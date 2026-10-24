import { test } from "node:test";
import assert from "node:assert/strict";
import { toCSV, toBackup, parseBackup } from "../src/lib/backup.js";
import { cutPlan } from "../src/lib/summary.js";
import { normalizeSubscription, SCHEMA_VERSION } from "../src/lib/model.js";

const TODAY = "2026-10-22";
const sub = (f) => normalizeSubscription({ id: f.name, cycle: "monthly", currency: "USD", domains: [`${f.name.toLowerCase()}.com`], ...f });

test("CSV export escapes and computes monthly cost", () => {
  const csv = toCSV([sub({ name: 'Acme, "Pro"', price: 120, cycle: "yearly", nextRenewal: "2026-12-01", startedAt: "2025-12-01" })]);
  const [header, row] = csv.trim().split("\r\n");
  assert.match(header, /^Name,Plan,Status,Price/);
  assert.match(row, /^"Acme, ""Pro""",,active,120,USD,yearly,10\.00,2026-12-01,Other,/);
});

test("backup round trip, and bad files are refused", () => {
  const data = { subscriptions: [sub({ name: "Netflix", price: 17.99 })], settings: { budget: 100 }, gmail: { connected: true }, installedAt: "2026-03-10" };
  const text = toBackup(data, new Date("2026-10-22T00:00:00Z"));
  assert.equal(JSON.parse(text).data.gmail, undefined); // connection state isn't restored
  const restored = parseBackup(text);
  assert.equal(restored.schemaVersion, SCHEMA_VERSION);
  assert.equal(restored.subscriptions[0].name, "Netflix");
  assert.equal(restored.installedAt, "2026-03-10");
  assert.throws(() => parseBackup("not json"), /isn't a Subscription Check backup/);
  assert.throws(() => parseBackup(JSON.stringify({ app: "other" })), /isn't a Subscription Check backup/);
  assert.throws(() => parseBackup(JSON.stringify({ app: "subscription-check", schemaVersion: 99, data: { subscriptions: [] } })), /newer version/);
});

test("cut plan: only what you haven't said you still use; one that covers it, else biggest first", () => {
  const subs = [
    sub({ name: "Netflix", price: 17.99, keptAt: "2026-10-01" }),
    sub({ name: "Paramount", price: 7.99, keptAt: "2026-06-01" }), // over 90 days ago
    sub({ name: "Adobe", price: 119.88, cycle: "yearly" }),
    sub({ name: "Dropbox", price: 119.88, cycle: "yearly" }),
    sub({ name: "Canva", price: 14.99, status: "trial" }),
    sub({ name: "Spotify", price: 11.99, keptAt: "2026-09-15" }),
  ];
  // Total 17.99 + 7.99 + 9.99 + 9.99 + 11.99 = 57.95
  const plan = cutPlan(subs, 50, TODAY);
  assert.deepEqual(plan.picks.map((s) => s.name), ["Paramount"]); // the cheapest that covers $7.95 alone
  assert.equal(plan.over, 7.95);
  assert.equal(plan.under, 0.04);
  assert.equal(plan.enough, true);
  const deeper = cutPlan(subs, 35, TODAY);
  assert.deepEqual(deeper.picks.map((s) => s.name), ["Adobe", "Dropbox", "Paramount"]);
  assert.equal(deeper.enough, true);
  assert.equal(cutPlan(subs, 20, TODAY).enough, false);
  assert.equal(cutPlan(subs, 100, TODAY), null);
});
