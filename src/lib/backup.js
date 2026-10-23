// Settings › Your data: CSV export, a backup file to restore from, and reading
// one back. Pure, so it's tested in Node. Everything stays on the user's
// machine: these only make files the user downloads.

import { migrate, SCHEMA_VERSION } from "./model.js";
import { monthlyCost } from "./money.js";

const BACKUP_KEYS = ["subscriptions", "visits", "settings", "review", "sorted", "stats", "installedAt", "dismissed"];

function csvCell(value) {
  const s = value == null ? "" : String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCSV(subs) {
  const header = ["Name", "Plan", "Status", "Price", "Currency", "Billing", "Monthly cost", "Next charge", "Category", "Website", "Last visit", "Started", "Cancelled"];
  const rows = subs.map((s) => [
    s.name,
    s.plan,
    s.status,
    s.price,
    s.currency,
    s.cycle,
    monthlyCost(s).toFixed(2),
    s.status === "cancelled" ? "" : s.nextRenewal,
    s.category,
    s.domains?.[0] ?? "",
    s.lastUsed ? new Date(s.lastUsed).toISOString().slice(0, 10) : "",
    s.startedAt,
    s.cancelledAt ?? "",
  ]);
  return [header, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

export function toBackup(data, now = new Date()) {
  const picked = Object.fromEntries(BACKUP_KEYS.filter((k) => k in data).map((k) => [k, data[k]]));
  return JSON.stringify({ app: "subscription-check", schemaVersion: SCHEMA_VERSION, exportedAt: now.toISOString(), data: picked }, null, 2);
}

/**
 * Read a backup file. Returns the data to store (migrated to the current
 * schema) or throws an Error with a message fit to show the user.
 */
export function parseBackup(text, { services = [] } = {}) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("That file isn't a Subscription Check backup.");
  }
  if (parsed?.app !== "subscription-check" || !Array.isArray(parsed?.data?.subscriptions)) {
    throw new Error("That file isn't a Subscription Check backup.");
  }
  if (parsed.schemaVersion > SCHEMA_VERSION) {
    throw new Error("That backup is from a newer version. Update the extension, then try again.");
  }
  const data = Object.fromEntries(BACKUP_KEYS.filter((k) => k in parsed.data).map((k) => [k, parsed.data[k]]));
  return migrate({ ...data, schemaVersion: parsed.schemaVersion ?? 1 }, { services });
}
