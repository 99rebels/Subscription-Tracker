// Popup: Home (Main.dc.html) and First run (PopupEmpty.dc.html). Anything
// bigger opens the side panel.
import { h } from "../ui/dom.js";
import { icon, logoTile, budgetMeter } from "../ui/components.js";
import * as t from "../ui/text.js";
import { applyTheme } from "../ui/theme.js";
import { load, save } from "../lib/storage.js";
import { answerReview } from "../lib/review.js";
import { keepSubscription } from "../lib/model.js";
import { totals, budgetStatus, upcoming, trialsEndingSoon, worthReviewing, priceHistory } from "../lib/summary.js";
import { daysBetween, today } from "../lib/dates.js";
import { monthlyCost } from "../lib/money.js";
import { converter, otherCurrencies } from "../lib/fx.js";

const app = document.getElementById("app");
const PRICE_RISE_RECENT_DAYS = 45;

// sidePanel.open() only works inside the click itself, so the window id is
// looked up before anything can be clicked.
let windowId = null;

function openPanel(hash = "#overview") {
  if (windowId != null) chrome.sidePanel.open({ windowId }).catch(() => {});
  chrome.storage.session.set({ panelNavigate: { hash, at: Date.now() } }).then(() => window.close());
}

async function main() {
  windowId = (await chrome.windows.getCurrent()).id;
  await applyTheme();
  await render();
  chrome.storage.onChanged.addListener((_, area) => area === "local" && render());
}

async function render() {
  const data = await load("subscriptions", "review", "settings", "fx");
  const state = { ...data, today: today(), conv: converter(data.settings.currency, data.fx) };
  if (!state.subscriptions.length && !state.review.length) {
    app.replaceChildren(...firstRunView());
  } else {
    app.replaceChildren(...homeView(state));
  }
}

// ---------------------------------------------------------------------------
// Shared pieces

function header() {
  return h(
    "header",
    { class: "popup-header" },
    h("div", { class: "brand" }, h("div", { class: "brand-mark" }, icon("check", { size: 12, stroke: 3 })), "Subscription Check"),
    h(
      "div",
      { style: "display: flex; gap: 2px" },
      h("button", { class: "icon-btn", "aria-label": "Open full view", title: "Open full view", onclick: () => openPanel() }, icon("panel", { stroke: 2 })),
      h("button", { class: "icon-btn", "aria-label": "Settings", title: "Settings", onclick: () => openPanel("#settings") }, icon("gear", { stroke: 2 })),
    ),
  );
}

function footer() {
  return h("footer", { class: "popup-footer" }, h("button", { class: "btn quiet block", style: "height: 36px", onclick: () => openPanel() }, icon("panel", { size: 15, stroke: 2 }), "Open full view"));
}

function comingUpRows(subs, todayISO, limit) {
  return upcoming(subs, todayISO, { limit }).map((u) => {
    const when = [t.shortDate(u.date), t.inDays(u.daysAway)];
    if (u.sub.cycle === "yearly" && !u.trial) when.push("yearly");
    return h(
      "button",
      { class: "cu", onclick: () => openPanel(`#sub/${u.sub.id}`) },
      logoTile(u.sub, { size: 28 }),
      h(
        "div",
        { class: "row-main" },
        h("div", { class: "row-title" }, h("span", { class: "name" }, t.displayName(u.sub)), u.trial ? h("span", { class: "attention", style: "font-size: 11px; font-weight: 600" }, "TRIAL") : null),
        h("div", { class: "row-sub" }, when.join(" · ")),
      ),
      h("div", { class: "amount" }, t.money(u.amount, u.sub.currency)),
    );
  });
}

// ---------------------------------------------------------------------------
// Home

function homeView(state) {
  const { subscriptions: subs, settings, today: todayISO } = state;
  const currency = settings.currency;
  const sum = totals(subs, state.conv);
  const parts = [`${t.moneyWhole(sum.yearly, currency)} a year`, t.plural(sum.count, "subscription")];
  if (sum.trials) parts.push(t.plural(sum.trials, "trial"));
  const note = t.conversionNote(otherCurrencies(subs, currency), state.conv);

  const total = h(
    "section",
    { class: "total" },
    h("div", { class: "caption" }, "This month"),
    h("div", { style: "display: flex; align-items: baseline; gap: 4px" }, h("span", { class: "figure" }, t.money(sum.monthly, currency)), h("span", { class: "muted", style: "font-size: 15px" }, "/mo")),
    h("div", { class: "caption" }, parts.join(" · ")),
    budgetMeter(budgetStatus(sum.monthly, settings.budget), sum.monthly, currency),
    note ? h("div", { class: "caption faint", style: "margin-top: 6px" }, note) : null,
  );

  const attention = attentionItems(state);
  const coming = comingUpRows(subs, todayISO, 5);

  return [
    header(),
    h(
      "div",
      { class: "middle" },
      total,
      attention.length
        ? h("section", { class: "pblock" }, h("div", { class: "block-title" }, "Needs attention", h("span", { class: "tag count" }, String(attention.length))), h("div", { class: "card" }, ...attention))
        : null,
      coming.length ? h("section", { class: "pblock", style: "gap: 2px; padding-bottom: 8px" }, h("div", { class: "block-title", style: "padding-bottom: 4px" }, "Coming up"), ...coming) : null,
    ),
    footer(),
  ];
}

function attentionItems(state) {
  const { subscriptions: subs, today: todayISO } = state;
  const items = [];
  const item = (lead, title, sub, action, subClass = "") =>
    h("div", { class: "row compact" }, lead, h("div", { class: "row-main" }, h("div", { class: "row-title" }, h("span", { class: "name" }, title)), h("div", { class: `row-sub ${subClass}` }, sub)), action);

  for (const u of trialsEndingSoon(subs, todayISO)) {
    const then = Number(u.sub.price) > 0 ? `Then ${t.pricePerCycle(u.sub)} from ${t.shortDate(u.date)}` : `Ends ${t.shortDate(u.date)}`;
    items.push(item(h("div", { class: "icon-tile s28" }, icon("clock", { size: 15 })), t.trialEndsText(u.sub, u.daysAway), then, h("button", { class: "btn cancel sm", onclick: () => openPanel(`#sub/${u.sub.id}`) }, "Cancel")));
  }

  for (const sub of subs) {
    if (sub.status === "cancelled") continue;
    const rise = priceHistory(sub).latestRise;
    if (!rise || daysBetween(rise.date, todayISO) > PRICE_RISE_RECENT_DAYS) continue;
    items.push(item(logoTile(sub, { size: 28 }), `${t.displayName(sub)} went up`, `${t.money(rise.from, sub.currency)} → ${t.money(rise.to, sub.currency)} (+${Math.round(rise.change * 100)}%)`, h("button", { class: "btn sm", onclick: () => openPanel(`#sub/${sub.id}`) }, "Review")));
  }

  for (const r of state.review) {
    items.push(
      item(
        logoTile(r.item, { size: 28 }),
        r.title,
        r.reason,
        h("div", { style: "display: flex; gap: 4px" }, h("button", { class: "btn sm", onclick: () => answerReview(r.id, "yes") }, "Yes"), h("button", { class: "btn sm", onclick: () => answerReview(r.id, "no") }, "No")),
      ),
    );
  }

  // The most expensive thing the user hasn't said they still use.
  const ask = worthReviewing(subs, todayISO, state.conv).items[0];
  if (ask) {
    items.push(
      item(
        logoTile(ask, { size: 28 }),
        t.displayName(ask),
        `Still using it? · ${t.money(monthlyCost(ask), ask.currency)}/mo`,
        h(
          "div",
          { style: "display: flex; gap: 4px" },
          h("button", { class: "btn sm", onclick: () => keep(ask) }, "Keep"),
          h("button", { class: "btn sm", onclick: () => openPanel(`#sub/${ask.id}`) }, "Review"),
        ),
        "attention",
      ),
    );
  }
  return items;
}

// "Keep": the user still uses it, so don't ask again for a few months.
async function keep(sub) {
  const { subscriptions } = await load("subscriptions");
  await save({ subscriptions: subscriptions.map((s) => (s.id === sub.id ? keepSubscription(s, today()) : s)) });
}

// ---------------------------------------------------------------------------
// First run

function firstRunView() {
  const line = (width) => h("div", { style: "display: flex; align-items: center; gap: 10px" }, h("div", { class: "sq" }), h("div", { class: "bar", style: `width: ${width}` }), h("div", { style: "flex-grow: 1" }), h("div", { class: "bar", style: "width: 40px" }));
  return [
    h("header", { class: "popup-header", style: "padding: 14px 16px 8px" }, h("div", { class: "brand" }, h("div", { class: "brand-mark" }, icon("check", { size: 12, stroke: 3 })), "Subscription Check")),
    h(
      "div",
      { class: "middle" },
      h(
        "section",
        { class: "skeleton", "aria-hidden": "true" },
        h("div", { style: "display: flex; align-items: flex-end; gap: 6px" }, h("div", { class: "bar", style: "width: 120px; height: 30px; border-radius: 6px" }), h("span", { style: "font-size: 14px; color: var(--faint)" }, "/mo")),
        line("75%"),
        line("60%"),
        line("45%"),
      ),
      h(
        "section",
        { style: "padding: 22px 16px 0; display: flex; flex-direction: column; gap: 8px" },
        h("h1", { style: "font: var(--text-heading); letter-spacing: -0.02em; line-height: 1.2" }, "Find everything you're paying for"),
        h("p", { class: "muted", style: "font-size: 13px; line-height: 1.5" }, "We'll read your receipts, show what you pay, and remind you before each charge."),
      ),
      h(
        "section",
        { style: "padding: 18px 16px 0; display: flex; flex-direction: column; gap: 10px" },
        // The scan runs in the side panel: a popup closes when you click away.
        h("button", { class: "btn primary lg block", onclick: () => openPanel("#scan?start=1") }, icon("mail"), "Scan my Gmail receipts"),
        h("div", { class: "caption", style: "display: flex; align-items: center; justify-content: center; gap: 6px" }, icon("lock", { size: 13 }), "Read in your browser. Nothing leaves your computer."),
      ),
      h(
        "footer",
        { class: "first-run-foot" },
        h("div", { class: "icon-tile s28", style: "background: var(--raised); color: var(--accent)" }, icon("target", { size: 15 })),
        h("div", { class: "caption", style: "flex-grow: 1; line-height: 1.45" }, "Not on Gmail? You can add subscriptions yourself."),
        h("a", { href: "#", style: "font-size: 12px; font-weight: 500; white-space: nowrap", onclick: (e) => (e.preventDefault(), openPanel("#edit/new")) }, "Add one"),
      ),
    ),
  ];
}

main();
