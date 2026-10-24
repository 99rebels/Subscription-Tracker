// Side panel · Subscription detail (docs/designs/PanelDetail.dc.html)
import { h } from "../ui/dom.js";
import { icon, logoTile, confirmedTag, tag } from "../ui/components.js";
import * as t from "../ui/text.js";
import { priceHistory, savings } from "../lib/summary.js";
import { cancelSubscription, undoCancel, keepSubscription } from "../lib/model.js";
import { cancelRoute } from "../lib/cancel.js";
import { daysBetween } from "../lib/dates.js";
import { monthlyPrice } from "../lib/money.js";
import { buildICS, googleCalendarUrl } from "../lib/calendar.js";

// Per-page UI toggles that survive re-renders.
const ui = { showAllCharges: null, calendarOpen: null };

export function renderDetail(state, actions, id) {
  const sub = state.subscriptions.find((s) => s.id === id);
  const back = h(
    "a",
    {
      class: "back",
      href: "#subscriptions",
      onclick: (e) => {
        if (history.length > 1) {
          e.preventDefault();
          history.back();
        }
      },
    },
    icon("chevronLeft", { size: 15 }),
    "Back",
  );

  if (!sub) {
    return [h("header", { class: "back-header" }, back), h("main", { class: "content detail" }, h("div", { class: "empty" }, "This subscription isn't here any more."))];
  }

  const header = h("header", { class: "back-header" }, back, h("a", { class: "btn sm", href: `#edit/${sub.id}`, style: "height: 30px; border-color: var(--border)" }, "Edit"));
  const cancelled = sub.status === "cancelled";

  return [
    header,
    h(
      "main",
      { class: "content detail" },
      top(sub),
      cancelled ? cancelledCard(sub, state, actions) : null,
      keepCard(sub, state, actions),
      cancelled ? null : scheduleCard(sub, state, actions),
      priceHistorySection(sub, actions),
      cancelled ? null : cancelSection(sub, state, actions),
    ),
  ];
}

// ---------------------------------------------------------------------------

function top(sub) {
  const domain = sub.domains?.[0];
  const subtitle = [sub.plan, domain].filter(Boolean).join(" · ") || t.cycleName(sub.cycle);
  const trial = sub.status === "trial";
  const price = Number(sub.price) || 0;

  let figure;
  let caption;
  if (trial) {
    figure = [h("span", { class: "big" }, "Free trial")];
    caption = price ? `Then ${t.pricePerCycle(sub)} from ${t.shortDate(sub.nextRenewal)}` : `Ends ${t.shortDate(sub.nextRenewal)}`;
  } else {
    figure = [h("span", { class: "big" }, t.money(price, sub.currency)), h("span", { class: "muted", style: "font-size: 14px" }, t.cycleUnit(sub.cycle))];
    caption = sub.cycle === "yearly" ? `${t.money(monthlyPrice(sub), sub.currency)} a month` : `${t.money(monthlyPrice(sub) * 12, sub.currency)} a year`;
  }

  let badge = null;
  if (sub.status === "cancelled") badge = tag("cancelled", "Cancelled");
  else if (sub.confirmedByReceipt) badge = confirmedTag();

  return h(
    "section",
    { style: "display: flex; flex-direction: column; gap: 14px" },
    h("div", { class: "detail-head" }, logoTile(sub, { size: 48 }), h("div", { style: "min-width: 0" }, h("h1", { class: "ellipsis" }, sub.name), h("div", { class: "caption ellipsis" }, subtitle))),
    h(
      "div",
      { class: "detail-price" },
      h("div", {}, h("div", { style: "display: flex; align-items: baseline; gap: 4px" }, ...figure), h("div", { class: "caption" }, caption)),
      badge,
    ),
  );
}

function cancelledCard(sub, state, actions) {
  const item = savings([sub], state.today).items[0];
  const lines = [h("div", { class: "strong" }, t.cancelledText(sub))];
  if (sub.cancelConfirmedByEmail) lines.push(h("div", { class: "caption", style: "display: flex; align-items: center; gap: 6px" }, icon("check", { size: 12, stroke: 2.6 }), `Confirmed by email, ${t.shortDate(sub.cancelConfirmedByEmail)}`));
  if (item && item.amount > 0) {
    lines.push(h("div", { class: "caption" }, `Saved ${t.money(item.amount, sub.currency)} so far (${t.plural(item.chargesAvoided, "charge")} you didn't pay).`));
  } else if (item) {
    lines.push(h("div", { class: "caption" }, sub.avoidedFrom ? `Your first saving comes on ${t.shortDate(sub.avoidedFrom)}, when it would have charged.` : "Savings start from its next charge date."));
  } else {
    lines.push(h("div", { class: "caption" }, "Cancelled before you started using Subscription Check, so it isn't counted in your savings."));
  }
  return h(
    "section",
    { class: "card card-pad", style: "gap: 8px" },
    ...lines,
    h("div", {}, h("button", { class: "btn sm", onclick: () => actions.save(undoCancel(sub)) }, "Still paying? Undo")),
  );
}

// "Still using it?" We can't see usage (phones, TVs, things you'd never
// visit), so we ask, and don't ask again for a few months after a yes.
function keepCard(sub, state, actions) {
  const k = t.keepStatus(sub, state.today);
  if (!k?.ask || sub.cancelStartedAt) return null;
  const yearly = t.money(monthlyPrice(sub) * 12, sub.currency);
  return h(
    "section",
    { class: "card card-pad", style: "gap: 10px" },
    h("h2", { style: "font-size: 15px; font-weight: 600" }, "Still using it?"),
    h("div", { class: "caption", style: "line-height: 1.45" }, `${sub.name} costs you ${yearly} a year. `, k.detail ?? "Tell us and we'll stop asking for a few months."),
    h(
      "div",
      { class: "btn-row" },
      h("button", { class: "btn primary md", onclick: () => actions.save(keepSubscription(sub, state.today)) }, "Yes, keep it"),
      h("button", { class: "btn md", onclick: () => document.getElementById("cancel")?.scrollIntoView({ behavior: "smooth", block: "start" }) }, "No, show me how to cancel"),
    ),
  );
}

function scheduleCard(sub, state, actions) {
  const { today, settings } = state;
  const trial = sub.status === "trial";
  const rows = [];

  if (sub.nextRenewal) {
    rows.push(h("div", { class: "kv" }, h("span", {}, trial ? "Trial ends" : "Next charge"), h("span", {}, `${t.shortDate(sub.nextRenewal)} · ${t.inDays(daysBetween(today, sub.nextRenewal))}`)));

    const current = sub.reminderDays ?? (trial ? settings.trialReminderDays : settings.reminderDays);
    const options = [...new Set([1, 3, 7, current])].sort((a, b) => a - b);
    const select = h(
      "select",
      { class: "select sm", id: "reminder" },
      ...options.map((n) => h("option", { value: n, selected: n === current ? "" : null }, n === 0 ? "On the day" : `${t.plural(n, "day")} before`)),
    );
    select.addEventListener("change", () => actions.save({ ...sub, reminderDays: Number(select.value), notifiedFor: null }));
    rows.push(h("div", { class: "kv", style: "padding-top: 8px; padding-bottom: 8px" }, h("label", { for: "reminder" }, "Remind me"), select));
  }

  rows.push(h("div", { class: "kv" }, h("span", {}, "Billing"), h("span", {}, t.billingText(sub))));

  const k = t.keepStatus(sub, today);
  if (k && !k.ask) rows.push(h("div", { class: "kv" }, h("span", {}, "Still using it"), h("span", { title: k.detail }, `You said yes, ${t.shortDate(sub.keptAt)}`)));

  if (sub.nextRenewal) {
    const open = ui.calendarOpen === sub.id;
    rows.push(
      h(
        "button",
        {
          class: "kv link",
          "aria-expanded": String(open),
          onclick: () => {
            ui.calendarOpen = open ? null : sub.id;
            actions.rerender();
          },
        },
        h("span", {}, "Add to calendar"),
        icon(open ? "chevronDown" : "chevronRight", { size: 14 }),
      ),
    );
    if (open) {
      rows.push(
        h(
          "div",
          { class: "kv", style: "gap: 8px" },
          h("a", { class: "btn sm", href: googleCalendarUrl(sub), target: "_blank", rel: "noopener" }, "Google Calendar"),
          h("button", { class: "btn sm", onclick: () => downloadICS(sub) }, "Apple / Outlook (.ics)"),
        ),
      );
    }
  }

  return h("section", { class: "card" }, ...rows);
}

function downloadICS(sub) {
  const blob = new Blob([buildICS(sub)], { type: "text/calendar" });
  const url = URL.createObjectURL(blob);
  const a = h("a", { href: url, download: `${sub.name.replace(/[^\w]+/g, "-").toLowerCase()}-renewal.ics` });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function priceHistorySection(sub, actions) {
  const history = priceHistory(sub);
  if (!history.charges.length) return null;
  const all = ui.showAllCharges === sub.id;
  const shown = all ? history.charges : history.charges.slice(0, 5);
  const changeByDate = new Map(history.changes.map((c) => [c.date, c]));
  const latestChange = history.changes.at(-1)?.date ?? "";
  const rise = history.latestRise;

  return h(
    "section",
    { class: "section" },
    h("h2", { class: "label" }, "Price history"),
    rise
      ? h(
          "div",
          { class: "note attention" },
          icon("arrowUp", { size: 14, stroke: 2.4 }),
          `Went up from ${t.money(rise.from, sub.currency)} to ${t.money(rise.to, sub.currency)} in ${t.monthName(rise.date.slice(0, 7))} (+${Math.round(rise.change * 100)}%)`,
        )
      : null,
    h(
      "div",
      { class: "lines" },
      ...shown.map((c) =>
        h(
          "div",
          {},
          h("span", { class: "muted" }, t.shortDate(c.date)),
          h(
            "span",
            { class: `num${c.date < latestChange ? " muted" : ""}` },
            t.money(c.amount, c.currency ?? sub.currency),
            changeByDate.has(c.date) ? h("span", { class: "attention" }, changeByDate.get(c.date).to > changeByDate.get(c.date).from ? " ↑" : " ↓") : null,
          ),
        ),
      ),
    ),
    history.charges.length > 5
      ? h(
          "a",
          {
            href: "#",
            style: "font-size: 12px; font-weight: 500",
            onclick: (e) => {
              e.preventDefault();
              ui.showAllCharges = all ? null : sub.id;
              actions.rerender();
            },
          },
          all ? "Show fewer" : `Show all ${history.charges.length} charges`,
        )
      : null,
  );
}

function cancelSection(sub, state, actions) {
  const route = cancelRoute(sub);
  const name = t.displayName(sub);
  const fromReceipts = sub.source === "gmail" || sub.confirmedByReceipt;

  let where;
  if (route.via) where = `Your receipts come from ${route.viaName}, so cancel in your ${route.viaName} account rather than on ${sub.name}'s site.`;
  else if (fromReceipts) where = `Your receipts come from ${sub.name} directly, so cancel on their site. If you'd signed up through Apple, Google Play or Amazon, we'd point you there instead.`;
  else where = `Cancel on ${sub.name}'s site. If you signed up through Apple, Google Play or Amazon, cancel there instead.`;

  const startCancel = (e) => {
    e.preventDefault();
    if (route.url) chrome.tabs.create({ url: route.url });
    actions.save({ ...sub, cancelStartedAt: state.today });
  };

  const parts = [
    h("h2", { class: "label" }, "How to cancel"),
    h(
      "ol",
      { class: "steps" },
      h("li", {}, "Sign in and open your account, usually under your profile picture or name"),
      h("li", {}, "Look for ", h("b", {}, "Subscription"), ", ", h("b", {}, "Plan"), ", ", h("b", {}, "Billing"), " or ", h("b", {}, "Membership")),
      h("li", {}, "Choose ", h("b", {}, "Cancel"), " and confirm. ", h("span", { class: "muted" }, "You may be offered a discount first; you can say no.")),
    ),
    h("div", { class: "note" }, icon("info", { size: 14 }), where),
  ];

  if (sub.cancelStartedAt) {
    parts.push(
      h(
        "div",
        { class: "card card-pad", style: "gap: 10px; margin-top: 4px" },
        h("div", { class: "strong" }, `Did you cancel ${name}?`),
        h("div", { class: "caption" }, state.gmail?.connected ? "We'll confirm it when the cancellation email arrives, or mark it now." : "Mark it here so your totals and savings stay right."),
        h(
          "div",
          { class: "btn-row" },
          h("button", { class: "btn primary md", onclick: () => actions.save(cancelSubscription({ ...sub, cancelStartedAt: null }, state.today)) }, "Yes, it's cancelled"),
          h("button", { class: "btn md", onclick: () => actions.save({ ...sub, cancelStartedAt: null }) }, "Not yet"),
        ),
      ),
    );
    if (route.url) parts.push(h("a", { href: route.url, target: "_blank", rel: "noopener", class: "center-note", style: "display: block" }, `Open ${route.viaName ?? sub.name} again`));
  } else {
    parts.push(
      h(
        "a",
        { class: "btn cancel lg block", href: route.url ?? "#", style: "margin-top: 4px", onclick: startCancel },
        sub.status === "trial" ? `Cancel ${sub.name} trial` : `Cancel ${sub.name}`,
        icon("external", { size: 14 }),
      ),
      h(
        "div",
        { class: "center-note" },
        !route.url ? "We don't know their website yet; add it with Edit." : state.gmail?.connected ? "We'll watch for the cancellation email and let you know it worked." : "Opens their site in a new tab. Come back here to mark it cancelled.",
      ),
    );
  }

  return h("section", { class: "section", id: "cancel", style: "gap: 10px; padding-top: 4px; scroll-margin-top: 12px" }, ...parts);
}
