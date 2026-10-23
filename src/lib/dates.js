// Dates are stored as local "YYYY-MM-DD" strings so a renewal never shifts by a
// day because of time zones.

export function toISODate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function parseISODate(str) {
  const [y, m, d] = str.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function today() {
  return toISODate(new Date());
}

function daysInMonth(year, monthIndex) {
  return new Date(year, monthIndex + 1, 0).getDate();
}

// Advance one billing cycle. `anchorDay` is the day of month the subscription
// started on, so Jan 31 -> Feb 28 -> Mar 31 instead of drifting to the 28th.
export function addCycle(dateStr, cycle, anchorDay) {
  const date = parseISODate(dateStr);
  if (cycle === "weekly") {
    date.setDate(date.getDate() + 7);
    return toISODate(date);
  }
  const months = cycle === "yearly" ? 12 : 1;
  const target = new Date(date.getFullYear(), date.getMonth() + months, 1);
  const day = Math.min(anchorDay ?? date.getDate(), daysInMonth(target.getFullYear(), target.getMonth()));
  target.setDate(day);
  return toISODate(target);
}

export function addDays(dateStr, days) {
  const date = parseISODate(dateStr);
  date.setDate(date.getDate() + days);
  return toISODate(date);
}

// Monday of the week containing dateStr. Weekly visit counts are keyed by this.
export function weekStart(dateStr) {
  const date = parseISODate(dateStr);
  const sinceMonday = (date.getDay() + 6) % 7;
  date.setDate(date.getDate() - sinceMonday);
  return toISODate(date);
}

// "2026-10" -> "2026-11"; months can be negative.
export function addMonthsToKey(monthKey, months) {
  const [y, m] = monthKey.split("-").map(Number);
  const date = new Date(y, m - 1 + months, 1);
  return toISODate(date).slice(0, 7);
}

// Same day n months later (or earlier), clamped to the month's last day: Mar 31 - 1 -> Feb 28.
export function addMonths(dateStr, months) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const target = new Date(y, m - 1 + months, 1);
  target.setDate(Math.min(d, daysInMonth(target.getFullYear(), target.getMonth())));
  return toISODate(target);
}

export function daysBetween(fromStr, toStr) {
  const ms = parseISODate(toStr) - parseISODate(fromStr);
  return Math.round(ms / 86_400_000);
}

// Roll a renewal date forward past today (e.g. after the browser was closed for a while).
export function nextRenewalOnOrAfter(dateStr, cycle, anchorDay, onOrAfter = today()) {
  let next = dateStr;
  while (next < onOrAfter) next = addCycle(next, cycle, anchorDay);
  return next;
}

export function relativeDays(ms) {
  if (!ms) return null;
  const days = Math.floor((Date.now() - ms) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  return `${days} days ago`;
}
