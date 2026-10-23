import { observeNavigation, forgetTab } from "./lib/detection.js";
import { load, save, newId, updateBadge, dismissPending, migrateStorage, recordVisits, mergeWeeklyVisits } from "./lib/storage.js";
import { findServiceByHost, guessName, hostMatches } from "./lib/services.js";
import { today, daysBetween, nextRenewalOnOrAfter } from "./lib/dates.js";
import { formatPrice } from "./lib/money.js";
import { isStale } from "./lib/summary.js";
import { usageFromHistory, VISIT_GAP_MS } from "./lib/usage.js";
import { scanInbox } from "./lib/inbox-scan.js";
import { GmailNeedsSignInError, BACKGROUND_PASS_WAITS } from "./lib/gmail.js";
import { mergeReceipts, resyncReason } from "./lib/resync.js";
import { reviewItem, sortedEntry } from "./lib/review.js";
import { FX_URL, converter, otherCurrencies, parseRates, ratesAreStale } from "./lib/fx.js";

const CHECK_ALARM = "renewal-check";
const SYNC_ALARM = "gmail-sync";
const SYNC_EVERY_MINUTES = 6 * 60;
const DAY_MS = 86_400_000;
const DISMISS_FOR_MS = 30 * 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Startup: alarms can be cleared on browser restart, so always re-create them,
// and run a check straight away to catch reminders missed while Chrome was closed.

async function init() {
  await migrateStorage();
  await chrome.alarms.create(CHECK_ALARM, { periodInMinutes: 60, delayInMinutes: 1 });
  await chrome.alarms.create(SYNC_ALARM, { periodInMinutes: SYNC_EVERY_MINUTES, delayInMinutes: 5 });
  await updateBadge();
  await checkRenewals();
  await backfillUsage();
  await refreshRates();
}

chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  // The first monthly check-in comes next month.
  if (reason === "install") await save({ installedAt: today(), stats: { remindersSent: 0, lastCheckIn: today().slice(0, 7) } });
  await init();
  // First run: open the full view on its welcome screen (the side panel itself
  // can't open without a click).
  if (reason === "install") await chrome.tabs.create({ url: chrome.runtime.getURL("src/panel/panel.html#overview") });
});
chrome.runtime.onStartup.addListener(init);

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === CHECK_ALARM) checkRenewals().then(refreshRates);
  if (alarm.name === SYNC_ALARM) syncGmail();
});

// "Check now" on the Review tab.
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "gmail-sync") return;
  syncGmail().then(() => sendResponse({ ok: true }), (err) => sendResponse({ ok: false, error: String(err) }));
  return true; // respond asynchronously
});

// ---------------------------------------------------------------------------
// Navigation: checkout detection + "last used" tracking.

async function onNavigate(details) {
  if (details.frameId !== 0) return;

  const merchant = await observeNavigation(details.tabId, details.url);
  if (merchant) await handleDetection(merchant, details.url, details.tabId);

  await recordUsage(details.url);
}

chrome.webNavigation.onCompleted.addListener(onNavigate);
// Single-page apps (most checkout flows) change the URL without a full load.
chrome.webNavigation.onHistoryStateUpdated.addListener(onNavigate);
chrome.tabs.onRemoved.addListener(forgetTab);

async function handleDetection(domain, url, tabId) {
  const { subscriptions, pending, dismissed, settings } = await load("subscriptions", "pending", "dismissed", "settings");
  if (!settings.detectCheckouts) return;

  // Re-subscribing to something cancelled earlier is still worth asking about.
  const current = subscriptions.filter((s) => s.status !== "cancelled");
  if (current.some((s) => s.domains.some((d) => hostMatches(domain, d) || hostMatches(d, domain)))) return;
  if (pending.some((p) => p.domain === domain)) return;
  if (dismissed[domain] && Date.now() - dismissed[domain] < DISMISS_FOR_MS) return;

  const service = await findServiceByHost(domain);
  // tabId lets the popup read the price from this tab (activeTab) when the user clicks our icon.
  const item = { id: newId(), domain, name: service?.name ?? guessName(domain), url, tabId, detectedAt: Date.now() };
  await save({ pending: [...pending, item] });
  await updateBadge();

  chrome.notifications.create(`detect:${item.id}`, {
    type: "basic",
    iconUrl: chrome.runtime.getURL("icons/icon128.png"),
    title: `Did you just subscribe to ${item.name}?`,
    message: "Add it to Subscription Check to track the cost and get a reminder before you're charged.",
    buttons: [{ title: "Add it" }, { title: "Not a subscription" }],
    requireInteraction: true,
  });
}

async function recordUsage(urlString) {
  let hostname;
  try {
    hostname = new URL(urlString).hostname;
  } catch {
    return;
  }
  const { subscriptions, settings } = await load("subscriptions", "settings");
  if (!settings.trackVisits) return;
  const now = Date.now();
  // Page loads within VISIT_GAP_MS of the last one are the same visit, so
  // lastUsed can lag by up to that long. Good enough for "visited today".
  const visited = subscriptions.filter(
    (s) =>
      s.status !== "cancelled" &&
      s.domains.some((d) => hostMatches(hostname, d)) &&
      (!s.lastUsed || now - s.lastUsed >= VISIT_GAP_MS),
  );
  if (!visited.length) return;
  for (const sub of visited) sub.lastUsed = now;
  await save({ subscriptions });
  await recordVisits(visited.map((s) => s.id), now);
}

// ---------------------------------------------------------------------------
// Usage backfill: whichever page adds a subscription, fill in its visits from
// Chrome history (~90 days) once.

let backfilling = false;
let backfillAgain = false;

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.subscriptions) backfillUsage();
  if (area === "local" && (changes.subscriptions || changes.settings)) refreshRates();
});

async function backfillUsage() {
  if (backfilling) {
    backfillAgain = true;
    return;
  }
  backfilling = true;
  try {
    do {
      backfillAgain = false;
      const { subscriptions, settings } = await load("subscriptions", "settings");
      if (!settings.trackVisits) return;
      const todo = subscriptions.filter((s) => !s.usageBackfilled && s.domains?.length);
      if (!todo.length) continue;

      const lastUsed = new Map();
      for (const sub of todo) {
        const usage = await usageFromHistory(sub.domains);
        await mergeWeeklyVisits(sub.id, usage.weekly);
        lastUsed.set(sub.id, usage.lastUsed);
      }
      // Re-read: the list may have changed while history was being read.
      const { subscriptions: fresh } = await load("subscriptions");
      for (const sub of fresh) {
        if (!lastUsed.has(sub.id)) continue;
        sub.usageBackfilled = true;
        sub.lastUsed = Math.max(sub.lastUsed ?? 0, lastUsed.get(sub.id) ?? 0) || null;
      }
      await save({ subscriptions: fresh });
    } while (backfillAgain);
  } finally {
    backfilling = false;
  }
}

// ---------------------------------------------------------------------------
// Renewal reminders.

async function checkRenewals() {
  const { subscriptions, settings, stats } = await load("subscriptions", "settings", "stats");
  const now = today();
  let changed = false;

  for (const sub of subscriptions) {
    if (!sub.nextRenewal || sub.status === "cancelled") continue;

    // Roll past renewals forward. A trial whose end date has passed is now paid.
    if (sub.nextRenewal < now) {
      sub.nextRenewal = nextRenewalOnOrAfter(sub.nextRenewal, sub.cycle, sub.anchorDay, now);
      if (sub.status === "trial") sub.status = "active";
      changed = true;
    }

    const trial = sub.status === "trial";
    const reminderDays = sub.reminderDays ?? (trial ? settings.trialReminderDays : settings.reminderDays);
    const daysLeft = daysBetween(now, sub.nextRenewal);
    if (daysLeft <= reminderDays && sub.notifiedFor !== sub.nextRenewal) {
      notifyRenewal(sub, daysLeft);
      sub.notifiedFor = sub.nextRenewal;
      stats.remindersSent += 1;
      changed = true;
    }
  }

  if (settings.monthlyCheckIn && stats.lastCheckIn !== now.slice(0, 7) && subscriptions.some((s) => s.status !== "cancelled")) {
    const { fx } = await load("fx");
    notifyCheckIn(subscriptions, now, converter(settings.currency, fx), settings.currency);
    stats.lastCheckIn = now.slice(0, 7);
    changed = true;
  }

  if (changed) await save({ subscriptions, stats });
}

function notifyRenewal(sub, daysLeft) {
  const when = daysLeft <= 0 ? "today" : daysLeft === 1 ? "tomorrow" : `in ${daysLeft} days`;
  const price = formatPrice(sub);
  const trial = sub.status === "trial";
  const title = trial ? `${sub.name} free trial ends ${when}` : `${sub.name} renews ${when}`;
  const message = trial
    ? `You'll be charged${price ? ` ${price}` : ""} unless you cancel.`
    : `You'll be charged${price ? ` ${price}` : ""}. Still using it?`;

  chrome.notifications.create(`renew:${sub.id}`, {
    type: "basic",
    iconUrl: chrome.runtime.getURL("icons/icon128.png"),
    title,
    message,
    buttons: sub.cancelUrl ? [{ title: "Cancel / manage" }, { title: "Keep it" }] : [{ title: "Keep it" }],
    requireInteraction: true,
  });
}

// Monthly check-in: "November: $85.95 this month · 6 charges · 3 worth reviewing".
function notifyCheckIn(subscriptions, now, conv, currency) {
  const current = subscriptions.filter((s) => s.status !== "cancelled");
  const monthEnd = `${now.slice(0, 7)}-31`;
  const charges = current.filter((s) => s.nextRenewal && s.nextRenewal <= monthEnd && s.status !== "trial").length;
  const monthly = current.reduce((a, s) => a + conv.monthly(s), 0);
  const stale = current.filter((s) => isStale(s, now)).length;
  const month = new Date(`${now}T12:00:00`).toLocaleDateString(undefined, { month: "long" });
  const parts = [`${formatPrice({ price: monthly, currency })} a month`, `${charges} charge${charges === 1 ? "" : "s"} this month`];
  if (stale) parts.push(`${stale} not opened in 30+ days`);
  chrome.notifications.create("checkin:overview", {
    type: "basic",
    iconUrl: chrome.runtime.getURL("icons/icon128.png"),
    title: `${month} check-in`,
    message: parts.join(" · "),
  });
}

// ---------------------------------------------------------------------------
// Notification actions.

// Open the side panel at a route (e.g. "#sub/<id>"). The panel reads
// panelNavigate from session storage when it opens or is already open.
// sidePanel.open needs a user gesture; notification clicks may or may not count
// (HANDOFF validate #3), so fall back to the popup, then to a tab.
async function openFullView(hash = "#overview") {
  await chrome.storage.session.set({ panelNavigate: { hash, at: Date.now() } });
  try {
    const win = await chrome.windows.getLastFocused();
    await chrome.sidePanel.open({ windowId: win.id });
  } catch {
    await chrome.tabs.create({ url: chrome.runtime.getURL(`src/panel/panel.html${hash}`) });
  }
}

// A detection is confirmed in the popup, where clicking our icon also lets us
// read the price from the page.
async function openDetection() {
  try {
    await chrome.action.openPopup();
  } catch {
    await openFullView("#review");
  }
}

chrome.notifications.onButtonClicked.addListener(async (notificationId, buttonIndex) => {
  const [kind, id] = notificationId.split(":");
  chrome.notifications.clear(notificationId);

  if (kind === "detect") {
    if (buttonIndex === 0) await openDetection();
    else await dismissPending(id);
  }

  if (kind === "renew" && buttonIndex === 0) {
    const { subscriptions } = await load("subscriptions");
    const sub = subscriptions.find((s) => s.id === id);
    if (sub?.cancelUrl) await chrome.tabs.create({ url: sub.cancelUrl });
  }
});

chrome.notifications.onClicked.addListener(async (notificationId) => {
  chrome.notifications.clear(notificationId);
  const [kind, id] = notificationId.split(":");
  if (kind === "detect") await openDetection();
  else if (kind === "checkin") await openFullView("#overview");
  else await openFullView(`#sub/${id}`);
});

// ---------------------------------------------------------------------------
// Gmail re-sync: new receipts confirm prices, catch price rises and
// cancellations, and raise questions about anything new (resync.js). Never
// signs in interactively; if Google's sign-in has expired, Review asks.

let syncing = false;

async function syncGmail() {
  if (syncing) return;
  syncing = true;
  try {
    const { gmail } = await load("gmail");
    if (!gmail.connected) return;
    const since = gmail.lastCheckedAt ?? gmail.lastScanAt ?? Date.now() - 35 * DAY_MS;
    const lookbackDays = Math.max(35, Math.ceil((Date.now() - since) / DAY_MS) + 2);

    let analysis;
    let unreadIds = [];
    try {
      // Emails an earlier scan or check couldn't read come along, whatever their date.
      ({ analysis, unreadIds } = await scanInbox({ lookbackDays, interactive: false, max: 300, passWaits: BACKGROUND_PASS_WAITS, extraIds: gmail.unreadIds ?? [] }));
    } catch (err) {
      if (err instanceof GmailNeedsSignInError) {
        await save({ gmail: { ...gmail, needsSignIn: true } });
        return;
      }
      throw err;
    }

    // Read everything again: the user may have changed things during the fetch.
    const fresh = await load("subscriptions", "review", "sorted", "gmail");
    const asked = new Set(fresh.gmail.askedKeys ?? []);
    const { subscriptions, events, questions } = mergeReceipts(fresh.subscriptions, analysis, { today: today(), known: asked });
    for (const q of questions) asked.add(q.item.key);

    const before = new Map(fresh.subscriptions.map((s) => [s.id, s]));
    const newSorted = events
      .filter((e) => e.type === "cancel_confirmed")
      .map((e) => {
        const sub = subscriptions.find((s) => s.id === e.subId);
        return sortedEntry({ name: sub.name, outcome: "cancelled", note: "Cancellation confirmed by email", subId: sub.id, restore: before.get(sub.id) });
      });

    await save({
      subscriptions,
      review: [...fresh.review, ...questions.map((q) => reviewItem(q.item, resyncReason(q)))],
      sorted: [...newSorted, ...fresh.sorted].slice(0, 50),
      // Anything Gmail still wouldn't give us is tried again next time. (If the
      // service worker is stopped mid-read, nothing is saved and the next check
      // simply covers the same days.)
      gmail: { ...fresh.gmail, lastCheckedAt: Date.now(), needsSignIn: false, askedKeys: [...asked].slice(-300), unreadIds },
    });
    const rises = events.filter((e) => e.type === "price_rise").length;
    if (rises) {
      const { stats } = await load("stats");
      await save({ stats: { ...stats, priceRisesSpotted: (stats.priceRisesSpotted ?? 0) + rises } });
    }
    await updateBadge();
    for (const e of events) notifyResync(e, subscriptions.find((s) => s.id === e.subId));
  } finally {
    syncing = false;
  }
}

function notifyResync(event, sub) {
  if (!sub) return;
  const iconUrl = chrome.runtime.getURL("icons/icon128.png");
  if (event.type === "price_rise") {
    const pct = Math.round(((event.to - event.from) / event.from) * 100);
    chrome.notifications.create(`price:${sub.id}`, {
      type: "basic",
      iconUrl,
      title: `${sub.name} went up to ${formatPrice({ ...sub, price: event.to })}`,
      message: `Up ${pct}% from ${formatPrice({ ...sub, price: event.from })}. Still worth it?`,
    });
  }
  if (event.type === "cancel_confirmed") {
    chrome.notifications.create(`cancelled:${sub.id}`, {
      type: "basic",
      iconUrl,
      title: `${sub.name} cancellation confirmed`,
      message: sub.avoidedFrom
        ? `We saw the cancellation email. Your savings start on ${new Date(`${sub.avoidedFrom}T12:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" })}.`
        : "We saw the cancellation email.",
    });
  }
}

// ---------------------------------------------------------------------------
// Exchange rates for totals (fx.js): fetched at most once a day, and only when
// something is priced in a currency other than the one totals are shown in.
// The request carries no user data.

let fetchingRates = false;

async function refreshRates() {
  if (fetchingRates) return;
  fetchingRates = true;
  try {
    const { subscriptions, settings, fx } = await load("subscriptions", "settings", "fx");
    const needed = otherCurrencies(subscriptions, settings.currency);
    if (!needed.length) return;
    const missing = [settings.currency, ...needed].some((c) => c !== fx?.base && !fx?.rates?.[c]);
    if (!ratesAreStale(fx) && !missing) return;
    const res = await fetch(FX_URL);
    if (!res.ok) return;
    await save({ fx: { ...parseRates(await res.json()), fetchedAt: Date.now() } });
  } catch (err) {
    console.warn("Exchange rates unavailable", err); // totals stay unconverted and say so
  } finally {
    fetchingRates = false;
  }
}
