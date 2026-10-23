import { test } from "node:test";
import assert from "node:assert/strict";
import { extractCheckoutPrice } from "../src/lib/checkout-price.js";

test("common checkout phrasings", () => {
  assert.deepEqual(extractCheckoutPrice("Figma Professional $16.00 per month Total due today $16.00"), { amount: 16, currency: "USD", cycle: "monthly", trialDays: null });
  assert.deepEqual(extractCheckoutPrice("Plus plan — $119.88/year"), { amount: 119.88, currency: "USD", cycle: "yearly", trialDays: null });
  assert.deepEqual(extractCheckoutPrice("Premium £10.99 a month"), { amount: 10.99, currency: "GBP", cycle: "monthly", trialDays: null });
  assert.deepEqual(extractCheckoutPrice("Abo 9,99 €/month"), { amount: 9.99, currency: "EUR", cycle: "monthly", trialDays: null });
  assert.deepEqual(extractCheckoutPrice("US$1,299.00 per year"), { amount: 1299, currency: "USD", cycle: "yearly", trialDays: null });
});

test("trial then price: takes the price after 'then' and the trial length", () => {
  assert.deepEqual(extractCheckoutPrice("Start your free trial. Free for 7 days, then $9.99/month. Cancel anytime. $0.00/month today"), {
    amount: 9.99,
    currency: "USD",
    cycle: "monthly",
    trialDays: 7,
  });
  assert.equal(extractCheckoutPrice("30-day free trial, then $14.99/mo").trialDays, 30);
  assert.equal(extractCheckoutPrice("1 month free, then €5 per month").trialDays, 30);
});

test("amount plus a billing word elsewhere", () => {
  assert.deepEqual(extractCheckoutPrice("Pro plan Price $96.00 Billed annually"), { amount: 96, currency: "USD", cycle: "yearly", trialDays: null });
});

test("no recurring price", () => {
  assert.equal(extractCheckoutPrice("Thanks for your order! Your package ships tomorrow. Total $24.99"), null);
  assert.equal(extractCheckoutPrice("Welcome aboard"), null);
});
