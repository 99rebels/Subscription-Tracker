// Wording tests. package.json pins LANG=en_US so dates and money format the same everywhere.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as t from "../src/ui/text.js";
import { forecast } from "../src/lib/summary.js";
import { cancelRoute } from "../src/lib/cancel.js";
import { normalizeSubscription } from "../src/lib/model.js";

const TODAY = "2026-10-22";
const at = (iso) => new Date(`${iso}T12:00:00`).getTime();
const sub = (fields) => normalizeSubscription({ id: fields.name, cycle: "monthly", domains: ["example.com"], ...fields });

test("usage wording never says unused", () => {
  assert.deepEqual(t.usage(sub({ name: "A", lastUsed: null }), TODAY), { text: "no visits on this computer", stale: true });
  assert.deepEqual(t.usage(sub({ name: "A", lastUsed: at("2026-10-22") }), TODAY), { text: "visited today", stale: false });
  assert.deepEqual(t.usage(sub({ name: "A", lastUsed: at("2026-10-21") }), TODAY), { text: "visited yesterday", stale: false });
  assert.deepEqual(t.usage(sub({ name: "A", lastUsed: at("2026-10-20") }), TODAY), { text: "visited 2 days ago", stale: false });
  assert.deepEqual(t.usage(sub({ name: "A", lastUsed: at("2026-08-19") }), TODAY), { text: "no visits in 64 days", stale: true });
});

test("dates and money", () => {
  assert.equal(t.shortDate("2026-11-10"), "Nov 10");
  assert.equal(t.weekdayDay("2026-10-24"), "Sat 24");
  assert.equal(t.longDay("2026-11-16"), "Mon, Nov 16");
  assert.equal(t.monthYear("2026-11"), "November 2026");
  assert.equal(t.monthLetter("2026-12"), "D");
  assert.equal(t.monthShortYear("2025-03-14"), "Mar 2025");
  assert.equal(t.money(1031.4), "$1,031.40");
  assert.equal(t.moneyWhole(1031.4), "$1,031");
  assert.equal(t.inDays(0), "today");
  assert.equal(t.inDays(1), "tomorrow");
  assert.equal(t.inDays(11), "in 11 days");
});

test("subscription lines", () => {
  const canva = sub({ name: "Canva", plan: "Pro", status: "trial", price: 14.99, nextRenewal: "2026-10-24" });
  assert.equal(t.displayName(canva), "Canva Pro");
  assert.equal(t.displayName(sub({ name: "Dropbox Plus", plan: "Plus" })), "Dropbox Plus");
  assert.equal(t.renewalText(canva), "Trial ends Oct 24 · then $14.99/mo");
  assert.equal(t.renewalText(sub({ name: "Netflix", price: 17.99, nextRenewal: "2026-11-10" })), "Renews Nov 10");
  assert.equal(t.billingText(sub({ name: "P", startedAt: "2025-03-21" })), "Monthly, since Mar 2025");
  assert.equal(t.monthlyShare(sub({ name: "D", price: 119.88, cycle: "yearly" })), "$9.99/mo");
  assert.equal(t.cancelledText({ cancelledAt: "2026-04-03", cancelledWhileTracking: true }), "Cancelled Apr 3 · no charges since");
  assert.equal(t.cancelledText({ cancelledAt: "2026-02-12", cancelledWhileTracking: false }), "Cancelled Feb 12 · before you joined");
});

test("forecast note names the heavy months and yearly renewals", () => {
  const subs = [
    sub({ name: "Netflix", price: 17.99, nextRenewal: "2026-11-10" }),
    sub({ name: "Dropbox", price: 119.88, cycle: "yearly", nextRenewal: "2026-11-16" }),
    sub({ name: "Adobe", price: 119.88, cycle: "yearly", nextRenewal: "2026-12-26" }),
  ];
  assert.deepEqual(t.forecastNote(forecast(subs, TODAY)), {
    months: "November and December",
    verb: "are",
    names: ["Dropbox", "Adobe"],
    renews: "renew",
    price: "$119.88 each",
  });
  assert.equal(t.forecastNote(forecast([subs[0]], TODAY)), null);
});

test("joinAnd, plural, cancelAllLabel", () => {
  assert.equal(t.joinAnd(["a"]), "a");
  assert.equal(t.joinAnd(["a", "b", "c"]), "a, b and c");
  assert.equal(t.plural(1, "visit"), "1 visit");
  assert.equal(t.plural(2, "visit"), "2 visits");
  assert.equal(t.cancelAllLabel(3), "Cancel all three to save");
  assert.equal(t.cancelAllLabel(2), "Cancel both to save");
  assert.equal(t.cancelAllLabel(1), "Cancel it to save");
});

test("cancel route: stores win over the service's own site", () => {
  assert.deepEqual(cancelRoute({ name: "Spotify", billedVia: "apple", domains: ["spotify.com"], cancelUrl: "https://spotify.com/account" }), {
    url: "https://account.apple.com/account/manage/section/subscriptions",
    via: "apple",
    viaName: "Apple",
  });
  assert.equal(cancelRoute({ name: "Apple subscriptions", domains: ["apple.com"] }).via, "apple");
  assert.equal(cancelRoute({ name: "Netflix", domains: ["netflix.com"], cancelUrl: "https://www.netflix.com/cancelplan" }).url, "https://www.netflix.com/cancelplan");
  assert.equal(cancelRoute({ name: "Linear", domains: ["linear.app"], cancelUrl: "" }).url, "https://linear.app");
  assert.equal(cancelRoute({ name: "Mystery", domains: [] }).url, null);
});

test("ago and spottedAt", () => {
  const now = new Date("2026-10-22T16:00:00").getTime();
  assert.equal(t.ago(now - 20_000, now), "just now");
  assert.equal(t.ago(now - 12 * 60_000, now), "12 min ago");
  assert.equal(t.ago(now - 2 * 3_600_000, now), "2 hours ago");
  assert.equal(t.ago(now - 30 * 3_600_000, now), "yesterday");
  assert.equal(t.spottedAt(new Date("2026-10-22T14:14:00").getTime(), now), "today, 2:14 PM");
  assert.equal(t.spottedAt(new Date("2026-10-20T09:05:00").getTime(), now), "Oct 20, 9:05 AM");
});
