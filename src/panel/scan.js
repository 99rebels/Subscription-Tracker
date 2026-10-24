// Side panel · Gmail scan: intro → progress → results (PanelScanResults.dc.html).
// The scan runs here rather than in the popup, which closes when you click away.
import { h } from "../ui/dom.js";
import { icon, logoTile } from "../ui/components.js";
import * as t from "../ui/text.js";
import { load, save, newId, updateBadge } from "../lib/storage.js";
import { normalizeSubscription } from "../lib/model.js";
import { classifyScan, candidateToSubscription, reasonFor } from "../lib/scan.js";
import { reviewItem, sortedEntry } from "../lib/review.js";
import { scanInbox } from "../lib/inbox-scan.js";
import { isConfigured } from "../lib/gmail.js";
import { analyseInbox } from "../lib/receipts.js";
import { loadServices } from "../lib/services.js";
import { sampleInbox } from "../lib/sample-inbox.js";

// One scan at a time; survives re-renders while the panel stays open.
// phase: "intro" | "running" | "results" | "error"
let scan = { phase: "intro" };

export function renderScan(state, actions, { start = false } = {}) {
  if (start) history.replaceState(null, "", "#scan"); // so Back doesn't start another scan
  if (start && scan.phase === "intro") runScan(state, actions);
  const brand = h(
    "header",
    { class: "back-header", style: "justify-content: flex-start; gap: 8px; padding: 14px 16px 12px" },
    h("div", { class: "brand" }, h("div", { class: "brand-mark" }, icon("check", { size: 12, stroke: 3 })), "Subscription Check"),
  );
  if (scan.phase === "results") return [brand, ...resultsView(state, actions)];
  return [brand, h("main", { class: "content" }, scan.phase === "running" ? progressView() : scan.phase === "error" ? errorView(state, actions) : introView(state, actions))];
}

// ---------------------------------------------------------------------------

function introView(state, actions) {
  return h(
    "div",
    { style: "display: flex; flex-direction: column; gap: 14px" },
    h("h1", { style: "font: var(--text-heading); letter-spacing: -0.02em" }, "Find everything you're paying for"),
    h("p", { class: "muted", style: "font-size: 13px; line-height: 1.5" }, "We'll read about 15 months of receipts and show what you pay, when you're charged next, and what you've stopped using."),
    h("button", { class: "btn primary lg block", onclick: () => runScan(state, actions) }, icon("mail"), "Scan my Gmail receipts"),
    h("div", { class: "caption", style: "display: flex; align-items: center; justify-content: center; gap: 6px" }, icon("lock", { size: 13 }), "Read in your browser. Nothing leaves your computer."),
    isConfigured() ? null : h("div", { class: "note" }, icon("info", { size: 14 }), "Gmail isn't connected in this build yet, so the scan uses a sample inbox."),
  );
}

// Lines that take turns under the spinner, so a long scan never looks stalled.
const SCAN_LINES = [
  "Finding your subscriptions…",
  "Reading receipts in your browser…",
  "Looking for renewal dates…",
  "Spotting free trials before they charge…",
  "Checking for price rises…",
  "Nothing leaves your computer.",
];
const LINE_MS = 5000; // matches the line-fade animation in panel.css
const SPIN_MS = 1600; // matches .spinner
const SWAP_AT = LINE_MS * 0.95; // the line is hidden then (line-fade keyframes)
let lineTimer = null;

// The progress screen is drawn once; progress changes only the bar and the
// count, in place. If something else redraws the panel mid-scan (a storage
// change), the fresh spinner and line start where the old ones were (a negative
// animation delay from when the scan started), so nothing jumps back.
const elapsed = () => Date.now() - (scan.startedAt ?? Date.now());
const currentLine = () => SCAN_LINES[Math.floor((elapsed() + LINE_MS - SWAP_AT) / LINE_MS) % SCAN_LINES.length];

function timeLeft(seconds) {
  if (seconds == null) return "";
  if (seconds < 10) return "a few seconds left";
  if (seconds < 55) return "under a minute left";
  const minutes = Math.round(seconds / 60);
  return `about ${t.plural(minutes, "minute")} left`;
}

function progressLabel(p) {
  if (p.phase === "connect") return "Connecting to Gmail…";
  if (p.phase === "search") return "Searching your receipts…";
  if (p.phase === "sort") return "Sorting what we found…";
  if (p.phase === "retry") return `Gmail asked us to slow down. Trying the last ${t.plural(p.total - p.done, "email")} again…`;
  return `Reading ${p.done} of ${p.total} emails${p.secondsLeft != null && p.done < p.total ? ` · ${timeLeft(p.secondsLeft)}` : "…"}`;
}

// Gmail allows ~100 full emails a minute (gmail.js), so a big first scan takes
// minutes. Say so once, when the estimate first comes in over half a minute.
const SLOW_NOTE = "Gmail lets apps read about 100 emails a minute, so the first scan takes a little while. Later scans only read new mail, so they're quick.";

// "Found so far": services the emails read so far add up to, in the order they
// turned up. Names only: prices and dates can still change as older emails arrive.
function foundRow(c, isNew) {
  return h(
    "div",
    { class: `found-row${isNew ? " new" : ""}`, "data-key": c.key },
    logoTile(c, { size: 24 }),
    h("span", { class: "name" }, c.name),
    c.isTrial ? h("span", { class: "attention", style: "font-size: 11px; font-weight: 600" }, "Trial") : null,
  );
}

function foundView() {
  const found = scan.found ?? [];
  return h(
    "section",
    { id: "scan-found", class: "found-list", hidden: !found.length },
    h("div", { class: "caption", id: "scan-found-head" }, `Found so far · ${found.length}`),
    h("div", { id: "scan-found-rows", class: "found-rows" }, ...found.map((c) => foundRow(c, false))),
  );
}

function updateFound(candidates) {
  const current = candidates.filter((c) => c.status !== "cancelled");
  const keys = new Set(current.map((c) => c.key));
  const kept = (scan.found ?? []).filter((c) => keys.has(c.key)).map((c) => current.find((x) => x.key === c.key));
  const added = current.filter((c) => !kept.some((k) => k.key === c.key));
  scan.found = [...kept, ...added];
  const rows = document.getElementById("scan-found-rows");
  if (!rows) return;
  for (const el of [...rows.children]) if (!keys.has(el.dataset.key)) el.remove();
  for (const c of added) rows.append(foundRow(c, true));
  document.getElementById("scan-found-head").textContent = `Found so far · ${scan.found.length}`;
  document.getElementById("scan-found").hidden = !scan.found.length;
}

function progressShare(p) {
  if ((p.phase === "read" || p.phase === "retry") && p.total) return p.done / p.total;
  return p.phase === "sort" ? 1 : 0.03;
}

function progressView() {
  const p = scan.progress ?? { phase: "connect" };
  const spinner = h("div", { class: "spinner", role: "presentation" });
  spinner.style.animationDelay = `-${elapsed() % SPIN_MS}ms`;
  const line = h("div", { class: "scan-line", id: "scan-line", "aria-live": "polite" }, currentLine());
  line.style.animationDelay = `-${elapsed() % LINE_MS}ms`;
  const fill = h("div", { id: "scan-fill" });
  fill.style.width = `${Math.round(progressShare(p) * 100)}%`;
  startLineTimer();
  return h(
    "div",
    { style: "display: flex; flex-direction: column; gap: 12px; padding-top: 24px" },
    h("div", { style: "display: flex; align-items: center; gap: 12px" }, spinner, h("h1", { style: "font-size: 18px; font-weight: 700" }, "Scanning your receipts")),
    line,
    h("div", { class: "meter", id: "scan-meter", role: "progressbar", "aria-valuemin": 0, "aria-valuemax": 100, "aria-valuenow": Math.round(progressShare(p) * 100) }, fill),
    h("div", { class: "caption", id: "scan-label" }, progressLabel(p)),
    h("div", { class: "note", id: "scan-slow", hidden: !scan.slow }, icon("clock", { size: 14 }), SLOW_NOTE),
    h("div", { class: "caption", style: "display: flex; align-items: center; gap: 6px" }, icon("lock", { size: 13 }), "Read in your browser. Nothing leaves your computer."),
    foundView(),
  );
}

function updateProgress(p, actions) {
  scan.progress = p;
  if (p.secondsLeft > 30 && !scan.slow) {
    scan.slow = true;
    const note = document.getElementById("scan-slow");
    if (note) note.hidden = false;
  }
  const fill = document.getElementById("scan-fill");
  if (!fill) return actions.rerender(); // not on screen yet
  const pct = Math.round(progressShare(p) * 100);
  fill.style.width = `${pct}%`;
  document.getElementById("scan-meter")?.setAttribute("aria-valuenow", pct);
  const label = document.getElementById("scan-label");
  if (label) label.textContent = progressLabel(p);
}

// Swap the line's text while it's faded out, lined up with the animation.
function startLineTimer() {
  if (lineTimer) return;
  const next = () => ((SWAP_AT - (elapsed() % LINE_MS) + LINE_MS) % LINE_MS) + 20;
  const tick = () => {
    const el = document.getElementById("scan-line");
    if (el) el.textContent = currentLine();
    lineTimer = setTimeout(tick, next());
  };
  lineTimer = setTimeout(tick, next());
}

function stopLineTimer() {
  clearTimeout(lineTimer);
  lineTimer = null;
}

function errorView(state, actions) {
  return h(
    "div",
    { style: "display: flex; flex-direction: column; gap: 12px; padding-top: 24px" },
    h("h1", { style: "font-size: 18px; font-weight: 700" }, "The scan didn't finish"),
    h("p", { class: "caption" }, scan.error),
    h("div", { class: "btn-row" }, h("button", { class: "btn primary", onclick: () => runScan(state, actions) }, "Try again"), h("a", { class: "btn", href: "#overview" }, "Not now")),
  );
}

async function runScan(state, actions) {
  scan = { phase: "running", startedAt: Date.now(), progress: { phase: "connect" } };
  actions.rerender();
  try {
    const sample = !isConfigured();
    let analysis;
    let scanned;
    let unreadIds = [];
    if (sample) {
      const messages = sampleInbox();
      const services = await loadServices();
      // Step through the sample like a real read, so the demo (and the preview)
      // shows the progress screen and "found so far".
      for (let done = 1; done <= messages.length; done++) {
        updateProgress({ phase: "read", done, total: messages.length, secondsLeft: ((messages.length - done) * 2500) / messages.length / 1000 }, actions);
        if (done % 6 === 0) updateFound(analyseInbox(messages.slice(0, done), { services }).candidates);
        await new Promise((r) => setTimeout(r, 2500 / messages.length));
      }
      analysis = analyseInbox(messages, { services });
      scanned = messages.length;
    } else {
      ({ analysis, scanned, unreadIds } = await scanInbox({ onProgress: (p) => updateProgress(p, actions), onFound: updateFound }));
    }
    updateProgress({ phase: "sort" }, actions);

    const { subscriptions } = await load("subscriptions");
    const groups = classifyScan(analysis, { today: state.today, subscriptions });
    scan = {
      phase: "results",
      sample,
      scanned,
      unreadIds,
      // Each row: { item, ticked } / { item, ...reason, answer } / { item, note, added }
      paying: groups.paying.map((item) => ({ item, ticked: true })),
      confirm: groups.confirm.map((c) => ({ ...c, answer: null })),
      notAdded: groups.notAdded.map((n) => ({ ...n, added: false })),
      tracked: groups.tracked.length,
    };
  } catch (err) {
    scan = { phase: "error", error: err?.message?.includes("did not approve") || err?.message?.includes("canceled") ? "Gmail access wasn't approved, so nothing was read." : `Something went wrong reading Gmail: ${err?.message ?? err}` };
  }
  stopLineTimer();
  actions.rerender();
}

// ---------------------------------------------------------------------------
// Results

function rowSub(c) {
  if (c.isTrial) return c.nextRenewal ? `Trial ends ${t.shortDate(c.nextRenewal)}${Number(c.price) > 0 ? `, then ${t.pricePerCycle(c)}` : ""}` : "Free trial";
  const yearly = c.cycle === "yearly" ? "Yearly · " : "";
  const how = c.processor ? `Billed via ${c.processor}` : `${t.plural(c.charges.length, "receipt")}`;
  return `${yearly}${c.nextRenewal ? `${how} · renews ${t.shortDate(c.nextRenewal)}` : how}`;
}

function resultsView(state, actions) {
  const { settings } = state;
  const currency = settings.currency;
  const rerender = actions.rerender;

  // Everything that will be added: ticked rows, "yes" answers, "Add anyway".
  const willAdd = [...scan.paying.filter((p) => p.ticked).map((p) => p.item), ...scan.confirm.filter((c) => c.answer === "yes" && !c.item.plan).map((c) => (c.kind === "yearly" ? { ...c.item, cycle: "yearly" } : c.item)), ...scan.notAdded.filter((n) => n.added).map((n) => n.item)];
  const asSubs = willAdd.map((c) => ({ ...c, status: c.isTrial ? "trial" : "active", domains: c.domains ?? [] }));
  const monthly = asSubs.reduce((a, s) => a + state.conv.monthly(s), 0);
  const unanswered = scan.confirm.filter((c) => !c.answer).length;
  const addCount = scan.paying.filter((p) => p.ticked).length + scan.confirm.filter((c) => c.answer === "yes").length + scan.notAdded.filter((n) => n.added).length;

  const summary = [`${t.moneyWhole(monthly * 12, currency)} a year across ${t.plural(asSubs.length, "subscription")}`];
  if (unanswered) summary.push(`${unanswered} to confirm`);

  const head = h(
    "section",
    { style: "display: flex; flex-direction: column; gap: 6px" },
    h("div", { class: "caption", style: "display: flex; align-items: center; gap: 6px" }, icon("check", { size: 13, stroke: 2.6 }), scan.sample ? `Sample inbox: ${t.plural(scan.scanned, "email")} (Gmail isn't connected yet)` : `Scanned ${t.plural(scan.scanned, "receipt")} from the last 15 months`),
    h("h1", { class: "caption", style: "font-weight: 500; margin-top: 8px" }, "You're paying"),
    h("div", { style: "display: flex; align-items: baseline; gap: 4px" }, h("span", { class: "figure", style: "font-size: 44px; line-height: 1.05" }, t.money(monthly, currency)), h("span", { class: "muted", style: "font-size: 16px" }, "/mo")),
    h("div", { class: "muted", style: "font-size: 13px" }, summary.join(", ")),
    scan.tracked ? h("div", { class: "caption" }, `${t.plural(scan.tracked, "subscription")} you already track ${scan.tracked === 1 ? "was" : "were"} left out.`) : null,
    // Never hide emails Gmail wouldn't give us.
    scan.unreadIds?.length
      ? h("div", { class: "note", style: "margin-top: 6px" }, icon("info", { size: 14 }), `Gmail hasn't let us read ${t.plural(scan.unreadIds.length, "email")} yet. We'll keep trying in the background, and anything we find will show up in Review.`)
      : null,
  );

  const payingRows = scan.paying.map((p) => {
    const c = p.item;
    const box = h("input", { type: "checkbox", checked: p.ticked, style: "width: 16px; height: 16px; margin: 0; accent-color: var(--accent); flex-shrink: 0", "aria-label": `Add ${c.name}` });
    box.addEventListener("change", () => {
      p.ticked = box.checked;
      rerender();
    });
    const price = c.isTrial ? h("span", { class: "num muted", style: "font-size: 13px; font-weight: 600" }, t.money(0, c.currency)) : h("span", { class: "num strong", style: "font-size: 13px" }, t.money(Number(c.price) || 0, c.currency), c.cycle === "yearly" ? h("span", { class: "muted", style: "font-weight: 400" }, "/yr") : null);
    return h(
      "label",
      { class: "row compact", style: "cursor: pointer" },
      box,
      logoTile(c, { size: 28 }),
      h("div", { class: "row-main" }, h("div", { class: "row-title" }, h("span", { class: "name" }, c.name), c.isTrial ? h("span", { class: "attention", style: "font-size: 11px; font-weight: 600" }, "Trial") : null), h("div", { class: "row-sub" }, rowSub(c))),
      price,
    );
  });

  const confirmRows = scan.confirm.map((c) => {
    const priced = Number(c.item.price) > 0 ? ` · ${t.money(c.item.price, c.item.currency)}${c.kind === "yearly" ? "/yr" : t.cycleUnit(c.item.cycle)}` : "";
    const answered = c.answer ? h("div", { class: "caption", style: "padding-left: 38px; display: flex; gap: 8px; align-items: center" }, c.answer === "yes" ? "Will be added." : c.kind === "plan" || c.kind === "add" ? "Won't be added." : "Marked as cancelled.", h("button", { class: "btn ghost sm", style: "height: auto; padding: 0; color: var(--accent)", onclick: () => ((c.answer = null), rerender()) }, "Change")) : null;
    return h(
      "div",
      { class: "attention-item" },
      h("div", { class: "line" }, logoTile(c.item, { size: 28 }), h("div", { class: "row-main" }, h("div", { class: "row-title" }, h("span", { class: "name" }, `${c.item.name}${priced}`)), h("div", { class: "row-sub", style: "white-space: normal" }, c.reason))),
      answered ??
        h(
          "div",
          { class: "actions", style: "padding-left: 38px" },
          h("button", { class: "btn sm", onclick: () => ((c.answer = "yes"), rerender()) }, c.kind === "yearly" || c.kind === "still" ? "Still paying" : c.yes),
          h("button", { class: "btn sm", onclick: () => ((c.answer = "no"), rerender()) }, c.kind === "yearly" || c.kind === "still" ? "Cancelled" : c.no),
        ),
    );
  });

  const notAddedRows = scan.notAdded.map((n) =>
    h(
      "div",
      { class: "row compact", style: "border-bottom-color: var(--raised)" },
      h("div", { class: "row-main" }, h("div", { class: "row-title muted", style: "font-weight: 400" }, h("span", { class: "name" }, n.item.name)), h("div", { class: "row-sub faint" }, n.added ? "Will be added" : n.note)),
      h("a", { href: "#", style: "font-size: 12px", onclick: (e) => (e.preventDefault(), (n.added = !n.added), rerender()) }, n.added ? "Undo" : "Add anyway"),
    ),
  );

  const finish = h("button", { class: "btn primary lg block", onclick: () => finishScan(state, actions), disabled: null }, addCount ? `Add ${t.plural(addCount, "subscription")}` : "Done");

  return [
    h(
      "main",
      { class: "content", style: "gap: 22px; padding-top: 20px" },
      head,
      scan.paying.length ? h("section", { class: "section" }, h("div", { class: "section-head" }, h("h2", {}, `You're paying for · ${scan.paying.length}`), h("span", { class: "caption" }, "Untick anything that's wrong")), h("div", { class: "card" }, ...payingRows)) : null,
      scan.confirm.length ? h("section", { class: "section" }, h("div", { class: "section-head" }, h("h2", {}, `Please confirm · ${scan.confirm.length}`)), h("div", { class: "card" }, ...confirmRows)) : null,
      scan.notAdded.length ? h("section", { class: "section" }, h("div", { class: "section-head" }, h("h2", { class: "muted" }, `Not added · ${scan.notAdded.length}`)), h("div", { class: "cancelled-list" }, ...notAddedRows)) : null,
      !scan.paying.length && !scan.confirm.length && !scan.notAdded.length ? h("div", { class: "empty" }, "We didn't find any subscription receipts. We'll keep checking as new emails arrive.") : null,
      h("div", { class: "caption", style: "display: flex; gap: 8px; line-height: 1.5" }, icon("lock", { size: 13 }), "Read in your browser. None of your email left this computer."),
    ),
    h(
      "footer",
      { style: "padding: 12px 16px 16px; border-top: 1px solid var(--raised); display: flex; flex-direction: column; gap: 6px; flex-shrink: 0" },
      finish,
      unanswered ? h("div", { class: "caption", style: "text-align: center" }, `You can answer the ${unanswered === 1 ? "question" : `${unanswered} questions`} later in Review`) : null,
    ),
  ];
}

// Store everything: subscriptions to add, questions for Review, and an
// "Already sorted" entry for each decision so it can be undone.
async function finishScan(state, actions) {
  const { subscriptions, review, sorted, gmail } = await load("subscriptions", "review", "sorted", "gmail");
  const services = await loadServices();
  const today = state.today;
  const add = (raw) => {
    if (!raw) return null;
    const sub = normalizeSubscription(raw, { services });
    subscriptions.push(sub);
    return sub;
  };
  const newSorted = [];

  for (const p of scan.paying) {
    if (p.ticked) add(candidateToSubscription(p.item, { today, id: newId() }));
    else newSorted.push(sortedEntry({ name: p.item.name, outcome: "not_subscription", note: "You unticked it after the scan.", review: reviewItem(p.item, { ...reasonFor(p.item, today), kind: "add", title: `Is ${p.item.name} a subscription?`, yes: "Yes, add it", no: "No" }) }));
  }
  for (const c of scan.confirm) {
    const reason = { kind: c.kind, title: c.title, reason: c.reason, detail: c.detail, yes: c.yes, no: c.no };
    if (!c.answer) {
      review.push(reviewItem(c.item, reason));
      continue;
    }
    const sub = add(candidateToSubscription(c.item, { today, answer: c.answer, kind: c.kind, id: newId() }));
    const outcome = !sub ? "not_subscription" : sub.status === "cancelled" ? "cancelled" : "added";
    newSorted.push(sortedEntry({ name: sub?.name ?? c.item.name, outcome, note: outcome === "cancelled" ? `You confirmed. ${c.reason}.` : outcome === "added" ? "You confirmed." : "You said it isn't one.", subId: sub?.id, review: reviewItem(c.item, reason) }));
  }
  for (const n of scan.notAdded) {
    const cancelledCandidate = n.item.status === "cancelled";
    const reason = cancelledCandidate ? { kind: "still", title: `Still paying for ${n.item.name}?`, reason: n.note, detail: `${n.note}.`, yes: "Yes, still paying", no: "No, cancelled" } : reasonFor(n.item, today);
    if (n.added) {
      add(candidateToSubscription(n.item, { today, answer: "yes", kind: reason.kind, id: newId() }));
      continue;
    }
    // Cancelled before joining: stored so it shows under Cancelled, never counted in savings.
    const sub = cancelledCandidate ? add(candidateToSubscription(n.item, { today, answer: "no", id: newId() })) : null;
    newSorted.push(sortedEntry({ name: n.item.name, outcome: cancelledCandidate ? "cancelled" : "not_subscription", note: cancelledCandidate ? (n.item.cancelledOn ? `Cancellation confirmed by email, ${t.shortDate(n.item.cancelledOn)}` : "Cancellation confirmed by email") : "Irregular one-off receipts", subId: sub?.id, review: reviewItem(n.item, reason) }));
  }

  // Everything the scan showed has been decided or queued, so the background
  // re-sync shouldn't ask about it again.
  const askedKeys = [...new Set([...(gmail.askedKeys ?? []), ...[...scan.paying, ...scan.confirm, ...scan.notAdded].map((x) => x.item.key).filter(Boolean)])].slice(-300);
  await save({
    subscriptions,
    review,
    sorted: [...newSorted, ...sorted].slice(0, 50),
    gmail: { ...gmail, connected: !scan.sample, sample: scan.sample, needsSignIn: false, lastScanAt: Date.now(), lastCheckedAt: Date.now(), scanned: scan.scanned, askedKeys, unreadIds: scan.unreadIds ?? [] },
  });
  await updateBadge();
  // Emails Gmail wouldn't give us yet: the background picks them up now that
  // the results are saved (anything new it finds goes to Review).
  if (scan.unreadIds?.length) chrome.runtime.sendMessage({ type: "gmail-sync" }).catch(() => {});
  scan = { phase: "intro" };
  actions.navigate("#overview");
}
