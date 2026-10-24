// The numbers behind the Overview, Subscriptions, Detail and Savings screens.
// Pure functions over stored subscriptions, so they can be unit-tested in Node. They return numbers and lists; wording lives with the UI.
//
// Sums take an optional converter (fx.js) so totals add up in the display
// currency; amounts on individual items stay in the subscription's own currency.

import { monthlyPrice, cents } from "./money.js";
import { IDENTITY } from "./fx.js";
import { addCycle, addMonthsToKey, daysBetween } from "./dates.js";

// After the user says they still use something ("Keep"), we don't ask again for this long.
export const ASK_AGAIN_AFTER_DAYS = 90;

const sum = (values) => cents(values.reduce((a, b) => a + b, 0));
const byMonthly = (conv) => (a, b) => conv.monthly(b) - conv.monthly(a) || a.name.localeCompare(b.name);

export const isCurrent = (sub) => sub.status !== "cancelled";

// "$85.95/mo · $1,031 a year · 8 subscriptions · 1 trial"
export function totals(subs, conv = IDENTITY) {
  const current = subs.filter(isCurrent);
  return {
    monthly: sum(current.map(conv.monthly)),
    yearly: sum(current.map((s) => conv.monthly(s) * 12)),
    count: current.length,
    trials: current.filter((s) => s.status === "trial").length,
  };
}

// "86% of your $100 budget · $14.05 left". null when no budget is set.
export function budgetStatus(monthly, budget) {
  if (!budget || budget <= 0) return null;
  return { budget, share: monthly / budget, left: cents(budget - monthly), over: monthly > budget };
}

// Days since the user last said they still use it, or null if they never have.
export function daysSinceKept(sub, today) {
  return sub.keptAt ? daysBetween(sub.keptAt, today) : null;
}

// Paid for, and the user hasn't told us lately that they still use it: never,
// or not in ASK_AGAIN_AFTER_DAYS. Trials are covered by their own reminder.
// (We can't see usage: phones, TVs and things like insurance never show up in
// a browser, so we ask instead of guessing.)
export function needsCheck(sub, today) {
  if (!isCurrent(sub) || sub.status === "trial") return false;
  const days = daysSinceKept(sub, today);
  return days === null || days >= ASK_AGAIN_AFTER_DAYS;
}

// "Still using these? 3 subscriptions, $335.64 a year · $27.97/mo"
export function worthReviewing(subs, today, conv = IDENTITY) {
  const items = subs.filter((s) => needsCheck(s, today)).sort(byMonthly(conv));
  const monthly = sum(items.map(conv.monthly));
  return { items, monthly, yearly: sum(items.map((s) => conv.monthly(s) * 12)) };
}

// Next charges (and trial ends), soonest first.
export function upcoming(subs, today, { limit = Infinity } = {}) {
  return subs
    .filter((s) => isCurrent(s) && s.nextRenewal && s.nextRenewal >= today)
    .sort((a, b) => a.nextRenewal.localeCompare(b.nextRenewal) || a.name.localeCompare(b.name))
    .slice(0, limit)
    .map((sub) => ({
      sub,
      date: sub.nextRenewal,
      daysAway: daysBetween(today, sub.nextRenewal),
      amount: Number(sub.price) || 0,
      trial: sub.status === "trial",
    }));
}

export function trialsEndingSoon(subs, today, withinDays = 7) {
  return upcoming(subs, today).filter((u) => u.trial && u.daysAway <= withinDays);
}

/**
 * Every projected charge in [from, to), projected forward from each
 * subscription's next renewal. A trial's first "charge" is its end date, when
 * it converts unless cancelled; those are flagged trial: true.
 */
export function chargesBetween(subs, from, to, { includeTrials = true } = {}) {
  const out = [];
  for (const sub of subs) {
    if (!isCurrent(sub) || !sub.nextRenewal || !(Number(sub.price) > 0)) continue;
    const trial = sub.status === "trial";
    if (trial && !includeTrials) continue;
    for (let date = sub.nextRenewal; date < to; date = addCycle(date, sub.cycle, sub.anchorDay)) {
      if (date >= from) out.push({ sub, date, amount: Number(sub.price), trial });
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.sub.name.localeCompare(b.sub.name));
}

// One calendar month ("2026-11"): "$185.85 due · 6 charges".
export function month(subs, monthKey, conv = IDENTITY) {
  const charges = chargesBetween(subs, `${monthKey}-01`, `${addMonthsToKey(monthKey, 1)}-01`);
  return { month: monthKey, charges, total: sum(charges.map((c) => conv.amount(c.amount, c.sub.currency))) };
}

/**
 * The next 12 calendar months, starting next month. Trials are left out (they
 * may never convert), so the total matches the yearly figure in totals().
 * yearlyCharges names the big annual renewals that make a month heavy.
 */
export function forecast(subs, today, months = 12, conv = IDENTITY) {
  const first = addMonthsToKey(today.slice(0, 7), 1);
  const charges = chargesBetween(subs, `${first}-01`, `${addMonthsToKey(first, months)}-01`, { includeTrials: false });
  const out = [];
  for (let i = 0; i < months; i++) {
    const key = addMonthsToKey(first, i);
    const inMonth = charges.filter((c) => c.date.startsWith(key));
    out.push({
      month: key,
      total: sum(inMonth.map((c) => conv.amount(c.amount, c.sub.currency))),
      charges: inMonth,
      yearlyCharges: inMonth.filter((c) => c.sub.cycle === "yearly"),
    });
  }
  return { months: out, total: sum(out.map((m) => m.total)) };
}

// "Where it goes": monthly spend per category, biggest first. Trials cost nothing yet.
export function categories(subs, conv = IDENTITY) {
  const groups = new Map();
  for (const sub of subs) {
    if (!isCurrent(sub) || sub.status === "trial") continue;
    const key = sub.category || "Other";
    const group = groups.get(key) ?? { category: key, monthly: 0, count: 0 };
    group.monthly += conv.monthly(sub);
    group.count += 1;
    groups.set(key, group);
  }
  const total = [...groups.values()].reduce((a, g) => a + g.monthly, 0);
  return [...groups.values()]
    .map((g) => ({ ...g, monthly: cents(g.monthly), share: total ? g.monthly / total : 0 }))
    .sort((a, b) => b.monthly - a.monthly || a.category.localeCompare(b.category));
}

/**
 * Honest savings: only cancellations made while using the extension, counted
 * from the first charge each one avoided. A cancelled trial saves its first
 * charge once. Anything cancelled before the user joined is listed separately
 * and never counted.
 *
 * Returns { total, monthlyGrowth, since, items, series, beforeJoined }.
 * series is the running total at the end of each month (to today), for the chart.
 */
export function savings(subs, today, { installedAt = null, conv = IDENTITY } = {}) {
  const items = [];
  const events = [];
  for (const sub of subs) {
    if (sub.status !== "cancelled" || !sub.cancelledWhileTracking || !sub.avoidedFrom) continue;
    const price = Number(sub.price) || 0;
    const dates = [];
    if (sub.cancelledDuringTrial) {
      if (sub.avoidedFrom <= today) dates.push(sub.avoidedFrom);
    } else {
      for (let d = sub.avoidedFrom; d <= today; d = addCycle(d, sub.cycle, sub.anchorDay)) dates.push(d);
    }
    for (const date of dates) events.push({ date, amount: conv.amount(price, sub.currency) });
    items.push({
      sub,
      kind: sub.cancelledDuringTrial ? "trial" : "cancelled",
      chargesAvoided: dates.length,
      amount: cents(price * dates.length),
      monthly: sub.cancelledDuringTrial ? 0 : cents(conv.amount(monthlyPrice(sub), sub.currency)),
    });
  }
  items.sort((a, b) => b.amount - a.amount || a.sub.name.localeCompare(b.sub.name));

  const cancelDates = items.map((i) => i.sub.cancelledAt).filter(Boolean).sort();
  const since = installedAt ?? cancelDates[0] ?? null;

  const series = [];
  if (since) {
    const last = today.slice(0, 7);
    for (let key = since.slice(0, 7); key <= last; key = addMonthsToKey(key, 1)) {
      const end = key === last ? today : `${addMonthsToKey(key, 1)}-01`;
      const upTo = key === last ? (d) => d <= end : (d) => d < end;
      series.push({ month: key, total: sum(events.filter((e) => upTo(e.date)).map((e) => e.amount)) });
    }
  }

  return {
    total: sum(events.map((e) => e.amount)),
    monthlyGrowth: sum(items.map((i) => i.monthly)),
    since,
    items,
    series,
    beforeJoined: subs.filter((s) => s.status === "cancelled" && !s.cancelledWhileTracking),
  };
}

// Charge list newest first, plus each price change ("Went up from $5.99 to $7.99 in July").
export function priceHistory(sub) {
  const sorted = [...(sub.charges ?? [])].sort((a, b) => a.date.localeCompare(b.date));
  const changes = [];
  for (let i = 1; i < sorted.length; i++) {
    const from = sorted[i - 1].amount;
    const to = sorted[i].amount;
    if (from > 0 && Math.abs(to - from) / from > 0.005) {
      changes.push({ date: sorted[i].date, from, to, change: (to - from) / from });
    }
  }
  return {
    charges: sorted.reverse(),
    changes,
    latestRise: changes.filter((c) => c.to > c.from).at(-1) ?? null,
  };
}

/**
 * Over budget: what to cut (product-plan §4). Only subscriptions the user
 * hasn't said they still use are suggested (needsCheck); trials have their own
 * reminder. The cheapest one that covers the gap on its own wins; otherwise the
 * biggest go first. null when not over budget.
 * Returns { over, picks, saved, under, enough }.
 */
export function cutPlan(subs, budget, today, conv = IDENTITY) {
  const { monthly } = totals(subs, conv);
  if (!budget || monthly <= budget) return null;
  const over = cents(monthly - budget);
  const candidates = subs.filter((s) => needsCheck(s, today) && conv.monthly(s) > 0).sort(byMonthly(conv));
  const single = candidates.filter((s) => conv.monthly(s) >= over).at(-1);
  const ranked = single ? [single] : candidates;
  const picks = [];
  let saved = 0;
  for (const sub of ranked) {
    if (saved >= over) break;
    picks.push(sub);
    saved += conv.monthly(sub);
  }
  saved = cents(saved);
  return { over, picks, saved, under: cents(saved - over), enough: saved >= over };
}
