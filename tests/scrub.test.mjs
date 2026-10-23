import { test } from "node:test";
import assert from "node:assert/strict";
import { scrubText, scrubMessage } from "../src/lib/scrub.js";
import { extractAmount } from "../src/lib/receipts.js";

const opts = { userEmails: ["jane.doe@gmail.com"], words: ["Jane Doe", "Jane", "12 Elm Road", "D04 X123", "janed05"] };

test("removes the person's names, address, postcode and username", () => {
  const out = scrubText("Hi Jane, Jane Doe — 12 Elm Road, Dublin D04X123. Hello janed05!", opts);
  assert.equal(out, "Hi [removed], [removed] — [removed], Dublin [removed]. Hello [removed]!");
});

test("names match apostrophe variants and don't hit other words", () => {
  const out = scrubText("Jane O’Brien, thank you. Janet and O'Briens", { words: ["Jane O'Brien", "Jane"] });
  assert.equal(out, "[removed], thank you. Janet and O'Briens");
});

test("replaces the person's email but keeps merchants' addresses", () => {
  const out = scrubText("Sent to jane.doe@gmail.com. Questions? support@canva.com", opts);
  assert.equal(out, "Sent to user@example.com. Questions? support@canva.com");
});

test("zeroes card digits, phone numbers and long reference numbers", () => {
  assert.equal(scrubText("billed your MasterCard card ending with the last two digits: 53 for", {}), "billed your MasterCard card ending with the last two digits: 44 for");
  assert.equal(scrubText("Visa •••• 4242", {}), "Visa •••• 4444");
  assert.equal(scrubText("Call +353 21 234 5678 now", {}), "Call +000 00 000 0000 now");
  assert.equal(scrubText("Customer Number: 123456789, order #1234567890", {}), "Customer Number: 000000000, order #0000000000");
});

test("keeps amounts, dates and plan wording the parser needs", () => {
  const text = ".COM Domain Renewal | €22.16 | 1 Year\nTotal: €1,299.00\nAuto-renews on 05/01/2027. Billing Date: 7/12/26. Starts 27 October 2026";
  assert.equal(scrubText(text, opts), text);
  assert.deepEqual(extractAmount(scrubText("Total: €27.26", opts)), { amount: 27.26, currency: "EUR" });
});

test("strips tracking from links", () => {
  assert.equal(scrubText("See https://click.example.com/email/?eid=abc&user=jane.doe%40gmail.com now", opts), "See https://click.example.com/email/ now");
});

test("scrubMessage keeps the sender and swaps the Gmail id", () => {
  const m = scrubMessage({ id: "18f00ab", date: 1, from: "GoDaddy <donotreply@godaddy.com>", subject: "Jane Doe, thank you", snippet: "", body: "", labels: ["CATEGORY_UPDATES"] }, opts, 7);
  assert.deepEqual(m, { id: "m7", date: 1, from: "GoDaddy <donotreply@godaddy.com>", subject: "[removed], thank you", snippet: "", body: "", labels: ["CATEGORY_UPDATES"], inProductionQuery: true });
});

test("postcodes match with or without the space, whichever way they were typed", () => {
  assert.equal(scrubText("Ireland, D04 X123. Postcode: D04X123", { words: ["D04X123"] }), "Ireland, [removed]. Postcode: [removed]");
  assert.equal(scrubText("Ireland, D04 X123. Postcode: D04X123", { words: ["D04 X123"] }), "Ireland, [removed]. Postcode: [removed]");
});

test("scrubMessage removes the person from emails they sent themselves", () => {
  const m = scrubMessage({ id: "1", date: 1, from: "Jane Doe <jane.doe@gmail.com>", subject: "", snippet: "", body: "" }, opts, 0);
  assert.equal(m.from, "[removed] <user@example.com>");
});
