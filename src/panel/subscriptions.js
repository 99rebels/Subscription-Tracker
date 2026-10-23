// Side panel · Subscriptions, with a List / Calendar toggle
// (docs/designs/PanelList.dc.html, PanelCalendar.dc.html)
import { h } from "../ui/dom.js";
import { icon, logoTile, subscriptionRow, usageSpan } from "../ui/components.js";
import * as t from "../ui/text.js";
import { isCurrent, isStale, totals, month as monthOf, savings } from "../lib/summary.js";
import { addMonthsToKey, parseISODate, addDays } from "../lib/dates.js";

// View state that survives re-renders (search text, sort, calendar month).
// selected: a date, null (pick the next charge day), or "none" (user closed the card).
const ui = { query: "", sort: "renewal", month: null, selected: null };

const FILTERS = [
  ["all", "All", () => true],
  ["monthly", "Monthly", (s) => s.status !== "trial" && s.cycle === "monthly"],
  ["yearly", "Yearly", (s) => s.status !== "trial" && s.cycle === "yearly"],
  ["weekly", "Weekly", (s) => s.status !== "trial" && s.cycle === "weekly"],
  ["trials", "Trials", (s) => s.status === "trial"],
  ["stale", "Not visited", (s, today) => isStale(s, today)],
];

// Each sort takes the currency converter so "Price" compares like with like.
const SORTS = {
  renewal: ["Next renewal", () => (a, b) => (a.nextRenewal ?? "9999").localeCompare(b.nextRenewal ?? "9999")],
  price: ["Price", (conv) => (a, b) => conv.monthly(b) - conv.monthly(a) || Number(b.price) - Number(a.price)],
  name: ["Name", () => (a, b) => a.name.localeCompare(b.name)],
  visit: ["Last visit", () => (a, b) => (a.lastUsed ?? 0) - (b.lastUsed ?? 0)],
};

export function renderSubscriptions(state, actions, { calendar = false, filter = null }) {
  const toggle = h(
    "div",
    { class: "segmented", role: "group", "aria-label": "View" },
    h("a", { href: "#subscriptions", "aria-current": calendar ? null : "page" }, icon("list", { size: 13 }), "List"),
    h("a", { href: "#subscriptions/calendar", "aria-current": calendar ? "page" : null }, icon("calendar", { size: 13 }), "Calendar"),
  );
  const body = calendar ? calendarView(state, actions) : listView(state, filter ?? "all");
  return h("main", { class: "content tight" }, toggle, ...body);
}

// ---------------------------------------------------------------------------
// List

function listView(state, filterKey) {
  const { subscriptions: subs, today, settings } = state;
  const current = subs.filter(isCurrent);
  if (!subs.length) {
    return [h("div", { class: "empty" }, "No subscriptions yet.", h("div", { style: "margin-top: 12px" }, h("a", { class: "btn quiet md", href: "#edit/new" }, icon("plus", { size: 14 }), "Add one")))];
  }

  const chips = FILTERS.filter(([key, , test]) => key === "all" || current.some((s) => test(s, today))).map(([key, label, test]) => {
    const count = current.filter((s) => test(s, today)).length;
    return h("a", { class: "filter", role: "button", "aria-pressed": String(key === filterKey), href: key === "all" ? "#subscriptions" : `#subscriptions?filter=${key}`, style: "display: inline-flex; align-items: center" }, `${label} ${count}`);
  });

  const results = h("div", { style: "display: flex; flex-direction: column; gap: 14px" });
  const renderResults = () => results.replaceChildren(...listResults(state, filterKey));

  const search = h("input", { type: "search", placeholder: "Search", "aria-label": "Search subscriptions", value: ui.query });
  search.addEventListener("input", () => {
    ui.query = search.value;
    renderResults();
  });
  const sort = h("select", { class: "select", "aria-label": "Sort by", style: "width: auto; font-size: 12px; font-weight: 500" }, ...Object.entries(SORTS).map(([key, [label]]) => h("option", { value: key, selected: key === ui.sort ? "" : null }, label)));
  sort.addEventListener("change", () => {
    ui.sort = sort.value;
    renderResults();
  });

  renderResults();
  return [h("div", { class: "list-tools" }, h("label", { class: "search" }, icon("search", { size: 15 }), search), sort), h("div", { class: "filters" }, ...chips), results];

  function listResults() {
    const test = (FILTERS.find(([key]) => key === filterKey) ?? FILTERS[0])[2];
    const q = ui.query.trim().toLowerCase();
    const matches = (s) => !q || s.name.toLowerCase().includes(q) || (s.plan ?? "").toLowerCase().includes(q) || s.domains.some((d) => d.includes(q));
    const shown = current.filter((s) => test(s, today) && matches(s)).sort(SORTS[ui.sort][1](state.conv));
    const sum = totals(shown, state.conv);
    const currency = settings.currency;

    const out = [
      h("div", { class: "summary-line" }, h("span", {}, t.plural(shown.length, "subscription")), h("span", { class: "num" }, `${t.money(sum.monthly, currency)}/mo · ${t.moneyWhole(sum.yearly, currency)}/yr`)),
      shown.length ? h("div", { class: "card" }, ...shown.map((s) => subscriptionRow(s, today))) : h("div", { class: "empty" }, q ? `Nothing matches "${ui.query}".` : "Nothing here."),
    ];

    const cancelled = subs.filter((s) => s.status === "cancelled" && matches(s)).sort((a, b) => (b.cancelledAt ?? "").localeCompare(a.cancelledAt ?? ""));
    if (filterKey === "all" && cancelled.length) {
      const saving = savings(subs, today, { conv: state.conv }).monthlyGrowth;
      out.push(
        h(
          "section",
          { class: "section", style: "margin-top: 8px" },
          h(
            "div",
            { class: "section-head", style: "padding: 0 2px" },
            h("h2", { class: "muted" }, `Cancelled · ${cancelled.length}`),
            saving ? h("span", { class: "caption", style: "display: flex; align-items: center; gap: 5px" }, icon("check", { size: 12, stroke: 2.6 }), `Saving ${t.money(saving, currency)}/mo`) : null,
          ),
          h(
            "div",
            { class: "cancelled-list" },
            ...cancelled.map((s) =>
              h(
                "a",
                { class: "row compact", href: `#sub/${s.id}` },
                logoTile(s, { size: 28, muted: true }),
                h("div", { class: "row-main" }, h("div", { class: "row-title muted", style: "font-weight: 400" }, h("span", { class: "name" }, t.displayName(s))), h("div", { class: "row-sub faint" }, t.cancelledText(s))),
                h("span", { class: "price" }, t.money(Number(s.price) || 0, s.currency)),
              ),
            ),
          ),
        ),
      );
    }
    return out;
  }
}

// ---------------------------------------------------------------------------
// Calendar

function calendarView(state, actions) {
  const { subscriptions: subs, today, settings } = state;
  const thisMonth = today.slice(0, 7);
  if (!ui.month || ui.month < thisMonth) ui.month = thisMonth;
  const key = ui.month;
  const m = monthOf(subs, key, state.conv);
  const sure = m.charges.filter((c) => !c.trial);
  const sureTotal = sure.reduce((a, c) => a + state.conv.amount(c.amount, c.sub.currency), 0);

  const byDay = new Map();
  for (const c of m.charges) {
    if (!byDay.has(c.date)) byDay.set(c.date, []);
    byDay.get(c.date).push(c);
  }
  if (ui.selected !== "none" && !byDay.has(ui.selected)) {
    const days = [...byDay.keys()];
    ui.selected = days.find((d) => d >= today) ?? days[0] ?? null;
  }

  const go = (delta) => {
    ui.month = addMonthsToKey(key, delta);
    ui.selected = null;
    actions.rerender();
  };
  const prev = h("button", { class: "icon-btn bordered", "aria-label": "Previous month", disabled: key <= thisMonth ? "" : null, onclick: () => go(-1) }, icon("chevronLeft", { size: 14, stroke: 2.4 }));
  const next = h("button", { class: "icon-btn bordered", "aria-label": "Next month", onclick: () => go(1) }, icon("chevronRight", { size: 14, stroke: 2.4 }));
  if (key <= thisMonth) prev.style.opacity = "0.4";

  const currency = settings.currency;
  const head = h(
    "section",
    { class: "cal-head" },
    h("div", {}, h("h1", {}, t.monthYear(key)), h("div", { class: "caption num" }, `${t.money(sureTotal, currency)} due · ${t.plural(sure.length, "charge")}`)),
    h("div", { style: "display: flex; gap: 4px" }, prev, next),
  );

  // Grid: weeks start on Monday.
  const first = parseISODate(`${key}-01`);
  const lead = (first.getDay() + 6) % 7;
  const start = addDays(`${key}-01`, -lead);
  const cells = [];
  for (let i = 0; ; i++) {
    const date = addDays(start, i);
    if (i >= 28 && i % 7 === 0 && date.slice(0, 7) !== key) break;
    cells.push(date);
  }
  const grid = h(
    "div",
    { class: "cal-grid" },
    ...["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => h("span", { class: "cal-dow" }, d)),
    ...cells.map((date) => {
      const inMonth = date.startsWith(key);
      const charges = inMonth ? byDay.get(date) ?? [] : [];
      const classes = ["cal-day", inMonth ? "" : "outside", charges.length ? "has-charge" : "", date === ui.selected ? "selected" : "", date === today ? "today" : ""].filter(Boolean).join(" ");
      const label = charges.length ? `${t.longDay(date)}: ${charges.map((c) => `${c.sub.name} ${t.money(c.amount, c.sub.currency)}`).join(", ")}` : t.longDay(date);
      const cell = h(
        charges.length ? "button" : "div",
        { class: classes, "aria-label": label, "aria-pressed": charges.length ? String(date === ui.selected) : null },
        h("span", { class: "n" }, String(parseISODate(date).getDate())),
        charges.length ? logoTile(charges[0].sub, { size: 20, dashed: charges[0].trial }) : null,
      );
      if (charges.length > 1) cell.append(h("span", { class: "more" }, `+${charges.length - 1}`));
      if (charges.length) {
        cell.addEventListener("click", () => {
          ui.selected = date;
          actions.rerender();
        });
      }
      return cell;
    }),
  );

  const selectedCard = byDay.has(ui.selected) ? dayCard(ui.selected, byDay.get(ui.selected), today, actions) : null;

  const all = h(
    "section",
    { class: "section", style: "gap: 0" },
    h("h2", { class: "label", style: "margin-bottom: 6px" }, "All charges this month"),
    m.charges.length
      ? h(
          "div",
          { class: "lines" },
          ...m.charges.map((c) =>
            h(
              "a",
              { href: `#sub/${c.sub.id}`, style: `color: ${c.trial ? "var(--muted)" : "var(--text)"}` },
              h("span", { class: "ellipsis" }, h("span", { class: "muted", style: "display: inline-block; width: 52px" }, t.shortDate(c.date)), c.trial ? `${t.displayName(c.sub)}, if you keep it` : t.displayName(c.sub)),
              h("span", { class: "num" }, t.money(c.amount, c.sub.currency)),
            ),
          ),
        )
      : h("div", { class: "caption", style: "padding: 8px 2px" }, "No charges expected this month."),
  );

  return [head, h("section", { style: "display: flex; flex-direction: column; gap: 4px" }, grid), selectedCard, all];
}

function dayCard(date, charges, today, actions) {
  return h(
    "section",
    { class: "card card-pad", style: "padding: 12px; gap: 10px" },
    h("div", { class: "label muted" }, t.longDay(date)),
    ...charges.map((c) => {
      const s = c.sub;
      const kind = c.trial ? "Trial ends" : t.cycleName(s.cycle);
      const sub = s.domains?.length && !c.trial ? [kind, " · ", usageSpan(s, today)] : [kind];
      return h(
        "div",
        { style: "display: flex; flex-direction: column; gap: 10px" },
        h(
          "a",
          { href: `#sub/${s.id}`, style: "display: flex; align-items: center; gap: 10px; color: var(--text)" },
          logoTile(s),
          h("div", { class: "row-main" }, h("div", { class: "row-title" }, h("span", { class: "name" }, t.displayName(s))), h("div", { class: "row-sub" }, ...sub)),
          h("span", { class: "num", style: "font-size: 15px; font-weight: 700" }, t.money(c.amount, s.currency)),
        ),
        h(
          "div",
          { class: "btn-row" },
          h("a", { class: "btn cancel md", href: `#sub/${s.id}` }, `Cancel before ${t.shortDate(date)}`),
          h(
            "button",
            {
              class: "btn md",
              onclick: () => {
                ui.selected = "none";
                actions.rerender();
              },
            },
            "Keep it",
          ),
        ),
      );
    }),
  );
}
