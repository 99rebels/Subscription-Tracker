import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeSubscription, cancelSubscription, undoCancel, keepSubscription, migrate, SCHEMA_VERSION } from "../src/lib/model.js";
import { weekStart, addMonths, addMonthsToKey, addDays } from "../src/lib/dates.js";

const services = [
  { name: "Netflix", domains: ["netflix.com"], category: "Entertainment", cancelUrl: "https://www.netflix.com/cancelplan" },
];

test("normalize: legacy isTrial becomes status; category and cancel link from the services list", () => {
  const s = normalizeSubscription({ id: "1", name: "netflix", isTrial: true, price: 9.99, createdAt: 0 }, { services });
  assert.equal(s.status, "trial");
  assert.equal("isTrial" in s, false);
  assert.equal(s.category, "Entertainment");
  assert.equal(s.cancelUrl, "https://www.netflix.com/cancelplan");
  assert.equal(s.cycle, "monthly");
  assert.equal(s.priceSource, "manual");
});

test("normalize: matches a service by domain and keeps explicit values", () => {
  const s = normalizeSubscription(
    { id: "1", name: "Netflix Standard", domains: ["netflix.com"], status: "active", category: "Other", source: "gmail", charges: [{ date: "2026-01-05", amount: 1 }] },
    { services },
  );
  assert.equal(s.category, "Other");
  assert.equal(s.priceSource, "receipt");
  assert.equal(s.confirmedByReceipt, true);
  assert.equal(s.startedAt, "2026-01-05");
});

test("cancel and undo", () => {
  const sub = normalizeSubscription({ id: "1", name: "Hulu", price: 9.99, status: "active", nextRenewal: "2026-11-03", anchorDay: 3 });
  const c = cancelSubscription(sub, "2026-10-22");
  assert.equal(c.status, "cancelled");
  assert.equal(c.cancelledWhileTracking, true);
  assert.equal(c.avoidedFrom, "2026-11-03");
  assert.equal(c.cancelledDuringTrial, false);
  // Cancelled on the renewal day: that charge has usually gone through already.
  assert.equal(cancelSubscription({ ...sub, nextRenewal: "2026-10-22", anchorDay: 22 }, "2026-10-22").avoidedFrom, "2026-11-22");
  const u = undoCancel(c);
  assert.equal(u.status, "active");
  assert.equal(u.cancelledAt, null);
  assert.equal(u.avoidedFrom, null);
  // A cancelled trial goes back to being a trial.
  const t = cancelSubscription({ ...sub, status: "trial" }, "2026-10-22");
  assert.equal(t.avoidedFrom, "2026-11-03");
  assert.equal(undoCancel(t).status, "trial");
});

test("migrate v1 storage", () => {
  const out = migrate({ subscriptions: [{ id: "1", name: "Netflix", isTrial: false, price: 1 }], settings: { reminderDays: 3 } }, { services });
  assert.equal(out.schemaVersion, SCHEMA_VERSION);
  assert.deepEqual(out.visits, {});
  assert.equal(out.subscriptions[0].status, "active");
  assert.equal(out.subscriptions[0].category, "Entertainment");
  assert.deepEqual(out.settings, { reminderDays: 3 });
  // Already current: unchanged.
  assert.equal(migrate(out).subscriptions[0], out.subscriptions[0]);
});

test("migrate v2: 'I still use it on another device' becomes kept; checkout detections go", () => {
  const v2 = {
    schemaVersion: 2,
    subscriptions: [
      { id: "1", name: "Netflix", price: 1, usedElsewhere: true, lastUsed: 123 },
      { id: "2", name: "Figma", price: 16, source: "detected", priceSource: "checkout" },
    ],
    pending: [{ id: "p1", name: "Canva", domain: "canva.com" }],
  };
  const out = migrate(v2, { services, today: "2026-10-24" });
  assert.equal(out.subscriptions[0].keptAt, "2026-10-24");
  assert.equal(out.subscriptions[1].keptAt, null);
  assert.equal(out.subscriptions[1].priceSource, "manual"); // no more checkout prices
  assert.deepEqual(out.pending, []);
});

test("keep sets the date the user said they still use it", () => {
  const sub = normalizeSubscription({ id: "1", name: "Netflix", price: 1 });
  assert.equal(sub.keptAt, null);
  assert.equal(keepSubscription(sub, "2026-10-24").keptAt, "2026-10-24");
});

test("date helpers", () => {
  assert.equal(weekStart("2026-10-25"), "2026-10-19"); // Sunday -> previous Monday
  assert.equal(weekStart("2026-10-19"), "2026-10-19");
  assert.equal(addMonths("2026-03-31", -1), "2026-02-28");
  assert.equal(addMonths("2026-10-22", -3), "2026-07-22");
  assert.equal(addMonthsToKey("2026-11", 2), "2027-01");
  assert.equal(addDays("2026-12-31", 1), "2027-01-01");
});
