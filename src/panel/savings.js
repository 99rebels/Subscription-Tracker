// Side panel · Savings (docs/designs/PanelSavings.dc.html). Honest counting
// (product-plan §6): only cancellations made while using the extension, from
// the first charge each one avoided.
import { h } from "../ui/dom.js";
import { icon, logoTile } from "../ui/components.js";
import * as t from "../ui/text.js";
import { savings, worthReviewing } from "../lib/summary.js";

const UNIT = { weekly: ["week", "weeks"], monthly: ["month", "months"], yearly: ["year", "years"] };

export function renderSavings(state) {
  const { subscriptions: subs, today, settings, stats } = state;
  const currency = settings.currency;
  const s = savings(subs, today, { installedAt: state.installedAt, conv: state.conv });
  const header = h("header", { class: "back-header" }, h("a", { class: "back", href: "#overview" }, icon("chevronLeft", { size: 15 }), "Overview"));

  if (!s.items.length) return [header, h("main", { class: "content", style: "gap: 22px; padding-top: 20px" }, zeroState(subs, today, currency, state.conv), honestNote(s))];

  const startedMonth = s.since ? t.monthName(s.since.slice(0, 7)) : null;
  const head = h(
    "section",
    { style: "display: flex; flex-direction: column; gap: 4px" },
    h("h1", { class: "caption", style: "font-weight: 500" }, "You've saved"),
    h("div", { class: "figure" }, t.money(s.total, currency)),
    h(
      "div",
      { class: "muted", style: "font-size: 13px" },
      startedMonth ? `since you started in ${startedMonth}` : "so far",
      s.monthlyGrowth ? [" · growing ", h("span", { class: "strong" }, t.money(s.monthlyGrowth, currency)), " every month"] : null,
    ),
  );

  return [
    header,
    h("main", { class: "content", style: "gap: 22px; padding-top: 20px" }, head, chart(s.series, currency), cameFrom(s.items), alsoLookedAfter(s, stats), honestNote(s)),
  ];
}

// Running total at the end of each month; the current month in the accent.
function chart(series, currency) {
  if (series.length < 2) return null;
  const shown = series.slice(-12);
  const max = Math.max(...shown.map((p) => p.total)) || 1;
  const bars = shown.map((p, i) => {
    const bar = h("div", { style: "flex: 1 1 0; border-radius: 3px" });
    if (p.total <= 0) Object.assign(bar.style, { height: "3px", background: "var(--border)", borderRadius: "2px" });
    else Object.assign(bar.style, { height: `${Math.max(4, (p.total / max) * 100)}%`, background: i === shown.length - 1 ? "var(--accent)" : "var(--dim)" });
    return bar;
  });
  const labels = shown.map((p, i) => h("span", { style: `flex: 1 1 0; ${i === shown.length - 1 ? "color: var(--text); font-weight: 600" : ""}` }, t.monthName(p.month).slice(0, 3)));
  return h(
    "section",
    { style: "display: flex; flex-direction: column; gap: 6px" },
    h("div", { role: "img", "aria-label": `Total saved at the end of each month: ${shown.map((p) => `${t.monthName(p.month)} ${t.money(p.total, currency)}`).join(", ")}`, style: "display: flex; align-items: flex-end; gap: 6px; height: 96px" }, ...bars),
    h("div", { style: "display: flex; gap: 6px; font-size: 10px; color: var(--faint); text-align: center" }, ...labels),
  );
}

function cameFrom(items) {
  const rows = items.map((i) => {
    const sub = i.sub;
    let line;
    if (i.kind === "trial") line = `Stopped ${t.shortDate(sub.cancelledAt)}, before its first charge`;
    else if (!i.chargesAvoided) line = `Cancelled ${t.shortDate(sub.cancelledAt)} · first saving ${t.shortDate(sub.avoidedFrom)}`;
    else {
      const [one, many] = UNIT[sub.cycle] ?? UNIT.monthly;
      line = `Cancelled ${t.shortDate(sub.cancelledAt)} · ${t.money(Number(sub.price) || 0, sub.currency)} × ${i.chargesAvoided} ${i.chargesAvoided === 1 ? one : many}`;
    }
    return h(
      "a",
      { class: "row", href: `#sub/${sub.id}` },
      logoTile(sub),
      h("div", { class: "row-main" }, h("div", { class: "row-title" }, h("span", { class: "name" }, i.kind === "trial" ? `${t.displayName(sub)} trial` : t.displayName(sub))), h("div", { class: "row-sub", style: "white-space: normal" }, line)),
      h("span", { class: "num strong", style: "font-size: 13px" }, t.money(i.amount, sub.currency)),
    );
  });
  return h("section", { class: "section" }, h("h2", { class: "label" }, "Where it came from"), h("div", { class: "card" }, ...rows));
}

// "Surprise charges" from the design needs post-cancellation charge checks
// (backlog); until then the third tile counts trials stopped in time.
function alsoLookedAfter(s, stats) {
  const tile = (n, label) => h("div", { class: "card", style: "padding: 12px; display: flex; flex-direction: column; gap: 2px" }, h("span", { class: "num", style: "font-size: 22px; font-weight: 700" }, String(n)), h("span", { class: "caption", style: "line-height: 1.35" }, label));
  const trials = s.items.filter((i) => i.kind === "trial").length;
  return h(
    "section",
    { class: "section" },
    h("h2", { class: "label" }, "Also looked after"),
    h(
      "div",
      { style: "display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px" },
      tile(stats.remindersSent, stats.remindersSent === 1 ? "Renewal you saw coming" : "Renewals you saw coming"),
      tile(stats.priceRisesSpotted ?? 0, (stats.priceRisesSpotted ?? 0) === 1 ? "Price rise spotted" : "Price rises spotted"),
      tile(trials, trials === 1 ? "Trial stopped in time" : "Trials stopped in time"),
    ),
  );
}

function honestNote(s) {
  const names = s.beforeJoined.map((x) => x.name);
  let text = "We only count what you cancelled while using Subscription Check, from the date you cancelled.";
  if (names.length) text += ` ${t.joinAnd(names)}, cancelled before you joined, ${names.length === 1 ? "isn't" : "aren't"} included.`;
  return h("section", { style: "display: flex; gap: 10px; font-size: 12px; color: var(--muted); line-height: 1.5; padding: 12px 14px; border-radius: 12px; border: 1px solid var(--raised)" }, icon("info", { size: 14 }), h("span", {}, text));
}

// Before any cancellation: never show $0; show the opportunity (SavingsZero.dc.html).
function zeroState(subs, today, currency, conv) {
  const w = worthReviewing(subs, today, conv);
  const title = h("h1", { style: "font-size: 18px; font-weight: 700" }, "Nothing saved yet");
  if (!w.items.length) return h("section", { class: "placeholder" }, title, h("p", { class: "caption" }, "When you cancel something with Subscription Check, what you'd have paid adds up here every month."));
  return h(
    "section",
    { style: "display: flex; flex-direction: column; gap: 10px" },
    h("div", { class: "caption" }, "You could be saving"),
    h("div", { style: "display: flex; align-items: baseline; gap: 4px" }, h("span", { class: "figure" }, t.money(w.monthly, currency)), h("span", { class: "muted", style: "font-size: 15px" }, "/mo")),
    h("div", { class: "caption", style: "line-height: 1.45" }, `Going to ${t.plural(w.items.length, "subscription")} you haven't opened in 30+ days. That's ${t.money(w.yearly, currency)} a year.`),
    h("a", { class: "btn quiet md", href: "#subscriptions?filter=stale", style: "align-self: flex-start" }, "Review them"),
  );
}
