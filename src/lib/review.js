// Review actions shared by the scan results, the Review tab, the Overview and
// the popup: answer a question, track or dismiss a detected signup, undo.
// Nothing is ever added silently (HANDOFF ground rules).

import { load, save, newId, updateBadge } from "./storage.js";
import { normalizeSubscription, cancelSubscription } from "./model.js";
import { candidateToSubscription, reasonFor } from "./scan.js";
import { loadServices } from "./services.js";
import { addCycle, addDays, parseISODate, toISODate, today as todayISO } from "./dates.js";

const KEEP_SORTED = 50;

// A question for the Review tab.
export function reviewItem(item, reason, now = Date.now()) {
  return { id: newId(), item, kind: reason.kind, title: reason.title, reason: reason.reason, detail: reason.detail, yes: reason.yes, no: reason.no, createdAt: now };
}

// An "Already sorted" entry. review (a question) or pending (a checkout signup)
// is kept so Undo can put it back. restore is a subscription as it was before an
// answer changed it (Undo puts it back instead of removing it).
export function sortedEntry({ name, outcome, note, subId = null, review = null, pending = null, restore = null, now = Date.now() }) {
  return { id: newId(), name, outcome, note, at: now, subId, review, pending, restore };
}

function outcomeNote(outcome, review) {
  if (outcome === "added") return "You confirmed.";
  if (outcome === "cancelled") return review?.reason ? `You confirmed. ${review.reason}.` : "You confirmed.";
  return "You said it isn't one.";
}

export async function answerReview(reviewId, answer) {
  const { review, sorted, subscriptions } = await load("review", "sorted", "subscriptions");
  const r = review.find((x) => x.id === reviewId);
  if (!r) return;
  const remaining = review.filter((x) => x.id !== reviewId);

  // "Did you cancel X?" from a cancellation email (resync.js).
  if (r.kind === "cancel_email") {
    const i = subscriptions.findIndex((s) => s.id === r.item.subId);
    if (answer === "yes" && i !== -1) {
      const before = subscriptions[i];
      subscriptions[i] = { ...cancelSubscription(before, r.item.cancelledOn), cancelConfirmedByEmail: r.item.cancelledOn };
      sorted.unshift(sortedEntry({ name: before.name, outcome: "cancelled", note: `Cancellation confirmed by email, ${r.reason.replace("Cancellation email on ", "")}`, subId: before.id, review: r, restore: before }));
    } else {
      sorted.unshift(sortedEntry({ name: r.item.name, outcome: "kept", note: "You said you're still paying.", review: r }));
    }
    await save({ review: remaining, sorted: sorted.slice(0, KEEP_SORTED), subscriptions });
    return;
  }

  const services = await loadServices();
  const raw = candidateToSubscription(r.item, { today: todayISO(), answer, kind: r.kind, id: newId() });
  const sub = raw && normalizeSubscription(raw, { services });
  if (sub) subscriptions.push(sub);
  const outcome = !sub ? "not_subscription" : sub.status === "cancelled" ? "cancelled" : "added";
  sorted.unshift(sortedEntry({ name: sub?.name ?? r.item.name, outcome, note: outcomeNote(outcome, r), subId: sub?.id, review: r }));
  await save({ review: remaining, sorted: sorted.slice(0, KEEP_SORTED), subscriptions });
}

// Clear an "Already sorted" entry from the list. What it stored stays as it is;
// only the record (and its Undo) goes.
export async function dismissSorted(sortedId) {
  const { sorted } = await load("sorted");
  await save({ sorted: sorted.filter((x) => x.id !== sortedId) });
}

// Undo an "Already sorted" entry: remove what it stored and ask again.
export async function undoSorted(sortedId) {
  const { review, sorted, subscriptions, pending } = await load("review", "sorted", "subscriptions", "pending");
  const entry = sorted.find((x) => x.id === sortedId);
  if (!entry) return;
  const next = {
    sorted: sorted.filter((x) => x.id !== sortedId),
    subscriptions: entry.restore ? subscriptions.map((s) => (s.id === entry.restore.id ? entry.restore : s)) : subscriptions.filter((s) => s.id !== entry.subId),
  };
  if (entry.review) next.review = [{ ...entry.review, id: newId(), createdAt: Date.now() }, ...review];
  if (entry.pending) next.pending = [entry.pending, ...pending];
  await save(next);
  if (entry.pending) await updateBadge();
}

// Re-ask about something the user said wasn't a subscription during the scan.
export function reviewForRejected(item) {
  return reviewItem(item, reasonFor(item, todayISO()));
}

/**
 * The subscription for a signup spotted at checkout (popup or Review).
 * price/cycle come from the checkout page when we read it, else from the user.
 */
export function detectionToSubscription(item, { settings, typedPrice = null, typedCycle = null, id = newId(), now = Date.now() }) {
  const startDate = toISODate(new Date(item.detectedAt));
  const hasPrice = item.price != null;
  const cycle = hasPrice ? item.cycle ?? "monthly" : typedCycle ?? "monthly";
  const trial = item.trialDays > 0;
  const nextRenewal = trial ? addDays(startDate, item.trialDays) : addCycle(startDate, cycle);
  return {
    id,
    createdAt: now,
    source: "detected",
    name: item.name,
    domains: [item.domain],
    price: hasPrice ? item.price : (typedPrice ?? ""),
    currency: hasPrice ? item.currency : settings.currency,
    cycle,
    status: trial ? "trial" : "active",
    startedAt: startDate,
    nextRenewal,
    anchorDay: parseISODate(nextRenewal).getDate(),
    priceSource: hasPrice ? "checkout" : "manual",
    confirmedByReceipt: false,
    lastUsed: now,
  };
}

export async function trackDetection(pendingId, { typedPrice = null, typedCycle = null } = {}) {
  const { pending, subscriptions, settings, sorted } = await load("pending", "subscriptions", "settings", "sorted");
  const item = pending.find((p) => p.id === pendingId);
  if (!item) return;
  const services = await loadServices();
  const sub = normalizeSubscription(detectionToSubscription(item, { settings, typedPrice, typedCycle }), { services });
  sorted.unshift(sortedEntry({ name: sub.name, outcome: "added", note: "Spotted at checkout. You confirmed.", subId: sub.id, pending: item }));
  await save({ subscriptions: [...subscriptions, sub], pending: pending.filter((p) => p.id !== pendingId), sorted: sorted.slice(0, KEEP_SORTED) });
  await updateBadge();
}
