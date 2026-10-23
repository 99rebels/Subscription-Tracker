// What kind of email is this? Decided before anything is read from it, so a
// trial reminder's price is never taken for a charge and a promo's "50% off Pro
// Annual" never makes a subscription (product-plan feature 10). Pure, tested in
// Node. Rules use Gmail's own labels and wording common to any sender, never a
// merchant's name.
//
//   receipt         money was taken (amount > 0): the only type that makes a charge
//   upcoming        a charge or renewal is coming: renewal reminders, "auto-renews on"
//   trial_start     a trial (or a €0 start of a subscription) began
//   trial_ending    a trial is ending or converting to paid
//   cancellation    it was, or will be, cancelled
//   payment_failed  a charge failed or the card on file expired (not a cancellation)
//   marketing       promos and newsletters, ignored
//   shipping        delivery updates, ignored
//   other           account notices, welcomes, terms, ignored

import { extractAmount } from "./receipts.js";

const LEAD_CHARS = 600;

export const IGNORED_TYPES = new Set(["marketing", "shipping", "other"]);

// Money was taken. "You'll be charged" is about the future, so it isn't here.
const PAID_RE =
  /\b(amount|total) (charged|paid)\b|\byou paid\b|\btotal paid\b|\bpaid (with|on|by)\b|\bpayment (received|confirmed|successful|confirmation)\b|\bhas been charged\b|\bwe(?:'ve|’ve| have) (billed|charged|processed)\b|\bprocessed your\b.*\bpayment\b|\bthank(s| you) for your (payment|purchase|order)\b|\border (number \S+ )?is complete\b|\bthis invoice has been paid\b|\brenewal success\b|\b(were|was|been) renewed\b|\brenewed automatically\b|\bsuccessfully subscribed\b/i;
// Receipt-like subjects; they need an amount in the email to count.
const RECEIPT_SUBJECT_RE = /\breceipt\b|\binvoice\b|\border\b|\bpurchase\b|\bpayment\b|\bbill(ing)?\b|\bstatement\b|\brenewal\b|\bsubscription\b|\bmembership\b|\bconfirm/i;
const RECURRING_RE =
  /(?<!un)subscri|\brenew|membership|recurring|billing (period|cycle)|next billing|\bplan\b|monthly|annual|yearly|per (month|year)|\/(mo|month|yr|year)\b/i;

const PROMO_LABELS = ["CATEGORY_PROMOTIONS", "CATEGORY_SOCIAL", "CATEGORY_FORUMS"];
const PROMO_SUBJECT_RE =
  /\b\d{1,2}% off\b|\bsale\b|\bdeals?\b|\boffer\b|\bdiscount|\bsave (up to )?[$€£]?\d|\blast chance\b|\bends (today|tonight|tomorrow|soon)\b|\bblack friday\b|\bcyber (week|monday)\b|\bfree shipping\b|\blimited[- ]time\b|\bnewsletter\b/i;

const FAILED_RE =
  /\bpayment\b[^.\n]{0,40}\b(failed|declined|unsuccessful|was not successful|could not be processed)\b|\bunable to (complete|process|charge|collect)\b[^.\n]{0,30}\bpayment\b|\bbilling (issue|problem)\b|\bupdate your (\w+ )?(payment|billing) (method|details|information|info)\b|\bpayment method (has )?expired\b|\bmay not renew\b|\bauto-?renew(al)? fail/i;
const CANCEL_RE =
  /\b(has been|was|been|is now|will be) cancel+ed\b|\bcancel+ed effective\b|\bcancel+ation (confirmed|confirmation|complete)\b|\bwill not (auto-?)?renew\b|\b(subscription|membership|plan) (has )?(ended|expired)\b|\b(plan|membership|subscription) (is about to|will) end\b|\bsorry to see you go\b|\bwe(?:'ve|’ve| have) cancel+ed\b/i;
const TRIAL_RE = /\bfree trial\b|\btrial (ends|ending|will end|is ending|expires|period|has started|starts|is over|for)\b|\btrialing\b|\byour (\w+ ){0,3}trial\b|\b\d+[- ]day trial\b/i;
const TRIAL_ENDING_RE = /\b(ends?|ending|will end|expires?|is over|about to (begin|start|end)|will (begin|start)( automatically)?|converts?|days? left)\b/i;
const UPCOMING_RE =
  /\brenewal (reminder|notice)\b|\brenews (on|tomorrow|soon|in)\b|\bwill (automatically )?(renew|be charged)\b|(you'll|you’ll|you will) be charged\b|\bupcoming (payment|charge|renewal)\b|\babout to renew\b|\bauto-?renews on\b|\bpayment is coming up\b|\bnext (payment|charge|billing date)\b/i;
const SHIPPING_RE = /\bshipped\b|\bout for delivery\b|\b(has been|was|successfully) delivered\b|\bdispatched\b|\btrack your (package|order|shipment)\b|\barrives (soon|today|tomorrow)\b|\byour (ride|trip) with\b|\bboarding pass\b|\be-?ticket\b/i;

/** Returns { type, amount } where amount is extractAmount()'s pick or null. */
export function classifyEmail(msg) {
  const subject = msg.subject ?? "";
  const text = `${subject}\n${msg.snippet ?? ""}\n${msg.body ?? ""}`;
  const lead = leadText(msg);
  const found = extractAmount(text);
  const amount = found?.amount ?? null;
  const paid = PAID_RE.test(text);
  const result = (type) => ({ type, amount: found });

  // Gmail's own tabs: promos and social mail are ignored unless money was clearly taken.
  const promoTab = (msg.labels ?? []).some((l) => PROMO_LABELS.includes(l));
  if ((promoTab || PROMO_SUBJECT_RE.test(subject)) && !(paid && amount > 0)) return result("marketing");

  if (FAILED_RE.test(subject) || (FAILED_RE.test(lead) && !(paid && amount > 0))) return result("payment_failed");
  if (CANCEL_RE.test(subject) || (CANCEL_RE.test(lead) && !(paid && amount > 0))) return result("cancellation");
  if (paid && amount > 0) return result("receipt");
  // "Amount charged: €0,00 … then €10,99/month": a subscription that started free.
  if (paid && amount === 0 && RECURRING_RE.test(text)) return result("trial_start");
  if (TRIAL_RE.test(lead)) return result(TRIAL_ENDING_RE.test(subject) || /\btrial\b[^.\n]{0,60}\b(ends?|will end|is ending|expires)\b|\bwill begin automatically\b/i.test(lead) ? "trial_ending" : "trial_start");
  if (UPCOMING_RE.test(lead)) return result("upcoming");
  if (RECEIPT_SUBJECT_RE.test(subject) && amount > 0 && !SHIPPING_RE.test(subject)) return result("receipt");
  if (SHIPPING_RE.test(subject)) return result("shipping");
  return result("other");
}

export function isRecurringText(text) {
  return RECURRING_RE.test(text);
}

// Invisible preview-line padding senders put before the content (U+034F, zero-width
// characters, soft hyphens, and the same as undecoded entities).
const PADDING_RE = /[\u034f\u00ad\u200b-\u200d\u2060\ufeff]|&(zwnj|zwj|shy|nbsp);|&#(8203|8204|8205|847|173);/gi;

// What an email is about is in its subject and opening lines; "start your free
// trial" or "manage your subscription" further down is usually an ad or a footer.
export function leadText(msg) {
  const body = (msg.body ?? "").replace(PADDING_RE, " ").replace(/\s+/g, " ").trim();
  return `${msg.subject ?? ""}\n${body.slice(0, LEAD_CHARS)}`;
}
