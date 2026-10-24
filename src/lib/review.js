// Review actions shared by the scan results, the Review tab, the Overview and
// the popup: answer a question, undo.
// Nothing is ever added silently (HANDOFF ground rules).

import { load, save, newId } from "./storage.js";
import { normalizeSubscription, cancelSubscription } from "./model.js";
import { candidateToSubscription, reasonFor } from "./scan.js";
import { loadServices } from "./services.js";
import { today as todayISO } from "./dates.js";

const KEEP_SORTED = 50;

// A question for the Review tab.
export function reviewItem(item, reason, now = Date.now()) {
  return { id: newId(), item, kind: reason.kind, title: reason.title, reason: reason.reason, detail: reason.detail, yes: reason.yes, no: reason.no, createdAt: now };
}

// An "Already sorted" entry. review (the question) is kept so Undo can ask it
// again. restore is a subscription as it was before an answer changed it (Undo
// puts it back instead of removing it).
export function sortedEntry({ name, outcome, note, subId = null, review = null, restore = null, now = Date.now() }) {
  return { id: newId(), name, outcome, note, at: now, subId, review, restore };
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
  const { review, sorted, subscriptions } = await load("review", "sorted", "subscriptions");
  const entry = sorted.find((x) => x.id === sortedId);
  if (!entry) return;
  const next = {
    sorted: sorted.filter((x) => x.id !== sortedId),
    subscriptions: entry.restore ? subscriptions.map((s) => (s.id === entry.restore.id ? entry.restore : s)) : subscriptions.filter((s) => s.id !== entry.subId),
  };
  if (entry.review) next.review = [{ ...entry.review, id: newId(), createdAt: Date.now() }, ...review];
  await save(next);
}

// Re-ask about something the user said wasn't a subscription during the scan.
export function reviewForRejected(item) {
  return reviewItem(item, reasonFor(item, todayISO()));
}
