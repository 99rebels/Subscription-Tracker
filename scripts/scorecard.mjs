// Receipt parser scorecard: runs the scan over an exported inbox
// (dev/export-inbox.html → tests/fixtures/inbox/*.json, git-ignored) and compares
// each service with an answer sheet (see below).
//
//   npm run scorecard                       newest export, every exported email
//   npm run scorecard -- --scan-search      only emails the scan's search found when exported
//   npm run scorecard -- path/to/export.json
//
// Answer sheet: tests/fixtures/inbox/answers.mjs if present (personal, git-ignored),
// else tests/fixtures/answers.example.mjs.
//
// Always exits 0: it's a measurement, not a gate.

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { analyseInbox } from "../src/lib/receipts.js";
import { classifyScan } from "../src/lib/scan.js";
import { hostMatches } from "../src/lib/services.js";

const ROOT = new URL("..", import.meta.url).pathname;
// The real answer sheet is personal, so it sits next to the export (git-ignored);
// the committed one is an example.
const PRIVATE_ANSWERS = join(ROOT, "tests/fixtures/inbox/answers.mjs");
const { answers } = await import(existsSync(PRIVATE_ANSWERS) ? PRIVATE_ANSWERS : join(ROOT, "tests/fixtures/answers.example.mjs"));
const INBOX_DIR = join(ROOT, "tests/fixtures/inbox");
const args = process.argv.slice(2);
const scanOnly = args.includes("--scan-search");

function exportPath() {
  const given = args.find((a) => !a.startsWith("--"));
  if (given) return given;
  const files = existsSync(INBOX_DIR) ? readdirSync(INBOX_DIR).filter((f) => f.endsWith(".json")).sort() : [];
  return files.length ? join(INBOX_DIR, files.at(-1)) : null;
}

const path = exportPath();
if (!path) {
  console.log("No exported inbox found. Export one with dev/export-inbox.html and put it in tests/fixtures/inbox/.");
  process.exit(0);
}

const file = JSON.parse(readFileSync(path, "utf8"));
const messages = scanOnly ? file.messages.filter((m) => m.inProductionQuery !== false) : file.messages;
const services = JSON.parse(readFileSync(join(ROOT, "data/services.json"), "utf8"));
const today = file.exportedAt;

const analysis = analyseInbox(messages, { services, today });
const groups = classifyScan(analysis, { today, subscriptions: [] });

// Where each candidate ended up on the results screen.
const placed = new Map();
for (const c of groups.paying) placed.set(c, "paying");
for (const { item } of groups.confirm) placed.set(item, item.plan ? "asked about plan" : "please confirm");
for (const { item } of groups.notAdded) placed.set(item, "not added");

const items = [...placed.keys()];
const domainsOf = (item) => item.domains ?? (item.domain ? [item.domain] : []);
const matchesAnswer = (item, answer) =>
  domainsOf(item).some((d) => answer.domains.some((ad) => hostMatches(d, ad) || hostMatches(ad, d))) ||
  item.name.toLowerCase() === answer.name.toLowerCase() ||
  (answer.names ?? []).some((n) => item.name.toLowerCase() === n.toLowerCase());

const statusOf = (item) => (item.plan ? "unknown" : item.isTrial ? "trial" : item.status);
const FIELDS = {
  status: (item) => statusOf(item),
  cycle: (item) => item.cycle,
  price: (item) => (item.price === "" ? null : Number(item.price)),
  currency: (item) => item.currency,
  nextRenewal: (item) => item.nextRenewal,
};
const same = (field, want, got) => (field === "price" ? got != null && Math.abs(want - got) < 0.01 : want === got);

let checked = 0;
let right = 0;
let servicesRight = 0;
const used = new Set();
const lines = [];

for (const answer of answers) {
  const found = items.filter((item) => matchesAnswer(item, answer));
  found.forEach((item) => used.add(item));
  const where = found.map((item) => placed.get(item)).join(", ") || "not found";
  const added = found.filter((item) => ["paying", "please confirm", "asked about plan"].includes(placed.get(item)));

  if (answer.expect.subscription === false) {
    checked += 1;
    const ok = added.length === 0;
    if (ok) right += 1, servicesRight += 1;
    lines.push(`${ok ? "✓" : "✗"} ${answer.name}: not a subscription. Parser: ${where}`);
    continue;
  }

  const item = found[0];
  const results = [];
  for (const [field, want] of Object.entries(answer.expect)) {
    if (!(field in FIELDS)) continue;
    checked += 1;
    const got = item ? FIELDS[field](item) : undefined;
    const ok = item !== undefined && same(field, want, got);
    if (ok) right += 1;
    results.push({ field, want, got, ok });
  }
  const allOk = item && results.every((r) => r.ok);
  if (allOk) servicesRight += 1;
  lines.push(`${allOk ? "✓" : "✗"} ${answer.name}: ${where}${found.length > 1 ? ` (${found.length} groups)` : ""}`);
  for (const r of results) if (!r.ok) lines.push(`    ${r.field}: want ${r.want}, got ${r.got ?? "nothing"}`);
}

const extras = items.filter((item) => !used.has(item) && placed.get(item) !== "not added");

console.log(`Scorecard · ${path.replace(ROOT, "")} · ${messages.length} emails${scanOnly ? " (scan's search at export)" : ""} · today ${today}\n`);
console.log(lines.join("\n"));
console.log(`\nServices fully right: ${servicesRight} of ${answers.length} · fields right: ${right} of ${checked}`);
if (extras.length) {
  console.log(`\nAdded but not on the answer sheet (false positives, or add them to the sheet):`);
  for (const item of extras) console.log(`  ${item.name} (${domainsOf(item).join(", ")}): ${placed.get(item)}, ${statusOf(item)}, ${item.price || "no price"} ${item.currency ?? ""}/${item.cycle ?? "?"}`);
}
