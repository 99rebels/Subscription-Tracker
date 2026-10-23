import { hostMatches, registrableDomain } from "./services.js";

// Hosted payment pages. The user is "at checkout" here, but the merchant is the
// site they came from, not this host.
const PROCESSOR_HOSTS = [
  "checkout.stripe.com",
  "buy.stripe.com",
  "paypal.com",
  "checkout.paddle.com",
  "pay.paddle.io",
  "chargebee.com",
  "recurly.com",
  "lemonsqueezy.com",
];

// Paths that look like a finished purchase / signup.
const SUCCESS_PATTERNS = [
  /(order|checkout|purchase|payment|subscri\w*|signup|sign-up|upgrade|billing|membership)[/_-]?(confirm\w*|complete\w*|success\w*|thank\w*|done|receipt)/i,
  /thank[-_]?you/i,
  /\/(success|welcome)(\/|$|\?)/i,
  /[?&](success|subscribed|upgraded)=(1|true)/i,
  /[?&]session_id=cs_(live|test)_/i, // Stripe Checkout success redirect
];

// Paths that look like the user is about to pay.
const CHECKOUT_PATTERNS = [/\/(checkout|subscribe|upgrade|pricing\/checkout|billing\/plan)(\/|$|\?)/i];

// Big retailers where a generic "order confirmed" page is almost always a one-off
// purchase. Still detected when the URL mentions a subscription/membership.
const ONE_OFF_RETAILERS = ["amazon.com", "ebay.com", "etsy.com", "walmart.com", "target.com", "bestbuy.com"];
const SUBSCRIPTION_HINT = /subscri|membership|prime|premium|plan/i;

export function isProcessorHost(hostname) {
  return PROCESSOR_HOSTS.some((d) => hostMatches(hostname, d));
}

export function looksLikeCheckout(url) {
  return isProcessorHost(url.hostname) || CHECKOUT_PATTERNS.some((re) => re.test(url.pathname));
}

export function looksLikeSuccess(url) {
  const target = url.pathname + url.search;
  if (!SUCCESS_PATTERNS.some((re) => re.test(target))) return false;
  const domain = registrableDomain(url.hostname);
  if (ONE_OFF_RETAILERS.includes(domain) && !SUBSCRIPTION_HINT.test(target)) return false;
  return true;
}

// Per-tab state survives the service worker going to sleep via storage.session.
//   tabs[tabId] = { merchant: "example.com", checkoutAt: ms | null }
const CHECKOUT_WINDOW_MS = 30 * 60 * 1000;

async function getTabState(tabId) {
  const { tabs = {} } = await chrome.storage.session.get("tabs");
  return [tabs, tabs[tabId] ?? { merchant: null, checkoutAt: null }];
}

/**
 * Feed every top-level navigation through here. Returns the merchant domain when
 * the navigation looks like a completed subscription purchase, otherwise null.
 */
export async function observeNavigation(tabId, urlString) {
  let url;
  try {
    url = new URL(urlString);
  } catch {
    return null;
  }
  if (!url.protocol.startsWith("http")) return null;

  const [tabs, state] = await getTabState(tabId);
  const processor = isProcessorHost(url.hostname);
  const domain = registrableDomain(url.hostname);
  let detected = null;

  const recentCheckout = state.checkoutAt && Date.now() - state.checkoutAt < CHECKOUT_WINDOW_MS;

  if (looksLikeSuccess(url)) {
    // On a processor's own success page, credit the merchant the user came from.
    detected = processor ? state.merchant : domain;
  } else if (!processor && recentCheckout && state.merchant === domain && state.leftForProcessor) {
    // Came back from a hosted payment page to the merchant: treat as a purchase
    // even if the merchant's return URL doesn't look like a success page.
    detected = domain;
  }

  if (detected) {
    state.checkoutAt = null;
    state.leftForProcessor = false;
  } else if (looksLikeCheckout(url)) {
    state.checkoutAt = Date.now();
    if (processor) state.leftForProcessor = true;
  }
  if (!processor) {
    if (state.merchant !== domain) state.leftForProcessor = false;
    state.merchant = domain;
  }

  tabs[tabId] = state;
  await chrome.storage.session.set({ tabs });
  return detected;
}

export async function forgetTab(tabId) {
  const { tabs = {} } = await chrome.storage.session.get("tabs");
  delete tabs[tabId];
  await chrome.storage.session.set({ tabs });
}
