import { test } from "node:test";
import assert from "node:assert/strict";
import {
  totals,
  budgetStatus,
  worthReviewing,
  upcoming,
  trialsEndingSoon,
  month,
  forecast,
  categories,
  savings,
  priceHistory,
  needsCheck,
} from "../src/lib/summary.js";
import { cancelSubscription, normalizeSubscription } from "../src/lib/model.js";

// The sample account on the design boards (docs/designs), as of Oct 22, 2026.
const TODAY = "2026-10-22";
const sub = (fields) =>
  normalizeSubscription({ id: fields.name, cycle: "monthly", currency: "USD", domains: [`${fields.name.toLowerCase()}.com`], ...fields });

const active = [
  sub({ name: "Canva", plan: "Pro", status: "trial", price: 14.99, nextRenewal: "2026-10-24", category: "Work tools", }),
  sub({ name: "ChatGPT Plus", price: 20, nextRenewal: "2026-11-02", category: "Work tools", keptAt: "2026-10-03" }),
  sub({ name: "Netflix", price: 17.99, nextRenewal: "2026-11-10", category: "Entertainment", keptAt: "2026-09-10" }),
  sub({ name: "Linear", price: 8, nextRenewal: "2026-11-14", category: "Work tools", keptAt: "2026-10-22" }),
  sub({ name: "Dropbox", price: 119.88, cycle: "yearly", nextRenewal: "2026-11-16", category: "Work tools" }),
  sub({ name: "Spotify", price: 11.99, nextRenewal: "2026-11-19", category: "Entertainment", keptAt: "2026-07-25" }),
  sub({
    name: "Paramount+",
    price: 7.99,
    nextRenewal: "2026-11-21",
    category: "Entertainment",
    keptAt: "2026-07-01", // over 90 days ago: ask again
    charges: [
      { date: "2026-06-21", amount: 5.99 },
      { date: "2026-07-21", amount: 7.99 },
      { date: "2026-08-21", amount: 7.99 },
      { date: "2026-09-21", amount: 7.99 },
      { date: "2026-10-21", amount: 7.99 },
    ],
  }),
  sub({ name: "Adobe", price: 119.88, cycle: "yearly", nextRenewal: "2026-12-26", category: "Work tools" }),
];

const cancelled = [
  cancelSubscription(sub({ name: "Hulu", price: 9.99, nextRenewal: "2026-04-03", anchorDay: 3, category: "Entertainment" }), "2026-04-03"),
  cancelSubscription(sub({ name: "Duolingo", price: 12.99, nextRenewal: "2026-05-25", anchorDay: 25, category: "Learning" }), "2026-05-25"),
  cancelSubscription(sub({ name: "Disney+", status: "trial", price: 13.99, nextRenewal: "2026-04-10" }), "2026-04-05"),
  sub({ name: "Peacock", price: 7.99, status: "cancelled", cancelledAt: "2026-02-12" }), // found by the scan, before install
];

const all = [...active, ...cancelled];

test("totals match the Overview header", () => {
  assert.deepEqual(totals(all), { monthly: 85.95, yearly: 1031.4, count: 8, trials: 1 });
});

test("budget meter", () => {
  const b = budgetStatus(85.95, 100);
  assert.equal(b.left, 14.05);
  assert.equal(Math.round(b.share * 100), 86);
  assert.equal(b.over, false);
  assert.equal(budgetStatus(85.95, null), null);
  assert.equal(budgetStatus(101.95, 100).over, true);
});

test("still using these: never kept or kept 90+ days ago, biggest first, trials excluded", () => {
  const w = worthReviewing(all, TODAY);
  assert.deepEqual(w.items.map((s) => s.name), ["Adobe", "Dropbox", "Paramount+"]);
  assert.equal(w.monthly, 27.97);
  assert.equal(w.yearly, 335.64);
});

test("needsCheck: asks until kept, then again after 90 days", () => {
  const dropbox = active.find((s) => s.name === "Dropbox");
  assert.equal(needsCheck(dropbox, TODAY), true);
  assert.equal(needsCheck({ ...dropbox, keptAt: "2026-07-25" }, TODAY), false); // 89 days
  assert.equal(needsCheck({ ...dropbox, keptAt: "2026-07-24" }, TODAY), true); // 90 days
  // No website is fine: we no longer need one to ask.
  assert.equal(needsCheck({ ...dropbox, domains: [] }, TODAY), true);
  assert.equal(needsCheck({ ...dropbox, status: "trial" }, TODAY), false);
  assert.equal(needsCheck({ ...dropbox, status: "cancelled" }, TODAY), false);
});

test("upcoming is soonest first and flags trials", () => {
  const next = upcoming(all, TODAY, { limit: 3 });
  assert.deepEqual(next.map((u) => [u.sub.name, u.daysAway, u.trial]), [
    ["Canva", 2, true],
    ["ChatGPT Plus", 11, false],
    ["Netflix", 19, false],
  ]);
  assert.deepEqual(trialsEndingSoon(all, TODAY).map((u) => u.sub.name), ["Canva"]);
});

test("November calendar: 6 charges plus the trial 'if you keep it'", () => {
  const nov = month(all, "2026-11");
  const sure = nov.charges.filter((c) => !c.trial);
  assert.equal(sure.length, 6);
  assert.equal(sure.reduce((a, c) => a + c.amount, 0).toFixed(2), "185.85");
  assert.deepEqual(nov.charges.filter((c) => c.trial).map((c) => [c.sub.name, c.date]), [["Canva", "2026-11-24"]]);
});

test("12-month forecast starts next month and matches the yearly total", () => {
  const f = forecast(all, TODAY);
  assert.equal(f.months.length, 12);
  assert.equal(f.months[0].month, "2026-11");
  assert.equal(f.months[11].month, "2027-10");
  assert.equal(f.total, 1031.4);
  assert.equal(f.months[0].total, 185.85);
  assert.equal(f.months[1].total, 185.85);
  assert.equal(f.months[2].total, 65.97);
  assert.deepEqual(f.months[0].yearlyCharges.map((c) => c.sub.name), ["Dropbox"]);
  assert.deepEqual(f.months[1].yearlyCharges.map((c) => c.sub.name), ["Adobe"]);
});

test("categories: where it goes", () => {
  const c = categories(all);
  assert.deepEqual(c.map((g) => [g.category, g.monthly, g.count]), [
    ["Work tools", 47.98, 4],
    ["Entertainment", 37.97, 3],
  ]);
  assert.equal(Math.round(c[0].share * 100), 56);
});

test("savings count only tracked cancellations, from the first avoided charge", () => {
  const s = savings(all, TODAY, { installedAt: "2026-03-10" });
  assert.equal(s.total, 125.89);
  assert.equal(s.monthlyGrowth, 22.98);
  assert.deepEqual(s.items.map((i) => [i.sub.name, i.kind, i.chargesAvoided, i.amount]), [
    ["Hulu", "cancelled", 6, 59.94],
    ["Duolingo", "cancelled", 4, 51.96],
    ["Disney+", "trial", 1, 13.99],
  ]);
  assert.deepEqual(s.beforeJoined.map((x) => x.name), ["Peacock"]);
  assert.deepEqual(s.series.map((p) => p.month), ["2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10"]);
  assert.equal(s.series[0].total, 0);
  assert.equal(s.series[1].total, 13.99); // Disney+ trial end, Apr 10
  assert.equal(s.series.at(-1).total, 125.89);
});

test("savings: nothing saved yet when the first avoided charge is still ahead", () => {
  const justCancelled = cancelSubscription(active.find((x) => x.name === "Netflix"), TODAY);
  const s = savings([justCancelled], TODAY);
  assert.equal(s.total, 0);
  assert.equal(s.items[0].chargesAvoided, 0);
  assert.equal(s.monthlyGrowth, 17.99);
});

test("price history finds the rise", () => {
  const p = priceHistory(active.find((x) => x.name === "Paramount+"));
  assert.equal(p.charges[0].date, "2026-10-21");
  assert.deepEqual(
    { date: p.latestRise.date, from: p.latestRise.from, to: p.latestRise.to, pct: Math.round(p.latestRise.change * 100) },
    { date: "2026-07-21", from: 5.99, to: 7.99, pct: 33 },
  );
});
