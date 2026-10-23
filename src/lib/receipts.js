// Turns receipt-like emails into subscription candidates. Pure functions with no
// chrome.* calls, so this can be unit-tested in Node.
//
// Input messages: { id, date (ms), from, subject, snippet, body, labels? (Gmail label ids) }
// Each email is typed first (email-type.js); see product-plan feature 10.

import { registrableDomain, guessName, hostMatches } from "./services.js";
import { addCycle, nextRenewalOnOrAfter, toISODate, daysBetween, today as todayISO } from "./dates.js";
import { classifyEmail, IGNORED_TYPES, isRecurringText, leadText } from "./email-type.js";

const DAY_MS = 86_400_000;

// Receipts sent by a payment processor on a merchant's behalf: the sender's
// display name ("Linear via Stripe") identifies the merchant, not the domain.
const PROCESSORS = {
  "stripe.com": "Stripe",
  "paddle.com": "Paddle",
  "paypal.com": "PayPal",
  "lemonsqueezy.com": "Lemon Squeezy",
  "chargebee.com": "Chargebee",
  "recurly.com": "Recurly",
  "fastspring.com": "FastSpring",
  "gumroad.com": "Gumroad",
};
const PROCESSOR_DOMAINS = Object.keys(PROCESSORS);

// Emails are typed first (email-type.js); only receipts make charges.
// Billing-period wording. "1 Year" on a GoDaddy line item, "1 year(s)" in a
// Bluehost term column, "Membership: Monthly", "Pro (Annual)", "€10,99/month".
const CYCLE_HINTS = [
  ["weekly", /\b(per|a|every|\/)\s?(week|wk)\b|\bweekly\b|\b1[- ]?week\b/i],
  ["yearly", /\b(per|a|every|\/)\s?(year|yr)\b|\bannual(ly)?\b|\byearly\b|\b(1|one)[- ]?(year|yr)s?\b|\b1 year\(s\)|\b12[- ]months?\b/i],
  ["monthly", /\b(per|a|every|\/)\s?(month|mo)\b|\bmonthly\b|\b(1|one)[- ]?month\b(?! free)/i],
];

// Legal small print says things like "If your products are on a 1 month
// subscription term, they will renew next month": true of *some* products, so
// it says nothing about this one. Dropped before reading periods.
const BOILERPLATE_RE =
  /^\s*(\*|if\b|note:|by (subscribing|continuing|clicking)|during the checkout|this message (also )?confirms)|terms of (service|use)|you agreed|agreements?\b.*\bpolic|refund policy|prices? (do not include|are current|is subject|are subject)|subject to change|installment/i;

export function stripBoilerplate(text) {
  return text
    .split(/(?<=[.!?])\s+|\n+/)
    .filter((sentence) => !BOILERPLATE_RE.test(sentence))
    .join("\n");
}

const CYCLE_DAYS = { weekly: 7, monthly: 30.4, yearly: 365 };

// ---------------------------------------------------------------------------
// Text helpers

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", euro: "€", pound: "£", zwnj: "", zwj: "", shy: "", mdash: "—", ndash: "–", copy: "©", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", hellip: "…" };

export function decodeEntities(text) {
  return text.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, code) => {
    if (code[0] === "#") {
      const n = code[1].toLowerCase() === "x" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : match;
    }
    return ENTITIES[code.toLowerCase()] ?? match;
  });
}

export function htmlToText(html) {
  return decodeEntities(
    html
      .replace(/<(style|script|head)[\s\S]*?<\/\1>/gi, " ")
      .replace(/<br\s*\/?>|<\/(p|div|tr|li|h\d|table)>/gi, "\n")
      .replace(/<\/t[dh]>/gi, " ")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/[ \t ]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .trim();
}

// ---------------------------------------------------------------------------
// Field extraction

export function parseFrom(from = "") {
  const match = from.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>/);
  const name = match ? match[1].trim() : "";
  const address = (match ? match[2] : from).trim().toLowerCase();
  const host = address.split("@")[1] ?? "";
  return { name, address, domain: host ? registrableDomain(host) : "" };
}

// One-off purchase wording: "Thanks for purchasing A Complete Unknown on YouTube",
// "You've made a purchase from … on Google Play".
const PURCHASE_RE = /\bthanks? (you )?for (purchasing|your purchase|ordering)\b|\byou(?:'ve|’ve| have) made a purchase\b|\b(rent(al|ed)|to begin watching)\b|\border (date|number)\b/i;

// Domain names are sold by the year.
const DOMAIN_RE = /\bdomain (name )?(renewal|registration|transfer)\b/i;

// People, not merchants: receipts never come from personal mail providers.
const PERSONAL_MAIL_RE = /^(gmail|googlemail|outlook|hotmail|live|msn|yahoo|ymail|icloud|me|mac|aol|proton|protonmail|gmx|mail|zoho|fastmail|eircom|example)\.[a-z.]+$/i;

// "Adobe Billing" -> "Adobe", "Linear via Stripe" -> "Linear",
// "Render Services, Inc dba Render" -> "Render" (dba: "doing business as")
export function cleanSenderName(name) {
  return name
    .replace(/^.*\s+d\/?b\/?a\s+/i, "")
    .replace(/\s+via\s+\w+$/i, "")
    .replace(/\b(billing|receipts?|invoices?|payments?|renewals?|orders?|team|support|accounts?|no-?reply|notifications?|inc\.?|llc|ltd)\b/gi, "")
    .replace(/[|,·-]+\s*$/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

const CURRENCY_SYMBOLS = {
  "US$": "USD", $: "USD", USD: "USD",
  "€": "EUR", EUR: "EUR",
  "£": "GBP", GBP: "GBP",
  "CA$": "CAD", CAD: "CAD",
  "A$": "AUD", AUD: "AUD",
};
const SYMBOL = "(US\\$|CA\\$|A\\$|\\$|€|£|USD|EUR|GBP|CAD|AUD)";
const NUMBER = "(\\d{1,3}(?:[,.]\\d{3})*(?:[.,]\\d{2})|\\d+(?:[.,]\\d{2})?)";
// "€4.99", "29,99 €". A number before a currency sign must be on the same line,
// not card digits ("•••• 4242" then "€4.99" on the next line is €4.99, not
// €4,242), and the sign mustn't be the start of the next amount.
const AMOUNT_RE = new RegExp(`${SYMBOL}\\s?${NUMBER}|(?<![•*xX#-][ \\u00a0]?|\\d)${NUMBER}[ \\u00a0]?(€|EUR|USD|GBP)(?![ \\u00a0]?\\d)`, "g");
// "Subtotal" / "Sub total" is before tax, so it isn't the total.
const AMOUNT_KEYWORD_RE = /(?<!sub[ -]?)total|amount (charged|paid|due)|charged|you paid|payment of|billed|price/gi;

function parseNumber(raw) {
  // "1,299.00" / "1.299,00" / "15,49" / "15.49"
  const cleaned = raw.replace(/\s/g, "");
  const lastSep = Math.max(cleaned.lastIndexOf("."), cleaned.lastIndexOf(","));
  if (lastSep !== -1 && cleaned.length - lastSep - 1 === 2) {
    return Number(cleaned.slice(0, lastSep).replace(/[.,]/g, "") + "." + cleaned.slice(lastSep + 1));
  }
  return Number(cleaned.replace(/[.,]/g, ""));
}

// Pick the amount closest after a "total"/"charged" keyword, else the first one.
export function extractAmount(text) {
  const amounts = [];
  for (const m of text.matchAll(AMOUNT_RE)) {
    const symbol = m[1] ?? m[4];
    const value = parseNumber(m[2] ?? m[3]);
    if (Number.isFinite(value)) amounts.push({ index: m.index, amount: value, currency: CURRENCY_SYMBOLS[symbol] });
  }
  if (!amounts.length) return null;

  let best = null;
  for (const k of text.matchAll(AMOUNT_KEYWORD_RE)) {
    // "you'll be charged €10,99" is a future price, not what was charged.
    if (/\bbe\s*$/i.test(text.slice(Math.max(0, k.index - 6), k.index))) continue;
    const after = amounts.find((a) => a.index > k.index && a.index - k.index < 80);
    if (after && (!best || after.index - k.index < best.distance)) best = { ...after, distance: after.index - k.index };
  }
  const pick = best ?? amounts[0];
  return { amount: pick.amount, currency: pick.currency };
}

// The billing period an email states, or null. When several appear, the first one
// in the email wins (the content comes before the small print and the ads).
export function cycleHint(text) {
  const clean = stripBoilerplate(text);
  let best = null;
  for (const [cycle, re] of CYCLE_HINTS) {
    const m = clean.match(re);
    if (m && (!best || m.index < best.index)) best = { cycle, index: m.index };
  }
  return best?.cycle ?? null;
}

const MONTHS = "(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*";
// "November 3, 2026" / "3 Nov 2026" / "05/01/2027" / "7/12/26"
const NUMERIC_DATE = "\\d{1,2}[/.-]\\d{1,2}[/.-](?:\\d{4}|\\d{2})\\b";
const DATE_TEXT = `(${MONTHS}\\.? \\d{1,2},? \\d{4}|\\d{1,2} ${MONTHS}\\.?,? \\d{4}|${NUMERIC_DATE})`;
const RENEWAL_DATE_RE = new RegExp(
  `(?:next (?:billing|payment|charge|renewal)(?: date)?|renews?|renewing|renewal date|trial (?:ends|will end|expires)|ends|will end|will (?:begin|start)(?: automatically)?|start date|payment date|will be charged|billed)\\s*(?:on|:)?\\s*${DATE_TEXT}`,
  "i",
);

// "Your plan renews on November 3, 2026" -> "2026-11-03"; "Auto-renews on
// 05/01/2027" -> "2027-01-05" when the email is DD/MM. sentAt (ms) is the email's
// date, used to tell DD/MM from MM/DD.
export function extractRenewalDate(text, sentAt = null) {
  const m = text.match(RENEWAL_DATE_RE);
  if (!m) return null;
  if (/^\d/.test(m[1]) && /[/.-]/.test(m[1])) return parseNumericDate(m[1], { text, sentAt });
  const parsed = new Date(m[1].replace(/\./g, "").replace(/,/g, ""));
  return Number.isNaN(parsed.getTime()) ? null : toISODate(parsed);
}

const NUMERIC_DATE_ALL_RE = /\b(\d{1,2})[/.-](\d{1,2})[/.-](\d{4}|\d{2})\b/g;

/**
 * "05/01/2027": 5 January (most of the world) or May 1 (US)? Decided by, in order:
 *   - the date itself, if one part is over 12
 *   - any other date in the same email whose order is clear ("29/09/2026")
 *   - whichever reading is closest to when the email was sent: renewal and
 *     billing dates in an email are near it (GoDaddy's 05/01/2027 sent in
 *     September is January; Bluehost's 01/06/2027 sent in January is January 6)
 */
export function parseNumericDate(raw, { text = "", sentAt = null } = {}) {
  const [a, b, y] = raw.split(/[/.-]/).map(Number);
  const year = y < 100 ? 2000 + y : y;
  const iso = (day, month) => (day >= 1 && day <= 31 && month >= 1 && month <= 12 ? `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}` : null);
  const dayFirst = iso(a, b);
  const monthFirst = iso(b, a);
  if (!dayFirst || !monthFirst) return dayFirst ?? monthFirst;
  if (dayFirst === monthFirst) return dayFirst;

  for (const [, x, z] of text.matchAll(NUMERIC_DATE_ALL_RE)) {
    if (Number(x) > 12 && Number(z) <= 12) return dayFirst;
    if (Number(z) > 12 && Number(x) <= 12) return monthFirst;
  }
  if (sentAt == null) return dayFirst;
  const sent = toISODate(new Date(sentAt));
  return Math.abs(daysBetween(sent, dayFirst)) <= Math.abs(daysBetween(sent, monthFirst)) ? dayFirst : monthFirst;
}

// ---------------------------------------------------------------------------
// Grouping

export function merchantOf(message, services = []) {
  const { name, domain } = parseFrom(message.from);
  const cleaned = cleanSenderName(name);
  if (PROCESSOR_DOMAINS.includes(domain)) {
    if (!cleaned) return null;
    return { key: `name:${cleaned.toLowerCase()}`, name: cleaned, domain: null, processor: PROCESSORS[domain] };
  }
  if (!domain || PERSONAL_MAIL_RE.test(domain)) return null;
  const service = services.find((s) => s.domains.some((d) => hostMatches(domain, d) || hostMatches(d, domain)));
  return {
    key: service ? `service:${service.name}` : domain,
    name: service?.name ?? (cleaned || guessName(domain)),
    domain: service?.domains[0] ?? domain,
    service,
  };
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function cycleFromIntervals(intervals) {
  if (!intervals.length) return null;
  const m = median(intervals);
  if (m >= 6 && m <= 8) return "weekly";
  if (m >= 26 && m <= 35) return "monthly";
  if (m >= 350 && m <= 380) return "yearly";
  return null;
}

function messageText(msg) {
  return `${msg.subject ?? ""}\n${msg.snippet ?? ""}\n${msg.body ?? ""}`;
}

/**
 * Group messages by merchant and decide which groups look like subscriptions.
 * Returns candidates sorted by monthly cost, most expensive first.
 */
export function buildCandidates(messages, options) {
  return analyseInbox(messages, options).candidates;
}

/**
 * Like buildCandidates, plus what the scan results screen shows as "Not added"
 * and "Please confirm" beyond the candidates:
 *   rejected:  merchants with frequent irregular receipts (rides, orders)
 *   questions: services sold as a plan we can't see in the receipts
 *              ("Found 9 order receipts. Do you have Prime?")
 */
export function analyseInbox(messages, { services = [], today = todayISO() } = {}) {
  // Type every email first; promos, deliveries and account notices are dropped
  // before grouping, so their wording can't make a merchant look like a subscription.
  const groups = new Map();
  for (const msg of messages) {
    if (msg.labels?.includes("SENT")) continue; // the person's own emails
    const { type, amount } = classifyEmail(msg);
    if (IGNORED_TYPES.has(type)) continue;
    const merchant = merchantOf(msg, services);
    if (!merchant) continue;
    if (!groups.has(merchant.key)) groups.set(merchant.key, { merchant, items: [] });
    groups.get(merchant.key).items.push({ msg, text: messageText(msg), lead: leadText(msg), type, amount });
  }

  // A merchant that bills through Stripe or Paddle for a while ("Render via
  // Stripe") is the same one that emails from its own domain ("Render").
  for (const [key, group] of groups) {
    if (!group.merchant.processor) continue;
    const own = [...groups.values()].find((g) => !g.merchant.processor && g.merchant.name.toLowerCase() === group.merchant.name.toLowerCase());
    if (!own) continue;
    own.items.push(...group.items);
    groups.delete(key);
  }

  const candidates = [];
  const rejected = [];
  const questions = [];
  for (const { merchant, items } of groups.values()) {
    items.sort((a, b) => a.msg.date - b.msg.date);
    const ofType = (...types) => items.filter((i) => types.includes(i.type));

    const cancels = ofType("cancellation");
    const trials = ofType("trial_start", "trial_ending");
    const upcoming = ofType("upcoming");
    // Trials, reminders and cancellations are about a subscription by nature;
    // receipts and failed payments only when they say so.
    const recurringHits = items.filter((i) => ["cancellation", "trial_start", "trial_ending"].includes(i.type) || isRecurringText(i.lead)).length;
    // A receipt that itself says it renews ("Membership: Monthly", "1 year(s)").
    const recurringReceipt = items.some((i) => i.type === "receipt" && isRecurringText(i.lead));
    // Known services sell one-off things too (YouTube movies, Google Play items):
    // if every receipt reads like a purchase and none says it renews, being a
    // known service proves nothing.
    const receiptItems = ofType("receipt");
    const purchasesOnly = receiptItems.length > 0 && !recurringReceipt && receiptItems.every((i) => PURCHASE_RE.test(i.lead));
    const knownService = merchant.service && !purchasesOnly;

    // Charges come from receipts only. A receipt and an invoice for the same
    // charge often arrive together, so merge anything within 3 days.
    const charges = [];
    for (const i of ofType("receipt")) {
      if (!i.amount || i.amount.amount <= 0) continue;
      const last = charges.at(-1);
      if (last && i.msg.date - last.date < 3 * DAY_MS) continue;
      charges.push({ date: i.msg.date, amount: i.amount.amount, currency: i.amount.currency });
    }
    // The price a trial or reminder quotes ("then €12.00 a month"), never a charge.
    const quotedPrice = [...trials, ...upcoming].filter((i) => i.amount?.amount > 0).at(-1)?.amount ?? null;

    const intervals = charges.slice(1).map((c, n) => (c.date - charges[n].date) / DAY_MS);
    // The billing period, most trusted first: a steady run of receipts (3+); what
    // the newest receipt says ("1 Year"); what a reminder or trial says; the gap
    // between two receipts; what's typical (domains are sold by the year). If
    // nothing says, it's "monthly" but not confident, so the scan asks.
    const intervalCycle = cycleFromIntervals(intervals);
    const stated = (list) => [...list].reverse().map((i) => cycleHint(i.text)).find(Boolean) ?? null;
    const receiptCycle = stated(ofType("receipt").filter((i) => i.amount?.amount > 0));
    const noticeCycle = stated([...upcoming, ...trials]);
    const typicalCycle = merchant.service?.defaultCycle ?? (items.some((i) => DOMAIN_RE.test(i.lead)) ? "yearly" : null);
    const steadyCycle = intervals.length >= 2 ? intervalCycle : null;
    const knownCycle = steadyCycle ?? receiptCycle ?? noticeCycle ?? intervalCycle;
    const cycle = knownCycle ?? typicalCycle ?? "monthly";

    const recent = charges.slice(-3).map((c) => c.amount);
    const amountsConsistent = recent.length >= 2 && Math.max(...recent) / Math.min(...recent) <= 1.5;
    const regular = intervalCycle !== null && intervals.length >= 1;

    // Score how subscription-like this merchant's emails are.
    let score = 0;
    if (recurringHits > 0) score += 2;
    if (regular) score += 2;
    if (amountsConsistent) score += 1;
    if (charges.length >= 2) score += 1;
    if (knownService) score += 2;
    if (trials.length) score += 3;
    if (recurringReceipt) score += 1;
    if (receiptCycle) score += 1; // "Membership: Monthly", "1 Year"
    if (regular && charges.length >= 4) score += 1; // a long steady run
    if (upcoming.some((i) => isRecurringText(i.lead))) score += 1;
    if (!charges.length && !trials.length && !upcoming.length) score -= 2;
    // Frequent charges with irregular gaps and varying amounts are rides/orders, not subscriptions.
    if (charges.length >= 3 && !regular && !amountsConsistent) score -= 3;
    // A service known by its plan ("Prime") whose emails never mention it: these
    // are probably orders, so ask instead of guessing.
    const plan = merchant.service?.plan;
    if (plan && !items.some((i) => i.text.toLowerCase().includes(plan.toLowerCase()))) {
      questions.push({
        key: merchant.key,
        name: merchant.service.name,
        plan,
        domain: merchant.domain,
        domains: merchant.service.domains,
        cancelUrl: merchant.service.cancelUrl ?? "",
        receiptCount: items.length,
      });
      continue;
    }

    // Only something its emails call a subscription, a known service, or 3+
    // regular charges. Two food orders 26 days apart aren't a monthly plan.
    const evidence = recurringHits > 0 || knownService || (regular && charges.length >= 3);
    if (score < 3 || !evidence) {
      if (charges.length >= 3 && !regular && !amountsConsistent) {
        rejected.push({ key: merchant.key, name: merchant.name, domain: merchant.domain, reason: "irregular", receiptCount: charges.length });
      }
      continue;
    }

    const lastCharge = charges.at(-1) ?? null;
    const lastChargeDate = lastCharge ? toISODate(new Date(lastCharge.date)) : null;
    const lastCancel = cancels.at(-1);
    const lastTrial = trials.at(-1);
    // A failed payment means it was still running then (receipts don't always come
    // every cycle), so it counts like a charge when judging "lapsed".
    const lastFailed = ofType("payment_failed").at(-1);
    const lastSign = Math.max(lastCharge?.date ?? 0, lastCharge && lastFailed ? lastFailed.msg.date : 0) || null;
    // When the trial ends, from the newest trial email that says.
    const trialEnd = [...trials].reverse().map((i) => extractRenewalDate(i.text, i.msg.date)).find(Boolean) ?? null;
    const inTrial = !!lastTrial && (!lastCharge || lastTrial.msg.date > lastCharge.date);

    let status = "active";
    let cancelledOn = null;
    let trialEnded = false;
    if (lastCancel && (!lastCharge || lastCancel.msg.date >= lastCharge.date)) {
      status = "cancelled";
      cancelledOn = toISODate(new Date(lastCancel.msg.date));
    } else if (inTrial && trialEnd && daysBetween(trialEnd, today) > 14) {
      // The trial ended over two weeks ago and no receipt followed: it didn't convert.
      status = "cancelled";
      cancelledOn = trialEnd;
      trialEnded = true;
    } else if (inTrial && !trialEnd && daysBetween(toISODate(new Date(lastTrial.msg.date)), today) > 45) {
      status = "lapsed";
    } else if (!inTrial && lastSign && daysBetween(toISODate(new Date(lastSign)), today) > CYCLE_DAYS[cycle] * 1.5 + 7) {
      status = "lapsed";
    }

    const isTrial = inTrial && status === "active" && (!trialEnd || trialEnd >= today);

    // The next charge: a trial's end date; else an explicit "renews on …" from the
    // newest reminder or receipt that has one in the future; else project forward
    // from the last charge.
    let nextRenewal = null;
    let anchorDay = null;
    const explicitDate = isTrial
      ? trialEnd
      : [...upcoming, ...ofType("receipt")].sort((a, b) => b.msg.date - a.msg.date).map((i) => extractRenewalDate(i.text, i.msg.date)).find((d) => d && d >= today) ?? null;
    if (explicitDate && explicitDate >= today) {
      nextRenewal = explicitDate;
      anchorDay = Number(explicitDate.slice(8));
    } else if (lastChargeDate) {
      anchorDay = Number(lastChargeDate.slice(8));
      nextRenewal = nextRenewalOnOrAfter(addCycle(lastChargeDate, cycle, anchorDay), cycle, anchorDay, today);
    }

    candidates.push({
      key: merchant.key,
      name: merchant.name,
      domain: merchant.domain,
      domains: merchant.service?.domains ?? (merchant.domain ? [merchant.domain] : []),
      cancelUrl: merchant.service?.cancelUrl ?? "",
      // A trial shows the price it will convert at.
      price: (isTrial ? quotedPrice?.amount : null) ?? lastCharge?.amount ?? quotedPrice?.amount ?? "",
      currency: (isTrial ? quotedPrice?.currency : null) ?? lastCharge?.currency ?? quotedPrice?.currency ?? "USD",
      cycle,
      cycleConfident: knownCycle !== null,
      nextRenewal,
      anchorDay,
      lastCharged: lastChargeDate,
      charges: charges.map((c) => ({ date: toISODate(new Date(c.date)), amount: c.amount, currency: c.currency })),
      status,
      isTrial,
      confidence: score >= 6 ? "high" : score >= 4 ? "medium" : "low",
      evidence: items.at(-1).msg.subject ?? "",
      messageCount: items.length,
      cancelledOn,
      trialEnded, // cancelled because the trial ended without a receipt, not by email
      processor: merchant.processor ?? null,
      billedVia: merchant.processor === "PayPal" ? "paypal" : null,
    });
  }

  return { candidates: candidates.sort((a, b) => monthlyOf(b) - monthlyOf(a)), rejected, questions };
}

function monthlyOf(c) {
  const price = Number(c.price) || 0;
  return c.cycle === "yearly" ? price / 12 : c.cycle === "weekly" ? (price * 52) / 12 : price;
}

// The Gmail searches used to find candidate emails, ~15 months back so annual
// renewals are always included. Wide on purpose (Gmail's Purchases tab, "order",
// "trialing"…): email typing (email-type.js) filters orders out, and a narrow
// search silently misses things ("thank you for your order" renewals).
// Promotions and Social are left out of the main search (42% of the founder's
// matches, nearly all thrown away by the parser, and each one costs Gmail quota
// and time); a second, narrow search keeps receipts Gmail filed there.
export function buildSearchQueries(today = todayISO(), lookbackDays = 460) {
  const since = new Date(new Date(today).getTime() - lookbackDays * DAY_MS);
  const after = `${since.getFullYear()}/${since.getMonth() + 1}/${since.getDate()}`;
  const subjects = [
    "receipt", "invoice", "subscription", "renewal", "renew", "renews", "membership", "trial",
    '"payment received"', '"payment confirmation"', '"your plan"', '"welcome to"', "billing", "cancelled", "canceled",
    "order", "payment", "trialing", '"about to begin"', '"new plan"',
  ];
  const phrases = [
    '"next billing date"', '"auto-renew"', '"next payment"', '"has been cancelled"', '"has been canceled"',
    '"free trial"', "trialing", '"will begin"', '"unable to complete your payment"', '"will not renew"',
  ];
  const receiptSubjects = ["receipt", "invoice", "renewal", '"payment received"', '"payment confirmation"', '"order confirmation"', '"has been renewed"'];
  // Searching is cheap (5 units a page); reading costs 60 an email. So leave out
  // in the search what the parser always throws away: delivery updates and the
  // person's own sent mail.
  const skip = `-in:sent -subject:(delivered OR dispatched OR "out for delivery" OR shipped OR "on its way")`;
  return [
    `after:${after} -category:promotions -category:social ${skip} (category:purchases OR subject:(${subjects.join(" OR ")}) OR ${phrases.join(" OR ")})`,
    `after:${after} (category:promotions OR category:social) ${skip} subject:(${receiptSubjects.join(" OR ")})`,
  ];
}
