// Calendar reminders work even when Chrome is closed: the user's calendar app
// sends the phone/email notification, so no server is needed.

import { parseISODate, toISODate } from "./dates.js";
import { formatPrice } from "./money.js";

function compact(dateStr) {
  return dateStr.replaceAll("-", "");
}

function dayAfter(dateStr) {
  const d = parseISODate(dateStr);
  d.setDate(d.getDate() + 1);
  return toISODate(d);
}

function rrule(sub) {
  if (sub.status === "trial") return null; // a trial ends once; the paid renewals get their own event later
  if (sub.cycle === "weekly") return "RRULE:FREQ=WEEKLY";
  if (sub.cycle === "yearly") return "RRULE:FREQ=YEARLY";
  // Billing on the 29th-31st falls back to the month's last day. BYSETPOS=-1 picks
  // the latest of these days that exists in each month.
  if (sub.anchorDay > 28) {
    const days = [];
    for (let d = 28; d <= sub.anchorDay; d++) days.push(d);
    return `RRULE:FREQ=MONTHLY;BYMONTHDAY=${days.join(",")};BYSETPOS=-1`;
  }
  return "RRULE:FREQ=MONTHLY";
}

function title(sub) {
  const price = sub.price ? ` (${formatPrice(sub)})` : "";
  return sub.status === "trial" ? `${sub.name} free trial ends${price}` : `${sub.name} renews${price}`;
}

function details(sub) {
  const lines = [`Charged ${sub.cycle}.`];
  if (sub.cancelUrl) lines.push(`Cancel or manage: ${sub.cancelUrl}`);
  lines.push("Added by Subscription Check.");
  return lines.join("\n");
}

function escapeText(text) {
  return text.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
}

function eventLines(sub, stamp) {
  const reminderDays = Math.max(1, sub.reminderDays ?? 1);
  // All-day events start at midnight; -PT15H lands on 9am the day before.
  const trigger = reminderDays > 1 ? `-P${reminderDays - 1}DT15H` : "-PT15H";
  return [
    "BEGIN:VEVENT",
    `UID:${sub.id}@subscription-check`,
    `DTSTAMP:${stamp}`,
    `DTSTART;VALUE=DATE:${compact(sub.nextRenewal)}`,
    `DTEND;VALUE=DATE:${compact(dayAfter(sub.nextRenewal))}`,
    rrule(sub),
    `SUMMARY:${escapeText(title(sub))}`,
    `DESCRIPTION:${escapeText(details(sub))}`,
    sub.cancelUrl ? `URL:${sub.cancelUrl}` : null,
    "BEGIN:VALARM",
    "ACTION:DISPLAY",
    `DESCRIPTION:${escapeText(title(sub))}`,
    `TRIGGER:${trigger}`,
    "END:VALARM",
    "END:VEVENT",
  ];
}

// One .ics file with an event per subscription (Settings: "Add all renewals to your calendar").
export function buildICS(subs) {
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  const events = [].concat(subs).filter((s) => s.nextRenewal && s.status !== "cancelled").flatMap((s) => eventLines(s, stamp));
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Subscription Check//EN", "CALSCALE:GREGORIAN", ...events, "END:VCALENDAR"].filter(Boolean);
  return lines.join("\r\n") + "\r\n";
}

// Google Calendar's "add event" link. Google applies the user's default
// notification settings; reminder timing can't be set through the URL.
export function googleCalendarUrl(sub) {
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: title(sub),
    dates: `${compact(sub.nextRenewal)}/${compact(dayAfter(sub.nextRenewal))}`,
    details: details(sub),
  });
  const rule = rrule(sub);
  if (rule) params.set("recur", rule);
  return `https://calendar.google.com/calendar/render?${params}`;
}
