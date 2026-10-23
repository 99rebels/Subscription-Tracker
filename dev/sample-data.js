// The sample account from the design boards, with dates relative to today so
// the preview always looks like the designs (dev/preview.html).
import { normalizeSubscription, cancelSubscription, SCHEMA_VERSION } from "../src/lib/model.js";
import { reviewItem, sortedEntry } from "../src/lib/review.js";
import { reasonFor } from "../src/lib/scan.js";
import { addDays, addMonths, today, weekStart } from "../src/lib/dates.js";

const T = today();
const d = (days) => addDays(T, days);
const at = (days) => new Date(`${d(days)}T12:00:00`).getTime();

function monthly(amount, lastDate, count, rise) {
  const charges = [];
  for (let i = count - 1; i >= 0; i--) {
    const date = addMonths(lastDate, -i);
    charges.push({ date, amount: rise && date < rise.date ? rise.from : amount, currency: "USD" });
  }
  return charges;
}

const sub = (f) =>
  normalizeSubscription({
    id: f.name.toLowerCase().replace(/\W+/g, "-"),
    currency: "USD",
    cycle: "monthly",
    source: "gmail",
    usageBackfilled: true,
    ...f,
  });

export function sampleData() {
  const paramountLast = d(-1);
  const subscriptions = [
    sub({ name: "Canva", plan: "Pro", domains: ["canva.com"], category: "Work tools", status: "trial", price: 14.99, nextRenewal: d(2), lastUsed: at(-1), source: "detected", priceSource: "checkout", confirmedByReceipt: false }),
    sub({ name: "ChatGPT Plus", domains: ["chatgpt.com"], category: "Work tools", price: 20, nextRenewal: d(11), lastUsed: at(-1), charges: monthly(20, addMonths(d(11), -1), 5) }),
    sub({ name: "Netflix", domains: ["netflix.com"], category: "Entertainment", price: 17.99, nextRenewal: d(19), lastUsed: at(-2), charges: monthly(17.99, addMonths(d(19), -1), 15) }),
    sub({ name: "Linear", domains: ["linear.app"], category: "Work tools", price: 8, nextRenewal: d(23), lastUsed: at(0), charges: monthly(8, addMonths(d(23), -1), 9) }),
    sub({ name: "Dropbox", plan: "Plus", domains: ["dropbox.com"], category: "Work tools", price: 119.88, cycle: "yearly", nextRenewal: d(25), lastUsed: null, charges: [{ date: addMonths(d(25), -12), amount: 119.88, currency: "USD" }] }),
    sub({ name: "Spotify", domains: ["spotify.com"], category: "Entertainment", price: 11.99, nextRenewal: d(28), lastUsed: at(0), charges: monthly(11.99, addMonths(d(28), -1), 15) }),
    sub({
      name: "Paramount+",
      plan: "Essential",
      domains: ["paramountplus.com"],
      category: "Entertainment",
      price: 7.99,
      nextRenewal: d(30),
      lastUsed: at(-64),
      startedAt: addMonths(paramountLast, -19),
      charges: monthly(7.99, paramountLast, 20, { date: addMonths(paramountLast, -3), from: 5.99 }),
    }),
    sub({ name: "Adobe Creative Cloud", domains: ["adobe.com"], category: "Work tools", price: 119.88, cycle: "yearly", nextRenewal: d(65), lastUsed: at(-45), charges: [{ date: addMonths(d(65), -12), amount: 119.88, currency: "USD" }] }),
    cancelSubscription(sub({ name: "Hulu", domains: ["hulu.com"], category: "Entertainment", price: 9.99, nextRenewal: d(-202), anchorDay: Number(d(-202).slice(8)) }), d(-202)),
    cancelSubscription(sub({ name: "Duolingo", plan: "Super", domains: ["duolingo.com"], category: "Learning", price: 12.99, nextRenewal: d(-150), anchorDay: Number(d(-150).slice(8)) }), d(-150)),
    cancelSubscription(sub({ name: "Disney+", domains: ["disneyplus.com"], category: "Entertainment", status: "trial", price: 13.99, nextRenewal: d(-195) }), d(-200)),
    sub({ name: "Peacock", domains: ["peacocktv.com"], category: "Entertainment", price: 7.99, status: "cancelled", cancelledAt: d(-252) }),
  ];

  const visits = {};
  const weekly = (id, counts) => {
    visits[id] = {};
    counts.forEach((n, i) => {
      if (n) visits[id][weekStart(d(-7 * (counts.length - 1 - i)))] = n;
    });
  };
  weekly("netflix", [3, 2, 4, 3, 1, 2, 3, 4, 2, 3, 2, 3]);
  weekly("spotify", [9, 8, 10, 7, 9, 11, 8, 9, 10, 7, 9, 6]);
  weekly("linear", [5, 6, 5, 4, 6, 5, 5, 6, 4, 5, 6, 4]);
  weekly("chatgpt-plus", [4, 3, 5, 6, 4, 5, 3, 4, 6, 5, 4, 3]);
  weekly("canva", [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 3]);
  visits["paramount-"] = { [weekStart(d(-80))]: 1, [weekStart(d(-64))]: 1 };
  visits["adobe-creative-cloud"] = { [weekStart(d(-45))]: 2 };

  const audible = { name: "Audible", domains: ["audible.com"], domain: "audible.com", status: "lapsed", price: 14.95, currency: "USD", cycle: "monthly", lastCharged: d(-130), charges: [{}, {}, {}, {}], messageCount: 4 };
  const prime = { name: "Amazon Prime", plan: "Prime", domain: "amazon.com", domains: ["amazon.com"], receiptCount: 9 };
  const review = [reviewItem(audible, reasonFor(audible, T)), reviewItem(prime, reasonFor(prime, T))];
  const sorted = [
    sortedEntry({ name: "Peacock", outcome: "cancelled", note: "Cancellation confirmed by email, Feb 12", subId: "peacock" }),
    sortedEntry({ name: "Uber", outcome: "not_subscription", note: "Irregular one-off receipts", review: reviewItem({ name: "Uber", reason: "irregular" }, reasonFor({ name: "Uber", reason: "irregular" }, T)) }),
  ];

  return {
    schemaVersion: SCHEMA_VERSION,
    review,
    sorted,
    gmail: { connected: true, lastScanAt: Date.now() - 7_200_000, lastCheckedAt: Date.now() - 7_200_000, scanned: 412, sample: false },
    subscriptions,
    visits,
    pending: [{ id: "p1", name: "Figma", domain: "figma.com", url: "https://www.figma.com/checkout/success", detectedAt: Date.now() }],
    dismissed: {},
    settings: { budget: 100 },
    stats: { remindersSent: 14 },
    installedAt: d(-226),
  };
}
