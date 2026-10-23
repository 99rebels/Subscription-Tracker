import { test } from "node:test";
import assert from "node:assert/strict";
import { toCSV, toBackup, parseBackup } from "../src/lib/backup.js";
import { cutPlan } from "../src/lib/summary.js";
import { normalizeSubscription, SCHEMA_VERSION } from "../src/lib/model.js";

const TODAY = "2026-10-22";
const at = (iso) => new Date(`${iso}T12:00:00`).getTime();
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

test("cut plan: least-used first, enough to get back under budget", () => {
  const subs = [
    sub({ name: "Netflix", price: 17.99, lastUsed: at("2026-10-21") }),
    sub({ name: "Paramount", price: 7.99, lastUsed: at("2026-08-19") }),
    sub({ name: "Adobe", price: 119.88, cycle: "yearly", lastUsed: at("2026-09-07") }),
    sub({ name: "Dropbox", price: 119.88, cycle: "yearly", lastUsed: null }),
    sub({ name: "Canva", price: 14.99, status: "trial", lastUsed: null }),
    sub({ name: "Spotify", price: 11.99, lastUsed: null, usedElsewhere: true }),
  ];
  // Total 17.99 + 7.99 + 9.99 + 9.99 + 11.99 = 57.95
  const plan = cutPlan(subs, 50, TODAY);
  assert.deepEqual(plan.picks.map((s) => s.name), ["Dropbox"]);
  assert.equal(plan.over, 7.95);
  assert.equal(plan.under, 2.04);
  assert.equal(plan.enough, true);
  const deeper = cutPlan(subs, 35, TODAY);
  assert.deepEqual(deeper.picks.map((s) => s.name), ["Dropbox", "Paramount", "Adobe"]);
  assert.equal(deeper.enough, true);
  assert.equal(cutPlan(subs, 20, TODAY).enough, false);
  assert.equal(cutPlan(subs, 100, TODAY), null);
});
