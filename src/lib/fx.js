// Currency conversion for totals (Settings › Show totals in). Rates are the
// European Central Bank's daily reference rates via Frankfurter: one request a
// day, only when something is priced in another currency, carrying no user
// data. Individual prices always show in their own currency; only sums convert.

import { monthlyCost } from "./money.js";

export const FX_URL = "https://api.frankfurter.dev/v1/latest";
export const FX_MAX_AGE_MS = 20 * 60 * 60 * 1000;

// No conversion: what the summary functions use when given no converter.
export const IDENTITY = { to: null, amount: (x) => x, monthly: (s) => monthlyCost(s), canConvert: () => true };

/**
 * converter("USD", fx) -> { to, amount(x, fromCurrency), monthly(sub), canConvert(currency) }
 * fx: { base, date, rates } as stored. Amounts in a currency without a rate are
 * left as they are (canConvert tells the UI to say so).
 */
export function converter(to, fx) {
  const rateOf = (c) => (c === fx?.base ? 1 : fx?.rates?.[c]);
  const factor = (from) => {
    if (!from || from === to) return 1;
    const a = rateOf(from);
    const b = rateOf(to);
    return a && b ? b / a : null;
  };
  const amount = (x, from) => {
    const f = factor(from);
    return f == null ? x : x * f;
  };
  return { to, amount, monthly: (s) => amount(monthlyCost(s), s.currency), canConvert: (from) => factor(from) != null };
}

// Currencies (other than `to`) that current subscriptions are priced in.
export function otherCurrencies(subs, to) {
  return [...new Set(subs.filter((s) => s.status !== "cancelled" && s.currency && s.currency !== to).map((s) => s.currency))].sort();
}

// Validate Frankfurter's response: { amount, base, date, rates: { USD: 1.08, ... } }
export function parseRates(json) {
  if (!json || typeof json.base !== "string" || typeof json.rates !== "object") throw new Error("Unexpected exchange-rate response");
  const rates = Object.fromEntries(Object.entries(json.rates).filter(([, v]) => typeof v === "number" && v > 0));
  return { base: json.base, date: json.date, rates };
}

export function ratesAreStale(fx, now = Date.now()) {
  return !fx?.fetchedAt || now - fx.fetchedAt > FX_MAX_AGE_MS;
}
