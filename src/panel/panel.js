// Side panel: header + tabs, hash routing, and re-rendering whenever stored
// data changes (from the background worker, the popup, or this page).
//
// Routes: #overview · #subscriptions · #subscriptions/calendar · #sub/<id>
//         #edit/<id> · #edit/new · #review · #scan (?start=1) · #settings · #savings

import { h } from "../ui/dom.js";
import { icon } from "../ui/components.js";
import { applyTheme } from "../ui/theme.js";
import { load, upsertSubscription, deleteSubscription } from "../lib/storage.js";
import { today } from "../lib/dates.js";
import { converter } from "../lib/fx.js";
import { renderOverview } from "./overview.js";
import { renderSubscriptions } from "./subscriptions.js";
import { renderDetail } from "./detail.js";
import { renderEdit } from "./edit.js";
import { renderSavings } from "./savings.js";
import { renderSettings } from "./settings.js";
import { renderReview } from "./review.js";
import { renderScan } from "./scan.js";

const app = document.getElementById("app");
let state = null;
let lastRoute = "";

function route() {
  const [path, query = ""] = location.hash.slice(1).split("?");
  const [view = "overview", arg = null] = path.split("/");
  return { view: view || "overview", arg, params: new URLSearchParams(query) };
}

export function navigate(hash) {
  if (location.hash === hash) render();
  else location.hash = hash;
}

// Actions shared by the views. Writes go to storage; the onChanged listener re-renders.
const actions = {
  navigate,
  save: (sub) => upsertSubscription(sub),
  remove: (id) => deleteSubscription(id),
  rerender: () => render(),
};

async function refresh() {
  const data = await load("subscriptions", "visits", "settings", "pending", "review", "sorted", "gmail", "fx", "installedAt", "stats");
  // conv adds totals up in the display currency (fx.js); single prices keep their own.
  state = { ...data, today: today(), conv: converter(data.settings.currency, data.fx) };
  render();
}

function header(reviewCount) {
  return [
    h(
      "header",
      { class: "panel-header" },
      h("div", { class: "brand" }, h("div", { class: "brand-mark" }, icon("check", { size: 12, stroke: 3 })), "Subscription Check"),
      h(
        "div",
        { class: "header-actions" },
        h("a", { class: "icon-btn", href: "#edit/new", "aria-label": "Add subscription", title: "Add subscription" }, icon("plus")),
        h("a", { class: "icon-btn", href: "#settings", "aria-label": "Settings", title: "Settings" }, icon("sliders", { stroke: 2 })),
      ),
    ),
    tabs(reviewCount),
  ];
}

function tabs(reviewCount) {
  const { view } = route();
  const tab = (name, label, extra) =>
    h("a", { href: `#${name}`, "aria-current": view === name ? "page" : null }, label, extra ?? null);
  return h(
    "nav",
    { class: "tabs", "aria-label": "Sections" },
    tab("overview", "Overview"),
    tab("subscriptions", "Subscriptions"),
    tab("review", "Review", reviewCount ? h("span", { class: "tag count" }, String(reviewCount)) : null),
  );
}

function render() {
  if (!state) return;
  const r = route();
  const key = location.hash;
  const previous = app.querySelector(".content");
  const scrollTop = key === lastRoute && previous ? previous.scrollTop : 0;
  lastRoute = key;

  const reviewCount = state.pending.length + state.review.length;
  let page;
  switch (r.view) {
    case "subscriptions":
      page = [...header(reviewCount), renderSubscriptions(state, actions, { calendar: r.arg === "calendar", filter: r.params.get("filter") })];
      break;
    case "sub":
      page = renderDetail(state, actions, r.arg);
      break;
    case "edit":
      page = renderEdit(state, actions, r.arg);
      break;
    case "review":
      page = [...header(reviewCount), renderReview(state)];
      break;
    case "scan":
      page = renderScan(state, actions, { start: r.params.get("start") === "1" });
      break;
    case "settings":
      page = renderSettings(state, actions);
      break;
    case "savings":
      page = renderSavings(state);
      break;
    default:
      page = [...header(reviewCount), renderOverview(state, actions)];
  }
  app.replaceChildren(...[].concat(page));
  const content = app.querySelector(".content");
  if (content) content.scrollTop = scrollTop;
}

window.addEventListener("hashchange", render);

// The popup and notifications ask the panel to show a screen via session storage.
async function takeNavigation(request) {
  if (!request || Date.now() - request.at > 10_000) return;
  await chrome.storage.session.remove("panelNavigate");
  navigate(request.hash);
}
chrome.storage.session.get("panelNavigate").then(({ panelNavigate }) => takeNavigation(panelNavigate));

let pendingRefresh = null;
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "session" && changes.panelNavigate?.newValue) takeNavigation(changes.panelNavigate.newValue);
  if (area !== "local") return;
  clearTimeout(pendingRefresh);
  pendingRefresh = setTimeout(refresh, 50);
});

// The date changes at midnight while the panel stays open.
setInterval(() => {
  if (state && state.today !== today()) refresh();
}, 60_000);

applyTheme();
refresh();
