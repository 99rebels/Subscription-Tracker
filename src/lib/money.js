export function formatPrice(sub) {
  if (sub.price == null || sub.price === "") return "";
  return formatMoney(sub.price, sub.currency);
}

// formatMoney(1031.4, "USD", { whole: true }) -> "$1,031"
export function formatMoney(amount, currency = "USD", { whole = false } = {}) {
  const digits = whole ? 0 : 2;
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: currency || "USD",
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(amount);
}

// Normalise a price to a monthly figure for the dashboard total. Trials cost
// nothing yet and cancelled subscriptions cost nothing any more.
export function monthlyCost(sub) {
  if (sub.status === "trial" || sub.status === "cancelled") return 0;
  return monthlyPrice(sub);
}

// What the subscription costs per month when it's being paid for, ignoring status.
// Used for "then $14.99/mo" after a trial and for savings from a cancellation.
export function monthlyPrice(sub) {
  const price = Number(sub.price) || 0;
  if (sub.cycle === "yearly") return price / 12;
  if (sub.cycle === "weekly") return (price * 52) / 12;
  return price;
}

// Round to cents so sums of prices compare cleanly (0.1 + 0.2 problems).
export function cents(amount) {
  return Math.round(amount * 100) / 100;
}
