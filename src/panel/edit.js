// Side panel · Add / edit a subscription. Manual entry is the fallback (most come
// from Gmail or checkout detection), so this is a plain form built from the
// shared components; there's no board for it yet.
import { h } from "../ui/dom.js";
import { icon } from "../ui/components.js";
import { CATEGORIES } from "../lib/model.js";
import { newId } from "../lib/storage.js";
import { registrableDomain } from "../lib/services.js";
import { nextRenewalOnOrAfter, parseISODate, addMonths } from "../lib/dates.js";

const CURRENCIES = ["USD", "EUR", "GBP", "CAD", "AUD"];

function websiteToDomain(value) {
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed.includes("://") ? trimmed : `https://${trimmed}`);
    return registrableDomain(url.hostname);
  } catch {
    return null;
  }
}

export function renderEdit(state, actions, id) {
  const isNew = id === "new";
  const existing = isNew ? null : state.subscriptions.find((s) => s.id === id);
  const back = h("a", { class: "back", href: isNew ? "#overview" : `#sub/${id}` }, icon("chevronLeft", { size: 15 }), isNew ? "Cancel" : "Back");

  if (!isNew && !existing) {
    return [h("header", { class: "back-header" }, back), h("main", { class: "content detail" }, h("div", { class: "empty" }, "This subscription isn't here any more."))];
  }

  const sub = existing ?? { name: "", plan: "", domains: [], price: "", currency: state.settings.currency, cycle: "monthly", status: "active", nextRenewal: addMonths(state.today, 1), category: "", cancelUrl: "" };
  const field = (label, control, hint) => h("label", { class: "field" }, label, control, hint ? h("span", { class: "faint" }, hint) : null);
  const input = (name, attrs = {}) => h("input", { class: "input", name, ...attrs });
  const select = (name, options, value) => h("select", { class: "select", name }, ...options.map(([v, label]) => h("option", { value: v, selected: v === value ? "" : null }, label)));

  const trialBox = h("input", { type: "checkbox", name: "trial", checked: sub.status === "trial" });
  const dateLabel = h("span", {}, sub.status === "trial" ? "Trial ends" : "Next charge");
  trialBox.addEventListener("change", () => (dateLabel.textContent = trialBox.checked ? "Trial ends" : "Next charge"));

  const error = h("div", { class: "caption cancel-text", role: "alert" });

  const form = h(
    "form",
    { class: "form", novalidate: "" },
    field("Name", input("name", { value: sub.name, required: "", placeholder: "Netflix", autocomplete: "off" })),
    field("Plan", input("plan", { value: sub.plan ?? "", placeholder: "Optional, e.g. Premium" })),
    field("Website", input("website", { value: sub.domains?.[0] ?? "", placeholder: "netflix.com" }), "Used to see when you last visited"),
    h(
      "div",
      { class: "pair" },
      field("Price", input("price", { value: sub.price, type: "number", min: "0", step: "0.01", inputmode: "decimal", placeholder: "0.00" })),
      field("Currency", select("currency", CURRENCIES.map((c) => [c, c]), sub.currency)),
    ),
    h(
      "div",
      { class: "pair" },
      field("Billing", select("cycle", [["monthly", "Monthly"], ["yearly", "Yearly"], ["weekly", "Weekly"]], sub.cycle)),
      h("label", { class: "field" }, dateLabel, input("date", { type: "date", value: sub.nextRenewal ?? "", required: "" })),
    ),
    h("label", { class: "check" }, trialBox, "This is a free trial"),
    field("Category", select("category", [["", "Automatic"], ...CATEGORIES.map((c) => [c, c])], sub.category && existing ? sub.category : "")),
    field("Cancel link", input("cancelUrl", { value: sub.cancelUrl ?? "", type: "url", placeholder: "Optional: the account or billing page" })),
    error,
    h("div", { class: "btn-row" }, h("button", { class: "btn primary", type: "submit" }, isNew ? "Add subscription" : "Save")),
  );

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = form.elements;
    const name = f.name.value.trim();
    const price = f.price.value === "" ? "" : Number(f.price.value);
    const date = f.date.value;
    if (!name) return (error.textContent = "Add a name.");
    if (price !== "" && !(price >= 0)) return (error.textContent = "The price should be a number.");
    if (!date) return (error.textContent = "Add the date of the next charge.");

    const cycle = f.cycle.value;
    const dateChanged = !existing || existing.nextRenewal !== date || existing.cycle !== cycle;
    const anchorDay = dateChanged ? parseISODate(date).getDate() : existing.anchorDay;
    const domain = websiteToDomain(f.website.value);
    const domains = domain ? [domain] : [];
    const priceChanged = !existing || Number(existing.price) !== Number(price);

    const updated = {
      ...(existing ?? { id: newId(), createdAt: Date.now(), source: "manual", startedAt: state.today, lastUsed: null }),
      name,
      plan: f.plan.value.trim(),
      domains,
      price,
      currency: f.currency.value,
      cycle,
      anchorDay,
      nextRenewal: nextRenewalOnOrAfter(date, cycle, anchorDay, state.today),
      status: existing?.status === "cancelled" ? "cancelled" : trialBox.checked ? "trial" : "active",
      category: f.category.value,
      cancelUrl: f.cancelUrl.value.trim(),
    };
    if (dateChanged) updated.notifiedFor = null;
    if (priceChanged) Object.assign(updated, { priceSource: "manual", confirmedByReceipt: false });
    if (!existing || existing.domains?.join() !== domains.join()) updated.usageBackfilled = false;

    await actions.save(updated);
    location.replace(`#sub/${updated.id}`);
  });

  const parts = [h("h1", { style: "font-size: 18px; font-weight: 700" }, isNew ? "Add a subscription" : `Edit ${sub.name}`), form];
  if (existing) {
    parts.push(
      h(
        "button",
        {
          class: "btn ghost",
          style: "color: var(--cancel)",
          onclick: async () => {
            if (!confirm(`Remove ${existing.name} from Subscription Check? This doesn't cancel it with ${existing.name}.`)) return;
            await actions.remove(existing.id);
            location.replace("#subscriptions");
          },
        },
        "Remove from Subscription Check",
      ),
    );
  }
  return [h("header", { class: "back-header" }, back), h("main", { class: "content detail" }, ...parts)];
}
