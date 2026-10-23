import { hostMatches } from "./services.js";
import { toISODate, weekStart } from "./dates.js";

// Page loads closer together than this count as one visit (one sitting).
export const VISIT_GAP_MS = 30 * 60 * 1000;
// Chrome keeps ~90 days of history; we keep our own weekly counts for longer.
const KEEP_WEEKS = 106;

/**
 * Turn page-load timestamps (ms) into visits per week: { "2026-10-19": 3 }.
 * Loads within VISIT_GAP_MS of the previous load are the same visit.
 */
export function weeklyCountsFromTimestamps(timestamps) {
  const counts = {};
  let previous = -Infinity;
  for (const t of [...timestamps].sort((a, b) => a - b)) {
    if (t - previous >= VISIT_GAP_MS) {
      const week = weekStart(toISODate(new Date(t)));
      counts[week] = (counts[week] ?? 0) + 1;
    }
    previous = t;
  }
  return counts;
}

// Add one visit at `now` to a weekly map, dropping weeks older than ~2 years.
export function addVisit(weekly = {}, now = Date.now()) {
  const week = weekStart(toISODate(new Date(now)));
  const next = { ...weekly, [week]: (weekly[week] ?? 0) + 1 };
  const cutoff = weekStart(toISODate(new Date(now - KEEP_WEEKS * 7 * 86_400_000)));
  for (const key of Object.keys(next)) if (key < cutoff) delete next[key];
  return next;
}

// Every page load on a subscription's domains that Chrome history still has.
async function historyTimestamps(domains) {
  const times = [];
  for (const domain of domains) {
    const items = await chrome.history.search({ text: domain, startTime: 0, maxResults: 500 });
    for (const item of items) {
      let host;
      try {
        host = new URL(item.url).hostname;
      } catch {
        continue; // ignore unparsable history entries
      }
      if (!hostMatches(host, domain)) continue;
      const visits = await chrome.history.getVisits({ url: item.url });
      for (const v of visits) if (v.visitTime) times.push(v.visitTime);
    }
  }
  return times;
}

/**
 * Backfill a subscription's usage from Chrome history (~90 days): weekly visit
 * counts and the latest visit. Used when a subscription is first added.
 */
export async function usageFromHistory(domains) {
  const times = await historyTimestamps(domains);
  return {
    weekly: weeklyCountsFromTimestamps(times),
    lastUsed: times.length ? Math.max(...times) : null,
  };
}

// Most recent visit to any of a subscription's domains, from Chrome history.
// Used by the legacy popup and import pages.
export async function lastVisitFromHistory(domains) {
  let latest = 0;
  for (const domain of domains) {
    const items = await chrome.history.search({ text: domain, startTime: 0, maxResults: 200 });
    for (const item of items) {
      try {
        if (hostMatches(new URL(item.url).hostname, domain)) {
          latest = Math.max(latest, item.lastVisitTime ?? 0);
        }
      } catch {
        // ignore unparsable history entries
      }
    }
  }
  return latest || null;
}
