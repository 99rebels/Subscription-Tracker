// Removing personal details from emails before they're saved as test data
// (dev/export-inbox.html). Pure, so it's tested in Node. It keeps what the
// parser needs (merchant, amounts, dates, plan wording) and removes who the
// person is. Best effort: the person exporting still reads the file before
// sharing it.

const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;
// "ending in 1234", "ending with the last two digits: 53", "•••• 1234", "**** 1234", "x1234"
const CARD_RE = /(ending (?:in|with)(?: the last (?:two|four|2|4) digits)?:?\s*|[•*xX]{2,}\s?|\bx)(\d{2,4})\b/gi;
// "+353 21 234 5678", "(555) 123-4567"
const PHONE_RE = /(?:\+\d{1,3}[\s.-]?)?\(?\d{2,4}\)?[\s.-]\d{3}[\s.-]?\d{3,4}\b/g;
// Customer, order and account numbers: 6+ digits in a row (amounts and dates are shorter).
const LONG_NUMBER_RE = /\d{6,}/g;
const URL_RE = /https?:\/\/[^\s)\]>"']+/g;

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * options:
 *   userEmails: the person's own addresses (from Gmail's profile)
 *   words:      anything else to remove: names, street, town, postcode, usernames
 */
export function scrubText(text, { userEmails = [], words = [] } = {}) {
  if (!text) return text;
  let out = text;

  // Links: keep where they point, drop tracking tokens and query strings.
  out = out.replace(URL_RE, (url) => {
    try {
      const u = new URL(url);
      return `${u.origin}${u.pathname}`;
    } catch {
      return "";
    }
  });

  const own = userEmails.map((e) => e.toLowerCase());
  const localParts = own.map((e) => e.split("@")[0]).filter((p) => p.length >= 4);
  out = out.replace(EMAIL_RE, (addr) => (own.includes(addr.toLowerCase()) ? "user@example.com" : addr));

  // Longest first so "Jane O'Brien" goes before "Jane".
  const removals = [...words, ...localParts].map((w) => w.trim()).filter((w) => w.length >= 2).sort((a, b) => b.length - a.length);
  for (const w of removals) {
    // Postcodes are written with or without a space ("D04X123" / "D04 X123"),
    // names with either apostrophe; any case.
    const spaced = /\d/.test(w) ? [...w.replace(/\s+/g, "")].map(escapeRe).join("\\s?") : escapeRe(w).replace(/\\? /g, "\\s*");
    const pattern = spaced.replace(/'/g, "['’]?");
    out = out.replace(new RegExp(`(?<![\\p{L}\\d])${pattern}(?![\\p{L}\\d])`, "giu"), "[removed]");
  }

  // 4s, not 0s: test data should keep realistic numbers (card digits next to a
  // price once fooled the amount reader, and zeros hid it).
  out = out.replace(CARD_RE, (_m, lead, digits) => `${lead}${"4".repeat(digits.length)}`);
  out = out.replace(PHONE_RE, (m) => m.replace(/\d/g, "0"));
  out = out.replace(LONG_NUMBER_RE, (m) => "0".repeat(m.length));
  return out;
}

// A parser message ({ id, date, from, subject, snippet, body, labels }) made safe
// to save. The sender is kept (it's the merchant, and the parser groups by it)
// unless it's the person themselves, e.g. an email they sent.
export function scrubMessage(msg, options, index) {
  return {
    id: `m${index}`,
    date: msg.date,
    from: scrubText(msg.from, options),
    subject: scrubText(msg.subject, options),
    snippet: scrubText(msg.snippet, options),
    body: scrubText(msg.body, options),
    labels: msg.labels ?? [],
    inProductionQuery: msg.inProductionQuery ?? true,
  };
}
