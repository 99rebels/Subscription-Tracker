// The shape of a stored subscription, and the transforms that change its status.
// Pure functions with no chrome.* calls, so this can be unit-tested in Node.
//
// subscription: {
//   id, name, plan,                 plan is the tier name from receipts ("Essential"), or ""
//   domains[], category,            category is one of CATEGORIES
//   price, currency, cycle,         cycle: "weekly" | "monthly" | "yearly"
//   anchorDay, nextRenewal,         next charge (or trial end) as "YYYY-MM-DD"
//   status,                         "active" | "trial" | "cancelled"
//   startedAt,                      first known charge or signup, "YYYY-MM-DD"
//   cancelledAt,                    "YYYY-MM-DD"
//   cancelledWhileTracking,         true only for cancellations made while using the extension (honest savings)
//   cancelledDuringTrial,           cancelled before the first charge: saves one charge, not a monthly amount
//   avoidedFrom,                    first charge the cancellation avoided, "YYYY-MM-DD"
//   priceSource,                    "receipt" | "checkout" | "manual"
//   confirmedByReceipt,             a receipt has confirmed the price
//   charges[{ date, amount, currency }],
//   billedVia,                      "apple" | "google_play" | "amazon" | "paypal" | null: where to cancel
//   cancelUrl, reminderDays,        reminderDays null = use the setting
//   notifiedFor, lastUsed,          lastUsed is a timestamp (ms) of the latest visit on this computer
//   usedElsewhere,                  "I still use it on another device": never suggest cutting it
//   source, createdAt,              source: "gmail" | "detected" | "manual"
//   cancelStartedAt,                the user opened the cancel page; ask "Did you cancel?"
//   cancelConfirmedByEmail,         date of the cancellation email that confirmed it (resync.js)
//   usageBackfilled,                visits have been backfilled from Chrome history (background.js)
// }

import { nextRenewalOnOrAfter, addDays, toISODate } from "./dates.js";

export const SCHEMA_VERSION = 2;

export const CATEGORIES = ["Entertainment", "Work tools", "News & reading", "Learning", "Shopping", "Other"];

const STATUSES = ["active", "trial", "cancelled"];
const CYCLES = ["weekly", "monthly", "yearly"];
const PRICE_SOURCES = ["receipt", "checkout", "manual"];

export function normalizeSubscription(input, { services = [] } = {}) {
  const { isTrial, ...raw } = input; // isTrial was the v1 field; status replaces it
  const name = (raw.name ?? "").trim().toLowerCase();
  const service =
    services.find((s) => s.name.toLowerCase() === name) ??
    services.find((s) => s.domains.some((d) => raw.domains?.includes(d)));
  const status = STATUSES.includes(raw.status) ? raw.status : isTrial ? "trial" : "active";
  const charges = Array.isArray(raw.charges) ? raw.charges : [];
  const createdAt = raw.createdAt ?? Date.now();

  return {
    ...raw,
    plan: raw.plan ?? "",
    domains: raw.domains ?? [],
    category: CATEGORIES.includes(raw.category) ? raw.category : (service?.category ?? "Other"),
    currency: raw.currency || "USD",
    cycle: CYCLES.includes(raw.cycle) ? raw.cycle : "monthly",
    status,
    startedAt: raw.startedAt ?? charges[0]?.date ?? toISODate(new Date(createdAt)),
    cancelledAt: raw.cancelledAt ?? null,
    cancelledWhileTracking: raw.cancelledWhileTracking ?? false,
    cancelledDuringTrial: raw.cancelledDuringTrial ?? false,
    avoidedFrom: raw.avoidedFrom ?? null,
    priceSource: PRICE_SOURCES.includes(raw.priceSource) ? raw.priceSource : raw.source === "gmail" ? "receipt" : "manual",
    confirmedByReceipt: raw.confirmedByReceipt ?? raw.source === "gmail",
    charges,
    billedVia: raw.billedVia ?? null,
    cancelUrl: raw.cancelUrl ?? service?.cancelUrl ?? "",
    reminderDays: raw.reminderDays ?? null,
    lastUsed: raw.lastUsed ?? null,
    usedElsewhere: raw.usedElsewhere ?? false,
    source: raw.source ?? "manual",
    createdAt,
  };
}

/**
 * Cancel a subscription the user is tracking. Records what's needed to count
 * savings honestly: the first charge it avoids (the next renewal strictly after
 * today, since a renewal due today has usually been charged already).
 */
export function cancelSubscription(sub, today) {
  const avoidedFrom = sub.nextRenewal
    ? nextRenewalOnOrAfter(sub.nextRenewal, sub.cycle, sub.anchorDay, addDays(today, 1))
    : null;
  return {
    ...sub,
    status: "cancelled",
    cancelledAt: today,
    cancelledWhileTracking: true,
    cancelledDuringTrial: sub.status === "trial",
    avoidedFrom: sub.status === "trial" ? sub.nextRenewal : avoidedFrom,
  };
}

export function undoCancel(sub) {
  return {
    ...sub,
    status: sub.cancelledDuringTrial ? "trial" : "active",
    cancelledAt: null,
    cancelledWhileTracking: false,
    cancelledDuringTrial: false,
    avoidedFrom: null,
  };
}

// Storage migrations, oldest first. Each takes and returns the whole stored object.
const MIGRATIONS = {
  // v1 -> v2: status/category/price-source fields, weekly visit counts, new settings.
  2: (data, { services }) => ({
    ...data,
    subscriptions: (data.subscriptions ?? []).map((s) => normalizeSubscription(s, { services })),
    visits: data.visits ?? {},
  }),
};

export function migrate(data, { services = [] } = {}) {
  let version = data.schemaVersion ?? 1;
  let out = data;
  while (version < SCHEMA_VERSION) {
    version += 1;
    out = MIGRATIONS[version](out, { services });
  }
  return { ...out, schemaVersion: SCHEMA_VERSION };
}
