// Turning a Gmail scan into the three groups on the results screen (product-plan
// §1–2): You're paying for · Please confirm · Not added, each uncertain item
// with a one-line reason built from a template (§8). Pure, so it's tested in Node.

import { addCycle, daysBetween, nextRenewalOnOrAfter, parseISODate } from "./dates.js";
import { hostMatches } from "./services.js";

const YEARLY_GUESS_AFTER_DAYS = 300;

const monthName = (iso) => parseISODate(iso).toLocaleDateString(undefined, { month: "long" });
const shortDate = (iso) => parseISODate(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
export const shortDateForReason = shortDate;

// "11 months ago" / "6 weeks ago" / "12 days ago"
export function timeAgo(fromISO, today) {
  const days = daysBetween(fromISO, today);
  if (days >= 60) return `${Math.round(days / 30.4)} months ago`;
  if (days >= 21) return `${Math.round(days / 7)} weeks ago`;
  return days === 1 ? "yesterday" : `${days} days ago`;
}

/**
 * Why an item needs a quick yes/no, as one question and a one-line reason.
 * kind decides what "yes" does: see candidateToSubscription.
 *   { kind, title, reason, detail, yes, no }
 * title is the card's question; reason is the short line (Overview, popup,
 * scan results); detail is the longer line on the Review card.
 */
export function reasonFor(item, today) {
  if (item.plan) {
    const reason = `Found ${item.receiptCount} order receipts. Do you have ${item.plan}?`;
    return { kind: "plan", title: item.name, reason, detail: reason, yes: `Yes, add ${item.plan}`, no: "No" };
  }
  if (item.reason === "irregular") {
    return { kind: "add", title: `Is ${item.name} a subscription?`, reason: "Irregular one-off receipts", detail: "Its receipts come at irregular times with different amounts.", yes: "Yes, add it", no: "No" };
  }

  const name = item.name;
  const still = { title: `Still paying for ${name}?`, yes: "Yes, still paying", no: "No, cancelled" };
  const last = item.lastCharged;

  if (last && item.charges?.length === 1 && daysBetween(last, today) >= YEARLY_GUESS_AFTER_DAYS) {
    const renews = nextRenewalOnOrAfter(addCycle(last, "yearly", Number(last.slice(8))), "yearly", Number(last.slice(8)), today);
    const reason = `Last receipt was ${timeAgo(last, today)}`;
    return { kind: "yearly", ...still, reason, detail: `${reason}. If it's yearly, it renews ${shortDate(renews)}.` };
  }
  if (item.status === "lapsed" && last) {
    const reason = `Receipts stopped in ${monthName(last)}`;
    return { kind: "still", ...still, reason, detail: `${reason}, but we didn't see a cancellation email.` };
  }
  if (item.price === "" || item.price == null) {
    const reason = "Couldn't find a price in the receipt";
    return { kind: "still", ...still, reason, detail: `${reason}. You can add it afterwards.` };
  }
  if (item.charges?.length === 1 && !item.cycleConfident) {
    const reason = `Only one receipt found (${monthName(last)})`;
    return { kind: "still", ...still, reason, detail: `${reason}, so we're not sure how often it charges.` };
  }
  if (!item.cycleConfident) {
    const reason = "Couldn't tell how often it charges";
    return { kind: "still", ...still, reason, detail: `${reason}. You can set monthly or yearly after adding it.` };
  }
  const reason = "Not sure this is a subscription";
  return { kind: "add", title: `Is ${name} a subscription?`, reason, detail: `Only ${item.messageCount} email${item.messageCount === 1 ? "" : "s"} looked like receipts.`, yes: "Yes, add it", no: "No" };
}

// An item is "already tracked" if a current subscription shares its name or a domain.
function isTracked(item, subscriptions) {
  const name = item.name.toLowerCase();
  return subscriptions.some(
    (s) =>
      s.status !== "cancelled" &&
      (s.name.toLowerCase() === name || (item.domains ?? []).some((d) => s.domains?.some((sd) => hostMatches(d, sd) || hostMatches(sd, d)))),
  );
}

/**
 * { paying, confirm, notAdded, tracked }
 *   paying:   candidates we're confident about (ticked by default)
 *   confirm:  { item, ...reasonFor(item) }
 *   notAdded: { item, note }: cancelled (stored as "cancelled before you joined") or one-off
 */
export function classifyScan({ candidates, rejected = [], questions = [] }, { today, subscriptions = [] }) {
  const out = { paying: [], confirm: [], notAdded: [], tracked: [] };
  for (const c of candidates) {
    if (isTracked(c, subscriptions)) {
      out.tracked.push(c);
      continue;
    }
    if (c.status === "cancelled") {
      const note = c.trialEnded ? `Trial ended ${shortDate(c.cancelledOn)}, no charge since` : c.cancelledOn ? `Cancellation email on ${shortDate(c.cancelledOn)}` : "Cancellation email found";
      out.notAdded.push({ item: c, note });
      continue;
    }
    // Sure only when we know how often it charges (or it's a trial with an end date).
    const sure = c.status === "active" && c.confidence !== "low" && c.price !== "" && (c.isTrial || c.cycleConfident);
    if (sure) out.paying.push(c);
    else out.confirm.push({ item: c, ...reasonFor(c, today) });
  }
  for (const q of questions) if (!isTracked(q, subscriptions)) out.confirm.push({ item: q, ...reasonFor(q, today) });
  for (const r of rejected) if (!isTracked(r, subscriptions)) out.notAdded.push({ item: r, note: "One-off receipts, not a subscription" });
  return out;
}

/**
 * The subscription to store for a scan item.
 *   answer "yes": add it (kind "yearly" as yearly; "plan" the plan, with no price yet).
 *   answer "no": a cancelled candidate or a "still paying?" No is stored as
 *   cancelled before the user joined (listed, never counted in savings);
 *   "Is X a subscription?" No stores nothing.
 * Returns null when nothing should be stored.
 */
export function candidateToSubscription(item, { today, answer = "yes", kind = null, id, now = Date.now() }) {
  const base = {
    id,
    createdAt: now,
    source: "gmail",
    name: item.plan && answer === "yes" ? `${item.name.replace(/\s+prime$/i, "")} ${item.plan}`.trim() : item.name,
    domains: item.domains ?? (item.domain ? [item.domain] : []),
    cancelUrl: item.cancelUrl ?? "",
    currency: item.currency ?? "USD",
    charges: item.charges ?? [],
    billedVia: item.billedVia ?? null,
    notifiedFor: null,
  };

  if (kind === "plan") {
    if (answer !== "yes") return null;
    return { ...base, price: "", cycle: "monthly", status: "active", nextRenewal: null, anchorDay: null, priceSource: "manual", confirmedByReceipt: false };
  }

  const cycle = kind === "yearly" ? "yearly" : item.cycle ?? "monthly";
  const last = item.lastCharged;
  const anchorDay = last ? Number(last.slice(8)) : item.anchorDay ?? null;
  const receiptFields = { price: item.price ?? "", cycle, anchorDay, priceSource: "receipt", confirmedByReceipt: item.price !== "" && item.price != null };

  if (answer === "no") {
    if (kind === "add" && answer === "no") return null; // "Is X a subscription?" No
    return { ...base, ...receiptFields, status: "cancelled", cancelledAt: item.cancelledOn ?? last ?? today, cancelledWhileTracking: false, nextRenewal: null };
  }

  let nextRenewal = item.nextRenewal ?? null;
  if (last && (kind === "yearly" || !nextRenewal || nextRenewal < today)) {
    nextRenewal = nextRenewalOnOrAfter(addCycle(last, cycle, anchorDay), cycle, anchorDay, today);
  }
  return { ...base, ...receiptFields, status: item.isTrial ? "trial" : "active", nextRenewal };
}
