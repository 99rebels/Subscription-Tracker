// Everything lives in chrome.storage.local; nothing leaves the device.
//
// schemaVersion: number                                   see model.js migrations
// subscriptions: [subscription]                           shape documented in model.js
// visits:        { [subscriptionId]: { [weekStart]: n } } visits per week on this computer
// pending:       [{ id, name, domain, url, detectedAt }]  checkout detections awaiting confirmation
// dismissed:     { [domain]: timestamp }                  detections the user said "no" to
// settings:      DEFAULT_SETTINGS below
// review:        [{ id, item, kind, title, reason, detail, yes, no, createdAt }]  questions from the scan (scan.js)
// sorted:        [{ id, name, outcome, note, at, subId, review }]  decided items, newest first, for Undo
// gmail:         { connected, lastScanAt, lastCheckedAt, scanned, sample, askedKeys, unreadIds }
// fx:            { base, date, rates, fetchedAt }       daily exchange rates for totals (fx.js)
// stats:         { remindersSent }                        for "Also looked after" on the Savings page
// installedAt:   "YYYY-MM-DD"                             savings are counted from here

import { migrate, normalizeSubscription, SCHEMA_VERSION } from "./model.js";
import { addVisit } from "./usage.js";
import { loadServices } from "./services.js";

export const DEFAULT_SETTINGS = {
  budget: null, // monthly, in settings.currency
  suggestCuts: true,
  reminderDays: 1,
  trialReminderDays: 3,
  monthlyCheckIn: true,
  calendarSync: false,
  detectCheckouts: true,
  trackVisits: true,
  theme: "system", // "system" | "light" | "dark"
  currency: "USD",
};

const DEFAULTS = {
  schemaVersion: SCHEMA_VERSION,
  subscriptions: [],
  visits: {},
  pending: [],
  dismissed: {},
  review: [],
  sorted: [],
  gmail: { connected: false, lastScanAt: null, lastCheckedAt: null, scanned: 0, sample: false },
  fx: null,
  settings: DEFAULT_SETTINGS,
  stats: { remindersSent: 0 },
  installedAt: null,
};

export async function load(...keys) {
  const wanted = Object.fromEntries(keys.map((k) => [k, DEFAULTS[k]]));
  const data = await chrome.storage.local.get(wanted);
  // Settings added in later versions get their defaults.
  if (data.settings) data.settings = { ...DEFAULT_SETTINGS, ...data.settings };
  if (data.stats) data.stats = { ...DEFAULTS.stats, ...data.stats };
  if (data.gmail) data.gmail = { ...DEFAULTS.gmail, ...data.gmail };
  return data;
}

export async function save(values) {
  await chrome.storage.local.set(values);
}

export function newId() {
  return crypto.randomUUID();
}

// Bring stored data up to the current schema. Safe to call on every startup.
export async function migrateStorage() {
  const { schemaVersion } = await chrome.storage.local.get({ schemaVersion: 1 });
  if (schemaVersion >= SCHEMA_VERSION) return;
  const data = await chrome.storage.local.get(null);
  const services = await loadServices();
  await save(migrate(data, { services }));
}

export async function upsertSubscription(sub) {
  const { subscriptions } = await load("subscriptions");
  const services = await loadServices();
  const normalized = normalizeSubscription(sub, { services });
  const i = subscriptions.findIndex((s) => s.id === sub.id);
  if (i === -1) subscriptions.push(normalized);
  else subscriptions[i] = normalized;
  await save({ subscriptions });
  return normalized;
}

export async function deleteSubscription(id) {
  const { subscriptions, visits } = await load("subscriptions", "visits");
  delete visits[id];
  await save({ subscriptions: subscriptions.filter((s) => s.id !== id), visits });
}

// Count one visit now for each of these subscriptions.
export async function recordVisits(ids, now = Date.now()) {
  if (!ids.length) return;
  const { visits } = await load("visits");
  for (const id of ids) visits[id] = addVisit(visits[id], now);
  await save({ visits });
}

// Merge weekly counts (e.g. backfilled from history), keeping the larger count per week.
export async function mergeWeeklyVisits(id, weekly) {
  const { visits } = await load("visits");
  const current = visits[id] ?? {};
  for (const [week, count] of Object.entries(weekly)) current[week] = Math.max(current[week] ?? 0, count);
  visits[id] = current;
  await save({ visits });
}

export async function removePending(id) {
  const { pending } = await load("pending");
  await save({ pending: pending.filter((p) => p.id !== id) });
  await updateBadge();
}

export async function dismissPending(id) {
  const { pending, dismissed } = await load("pending", "dismissed");
  const item = pending.find((p) => p.id === id);
  if (item) dismissed[item.domain] = Date.now();
  await save({ pending: pending.filter((p) => p.id !== id), dismissed });
  await updateBadge();
}

// Badge = things waiting in Review (signups spotted at checkout + questions).
export async function updateBadge() {
  const { pending, review } = await load("pending", "review");
  const count = pending.length + review.length;
  await chrome.action.setBadgeText({ text: count ? String(count) : "" });
  // The accent, not amber: amber is never a solid fill (HANDOFF visual rules).
  await chrome.action.setBadgeBackgroundColor({ color: "#8AB4FF" });
  await chrome.action.setBadgeTextColor({ color: "#0D0E10" });
}
