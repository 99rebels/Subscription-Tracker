// Side panel · Overview (docs/designs/PanelOverview.dc.html, SavingsZero.dc.html)
import { h } from "../ui/dom.js";
import { icon, logoTile, budgetMeter, sectionHead } from "../ui/components.js";
import * as t from "../ui/text.js";
import {
  totals,
  budgetStatus,
  worthReviewing,
  upcoming,
  trialsEndingSoon,
  forecast,
  categories,
  savings,
  priceHistory,
  cutPlan,
} from "../lib/summary.js";
import { addDays, daysBetween, weekStart, today as todayLocal } from "../lib/dates.js";
import { answerReview } from "../lib/review.js";
import { monthlyCost } from "../lib/money.js";
import { otherCurrencies } from "../lib/fx.js";

const PRICE_RISE_RECENT_DAYS = 45;
const COMING_UP_DAYS = 35;
const COMING_UP_MAX = 5;

export function renderOverview(state, actions) {
  const { subscriptions: subs, settings, today } = state;
  const currency = settings.currency;

  if (!subs.length && !state.review.length) return h("main", { class: "content" }, emptyState());

  return h(
    "main",
    { class: "content" },
    totalSection(state),
    savingsCard(state),
    needsAttention(state, actions),
    worthReviewingSection(subs, today, currency, state.conv),
    comingUp(subs, today),
    forecastSection(subs, today, currency, state.conv),
    whereItGoes(subs, currency, state.conv),
  );
}

// First run (as in PopupEmpty.dc.html): scan Gmail, or wait for checkout detection.
function emptyState() {
  return h(
    "div",
    { style: "display: flex; flex-direction: column; gap: 14px; padding-top: 8px" },
    h("h1", { style: "font: var(--text-heading); letter-spacing: -0.02em; line-height: 1.2" }, "Find everything you're paying for"),
    h("p", { class: "muted", style: "font-size: 13px; line-height: 1.5" }, "We'll read your receipts and show what you pay, when you're charged next, and what you've stopped using."),
    h("a", { class: "btn primary lg block", href: "#scan?start=1" }, icon("mail"), "Scan my Gmail receipts"),
    h("div", { class: "caption", style: "display: flex; align-items: center; justify-content: center; gap: 6px" }, icon("lock", { size: 13 }), "Read in your browser. Nothing leaves your computer."),
    h(
      "div",
      { style: "margin-top: 8px; padding: 12px 14px; border-radius: 12px; border: 1px solid var(--border); display: flex; align-items: center; gap: 12px" },
      h("div", { class: "icon-tile", style: "width: 28px; height: 28px; border-radius: 7px; background: var(--raised); color: var(--accent)" }, icon("target", { size: 15 })),
      h("div", { class: "caption", style: "flex-grow: 1; line-height: 1.45" }, "Or just keep browsing. We'll spot new subscriptions at checkout."),
      h("a", { href: "#edit/new", style: "font-size: 12px; font-weight: 500; white-space: nowrap" }, "Add one"),
    ),
  );
}

// ---------------------------------------------------------------------------

function totalSection(state) {
  const { subscriptions: subs, settings, conv } = state;
  const sum = totals(subs, conv);
  const currency = settings.currency;
  const parts = [`${t.moneyWhole(sum.yearly, currency)} a year`, t.plural(sum.count, "subscription")];
  if (sum.trials) parts.push(t.plural(sum.trials, "trial"));
  return h(
    "section",
    { class: "total" },
    h("div", { class: "caption" }, "This month"),
    h("div", { class: "figure-line" }, h("span", { class: "figure" }, t.money(sum.monthly, currency)), h("span", { class: "per" }, "/mo")),
    h("div", { class: "caption" }, parts.join(" · ")),
    budgetMeter(budgetStatus(sum.monthly, settings.budget), sum.monthly, currency),
    settings.suggestCuts ? cutPlanNote(subs, settings, conv) : null,
    conversion(subs, settings, conv),
  );
}

function conversion(subs, settings, conv) {
  const note = t.conversionNote(otherCurrencies(subs, settings.currency), conv);
  return note ? h("div", { class: "caption faint", style: "margin-top: 6px" }, note) : null;
}

// Over budget: "You're $1.95 over. Cancelling Dropbox (no visits on this
// computer) brings you $8.04 under." (product-plan §4)
function cutPlanNote(subs, settings, conv) {
  const plan = cutPlan(subs, settings.budget, todayLocal(), conv);
  if (!plan) return null;
  const currency = settings.currency;
  let text;
  if (!plan.picks.length) text = `You're ${t.money(plan.over, currency)} over, and everything has been used lately.`;
  else {
    const names = plan.picks.length === 1 ? `${plan.picks[0].name} (${t.usage(plan.picks[0], todayLocal()).text})` : t.joinAnd(plan.picks.map((s) => s.name));
    text = plan.enough
      ? `You're ${t.money(plan.over, currency)} over. Cancelling ${names} brings you ${t.money(plan.under, currency)} under.`
      : `You're ${t.money(plan.over, currency)} over. Cancelling ${names} saves ${t.money(plan.saved, currency)}/mo.`;
  }
  return h("div", { class: "caption", style: "margin-top: 8px; line-height: 1.45" }, text, plan.picks.length ? [" ", h("a", { href: "#subscriptions?filter=stale", style: "color: var(--accent)" }, "Review")] : null);
}

function savingsCard(state) {
  const { subscriptions: subs, today, installedAt, conv } = state;
  const currency = state.settings.currency;
  const s = savings(subs, today, { installedAt, conv });
  if (s.items.length) {
    return h(
      "a",
      { class: "savings-card", href: "#savings" },
      h(
        "div",
        { style: "flex-grow: 1; min-width: 0" },
        h("div", { class: "caption" }, s.since ? `Saved since ${t.monthName(s.since.slice(0, 7))}` : "Saved so far"),
        h("div", { class: "amount" }, t.money(s.total, currency)),
        h("div", { class: "caption" }, s.monthlyGrowth ? `Growing ${t.money(s.monthlyGrowth, currency)} every month` : "From trials you stopped"),
      ),
      sparkline(s.series),
      icon("chevronRight", { size: 14, stroke: 2.2 }),
    );
  }
  // Zero state: never show $0; show what could be saved instead.
  const w = worthReviewing(subs, today, conv);
  if (!w.items.length) return null;
  return h(
    "a",
    { class: "savings-card zero", href: "#subscriptions?filter=stale" },
    h(
      "div",
      {},
      h("div", { class: "caption" }, "You could be saving"),
      h("div", { style: "display: flex; align-items: baseline; gap: 4px" }, h("span", { class: "amount" }, t.money(w.monthly, currency)), h("span", { class: "muted" }, "/mo")),
      h(
        "div",
        { class: "caption", style: "line-height: 1.45" },
        `Going to ${t.plural(w.items.length, "subscription")} you haven't opened in 30+ days. That's ${t.money(w.yearly, currency)} a year.`,
      ),
    ),
    h("div", { class: "cta" }, h("span", {}, "Review them"), icon("chevronRight", { size: 14 })),
  );
}

function sparkline(series) {
  if (series.length < 2) return null;
  const width = 88;
  const height = 40;
  const max = Math.max(...series.map((p) => p.total)) || 1;
  const points = series
    .map((p, i) => {
      const x = 2 + (i * (width - 4)) / (series.length - 1);
      const y = height - 2 - (p.total / max) * (height - 4);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("width", width);
  svg.setAttribute("height", height);
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.setAttribute("aria-hidden", "true");
  svg.style.flexShrink = "0";
  const line = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
  line.setAttribute("points", points);
  line.setAttribute("fill", "none");
  line.setAttribute("stroke", "var(--accent)");
  line.setAttribute("stroke-width", "2");
  line.setAttribute("stroke-linecap", "round");
  line.setAttribute("stroke-linejoin", "round");
  svg.append(line);
  return svg;
}

// ---------------------------------------------------------------------------
// Needs attention: trials ending soon, signups spotted at checkout, recent price rises.

function needsAttention(state, actions) {
  const { subscriptions: subs, today, pending } = state;
  const items = [];

  for (const u of trialsEndingSoon(subs, today)) {
    const sub = u.sub;
    const then = Number(sub.price) > 0 ? `Then ${t.pricePerCycle(sub)} from ${t.shortDate(sub.nextRenewal)}` : `Ends ${t.shortDate(sub.nextRenewal)}`;
    items.push(
      h(
        "div",
        { class: "attention-item" },
        h(
          "div",
          { class: "line" },
          h("div", { class: "icon-tile" }, icon("clock")),
          h("div", { class: "row-main" }, h("div", { class: "row-title" }, h("span", { class: "name" }, t.trialEndsText(sub, u.daysAway))), h("div", { class: "row-sub" }, then)),
          h("a", { class: "btn cancel sm", href: `#sub/${sub.id}` }, "Cancel"),
        ),
      ),
    );
  }

  for (const r of state.review) {
    items.push(
      h(
        "div",
        { class: "attention-item" },
        h("div", { class: "line" }, logoTile(r.item), h("div", { class: "row-main" }, h("div", { class: "row-title" }, h("span", { class: "name" }, r.title)), h("div", { class: "row-sub" }, r.reason))),
        h("div", { class: "actions" }, h("button", { class: "btn sm", onclick: () => answerReview(r.id, "yes") }, r.yes), h("button", { class: "btn sm", onclick: () => answerReview(r.id, "no") }, r.no)),
      ),
    );
  }

  for (const p of pending) {
    items.push(
      h(
        "div",
        { class: "attention-item" },
        h(
          "div",
          { class: "line" },
          logoTile({ name: p.name, domains: [p.domain] }),
          h("div", { class: "row-main" }, h("div", { class: "row-title" }, h("span", { class: "name" }, `Did you subscribe to ${p.name}?`)), h("div", { class: "row-sub" }, "Spotted at checkout")),
          h("a", { class: "btn sm", href: "#review" }, "Review"),
        ),
      ),
    );
  }

  for (const sub of subs) {
    if (sub.status === "cancelled") continue;
    const rise = priceHistory(sub).latestRise;
    if (!rise || daysBetween(rise.date, today) > PRICE_RISE_RECENT_DAYS) continue;
    items.push(
      h(
        "div",
        { class: "attention-item" },
        h(
          "div",
          { class: "line" },
          logoTile(sub),
          h(
            "div",
            { class: "row-main" },
            h("div", { class: "row-title" }, h("span", { class: "name" }, `${t.displayName(sub)} went up`)),
            h("div", { class: "row-sub" }, `${t.money(rise.from, sub.currency)} → ${t.money(rise.to, sub.currency)} on ${t.shortDate(rise.date)} (+${Math.round(rise.change * 100)}%)`),
          ),
          h("a", { class: "btn sm", href: `#sub/${sub.id}` }, "Review"),
        ),
      ),
    );
  }

  if (!items.length) return null;
  return h("section", { class: "section" }, sectionHead("Needs attention", null, { count: items.length }), h("div", { class: "card" }, ...items));
}

// ---------------------------------------------------------------------------

function worthReviewingSection(subs, today, currency, conv) {
  const w = worthReviewing(subs, today, conv);
  if (!w.items.length) return null;
  const rows = w.items.map((sub) => {
    const u = t.usage(sub, today);
    return h(
      "a",
      { class: "row compact", href: `#sub/${sub.id}` },
      logoTile(sub, { size: 28 }),
      h("div", { class: "row-main" }, h("div", { class: "row-title" }, h("span", { class: "name" }, t.displayName(sub))), h("div", { class: "row-sub attention" }, t.capitalize(u.text))),
      h("span", { class: "num strong", style: "font-size: 13px" }, t.money(monthlyCost(sub), sub.currency), h("span", { class: "muted", style: "font-weight: 400" }, "/mo")),
    );
  });
  return h(
    "section",
    { class: "section" },
    sectionHead("Worth reviewing", "Not visited in 30+ days"),
    h(
      "div",
      { class: "card" },
      h(
        "div",
        { class: "review-head" },
        h("div", { class: "caption" }, t.cancelAllLabel(w.items.length)),
        h("div", { style: "display: flex; align-items: baseline; gap: 6px; margin-top: 2px" }, h("span", { class: "big" }, t.money(w.yearly, currency)), h("span", { class: "caption" }, `a year · ${t.money(w.monthly, currency)}/mo`)),
      ),
      ...rows,
    ),
  );
}

function comingUp(subs, today) {
  const nextWeek = addDays(weekStart(today), 7);
  const until = addDays(today, COMING_UP_DAYS);
  const items = upcoming(subs, today, { limit: COMING_UP_MAX }).filter((u) => u.date <= until);
  if (!items.length) return null;

  const row = (u) =>
    h(
      "a",
      { class: "cu-row", href: `#sub/${u.sub.id}` },
      h("div", { class: "when" }, u.date < nextWeek ? t.weekdayDay(u.date) : t.shortDate(u.date)),
      logoTile(u.sub, { size: 28 }),
      h("div", { class: "what ellipsis" }, t.displayName(u.sub), u.trial ? h("span", { class: "attention", style: "font-size: 11px; font-weight: 600; margin-left: 6px" }, "Trial") : null),
      h("span", { class: "amount" }, t.money(u.amount, u.sub.currency)),
    );

  const thisWeek = items.filter((u) => u.date < nextWeek);
  const later = items.filter((u) => u.date >= nextWeek);
  return h(
    "section",
    { class: "section coming-up" },
    h("h2", { class: "label", style: "margin-bottom: 4px" }, "Coming up"),
    thisWeek.length ? h("div", { class: "eyebrow" }, "This week") : null,
    ...thisWeek.map(row),
    later.length ? h("div", { class: "eyebrow" }, "Next few weeks") : null,
    ...later.map(row),
    h("a", { href: "#subscriptions/calendar", style: "font-size: 12px; font-weight: 500; padding-top: 6px" }, "See calendar"),
  );
}

function forecastSection(subs, today, currency, conv) {
  const f = forecast(subs, today, 12, conv);
  if (!f.total) return null;
  const max = Math.max(...f.months.map((m) => m.total)) || 1;
  const heavy = f.months.filter((m) => m.yearlyCharges.length && m.total > (f.total / 12) * 1.25);
  const firstHeavy = heavy[0]?.month;

  const cols = f.months.map((m) => {
    const isHeavy = heavy.includes(m);
    const bar = h("div", { class: "bar" });
    bar.style.height = `${Math.max(2, (m.total / max) * 76)}px`;
    if (isHeavy) bar.style.background = m.month === firstHeavy ? "var(--accent)" : "var(--chart-rest)";
    return h(
      "div",
      { class: "col", title: `${t.monthName(m.month)}: ${t.money(m.total, currency)}` },
      isHeavy ? h("span", { class: "value" }, t.moneyWhole(m.total, currency)) : null,
      bar,
      h("span", { class: "letter" }, t.monthLetter(m.month)),
    );
  });

  const describe = f.months.map((m) => `${t.monthName(m.month)} ${t.moneyWhole(m.total, currency)}`).join(", ");
  const note = t.forecastNote(f);
  return h(
    "section",
    { class: "section", style: "gap: 10px" },
    sectionHead("Next 12 months", h("span", { class: "caption num" }, `${t.moneyWhole(f.total, currency)} expected`)),
    h("div", { class: "forecast-bars", role: "img", "aria-label": `Expected charges per month: ${describe}` }, ...cols),
    note
      ? h(
          "div",
          { class: "caption", style: "line-height: 1.45" },
          `${note.months} ${note.verb} heavier: `,
          ...joinNodes(note.names.map((n) => h("span", { style: "color: var(--text)" }, n))),
          ` ${note.renews} yearly (${note.price}).`,
        )
      : null,
  );
}

// [a, b, c] -> [a, ", ", b, " and ", c]
function joinNodes(nodes) {
  const out = [];
  nodes.forEach((n, i) => {
    if (i > 0) out.push(i === nodes.length - 1 ? " and " : ", ");
    out.push(n);
  });
  return out;
}

const RING_COLOURS = ["var(--accent)", "var(--chart-rest)", "var(--dim)", "var(--faint)", "var(--muted)", "var(--border)"];

function whereItGoes(subs, currency, conv) {
  const groups = categories(subs, conv);
  if (!groups.length) return null;
  const total = groups.reduce((a, g) => a + g.monthly, 0);

  const circumference = 2 * Math.PI * 50;
  const gap = groups.length > 1 ? 4 : 0;
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("width", "112");
  svg.setAttribute("height", "112");
  svg.setAttribute("viewBox", "0 0 120 120");
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", groups.map((g) => `${g.category} ${t.money(g.monthly, currency)} (${Math.round(g.share * 100)}%)`).join(", "));
  let offset = 0;
  groups.forEach((g, i) => {
    const length = Math.max(0, g.share * circumference - gap);
    const c = document.createElementNS(ns, "circle");
    c.setAttribute("cx", "60");
    c.setAttribute("cy", "60");
    c.setAttribute("r", "50");
    c.setAttribute("fill", "none");
    c.setAttribute("stroke", RING_COLOURS[i % RING_COLOURS.length]);
    c.setAttribute("stroke-width", "7");
    c.setAttribute("stroke-dasharray", `${length.toFixed(1)} ${circumference.toFixed(2)}`);
    c.setAttribute("stroke-dashoffset", (-offset).toFixed(1));
    c.setAttribute("transform", "rotate(-90 60 60)");
    svg.append(c);
    offset += g.share * circumference;
  });

  const legend = groups.map((g, i) => {
    const dot = h("span", { class: "dot" });
    dot.style.background = RING_COLOURS[i % RING_COLOURS.length];
    return h(
      "div",
      { style: "display: flex; flex-direction: column; gap: 2px" },
      h("div", { class: "item-line" }, dot, h("span", { style: "flex-grow: 1" }, g.category), h("span", { class: "num strong" }, t.money(g.monthly, currency))),
      h("div", { class: "caption", style: "padding-left: 16px" }, `${t.plural(g.count, "subscription")} · ${Math.round(g.share * 100)}%`),
    );
  });

  return h(
    "section",
    { class: "section", style: "gap: 12px" },
    h("h2", { class: "label" }, "Where it goes"),
    h(
      "div",
      { class: "ring-wrap" },
      h(
        "div",
        { class: "ring" },
        svg,
        h("div", { class: "center" }, h("span", { class: "num", style: "font-size: 16px; font-weight: 700; letter-spacing: -0.02em" }, t.money(total, currency)), h("span", { class: "caption", style: "font-size: 11px" }, "a month")),
      ),
      h("div", { class: "legend" }, ...legend),
    ),
  );
}

