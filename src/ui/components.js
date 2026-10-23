// Shared building blocks for the popup and side panel (Components.dc.html).
import { h } from "./dom.js";
import * as t from "./text.js";
import { daysBetween } from "../lib/dates.js";

// ---------------------------------------------------------------------------
// Icons (paths from the designs; 24x24 stroke icons)

const ICONS = {
  check: '<path d="M5 12l5 5L20 7"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  sliders: '<path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
  chevronRight: '<path d="M9 18l6-6-6-6"/>',
  chevronLeft: '<path d="M15 18l-6-6 6-6"/>',
  chevronDown: '<path d="M6 9l6 6 6-6"/>',
  external: '<path d="M7 17L17 7M9 7h8v8"/>',
  arrowUp: '<path d="M12 19V5M5 12l7-7 7 7"/>',
  list: '<path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>',
  panel: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M15 4v16"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  spark: '<path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4"/><path d="M12 3v2M12 19v2"/>',
  download: '<path d="M12 4v12M7 11l5 5 5-5M5 20h14"/>',
  upload: '<path d="M12 20V8M7 13l5-5 5 5M5 4h14"/>',
};

export function icon(name, { size = 16, stroke = 2.2, label } = {}) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("width", size);
  svg.setAttribute("height", size);
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", stroke);
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  if (label) {
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", label);
  } else {
    svg.setAttribute("aria-hidden", "true");
  }
  svg.innerHTML = ICONS[name]; // static strings from this file only
  return svg;
}

// ---------------------------------------------------------------------------
// Logo tile: the site's icon from Chrome's favicon cache (no network request),
// or a letter on a neutral tile tinted per service.

function hashString(s) {
  let n = 0;
  for (const ch of s) n = (n * 31 + ch.codePointAt(0)) >>> 0;
  return n;
}

export function tintFor(name) {
  return `var(--tint-${(hashString(name.toLowerCase()) % 5) + 1})`;
}

function faviconUrl(domain, size) {
  const url = new URL(chrome.runtime.getURL("/_favicon/"));
  url.searchParams.set("pageUrl", `https://${domain}`);
  url.searchParams.set("size", String(size));
  return url.toString();
}

// Chrome returns a generic globe for sites it has no icon for. Fetch that once
// and compare, so unknown sites get the letter tile instead of a globe.
let genericIcon;
const iconCache = new Map(); // domain -> Promise<string | null>

async function bytesOf(url) {
  const res = await fetch(url);
  return new Uint8Array(await res.arrayBuffer());
}

function sameBytes(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function realFavicon(domain) {
  if (!iconCache.has(domain)) {
    const url = faviconUrl(domain, 32);
    genericIcon ??= bytesOf(faviconUrl("invalid.invalid", 32)).catch(() => null);
    iconCache.set(
      domain,
      Promise.all([bytesOf(url), genericIcon])
        .then(([icon, generic]) => (sameBytes(icon, generic) ? null : url))
        .catch(() => null),
    );
  }
  return iconCache.get(domain);
}

export function logoTile(sub, { size = 32, muted = false, dashed = false } = {}) {
  const name = sub.name || "?";
  const tile = h("div", { class: `tile${size === 32 ? "" : ` s${size}`}${muted ? " muted-tile" : ""}${dashed ? " dashed" : ""}`, "aria-hidden": "true" }, name[0].toUpperCase());
  tile.style.color = muted ? "" : tintFor(name);
  const domain = sub.domains?.[0] ?? sub.domain;
  if (domain && typeof chrome !== "undefined" && chrome.runtime?.getURL) {
    realFavicon(domain).then((url) => {
      if (url) tile.replaceChildren(h("img", { src: url, alt: "" }));
    });
  }
  return tile;
}

// ---------------------------------------------------------------------------
// Tags, chips, meter

export const tag = (kind, text) => h("span", { class: `tag ${kind}` }, text);

export const confirmedTag = () => h("span", { class: "tag confirmed" }, icon("check", { size: 11, stroke: 3 }), "Confirmed by receipt");

// "In 2 days" / "Tomorrow" / "Today" / "Nov 16"
export function renewalChip(daysAway, { trial = false, date } = {}) {
  const label = daysAway > 30 && date ? t.shortDate(date) : t.capitalize(t.inDays(daysAway));
  const kind = daysAway <= 0 || (trial && daysAway <= 7) ? " soon" : daysAway === 1 ? " tomorrow" : "";
  return h("span", { class: `chip${kind}` }, label);
}

// Budget meter: under · close (90%+) · over
export function budgetMeter(budget, monthly, currency) {
  if (!budget) return null;
  const share = monthly / budget.budget;
  const state = budget.over ? "over" : share >= 0.9 ? "close" : "";
  const bar = h("div", { class: `meter ${state}`, role: "meter", "aria-valuemin": 0, "aria-valuemax": budget.budget, "aria-valuenow": monthly, "aria-label": "Budget used" });
  if (!budget.over) {
    const fill = h("div");
    fill.style.width = `${Math.min(100, share * 100).toFixed(1)}%`;
    bar.append(fill);
  }
  const left = budget.over
    ? h("span", { class: "num cancel-text strong" }, `${t.money(-budget.left, currency)} over`)
    : h("span", { class: `num${state === "close" ? " attention" : ""}` }, `${t.money(budget.left, currency)} left`);
  const label = budget.over
    ? `${t.money(monthly, currency)} of your ${t.moneyWhole(budget.budget, currency)} budget`
    : `${Math.round(share * 100)}% of your ${t.moneyWhole(budget.budget, currency)} budget`;
  return h("div", { class: "budget" }, bar, h("div", { class: "meter-labels" }, h("span", {}, label), left));
}

export function sectionHead(title, aside, { count } = {}) {
  return h(
    "div",
    { class: "section-head" },
    h("h2", {}, title, count ? h("span", { class: "tag count" }, String(count)) : null),
    aside == null ? null : typeof aside === "string" ? h("span", { class: "caption" }, aside) : aside,
  );
}

// ---------------------------------------------------------------------------
// Subscription row (Components: normal · not visited lately · trial · yearly ·
// no visits on this computer · price pending)

export function usageSpan(sub, today) {
  const u = t.usage(sub, today);
  return u.stale ? h("span", { class: "attention", style: "font-weight: 500" }, u.text) : u.text;
}

export const isPricePending = (sub) => sub.priceSource === "checkout" && !sub.confirmedByReceipt;

export function subscriptionRow(sub, today, { href = `#sub/${sub.id}`, compact = false } = {}) {
  const trial = sub.status === "trial";
  const pending = isPricePending(sub);
  const currency = sub.currency;

  const title = h(
    "div",
    { class: "row-title" },
    h("span", { class: "name" }, t.displayName(sub)),
    trial ? tag("trial", "Trial") : null,
    !trial && sub.cycle === "yearly" ? tag("neutral", "Yearly") : null,
  );

  let subline;
  if (trial) subline = t.renewalText(sub);
  else if (pending) subline = "Price from checkout page · confirming with receipt";
  else if (!sub.domains?.length) subline = t.renewalText(sub);
  else subline = [t.renewalText(sub), " · ", usageSpan(sub, today)];

  let right;
  if (trial && sub.nextRenewal) {
    right = renewalChip(daysBetween(today, sub.nextRenewal), { trial: true });
  } else {
    const amount = Number(sub.price) || 0;
    right = h(
      "div",
      { class: "row-price" },
      h("div", { class: `amount${pending ? " pending" : ""}` }, t.money(amount, currency)),
      h("div", { class: "unit" }, sub.cycle === "yearly" ? t.monthlyShare(sub) : t.cycleUnit(sub.cycle)),
    );
  }

  return h(
    "a",
    { class: `row${compact ? " compact" : ""}`, href },
    logoTile(sub, { size: compact ? 28 : 32 }),
    h("div", { class: "row-main" }, title, h("div", { class: "row-sub" }, ...[].concat(subline))),
    right,
  );
}

// On/off switch (Settings).
export function toggle(checked, label, onChange) {
  const button = h("button", { class: "switch", role: "switch", "aria-checked": String(!!checked), "aria-label": label }, h("span"));
  button.addEventListener("click", () => onChange(button.getAttribute("aria-checked") !== "true"));
  return button;
}
