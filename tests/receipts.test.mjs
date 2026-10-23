import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildCandidates,
  extractAmount,
  extractRenewalDate,
  htmlToText,
  parseFrom,
  cleanSenderName,
  buildSearchQueries,
} from "../src/lib/receipts.js";

const services = [
  { name: "Netflix", domains: ["netflix.com"], cancelUrl: "https://www.netflix.com/cancelplan" },
  { name: "Adobe Creative Cloud", domains: ["adobe.com"], cancelUrl: "https://account.adobe.com/plans" },
];
const TODAY = "2026-10-22";
const at = (iso) => new Date(`${iso}T12:00:00`).getTime();
let nextId = 0;
const msg = (date, from, subject, body = "", snippet = "") => ({ id: String(nextId++), date: at(date), from, subject, snippet, body });

test("extractAmount prefers the total over other amounts", () => {
  assert.deepEqual(extractAmount("Plan $10.00 Tax $1.20 Total $11.20"), { amount: 11.2, currency: "USD" });
  assert.deepEqual(extractAmount("Amount charged: €15,49"), { amount: 15.49, currency: "EUR" });
  assert.deepEqual(extractAmount("You paid 9,99 € for Premium"), { amount: 9.99, currency: "EUR" });
  assert.deepEqual(extractAmount("Total: £1,299.00"), { amount: 1299, currency: "GBP" });
  assert.deepEqual(extractAmount("Total CA$12.99"), { amount: 12.99, currency: "CAD" });
  assert.equal(extractAmount("No money here"), null);
});

test("extractRenewalDate reads common phrasings", () => {
  assert.equal(extractRenewalDate("Your plan renews on November 3, 2026."), "2026-11-03");
  assert.equal(extractRenewalDate("Next billing date: 30 Nov 2026"), "2026-11-30");
  assert.equal(extractRenewalDate("Your free trial ends on Oct. 29, 2026"), "2026-10-29");
  assert.equal(extractRenewalDate("Thanks for your order"), null);
});

test("htmlToText strips markup and decodes entities", () => {
  const text = htmlToText("<style>.a{}</style><table><tr><td>Total</td><td>&#36;15.49</td></tr></table><p>Thanks&nbsp;&amp; bye</p>");
  assert.match(text, /Total \$15\.49/);
  assert.match(text, /Thanks & bye/);
});

test("parseFrom and cleanSenderName", () => {
  assert.deepEqual(parseFrom('"Netflix" <info@account.netflix.com>'), { name: "Netflix", address: "info@account.netflix.com", domain: "netflix.com" });
  assert.equal(parseFrom("receipts@shop.co.uk").domain, "shop.co.uk");
  assert.equal(cleanSenderName("Adobe Billing"), "Adobe");
  assert.equal(cleanSenderName("Linear via Stripe"), "Linear");
});

test("monthly receipts become an active monthly subscription", () => {
  const messages = ["2026-07-05", "2026-08-05", "2026-09-05", "2026-10-05"].map((d) =>
    msg(d, "Netflix <info@account.netflix.com>", "Your Netflix payment receipt", "Standard plan. Total $17.99. Your membership renews monthly."),
  );
  const [c] = buildCandidates(messages, { services, today: TODAY });
  assert.equal(c.name, "Netflix");
  assert.equal(c.price, 17.99);
  assert.equal(c.cycle, "monthly");
  assert.equal(c.status, "active");
  assert.equal(c.nextRenewal, "2026-11-05");
  assert.equal(c.cancelUrl, "https://www.netflix.com/cancelplan");
  assert.equal(c.confidence, "high");
  assert.equal(c.charges.length, 4);
});

test("a single annual receipt is detected as yearly from the wording", () => {
  const messages = [msg("2026-01-15", "Adobe <mail@mail.adobe.com>", "Your Adobe invoice", "Creative Cloud annual plan. Amount charged: $659.88 per year.")];
  const [c] = buildCandidates(messages, { services, today: TODAY });
  assert.equal(c.cycle, "yearly");
  assert.equal(c.nextRenewal, "2027-01-15");
  assert.equal(c.status, "active");
});

test("processor receipts are credited to the merchant name", () => {
  const messages = ["2026-08-12", "2026-09-12", "2026-10-12"].map((d) =>
    msg(d, "Linear via Stripe <invoice+statements@stripe.com>", "Your receipt from Linear", "Linear Standard subscription. Amount paid $8.00"),
  );
  const [c] = buildCandidates(messages, { services, today: TODAY });
  assert.equal(c.name, "Linear");
  assert.equal(c.domain, null);
  assert.equal(c.cycle, "monthly");
  assert.equal(c.price, 8);
});

test("a cancellation email after the last charge marks it cancelled", () => {
  const messages = [
    msg("2026-08-01", "Spotify <no-reply@spotify.com>", "Your Spotify Premium receipt", "Premium subscription Total $11.99"),
    msg("2026-09-01", "Spotify <no-reply@spotify.com>", "Your Spotify Premium receipt", "Premium subscription Total $11.99"),
    msg("2026-09-10", "Spotify <no-reply@spotify.com>", "Your Premium has been cancelled", "We're sorry to see you go"),
  ];
  const [c] = buildCandidates(messages, { services, today: TODAY });
  assert.equal(c.status, "cancelled");
});

test("old charges with no recent receipt are marked lapsed", () => {
  const messages = ["2026-02-03", "2026-03-03", "2026-04-03"].map((d) =>
    msg(d, "Duolingo <no-reply@duolingo.com>", "Your Super Duolingo receipt", "Monthly subscription Total $12.99"),
  );
  const [c] = buildCandidates(messages, { services, today: TODAY });
  assert.equal(c.status, "lapsed");
});

test("free trial with no charge yet is flagged with its end date", () => {
  const messages = [msg("2026-10-15", "Canva <hello@canva.com>", "Welcome to your Canva Pro free trial", "Your free trial ends on October 29, 2026. Then $14.99/month.")];
  const [c] = buildCandidates(messages, { services, today: TODAY });
  assert.equal(c.isTrial, true);
  assert.equal(c.nextRenewal, "2026-10-29");
  assert.equal(c.cycle, "monthly");
  assert.equal(c.price, 14.99);
  assert.equal(c.charges.length, 0);
});

test("irregular varying receipts (rides, orders) are not subscriptions", () => {
  const messages = [
    ["2026-09-02", "$23.10"], ["2026-09-04", "$8.45"], ["2026-09-19", "$41.00"], ["2026-10-01", "$12.75"], ["2026-10-02", "$30.20"],
  ].map(([d, amt]) => msg(d, "Uber Receipts <noreply@uber.com>", "Your Thursday evening trip receipt", `Total ${amt}`));
  assert.equal(buildCandidates(messages, { services, today: TODAY }).length, 0);
});

test("shipping notifications are ignored", () => {
  const messages = [msg("2026-10-01", "Amazon <shipment-tracking@amazon.com>", "Your order has shipped", "Total $49.99")];
  assert.equal(buildCandidates(messages, { services, today: TODAY }).length, 0);
});

test("duplicate receipt + invoice for the same charge count once", () => {
  const messages = [
    msg("2026-09-20", "Notion <team@makenotion.com>", "Your receipt", "Plus plan subscription Total $10.00"),
    msg("2026-09-20", "Notion <team@makenotion.com>", "Your invoice", "Plus plan subscription Total $10.00"),
    msg("2026-10-20", "Notion <team@makenotion.com>", "Your receipt", "Plus plan subscription Total $10.00"),
  ];
  const [c] = buildCandidates(messages, { services, today: TODAY });
  assert.equal(c.charges.length, 2);
  assert.equal(c.name, "Notion");
});

test("searches look back about 15 months and skip promotions, except receipts filed there", () => {
  const [main, promos] = buildSearchQueries(TODAY);
  assert.match(main, /^after:2025\/7\/19 -category:promotions -category:social -in:sent -subject:\(delivered OR dispatched/);
  assert.match(promos, /^after:2025\/7\/19 \(category:promotions OR category:social\) -in:sent .* subject:\(receipt OR invoice/);
});
