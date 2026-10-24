import { load, save, updateBadge, migrateStorage } from "./lib/storage.js";
import { today, daysBetween, nextRenewalOnOrAfter } from "./lib/dates.js";
import { formatPrice } from "./lib/money.js";
import { needsCheck } from "./lib/summary.js";
import { keepSubscription } from "./lib/model.js";
import { scanInbox } from "./lib/inbox-scan.js";
import { GmailNeedsSignInError, BACKGROUND_PASS_WAITS } from "./lib/gmail.js";
import { mergeReceipts, resyncReason } from "./lib/resync.js";
import { reviewItem, sortedEntry } from "./lib/review.js";
import { FX_URL, converter, otherCurrencies, parseRates, ratesAreStale } from "./lib/fx.js";

const CHECK_ALARM = "renewal-check";
const SYNC_ALARM = "gmail-sync";
// New signups are found from their receipt email, so check often. Emails are
// only downloaded once (mail-cache.js), so a check with nothing new is a
// couple of cheap searches.
const SYNC_EVERY_MINUTES = 60;
const DAY_MS = 86_400_000;

// ---------------------------------------------------------------------------
// Startup: alarms can be cleared on browser restart, so always re-create them,
// and run a check straight away to catch reminders missed while Chrome was closed.

async function init() {
  await migrateStorage();
  await chrome.alarms.create(CHECK_ALARM, { periodInMinutes: 60, delayInMinutes: 1 });
  await chrome.alarms.create(SYNC_ALARM, { periodInMinutes: SYNC_EVERY_MINUTES, delayInMinutes: 1 });
  await updateBadge();
  await checkRenewals();
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
// Whichever page changes something: a reminder due now (e.g. the next charge
// was just edited to tomorrow) goes out straight away instead of within the
// hour, and the badge follows the Review questions.

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (changes.subscriptions || changes.settings) checkRenewals();
  if (changes.review) updateBadge();
  if (changes.subscriptions || changes.settings) refreshRates();
});

// ---------------------------------------------------------------------------
// Renewal reminders.

// One check at a time; a change that lands during a check runs it again after.
let checking = false;
let checkAgain = false;

async function checkRenewals() {
  if (checking) {
    checkAgain = true;
    return;
  }
  checking = true;
  try {
    do {
      checkAgain = false;
      await checkRenewalsOnce();
    } while (checkAgain);
  } finally {
    checking = false;
  }
}

async function checkRenewalsOnce() {
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
    buttons: renewalButtons(sub).map((b) => ({ title: b.title })),
    requireInteraction: true,
  });
}

// "Keep it" also answers "Still using it?" (summary.js needsCheck).
function renewalButtons(sub) {
  const keep = { title: "Keep it", action: "keep" };
  return sub.cancelUrl ? [{ title: "Cancel / manage", action: "cancel" }, keep] : [keep];
}

// Monthly check-in: "November: $85.95 a month · 6 charges this month · 3 to check".
function notifyCheckIn(subscriptions, now, conv, currency) {
  const current = subscriptions.filter((s) => s.status !== "cancelled");
  const monthEnd = `${now.slice(0, 7)}-31`;
  const charges = current.filter((s) => s.nextRenewal && s.nextRenewal <= monthEnd && s.status !== "trial").length;
  const monthly = current.reduce((a, s) => a + conv.monthly(s), 0);
  const toCheck = current.filter((s) => needsCheck(s, now)).length;
  const month = new Date(`${now}T12:00:00`).toLocaleDateString(undefined, { month: "long" });
  const parts = [`${formatPrice({ price: monthly, currency })} a month`, `${charges} charge${charges === 1 ? "" : "s"} this month`];
  if (toCheck) parts.push(`${toCheck} to check`);
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

chrome.notifications.onButtonClicked.addListener(async (notificationId, buttonIndex) => {
  const [kind, id] = notificationId.split(":");
  chrome.notifications.clear(notificationId);

  if (kind !== "renew") return;
  const { subscriptions } = await load("subscriptions");
  const i = subscriptions.findIndex((s) => s.id === id);
  if (i === -1) return;
  const action = renewalButtons(subscriptions[i])[buttonIndex]?.action;
  if (action === "cancel") await chrome.tabs.create({ url: subscriptions[i].cancelUrl });
  if (action === "keep") {
    subscriptions[i] = keepSubscription(subscriptions[i], today());
    await save({ subscriptions });
  }
});

chrome.notifications.onClicked.addListener(async (notificationId) => {
  chrome.notifications.clear(notificationId);
  const [kind, id] = notificationId.split(":");
  if (kind === "checkin") await openFullView("#overview");
  else if (kind === "new") await openFullView("#review");
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
    for (const q of questions) if (q.kind === "new") notifyNew(q);
  } finally {
    syncing = false;
  }
}

// A receipt from something we don't track yet: ask in Review (never added silently).
function notifyNew(q) {
  const reason = resyncReason(q);
  chrome.notifications.create(`new:${q.item.key}`, {
    type: "basic",
    iconUrl: chrome.runtime.getURL("icons/icon128.png"),
    title: reason.title,
    message: reason.detail,
  });
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
