import { test } from "node:test";
import assert from "node:assert/strict";
import { converter, otherCurrencies, parseRates, ratesAreStale } from "../src/lib/fx.js";
import { totals, forecast, categories, cutPlan } from "../src/lib/summary.js";
import { normalizeSubscription } from "../src/lib/model.js";

// ECB-style rates, base EUR.
const fx = { base: "EUR", date: "2026-10-22", rates: { USD: 1.25, GBP: 0.8 } };
const sub = (f) => normalizeSubscription({ id: f.name, cycle: "monthly", domains: [], ...f });

test("converter goes through the base currency", () => {
  const usd = converter("USD", fx);
  assert.equal(usd.amount(10, "USD"), 10);
  assert.equal(usd.amount(10, "EUR"), 12.5);
  assert.equal(usd.amount(8, "GBP"), 12.5);
  assert.equal(usd.canConvert("JPY"), false);
  assert.equal(usd.amount(500, "JPY"), 500); // no rate: left as it is
  assert.equal(converter("USD", null).canConvert("EUR"), false);
});

test("totals add up in the display currency", () => {
  const subs = [
    sub({ name: "Netflix", price: 10, currency: "USD", nextRenewal: "2026-11-10", category: "Entertainment" }),
    sub({ name: "Spotify", price: 8, currency: "GBP", nextRenewal: "2026-11-12", category: "Entertainment" }),
    sub({ name: "Notion", price: 120, currency: "EUR", cycle: "yearly", nextRenewal: "2026-11-20", category: "Work tools" }),
  ];
  const usd = converter("USD", fx);
  assert.deepEqual(totals(subs, usd), { monthly: 35, yearly: 420, count: 3, trials: 0 });
  assert.equal(forecast(subs, "2026-10-22", 12, usd).months[0].total, 172.5); // 10 + 12.50 + 150
  assert.deepEqual(categories(subs, usd).map((g) => [g.category, g.monthly]), [["Entertainment", 22.5], ["Work tools", 12.5]]);
  assert.equal(cutPlan(subs, 30, "2026-10-22", usd).over, 5);
  assert.deepEqual(otherCurrencies(subs, "USD"), ["EUR", "GBP"]);
});

test("rates response and freshness", () => {
  assert.deepEqual(parseRates({ amount: 1, base: "EUR", date: "2026-10-22", rates: { USD: 1.16, BAD: "x" } }), { base: "EUR", date: "2026-10-22", rates: { USD: 1.16 } });
  assert.throws(() => parseRates({ nope: 1 }));
  const now = Date.now();
  assert.equal(ratesAreStale({ fetchedAt: now - 3_600_000 }, now), false);
  assert.equal(ratesAreStale({ fetchedAt: now - 25 * 3_600_000 }, now), true);
  assert.equal(ratesAreStale(null, now), true);
});
