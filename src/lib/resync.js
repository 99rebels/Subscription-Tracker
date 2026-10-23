// Background Gmail re-sync (product-plan §3 layer 2): fold newly arrived receipts
// into tracked subscriptions. Pure, so it's tested in Node; background.js does
// the fetching, storing and notifying.
//
//   - a receipt confirms a price read at checkout (or corrects it)
//   - a higher amount than last time is a price rise
//   - a cancellation email confirms a cancellation the user started with us;
//     otherwise it becomes a question ("Did you cancel X?"), never a silent change
//   - receipts from something new become a question in Review, never added silently

import { addCycle, daysBetween, nextRenewalOnOrAfter } from "./dates.js";
import { hostMatches } from "./services.js";
import { cancelSubscription } from "./model.js";
import { shortDateForReason } from "./scan.js";

const SAME_CHARGE_DAYS = 3;

function matches(item, sub) {
  const name = item.name.toLowerCase();
  return sub.name.toLowerCase() === name || (item.domains ?? []).some((d) => sub.domains?.some((sd) => hostMatches(d, sd) || hostMatches(sd, d)));
}

function mergeCharges(existing, incoming) {
  const out = [...existing];
  const added = [];
  for (const c of incoming) {
    const dup = out.some((e) => Math.abs(daysBetween(e.date, c.date)) <= SAME_CHARGE_DAYS && Math.abs(e.amount - c.amount) < 0.01);
    if (!dup) {
      out.push(c);
      added.push(c);
    }
  }
  out.sort((a, b) => a.date.localeCompare(b.date));
  return { charges: out, added };
}

/**
 * subscriptions: stored list. analysis: analyseInbox() over the recent emails.
 * known: keys already asked about or answered (so we never ask twice).
 * Returns { subscriptions, events, questions }:
 *   events:    { type: "confirmed" | "price_corrected" | "price_rise" | "cancel_confirmed", subId, ... }
 *   questions: { kind: "cancel_email", item } | { kind: "new", item } for Review
 */
export function mergeReceipts(subscriptions, analysis, { today, known = new Set() }) {
  const events = [];
  const questions = [];
  const subs = subscriptions.map((s) => ({ ...s }));

  for (const c of analysis.candidates) {
    const sub = subs.find((s) => matches(c, s));

    if (!sub) {
      // Something new. Ask about active ones (paid, or on a trial) we haven't asked about before.
      if (c.status === "active" && (c.charges.length || c.isTrial) && !known.has(c.key)) questions.push({ kind: "new", item: c });
      continue;
    }

    // Cancellation email after the subscription was being tracked.
    if (c.status === "cancelled" && c.cancelledOn) {
      if (sub.status === "cancelled") {
        if (!sub.cancelConfirmedByEmail && sub.cancelledWhileTracking) {
          sub.cancelConfirmedByEmail = c.cancelledOn;
          events.push({ type: "cancel_confirmed", subId: sub.id, date: c.cancelledOn });
        }
      } else if (sub.cancelStartedAt && c.cancelledOn >= sub.cancelStartedAt) {
        Object.assign(sub, cancelSubscription(sub, c.cancelledOn), { cancelStartedAt: null, cancelConfirmedByEmail: c.cancelledOn });
        events.push({ type: "cancel_confirmed", subId: sub.id, date: c.cancelledOn });
      } else if (c.cancelledOn >= (sub.startedAt ?? "") && !known.has(`cancel:${sub.id}:${c.cancelledOn}`)) {
        questions.push({ kind: "cancel_email", item: { subId: sub.id, name: sub.name, domains: sub.domains, cancelledOn: c.cancelledOn, key: `cancel:${sub.id}:${c.cancelledOn}` } });
      }
      continue;
    }

    if (sub.status === "cancelled" || !c.charges.length) continue;

    const { charges, added } = mergeCharges(sub.charges ?? [], c.charges);
    if (!added.length) continue;
    const previous = charges.filter((x) => !added.includes(x)).at(-1);
    const latest = charges.at(-1);
    sub.charges = charges;

    if (sub.priceSource === "checkout" && !sub.confirmedByReceipt) {
      events.push(Math.abs(Number(sub.price) - latest.amount) < 0.01 ? { type: "confirmed", subId: sub.id } : { type: "price_corrected", subId: sub.id, from: Number(sub.price), to: latest.amount });
    } else if (previous && latest.amount > previous.amount * 1.005 && added.includes(latest)) {
      events.push({ type: "price_rise", subId: sub.id, from: previous.amount, to: latest.amount, date: latest.date });
    }
    sub.price = latest.amount;
    sub.currency = latest.currency ?? sub.currency;
    sub.priceSource = "receipt";
    sub.confirmedByReceipt = true;
    if (sub.status === "trial" && latest.date >= (sub.nextRenewal ?? latest.date)) sub.status = "active";

    // The next charge follows the latest receipt.
    const anchor = Number(latest.date.slice(8));
    const next = nextRenewalOnOrAfter(addCycle(latest.date, sub.cycle, anchor), sub.cycle, anchor, today);
    if (!sub.nextRenewal || next > sub.nextRenewal || sub.nextRenewal < today) {
      sub.nextRenewal = next;
      sub.anchorDay = anchor;
      sub.notifiedFor = null;
    }
  }

  return { subscriptions: subs, events, questions };
}

// The Review card for a re-sync question.
export function resyncReason(q) {
  if (q.kind === "cancel_email") {
    const when = shortDateForReason(q.item.cancelledOn);
    return {
      kind: "cancel_email",
      title: `Did you cancel ${q.item.name}?`,
      reason: `Cancellation email on ${when}`,
      detail: `We saw a cancellation email from ${q.item.name} on ${when}. If you cancelled, we'll stop counting it and start counting your savings.`,
      yes: "Yes, I cancelled",
      no: "No, still paying",
    };
  }
  const c = q.item;
  const per = { weekly: "/wk", monthly: "/mo", yearly: "/yr" }[c.cycle] ?? "";
  const money = (amount, currency) => new Intl.NumberFormat(undefined, { style: "currency", currency: currency ?? "USD" }).format(amount);
  if (c.isTrial) {
    const ends = c.nextRenewal ? `Free trial ends ${shortDateForReason(c.nextRenewal)}` : "Free trial";
    const then = Number(c.price) > 0 ? `, then ${money(Number(c.price), c.currency)}${c.cycleConfident ? per : ""}` : "";
    return {
      kind: "add",
      title: `Track your ${c.name} trial?`,
      reason: ends,
      detail: `${ends}${then}. We'll remind you before it starts charging.`,
      yes: "Track it",
      no: "Not a subscription",
    };
  }
  const last = c.charges.at(-1);
  const price = money(last.amount, last.currency);
  return {
    kind: "add",
    title: `Track ${c.name}?`,
    reason: `New receipt on ${shortDateForReason(last.date)}`,
    detail: `New receipt from ${c.name} on ${shortDateForReason(last.date)} for ${price}${c.cycleConfident ? per : ""}.`,
    yes: "Track it",
    no: "Not a subscription",
  };
}
