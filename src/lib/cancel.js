// Where to cancel (product-plan §9): where the user signed up decides where they
// cancel, and receipts tell us. A rule in code, not per-service data.
// Store links checked 2026-10-22: each loads and sends you to sign in first. The
// Apple one couldn't be confirmed automatically; check it by hand (BUILD.md).

const STORES = {
  apple: { name: "Apple", url: "https://account.apple.com/account/manage/section/subscriptions" },
  google_play: { name: "Google Play", url: "https://play.google.com/store/account/subscriptions" },
  amazon: { name: "Amazon", url: "https://www.amazon.com/yourmembershipsandsubscriptions" },
  paypal: { name: "PayPal", url: "https://www.paypal.com/myaccount/autopay/" },
};

// Services that are themselves a store's subscription list.
const STORE_SERVICES = { "Apple subscriptions": "apple", "Google Play subscriptions": "google_play" };

/**
 * { url, via, viaName }: via is a store key when the user should cancel there
 * instead of on the service's own site. url is null if we know no website.
 */
export function cancelRoute(sub) {
  const via = sub.billedVia ?? STORE_SERVICES[sub.name] ?? null;
  if (via && STORES[via]) return { url: STORES[via].url, via, viaName: STORES[via].name };
  const domain = sub.domains?.[0];
  return { url: sub.cancelUrl || (domain ? `https://${domain}` : null), via: null, viaName: null };
}

