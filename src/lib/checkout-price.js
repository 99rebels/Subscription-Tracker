// Read a subscription's price off a checkout or confirmation page's text
// (product-plan §3, layer 1): "$20.00 per month", "billed annually",
// "free for 7 days, then $9.99/month". Pure, so it's tested in Node.

const SYMBOLS = { "US$": "USD", $: "USD", "€": "EUR", "£": "GBP", "CA$": "CAD", "A$": "AUD", USD: "USD", EUR: "EUR", GBP: "GBP", CAD: "CAD", AUD: "AUD" };
const SYMBOL = "(US\\$|CA\\$|A\\$|\\$|€|£|USD|EUR|GBP|CAD|AUD)";
const NUMBER = "(\\d{1,3}(?:,\\d{3})*(?:\\.\\d{1,2})?|\\d+(?:[.,]\\d{1,2})?)";
const PERIOD = "(?:\\s*(?:USD|EUR|GBP))?\\s*(?:/|per|a|an|every|each)\\s*(month|mo|year|yr|annum|week|wk)\\b";

// "$9.99/month", "$20.00 per month", "€8 a month"
const PRICED_PERIOD = new RegExp(`${SYMBOL}\\s?${NUMBER}${PERIOD}`, "gi");
// "9,99 €/month"
const PRICED_PERIOD_AFTER = new RegExp(`${NUMBER}\\s?(€|EUR|USD|GBP)${PERIOD}`, "gi");
const PLAIN_AMOUNT = new RegExp(`${SYMBOL}\\s?${NUMBER}`, "gi");

const TRIAL_RES = [
  /(\d+)[- ]day(?:s)? free trial/i,
  /free for (\d+) days/i,
  /(\d+) days? free/i,
  /free trial (?:for|of) (\d+) days/i,
  /trial ends in (\d+) days/i,
];
const MONTH_TRIAL_RE = /(\d+|one|a) months? free/i;

function firstAmountFrom(text, index) {
  PLAIN_AMOUNT.lastIndex = index;
  return PLAIN_AMOUNT.exec(text);
}

function cycleOf(word) {
  const w = word.toLowerCase();
  if (w.startsWith("y") || w === "annum") return "yearly";
  if (w.startsWith("w")) return "weekly";
  return "monthly";
}

function parseAmount(raw) {
  // "1,299.00" -> 1299; "9,99" -> 9.99
  if (/,\d{1,2}$/.test(raw) && !raw.includes(".")) return Number(raw.replace(",", "."));
  return Number(raw.replace(/,/g, ""));
}

/**
 * Returns { amount, currency, cycle, trialDays } or null when no recurring
 * price is found. When several prices appear, prefer the one after "then"
 * (the price after a trial) and otherwise the first.
 */
export function extractCheckoutPrice(rawText) {
  const text = rawText.replace(/\s+/g, " ").slice(0, 50_000);
  const found = [];
  for (const m of text.matchAll(PRICED_PERIOD)) {
    found.push({ index: m.index, currency: SYMBOLS[m[1].toUpperCase()] ?? SYMBOLS[m[1]], amount: parseAmount(m[2]), cycle: cycleOf(m[3]) });
  }
  for (const m of text.matchAll(PRICED_PERIOD_AFTER)) {
    found.push({ index: m.index, currency: SYMBOLS[m[2].toUpperCase()], amount: parseAmount(m[1]), cycle: cycleOf(m[3]) });
  }

  let pick = null;
  if (found.length) {
    found.sort((a, b) => a.index - b.index);
    pick = found.find((f) => /then\s*$/i.test(text.slice(Math.max(0, f.index - 12), f.index))) ?? found.find((f) => f.amount > 0) ?? null;
  } else if (/billed (annually|yearly)|annual plan|per year|\/yr\b/i.test(text) || /billed monthly|monthly plan/i.test(text)) {
    // "Pro plan · $96 · billed annually": an amount plus a billing word elsewhere.
    const yearly = /billed (annually|yearly)|annual plan|per year|\/yr\b/i.test(text);
    const near = /(total|due today|plan|price)[^$€£]{0,40}/i.exec(text);
    const m = firstAmountFrom(text, near ? near.index : 0) ?? firstAmountFrom(text, 0);
    if (m) pick = { currency: SYMBOLS[m[1].toUpperCase()] ?? SYMBOLS[m[1]], amount: parseAmount(m[2]), cycle: yearly ? "yearly" : "monthly" };
  }
  if (!pick || !(pick.amount > 0)) return null;

  let trialDays = null;
  for (const re of TRIAL_RES) {
    const m = re.exec(text);
    if (m) {
      trialDays = Number(m[1]);
      break;
    }
  }
  if (trialDays === null) {
    const m = MONTH_TRIAL_RE.exec(text);
    if (m) trialDays = 30 * (/^\d+$/.test(m[1]) ? Number(m[1]) : 1);
  }

  return { amount: pick.amount, currency: pick.currency ?? "USD", cycle: pick.cycle, trialDays };
}
