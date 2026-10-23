import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyEmail, leadText } from "../src/lib/email-type.js";
import { analyseInbox, extractAmount, cleanSenderName } from "../src/lib/receipts.js";
import { mergeReceipts, resyncReason } from "../src/lib/resync.js";

const TODAY = "2026-10-23";
const at = (iso) => new Date(`${iso}T12:00:00`).getTime();
let n = 0;
const msg = (date, from, subject, body = "", labels = ["CATEGORY_UPDATES"]) => ({ id: String(n++), date: at(date), from, subject, snippet: "", body, labels });
const type = (subject, body, labels) => classifyEmail(msg(TODAY, "X <a@x.com>", subject, body, labels)).type;

// Wording below is quoted (shortened) from real receipts, reminders and promos.

test("paid receipts are receipts", () => {
  assert.equal(type("Your receipt from Render #2168-2946", "Receipt from Render $1.93 Paid September 1, 2026 Total $1.93 Amount paid $1.93"), "receipt");
  assert.equal(type("UFC Fight Pass Receipt", "We have processed your UFC Fight Pass membership payment … Membership: Monthly Sub total: €8.93 Tax: €2.06 Total: €10.99"), "receipt");
  assert.equal(type("ChatGPT - Your new plan", "You've successfully subscribed to ChatGPT Plus. Your subscription will automatically renew monthly. Total: €23.00"), "receipt");
  assert.equal(type("Thank you for your order.", "Order number 0000 is complete. .COM Domain Renewal | €22.16 1 Year Auto-renews on 05/01/2027 Subtotal: €22.16 Tax: €5.10 Total: €27.26"), "receipt");
});

test("a trial converting to paid is a trial, and its price isn't a charge", () => {
  assert.equal(type("Reminder: Your Canva Pro subscription is about to begin", "Thanks for trialing Canva Pro! … your Monthly subscription will begin automatically on 27 October 2026. Monthly (1 member) €12.00"), "trial_ending");
  assert.equal(type("Your free trial ends in 4 days", "Your free Linktree Pro (Annual) trial ends in 4 days"), "trial_ending");
  assert.equal(type("Your Scribd subscription confirmation", "Recurring Monthly Membership for €10,99/month Starting , you’ll be charged €10,99 per month. Amount charged : €0,00"), "trial_start");
});

test("reminders, cancellations and failed payments", () => {
  assert.equal(type("Renewal Reminder: Your Workspace subscription renews on June 5, 2026", "Our records indicate that your service renews on June 5, 2026"), "upcoming");
  assert.equal(type("ChatGPT - Your plan will not renew", "Your ChatGPT Plus subscription will not renew and will be canceled"), "cancellation");
  assert.equal(type("Your cancellation confirmation", "Your subscription has been canceled effective June 17, 2026."), "cancellation");
  assert.equal(type("UFC.TV Billing Issue", "We were unable to complete your UFC payment. Your most recent payment for a Monthly failed."), "payment_failed");
  assert.equal(type("$54.99 payment to MuseScore was unsuccessful", ""), "payment_failed");
  assert.equal(type("Jane, your domains may not renew.", "Auto-renews on 06/01/2026 | Term: 1 Year €21.99"), "payment_failed");
});

test("promos are marketing, even when they talk about plans and trials", () => {
  assert.equal(type("50% off Pro Annual for a limited time", "Save on Codecademy Pro annual plans", ["CATEGORY_PROMOTIONS"]), "marketing");
  assert.equal(type("🔥 BF6 FREE TRIAL | Deploy Now 🔥", "Experience the best-selling shooter of the year for free", ["CATEGORY_PROMOTIONS"]), "marketing");
  assert.equal(type("The latest renewed and canceled shows", "", ["CATEGORY_PROMOTIONS"]), "marketing");
  // Subject wording alone, for inboxes without Gmail's tabs.
  assert.equal(type("FLASH SALE: 50% off Pro", "Join today", []), "marketing");
});

test("a free-trial ad below the content doesn't make a newsletter a trial", () => {
  const body = `${"An essay about suffering. ".repeat(40)} Start your free trial of our paid tier for €100/year.`;
  assert.equal(type("Arthur Brooks: Don’t Waste Your Suffering", body), "other");
});

test("preview-line padding doesn't hide the opening lines", () => {
  const padding = "͏ ‌ &shy; ".repeat(200);
  const m = msg(TODAY, "Canva <no-reply@canva.com>", "Reminder: Your Canva Pro subscription is about to begin", `${padding} Thanks for trialing Canva Pro!`);
  assert.match(leadText(m), /Thanks for trialing/);
  assert.equal(classifyEmail(m).type, "trial_ending");
});

test("subtotals and future prices aren't the amount charged", () => {
  assert.deepEqual(extractAmount("Subtotal: €22.16 Tax: €5.10 Total: €27.26"), { amount: 27.26, currency: "EUR" });
  assert.deepEqual(extractAmount("Sub total: €8.93 Tax: €2.06 Total: €10.99"), { amount: 10.99, currency: "EUR" });
  assert.deepEqual(extractAmount("Starting soon, you’ll be charged €10,99 per month. Amount charged : €0,00"), { amount: 0, currency: "EUR" });
});

test("scan: a converting trial comes out as a trial with its end date and price", () => {
  const { candidates } = analyseInbox(
    [msg("2026-10-22", "Canva <no-reply@canva.com>", "Reminder: Your Canva Pro subscription is about to begin", "Thanks for trialing Canva Pro! Your Monthly subscription will begin automatically on 27 October 2026. Monthly (1 member) €12.00")],
    { services: [{ name: "Canva", domains: ["canva.com"] }], today: TODAY },
  );
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].isTrial, true);
  assert.equal(candidates[0].nextRenewal, "2026-10-27");
  assert.equal(candidates[0].price, 12);
  assert.deepEqual(candidates[0].charges, []);
});

test("scan: a trial that ended weeks ago with no receipt didn't convert", () => {
  const { candidates } = analyseInbox(
    [msg("2026-08-31", "Linktree <info@billing.linktr.ee>", "Your free trial ends in 4 days", "Your free Linktree Pro (Annual) trial ends in 4 days. Trial ends on 04 September 2026")],
    { today: TODAY },
  );
  assert.equal(candidates[0].status, "cancelled");
  assert.equal(candidates[0].cancelledOn, "2026-09-04");
});

test("scan: promos, personal senders and your own sent mail never become subscriptions", () => {
  const promo = msg("2026-09-01", "Codecademy <learn@tr.mail.codecademy.com>", "50% off Pro Annual", "Pro annual plan, $119.99/year", ["CATEGORY_PROMOTIONS"]);
  const person = msg("2026-02-14", "Alex <alex@outlook.ie>", "Club Insurance Renewal Information", "Renewal fee €25.80 per year, payment received");
  const sent = { ...msg("2026-04-02", "Me <me@gmail.com>", "Fwd: invoice", "Subscription invoice, amount paid €215.88 per year"), labels: ["SENT"] };
  assert.deepEqual(analyseInbox([promo, person, sent], { today: TODAY }).candidates, []);
});

test("scan: one receipt that says it renews is enough; two food orders a month apart aren't", () => {
  const ufc = msg("2026-07-12", "UFC Fight Pass <ufc@ufcfightpass.com>", "UFC Fight Pass Receipt", "We have processed your UFC Fight Pass membership payment. Membership: Monthly Total: €10.99");
  const food = ["2026-09-11", "2026-10-07"].map((d) => msg(d, "Uber Receipts <noreply@uber.com>", "Your Friday afternoon order with Uber Eats", "Thanks for ordering. Total €8.73 Amount paid €8.73"));
  const { candidates } = analyseInbox([ufc, ...food], { today: "2026-08-01" });
  assert.deepEqual(candidates.map((c) => c.name), ["UFC Fight Pass"]);
});

test("scan: a failed payment shows it was still running", () => {
  const { candidates } = analyseInbox(
    [
      msg("2026-07-12", "UFC Fight Pass <ufc@ufcfightpass.com>", "UFC Fight Pass Receipt", "We have processed your membership payment. Membership: Monthly Total: €10.99"),
      msg("2026-09-12", "UFC Fight Pass <ufc@ufcfightpass.com>", "UFC.TV Billing Issue", "We were unable to complete your UFC payment"),
    ],
    { today: TODAY },
  );
  assert.equal(candidates[0].status, "active");
  assert.equal(candidates[0].nextRenewal, "2026-11-12");
});

test("scan: a merchant billing through Stripe for a while is still one merchant", () => {
  assert.equal(cleanSenderName("Render Services, Inc dba Render"), "Render");
  const own = ["2026-01-03", "2026-02-03", "2026-03-04"].map((d) => msg(d, "Render <invoice+statements@render.com>", "Your receipt from Render", "Amount paid $7.00 Total $7.00"));
  const stripe = ["2026-04-04", "2026-05-04"].map((d) => msg(d, '"Render Services, Inc dba Render" <invoice+statements+acct_1@stripe.com>', "Your receipt from Render Services, Inc dba Render", "Amount paid $7.00 Total $7.00"));
  const { candidates } = analyseInbox([...own, ...stripe], { today: "2026-05-20" });
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].charges.length, 5);
  assert.equal(candidates[0].status, "active");
});

test("re-sync asks about a new trial instead of calling it a receipt", () => {
  const analysis = analyseInbox(
    [msg("2026-10-22", "Canva <no-reply@canva.com>", "Reminder: Your Canva Pro subscription is about to begin", "Thanks for trialing Canva Pro! Your Monthly subscription will begin automatically on 27 October 2026. Monthly (1 member) €12.00")],
    { services: [{ name: "Canva", domains: ["canva.com"] }], today: TODAY },
  );
  const { questions } = mergeReceipts([], analysis, { today: TODAY });
  assert.equal(questions.length, 1);
  const reason = resyncReason(questions[0]);
  assert.equal(reason.title, "Track your Canva trial?");
  assert.match(reason.detail, /^Free trial ends Oct 27, then €12\.00\/mo\./);
});

// --- Billing periods and dates ------------------------------------------------

import { cycleHint, stripBoilerplate, parseNumericDate, extractRenewalDate } from "../src/lib/receipts.js";
import { classifyScan } from "../src/lib/scan.js";

test("billing periods as receipts write them", () => {
  assert.equal(cycleHint(".COM Domain Renewal | €22.16\n1 Year\nTotal: €27.26"), "yearly");
  assert.equal(cycleHint("Renewal of: WordPress Basic Hosting 1 year(s) $47.88"), "yearly");
  assert.equal(cycleHint("Membership: Monthly Total: €10.99"), "monthly");
  assert.equal(cycleHint("Your free Linktree Pro (Annual) trial ends in 4 days"), "yearly");
  assert.equal(cycleHint("Recurring Membership for €10,99/month"), "monthly");
  assert.equal(cycleHint("Try 1 month free, then €9.99"), null);
  assert.equal(cycleHint("Thanks for your order"), null);
});

test("small print about other products doesn't decide the period", () => {
  const godaddy = ".COM Domain Renewal | €22.16 1 Year. If your products are on a 1 month subscription term, they will automatically renew next month.";
  assert.equal(cycleHint(godaddy), "yearly");
  assert.equal(cycleHint("Total: €27.26. *Prices are current as of 29/09/2026. If your products are on a subscription term of 12 months or less, they will renew."), null);
  assert.doesNotMatch(stripBoilerplate("You agreed to our Universal Terms of Service Agreement. Total €5"), /Terms/);
});

test("the first period mentioned wins over a later upsell", () => {
  assert.equal(cycleHint("Membership: Monthly Total €10.99. Switch to annual and save 20%!"), "monthly");
});

test("numeric dates: day/month order from the date itself, the email, or the send date", () => {
  assert.equal(parseNumericDate("25/12/2026"), "2026-12-25");
  assert.equal(parseNumericDate("12/25/2026"), "2026-12-25");
  // Another date in the same email settles it.
  assert.equal(parseNumericDate("05/01/2027", { text: "Auto-renews on 05/01/2027. Prices are current as of 29/09/2026." }), "2027-01-05");
  assert.equal(parseNumericDate("01/06/2027", { text: "Expires 01/06/2027. Order date 12/22/2025" }), "2027-01-06");
  // Otherwise the reading closest to when it was sent.
  assert.equal(parseNumericDate("05/01/2027", { sentAt: at("2026-09-29") }), "2027-01-05");
  assert.equal(parseNumericDate("01/06/2027", { sentAt: at("2026-01-03") }), "2027-01-06");
  assert.equal(parseNumericDate("7/12/26", { sentAt: at("2026-07-12") }), "2026-07-12");
  assert.equal(extractRenewalDate("Auto-renews on 06/01/2026 | Term: 1 Year", at("2025-12-08")), "2026-01-06");
});

test("scan: the receipt's own period beats a guess; with nothing to go on, it asks", () => {
  const yearly = msg("2026-09-29", "GoDaddy <donotreply@godaddy.com>", "Thank you for your order.", ".COM Domain Renewal | €22.16 1 Year Auto-renews on 05/01/2027 for €21.99 Subtotal: €22.16 Total: €27.26. Prices are current as of 29/09/2026. If your products are on a 1 month subscription term, they will automatically renew next month.");
  const [c] = analyseInbox([yearly], { today: TODAY }).candidates;
  assert.equal(c.cycle, "yearly");
  assert.equal(c.cycleConfident, true);
  assert.equal(c.price, 27.26);
  assert.equal(c.nextRenewal, "2027-01-05");

  const vague = msg("2026-10-01", "Acme <billing@acme.io>", "Your Acme subscription receipt", "Thanks for your subscription. Amount paid $9.00");
  const analysis = analyseInbox([vague], { today: TODAY });
  assert.equal(analysis.candidates[0].cycleConfident, false);
  const groups = classifyScan(analysis, { today: TODAY });
  assert.equal(groups.paying.length, 0);
  assert.match(groups.confirm[0].detail, /Only one receipt found|Couldn't tell how often/);
});

test("scan: a trial that ended says so, not 'cancellation email'", () => {
  const analysis = analyseInbox([msg("2026-08-31", "Linktree <info@billing.linktr.ee>", "Your free trial ends in 4 days", "Trial ends on 04 September 2026")], { today: TODAY });
  assert.equal(classifyScan(analysis, { today: TODAY }).notAdded[0].note, "Trial ended Sep 4, no charge since");
});

test("card digits on the line above a price aren't the price", () => {
  assert.deepEqual(extractAmount("€4.99\nTotal\nPaid with Mastercard •••• 4242\n€4.99\n(Includes Tax €0.93)"), { amount: 4.99, currency: "EUR" });
  assert.deepEqual(extractAmount("Total: 29,99€ (incl. VAT 5,61€)"), { amount: 29.99, currency: "EUR" });
  assert.deepEqual(extractAmount("Item price: 49.00 €"), { amount: 49, currency: "EUR" });
});

test("scan: movie purchases from a known subscription service aren't the subscription", () => {
  const movies = [["2025-08-03", "€4.99"], ["2025-08-21", "€3.99"], ["2025-09-20", "€4.99"]].map(([d, p]) =>
    msg(d, "YouTube <noreply-purchases@youtube.com>", "Your YouTube receipt", `Thanks for purchasing a movie on YouTube. You have until 2 Sept 2025 to begin watching your movie. ${p} Total Paid with Mastercard •••• 4242 ${p}`),
  );
  const services = [{ name: "YouTube Premium", domains: ["youtube.com"] }];
  assert.deepEqual(analyseInbox(movies, { services, today: TODAY }).candidates, []);
  const premium = msg("2026-10-01", "YouTube <noreply@youtube.com>", "Your YouTube Premium receipt", "Your YouTube Premium membership renews monthly. Total €13.99");
  assert.equal(analyseInbox([...movies, premium], { services, today: TODAY }).candidates.length, 1);
});
