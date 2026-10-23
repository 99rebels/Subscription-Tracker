import { test } from "node:test";
import assert from "node:assert/strict";
import { analyseInbox } from "../src/lib/receipts.js";
import { classifyScan, reasonFor, candidateToSubscription, timeAgo } from "../src/lib/scan.js";

const TODAY = "2026-10-22";
const at = (iso) => new Date(`${iso}T12:00:00`).getTime();
let n = 0;
const msg = (date, from, subject, body = "") => ({ id: String(n++), date: at(date), from, subject, snippet: "", body });
const services = [
  { name: "Netflix", domains: ["netflix.com"], cancelUrl: "https://www.netflix.com/cancelplan" },
  { name: "Dropbox", domains: ["dropbox.com"], cancelUrl: "https://www.dropbox.com/account/plan" },
  { name: "Amazon Prime", domains: ["amazon.com"], plan: "Prime", cancelUrl: "https://www.amazon.com/mc" },
];

// An inbox like the scan results board.
const inbox = [
  ...["2026-07-10", "2026-08-10", "2026-09-10", "2026-10-10"].map((d) => msg(d, "Netflix <info@account.netflix.com>", "Your Netflix receipt", "Membership renews monthly. Total $17.99")),
  msg("2025-11-16", "Dropbox <no-reply@dropbox.com>", "Your Dropbox Plus receipt", "Dropbox Plus subscription. Total $119.88"),
  ...["2026-09-12", "2026-10-12"].map((d) => msg(d, "Linear via Stripe <invoice+statements@stripe.com>", "Your receipt from Linear", "Linear subscription. Amount paid $8.00")),
  ...[["2026-03-02", "$23.10"], ["2026-05-04", "$8.45"], ["2026-06-19", "$41.00"], ["2026-08-01", "$12.75"], ["2026-10-02", "$30.20"], ["2026-10-09", "$15.10"], ["2026-10-15", "$64.00"], ["2026-10-17", "$9.99"], ["2026-10-20", "$22.40"]].map(([d, amt]) =>
    msg(d, "Amazon.com <auto-confirm@amazon.com>", "Your Amazon.com order", `Order total ${amt}`),
  ),
  ...["2026-01-05", "2026-02-05"].map((d) => msg(d, "Peacock <no-reply@peacocktv.com>", "Your Peacock receipt", "Premium plan subscription Total $7.99")),
  msg("2026-02-12", "Peacock <no-reply@peacocktv.com>", "Your subscription has been cancelled", "Sorry to see you go"),
  ...[["2026-09-02", "$23.10"], ["2026-09-04", "$8.45"], ["2026-09-19", "$41.00"], ["2026-10-01", "$12.75"]].map(([d, amt]) => msg(d, "Uber Receipts <noreply@uber.com>", "Your Thursday evening trip receipt", `Total ${amt}`)),
];

test("scan groups: paying, please confirm (with reasons), not added", () => {
  const groups = classifyScan(analyseInbox(inbox, { services, today: TODAY }), { today: TODAY, subscriptions: [] });
  assert.deepEqual(groups.paying.map((c) => c.name).sort(), ["Linear", "Netflix"]);
  assert.deepEqual(
    groups.confirm.map((c) => [c.item.name, c.kind, c.reason]),
    [
      ["Dropbox", "yearly", "Last receipt was 11 months ago"],
      ["Amazon Prime", "plan", "Found 9 order receipts. Do you have Prime?"],
    ],
  );
  assert.equal(groups.confirm[0].detail, "Last receipt was 11 months ago. If it's yearly, it renews Nov 16.");
  assert.deepEqual(groups.notAdded.map((x) => [x.item.name, x.note]), [
    ["Peacock", "Cancellation email on Feb 12"],
    ["Uber", "One-off receipts, not a subscription"],
  ]);
  assert.equal(groups.paying.find((c) => c.name === "Linear").processor, "Stripe");
});

test("already-tracked services are left out", () => {
  const groups = classifyScan(analyseInbox(inbox, { services, today: TODAY }), { today: TODAY, subscriptions: [{ name: "Netflix", status: "active", domains: ["netflix.com"] }] });
  assert.deepEqual(groups.paying.map((c) => c.name), ["Linear"]);
  assert.deepEqual(groups.tracked.map((c) => c.name), ["Netflix"]);
});

test("reason templates", () => {
  assert.equal(reasonFor({ name: "Duolingo", status: "lapsed", lastCharged: "2026-05-25", charges: [{}, {}, {}], price: 12.99 }, TODAY).detail, "Receipts stopped in May, but we didn't see a cancellation email.");
  assert.equal(reasonFor({ name: "X", status: "active", lastCharged: "2026-01-10", charges: [{}], price: "" }, TODAY).reason, "Couldn't find a price in the receipt");
  assert.equal(reasonFor({ name: "X", status: "active", lastCharged: "2026-09-10", charges: [{}], price: 5, cycleConfident: false }, TODAY).detail, "Only one receipt found (September), so we're not sure how often it charges.");
  assert.equal(reasonFor({ name: "Uber", reason: "irregular" }, TODAY).title, "Is Uber a subscription?");
  assert.equal(timeAgo("2026-10-01", TODAY), "3 weeks ago");
});

test("answers become subscriptions", () => {
  const { candidates } = analyseInbox(inbox, { services, today: TODAY });
  const dropbox = candidates.find((c) => c.name === "Dropbox");
  const yes = candidateToSubscription(dropbox, { today: TODAY, kind: "yearly", id: "d" });
  assert.equal(yes.cycle, "yearly");
  assert.equal(yes.status, "active");
  assert.equal(yes.nextRenewal, "2026-11-16");
  const no = candidateToSubscription(dropbox, { today: TODAY, kind: "yearly", answer: "no", id: "d" });
  assert.equal(no.status, "cancelled");
  assert.equal(no.cancelledWhileTracking, false);

  const peacock = candidates.find((c) => c.name === "Peacock");
  const stored = candidateToSubscription(peacock, { today: TODAY, answer: "no", id: "p" });
  assert.equal(stored.status, "cancelled");
  assert.equal(stored.cancelledAt, "2026-02-12");

  const prime = { name: "Amazon Prime", plan: "Prime", domains: ["amazon.com"], receiptCount: 9 };
  assert.equal(candidateToSubscription(prime, { today: TODAY, kind: "plan", id: "a" }).name, "Amazon Prime");
  assert.equal(candidateToSubscription(prime, { today: TODAY, kind: "plan", answer: "no", id: "a" }), null);
  assert.equal(candidateToSubscription({ name: "Uber", reason: "irregular" }, { today: TODAY, kind: "add", answer: "no", id: "u" }), null);
});

test("'Add anyway' on a cancelled candidate adds it as active", () => {
  const { candidates } = analyseInbox(inbox, { services, today: TODAY });
  const peacock = candidates.find((c) => c.name === "Peacock");
  const sub = candidateToSubscription(peacock, { today: TODAY, answer: "yes", id: "p" });
  assert.equal(sub.status, "active");
  assert.ok(sub.nextRenewal >= TODAY);
});
