import { test } from "node:test";
import assert from "node:assert/strict";
import { mergeReceipts, resyncReason } from "../src/lib/resync.js";
import { normalizeSubscription } from "../src/lib/model.js";

const TODAY = "2026-10-22";
const sub = (f) => normalizeSubscription({ cycle: "monthly", currency: "USD", ...f });
const candidate = (f) => ({ key: f.name, status: "active", cycle: "monthly", cycleConfident: true, domains: [], charges: [], ...f });
const charge = (date, amount) => ({ date, amount, currency: "USD" });

test("a receipt confirms a checkout price", () => {
  const figma = sub({ id: "f", name: "Figma", domains: ["figma.com"], price: 16, priceSource: "checkout", confirmedByReceipt: false, nextRenewal: "2026-11-20", anchorDay: 20 });
  const out = mergeReceipts([figma], { candidates: [candidate({ name: "Figma", domains: ["figma.com"], charges: [charge("2026-10-20", 16)] })] }, { today: TODAY });
  const s = out.subscriptions[0];
  assert.deepEqual(out.events, [{ type: "confirmed", subId: "f" }]);
  assert.equal(s.confirmedByReceipt, true);
  assert.equal(s.priceSource, "receipt");
  assert.equal(s.nextRenewal, "2026-11-20");
  assert.equal(s.charges.length, 1);
});

test("a different receipt amount corrects a checkout price", () => {
  const figma = sub({ id: "f", name: "Figma", domains: ["figma.com"], price: 16, priceSource: "checkout", nextRenewal: "2026-11-20" });
  const out = mergeReceipts([figma], { candidates: [candidate({ name: "Figma", domains: ["figma.com"], charges: [charge("2026-10-20", 19.2)] })] }, { today: TODAY });
  assert.deepEqual(out.events, [{ type: "price_corrected", subId: "f", from: 16, to: 19.2 }]);
  assert.equal(out.subscriptions[0].price, 19.2);
});

test("a higher amount than last time is a price rise; duplicates are ignored", () => {
  const netflix = sub({ id: "n", name: "Netflix", domains: ["netflix.com"], price: 17.99, source: "gmail", nextRenewal: "2026-10-10", charges: [charge("2026-08-10", 17.99), charge("2026-09-10", 17.99)] });
  const out = mergeReceipts([netflix], { candidates: [candidate({ name: "Netflix", domains: ["netflix.com"], charges: [charge("2026-09-11", 17.99), charge("2026-10-10", 19.99)] })] }, { today: TODAY });
  assert.deepEqual(out.events, [{ type: "price_rise", subId: "n", from: 17.99, to: 19.99, date: "2026-10-10" }]);
  const s = out.subscriptions[0];
  assert.equal(s.charges.length, 3);
  assert.equal(s.price, 19.99);
  assert.equal(s.nextRenewal, "2026-11-10");
});

test("cancellation email: confirms a cancellation started with us, otherwise asks", () => {
  const started = sub({ id: "h", name: "Hulu", domains: ["hulu.com"], price: 9.99, nextRenewal: "2026-11-03", anchorDay: 3, cancelStartedAt: "2026-10-20", startedAt: "2026-01-03" });
  const notStarted = sub({ id: "d", name: "Duolingo", domains: ["duolingo.com"], price: 12.99, nextRenewal: "2026-11-25", startedAt: "2026-01-25" });
  const out = mergeReceipts([started, notStarted], {
    candidates: [
      candidate({ name: "Hulu", domains: ["hulu.com"], status: "cancelled", cancelledOn: "2026-10-21" }),
      candidate({ name: "Duolingo", domains: ["duolingo.com"], status: "cancelled", cancelledOn: "2026-10-19" }),
    ],
  }, { today: TODAY });
  const hulu = out.subscriptions.find((s) => s.id === "h");
  assert.equal(hulu.status, "cancelled");
  assert.equal(hulu.cancelledWhileTracking, true);
  assert.equal(hulu.avoidedFrom, "2026-11-03");
  assert.deepEqual(out.events, [{ type: "cancel_confirmed", subId: "h", date: "2026-10-21" }]);
  assert.equal(out.subscriptions.find((s) => s.id === "d").status, "active");
  assert.equal(out.questions.length, 1);
  assert.equal(resyncReason(out.questions[0]).title, "Did you cancel Duolingo?");
  // Already asked: not asked again.
  const again = mergeReceipts([notStarted], { candidates: [candidate({ name: "Duolingo", domains: ["duolingo.com"], status: "cancelled", cancelledOn: "2026-10-19" })] }, { today: TODAY, known: new Set(["cancel:d:2026-10-19"]) });
  assert.equal(again.questions.length, 0);
});

test("receipts from something new become a question, once", () => {
  const out = mergeReceipts([], { candidates: [candidate({ name: "Notion", domains: ["notion.so"], charges: [charge("2026-10-12", 10)] })] }, { today: TODAY });
  assert.equal(out.questions.length, 1);
  assert.equal(resyncReason(out.questions[0]).title, "Track Notion?");
  assert.equal(resyncReason(out.questions[0]).detail, "New receipt from Notion on Oct 12 for $10.00/mo.");
  assert.equal(mergeReceipts([], { candidates: [candidate({ name: "Notion", charges: [charge("2026-10-12", 10)] })] }, { today: TODAY, known: new Set(["Notion"]) }).questions.length, 0);
});
