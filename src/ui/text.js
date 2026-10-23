// Wording for the screens: every sentence is a template filled from numbers in
// summary.js (product-plan §8, no LLM). Pure, so it's tested in Node.
// Usage wording rule (HANDOFF): "no visits on this computer" / "no visits in N
// days", never "unused"; we can't see phones or TVs.

import { formatMoney, monthlyPrice } from "../lib/money.js";
import { daysSinceVisit, STALE_AFTER_DAYS } from "../lib/summary.js";
import { parseISODate } from "../lib/dates.js";

const LOCALE = undefined; // the browser's

export const capitalize = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);

// ["a"] -> "a"; ["a","b"] -> "a and b"; ["a","b","c"] -> "a, b and c"
export function joinAnd(items) {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
}

export const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

// ---------------------------------------------------------------------------
// Money and dates

export const money = (amount, currency = "USD") => formatMoney(amount, currency);
export const moneyWhole = (amount, currency = "USD") => formatMoney(amount, currency, { whole: true });

const UNITS = { weekly: "/wk", monthly: "/mo", yearly: "/yr" };
export const cycleUnit = (cycle) => UNITS[cycle] ?? "/mo";
const CYCLE_NAMES = { weekly: "Weekly", monthly: "Monthly", yearly: "Yearly" };
export const cycleName = (cycle) => CYCLE_NAMES[cycle] ?? "Monthly";

// "Nov 10"
export const shortDate = (iso) => parseISODate(iso).toLocaleDateString(LOCALE, { month: "short", day: "numeric" });
// "Sat 24"
export function weekdayDay(iso) {
  const d = parseISODate(iso);
  return `${d.toLocaleDateString(LOCALE, { weekday: "short" })} ${d.getDate()}`;
}
// "Mon, Nov 16"
export const longDay = (iso) => parseISODate(iso).toLocaleDateString(LOCALE, { weekday: "short", month: "short", day: "numeric" });
// "2026-11" -> "November 2026"
export const monthYear = (key) => parseISODate(`${key}-01`).toLocaleDateString(LOCALE, { month: "long", year: "numeric" });
// "2026-11" -> "November"
export const monthName = (key) => parseISODate(`${key}-01`).toLocaleDateString(LOCALE, { month: "long" });
// "2026-11" -> "N"
export const monthLetter = (key) => monthName(key)[0];
// "2025-03-14" -> "Mar 2025"
export const monthShortYear = (iso) => parseISODate(iso).toLocaleDateString(LOCALE, { month: "short", year: "numeric" });

// A past moment: "just now", "12 min ago", "2 hours ago", "yesterday", "5 days ago"
export function ago(ms, now = Date.now()) {
  const minutes = Math.round((now - ms) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return hours === 1 ? "an hour ago" : `${hours} hours ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? "yesterday" : `${days} days ago`;
}

// When a signup was spotted: "just now", "12 min ago", "today, 2:14 PM", "Oct 20, 9:05 AM"
export function spottedAt(ms, now = Date.now()) {
  const minutes = Math.round((now - ms) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const d = new Date(ms);
  const time = d.toLocaleTimeString(LOCALE, { hour: "numeric", minute: "2-digit" });
  return d.toDateString() === new Date(now).toDateString() ? `today, ${time}` : `${d.toLocaleDateString(LOCALE, { month: "short", day: "numeric" })}, ${time}`;
}

// 0 -> "today", 1 -> "tomorrow", 11 -> "in 11 days"
export function inDays(n) {
  if (n <= 0) return "today";
  if (n === 1) return "tomorrow";
  return `in ${n} days`;
}

// ---------------------------------------------------------------------------
// Subscriptions

// "visited 2 days ago" / "no visits in 64 days" / "no visits on this computer".
// stale is true for the amber wording.
export function usage(sub, today) {
  const days = daysSinceVisit(sub, today);
  if (days === null) return { text: "no visits on this computer", stale: true };
  if (days <= 0) return { text: "visited today", stale: false };
  if (days === 1) return { text: "visited yesterday", stale: false };
  if (days < STALE_AFTER_DAYS) return { text: `visited ${days} days ago`, stale: false };
  return { text: `no visits in ${days} days`, stale: true };
}

// "Canva Pro" (name + plan, unless the name already includes it)
export function displayName(sub) {
  if (!sub.plan || sub.name.toLowerCase().includes(sub.plan.toLowerCase())) return sub.name;
  return `${sub.name} ${sub.plan}`;
}

// "$14.99/mo" — the paid price per cycle
export const pricePerCycle = (sub) => `${money(Number(sub.price) || 0, sub.currency)}${cycleUnit(sub.cycle)}`;

// First line under a subscription's name, before the usage part.
// "Trial ends Oct 24 · then $14.99/mo" / "Renews Nov 10"
export function renewalText(sub) {
  if (!sub.nextRenewal) return "No renewal date";
  if (sub.status === "trial") {
    const then = Number(sub.price) > 0 ? ` · then ${pricePerCycle(sub)}` : "";
    return `Trial ends ${shortDate(sub.nextRenewal)}${then}`;
  }
  return `Renews ${shortDate(sub.nextRenewal)}`;
}

// "Monthly, since Mar 2025"
export function billingText(sub) {
  if (sub.status === "trial") return `${cycleName(sub.cycle)} after the trial`;
  return sub.startedAt ? `${cycleName(sub.cycle)}, since ${monthShortYear(sub.startedAt)}` : cycleName(sub.cycle);
}

// Yearly plans show the monthly share: "$9.99/mo"
export const monthlyShare = (sub) => `${money(monthlyPrice(sub), sub.currency)}/mo`;

// "Cancelled Apr 3 · no charges since"
export function cancelledText(sub) {
  const when = sub.cancelledAt ? `Cancelled ${shortDate(sub.cancelledAt)}` : "Cancelled";
  return sub.cancelledWhileTracking ? `${when} · no charges since` : `${when} · before you joined`;
}

// Under a total that mixes currencies: "Includes EUR and GBP prices, converted
// at today's rates" / "JPY prices aren't converted yet". null when there's nothing to say.
export function conversionNote(currencies, conv) {
  if (!currencies.length) return null;
  const missing = currencies.filter((c) => !conv.canConvert(c));
  if (missing.length) return `${joinAnd(missing)} prices aren't converted yet, so the total is approximate.`;
  return `Includes ${joinAnd(currencies)} prices, converted at today's rates.`;
}

// ---------------------------------------------------------------------------
// Overview

// "November and December are heavier: Dropbox and Adobe renew yearly ($119.88 each)."
// null when no month stands out.
export function forecastNote(forecast) {
  const average = forecast.total / forecast.months.length;
  const heavy = forecast.months.filter((m) => m.yearlyCharges.length && m.total > average * 1.25);
  if (!heavy.length) return null;
  const charges = heavy.flatMap((m) => m.yearlyCharges);
  const names = [...new Set(charges.map((c) => c.sub.name))];
  const amounts = [...new Set(charges.map((c) => c.amount))];
  const currency = charges[0].sub.currency;
  const price = amounts.length === 1 ? `${money(amounts[0], currency)}${names.length > 1 ? " each" : ""}` : joinAnd(amounts.map((a) => money(a, currency)));
  const months = joinAnd(heavy.map((m) => monthName(m.month)));
  const verb = heavy.length === 1 ? "is" : "are";
  return { months, verb, names, renews: names.length === 1 ? "renews" : "renew", price };
}

// "Cancel all three to save" / "Cancel it to save"
const COUNT_WORDS = ["", "one", "both", "all three", "all four", "all five", "all six", "all seven", "all eight", "all nine"];
export function cancelAllLabel(n) {
  if (n === 1) return "Cancel it to save";
  return `Cancel ${COUNT_WORDS[n] ?? `all ${n}`} to save`;
}

// "Canva Pro trial ends in 2 days"
export const trialEndsText = (sub, daysAway) => `${displayName(sub)} trial ends ${inDays(daysAway)}`;
