// Side panel · Settings (docs/designs/PanelSettings.dc.html).
import { h } from "../ui/dom.js";
import { icon, toggle } from "../ui/components.js";
import * as t from "../ui/text.js";
import { load, save, updateBadge, DEFAULT_SETTINGS } from "../lib/storage.js";
import { disconnect } from "../lib/gmail.js";
import { clearCache } from "../lib/mail-cache.js";
import { buildICS } from "../lib/calendar.js";
import { toCSV, toBackup, parseBackup } from "../lib/backup.js";
import { loadServices } from "../lib/services.js";
import { today } from "../lib/dates.js";
import { SCHEMA_VERSION } from "../lib/model.js";

const CURRENCIES = [
  ["USD", "USD $"],
  ["EUR", "EUR €"],
  ["GBP", "GBP £"],
  ["CAD", "CAD $"],
  ["AUD", "AUD $"],
];
const SYMBOLS = { USD: "$", EUR: "€", GBP: "£", CAD: "$", AUD: "$" };

// Which export choice is open (survives re-renders).
const ui = { exportOpen: false, message: null };

async function setSetting(key, value) {
  const { settings } = await load("settings");
  await save({ settings: { ...settings, [key]: value } });
}

function download(filename, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = h("a", { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const section = (title, ...children) => h("section", { class: "section" }, h("h2", { class: "label muted" }, title), ...children);
const line = (title, sub) => h("div", { style: "min-width: 0" }, h("div", { style: "font-size: 13px" }, title), sub ? h("div", { class: "caption" }, sub) : null);
const kv = (...children) => h("div", { class: "kv", style: "color: var(--text)" }, ...children);

export function renderSettings(state, actions) {
  const { settings, gmail } = state;
  const header = h(
    "header",
    { class: "back-header", style: "justify-content: flex-start; gap: 4px" },
    h("a", { class: "icon-btn", href: "#overview", "aria-label": "Back" }, icon("chevronLeft")),
    h("h1", { style: "font-size: 15px; font-weight: 600" }, "Settings"),
  );

  // Budget
  const budgetInput = h("input", {
    id: "budget",
    value: settings.budget ?? "",
    inputmode: "decimal",
    placeholder: "None",
    "aria-label": "Monthly budget",
    style: "width: 56px; border: none; outline: none; background: transparent; color: var(--text); font-size: 13px; font-weight: 600; font-variant-numeric: tabular-nums; text-align: right",
  });
  budgetInput.addEventListener("change", () => {
    const value = budgetInput.value.trim() === "" ? null : Number(budgetInput.value.replace(/[^\d.]/g, ""));
    setSetting("budget", value > 0 ? value : null);
  });
  const budget = section(
    "Budget",
    h(
      "div",
      { class: "card" },
      kv(
        h("label", { for: "budget", style: "font-size: 13px; color: var(--text)" }, "Monthly budget"),
        h("div", { style: "display: flex; align-items: center; gap: 4px; height: 32px; padding: 0 10px; border-radius: 8px; background: var(--raised); border: 1px solid var(--border)" }, h("span", { class: "muted" }, SYMBOLS[settings.currency] ?? ""), budgetInput),
      ),
      kv(line("Suggest what to cut", "When you go over, based on what you use least"), toggle(settings.suggestCuts, "Suggest what to cut", (v) => setSetting("suggestCuts", v))),
    ),
  );

  // Reminders
  const daysSelect = (id, value, key) => {
    const select = h("select", { class: "select sm", id }, ...[1, 3, 7].map((n) => h("option", { value: n, selected: n === value ? "" : null }, t.plural(n, "day"))));
    select.addEventListener("change", () => setSetting(key, Number(select.value)));
    return select;
  };
  const reminders = section(
    "Reminders",
    h(
      "div",
      { class: "card" },
      kv(h("label", { for: "renewal-reminder" }, "Before renewals"), daysSelect("renewal-reminder", settings.reminderDays, "reminderDays")),
      kv(h("label", { for: "trial-reminder" }, "Before free trials end"), daysSelect("trial-reminder", settings.trialReminderDays, "trialReminderDays")),
      kv(line("Monthly check-in", "What's coming up and what's worth reviewing"), toggle(settings.monthlyCheckIn, "Monthly check-in", (v) => setSetting("monthlyCheckIn", v))),
      h(
        "button",
        {
          class: "kv link",
          onclick: () => download("subscription-renewals.ics", buildICS(state.subscriptions), "text/calendar"),
        },
        line("Add all renewals to your calendar", "Reminders even when Chrome is closed"),
        icon("download", { size: 14 }),
      ),
    ),
  );

  // Finding subscriptions
  let gmailRow;
  if (gmail.connected) {
    gmailRow = kv(
      h("div", { style: "display: flex; align-items: center; gap: 10px; min-width: 0" }, mailTile(), line(gmail.needsSignIn ? "Gmail needs you to sign in again" : "Gmail connected", `Read-only · checked ${t.ago(gmail.lastCheckedAt ?? gmail.lastScanAt)}`)),
      h(
        "button",
        {
          class: "btn sm",
          onclick: async () => {
            if (!confirm("Disconnect Gmail? New receipts won't be picked up. Your subscriptions stay.")) return;
            await disconnect();
            await clearCache();
            await save({ gmail: { ...gmail, connected: false, needsSignIn: false, unreadIds: [] } });
          },
        },
        "Disconnect",
      ),
    );
  } else {
    gmailRow = kv(h("div", { style: "display: flex; align-items: center; gap: 10px; min-width: 0" }, mailTile(), line("Gmail not connected", "Scan your receipts to find what you pay for")), h("a", { class: "btn sm", href: "#scan?start=1" }, "Connect"));
  }
  const finding = section(
    "Finding subscriptions",
    h(
      "div",
      { class: "card" },
      gmailRow,
      kv(line("Spot new subscriptions at checkout", "We'll ask before adding anything"), toggle(settings.detectCheckouts, "Spot new subscriptions at checkout", (v) => setSetting("detectCheckouts", v))),
      kv(line('Track visits for "last used"', "Only on sites you subscribe to"), toggle(settings.trackVisits, "Track visits for last used", (v) => setSetting("trackVisits", v))),
    ),
  );

  // Appearance
  const themes = h(
    "div",
    { class: "radio-group", role: "radiogroup", "aria-label": "Theme" },
    ...[
      ["system", "System"],
      ["light", "Light"],
      ["dark", "Dark"],
    ].map(([value, label]) => h("button", { role: "radio", "aria-checked": String(settings.theme === value), onclick: () => setSetting("theme", value) }, label)),
  );
  const currency = h("select", { class: "select sm", id: "currency" }, ...CURRENCIES.map(([v, label]) => h("option", { value: v, selected: v === settings.currency ? "" : null }, label)));
  currency.addEventListener("change", () => setSetting("currency", currency.value));
  const appearance = section(
    "Appearance",
    h("div", { class: "card" }, kv(h("span", {}, "Theme"), themes), kv(h("label", { for: "currency" }, "Show totals in"), currency)),
    h("div", { class: "caption", style: "padding: 0 2px; line-height: 1.45" }, "If you pay in more than one currency, totals are converted at the European Central Bank's daily rates. Fetching them sends none of your data."),
  );

  // Your data
  const restoreInput = h("input", { type: "file", accept: "application/json,.json", style: "display: none" });
  restoreInput.addEventListener("change", () => restore(restoreInput.files[0], actions));
  const exportRows = ui.exportOpen
    ? [
        h(
          "div",
          { class: "kv", style: "gap: 8px; justify-content: flex-start" },
          h("button", { class: "btn sm", onclick: () => download(`subscriptions-${today()}.csv`, toCSV(state.subscriptions), "text/csv") }, "CSV for spreadsheets"),
          h(
            "button",
            {
              class: "btn sm",
              onclick: async () => download(`subscription-check-backup-${today()}.json`, toBackup(await load("subscriptions", "visits", "settings", "review", "sorted", "stats", "installedAt", "dismissed")), "application/json"),
            },
            "Backup file",
          ),
        ),
      ]
    : [];
  const data = section(
    "Your data",
    h("div", { class: "caption", style: "display: flex; gap: 10px; line-height: 1.5; padding: 0 2px" }, icon("lock", { size: 14 }), "Everything is stored in this browser. We don't have servers, and we never see your email or browsing."),
    h(
      "div",
      { class: "card" },
      h("button", { class: "kv link", "aria-expanded": String(ui.exportOpen), onclick: () => ((ui.exportOpen = !ui.exportOpen), actions.rerender()) }, line("Export a backup", "CSV for spreadsheets, or a file to restore from"), icon("download", { size: 14 })),
      ...exportRows,
      h("button", { class: "kv link", onclick: () => restoreInput.click() }, line("Restore from a backup"), icon("upload", { size: 14 })),
    ),
    restoreInput,
    ui.message ? h("div", { class: `caption${ui.message.error ? " cancel-text" : ""}`, role: "status", style: "padding: 0 2px" }, ui.message.text) : null,
    h("button", { class: "btn ghost", style: "align-self: flex-start; height: 32px; padding: 0 2px; color: var(--cancel)", onclick: () => deleteAll(actions) }, "Delete all data"),
  );

  return [header, h("main", { class: "content", style: "gap: 22px; padding-top: 18px" }, budget, reminders, finding, appearance, data)];
}

function mailTile() {
  return h("div", { class: "icon-tile", style: "width: 28px; height: 28px; border-radius: 7px; background: var(--raised); color: var(--muted)" }, icon("mail", { size: 15 }));
}

async function restore(file, actions) {
  if (!file) return;
  try {
    const data = parseBackup(await file.text(), { services: await loadServices() });
    if (!confirm(`Replace what's here with this backup (${t.plural(data.subscriptions.length, "subscription")})?`)) return;
    const { gmail } = await load("gmail");
    await chrome.storage.local.clear();
    await save({ ...data, gmail: { ...gmail }, pending: [] });
    await updateBadge();
    ui.message = { text: `Restored ${t.plural(data.subscriptions.length, "subscription")}.` };
  } catch (err) {
    ui.message = { text: err.message, error: true };
  }
  actions.rerender();
}

async function deleteAll(actions) {
  if (!confirm("Delete everything Subscription Check has stored in this browser? This can't be undone. Export a backup first if you might want it back.")) return;
  await disconnect();
  await chrome.storage.local.clear();
  await save({ schemaVersion: SCHEMA_VERSION, installedAt: today(), settings: { ...DEFAULT_SETTINGS } });
  await updateBadge();
  ui.message = { text: "Everything has been deleted." };
  actions.navigate("#overview");
}
