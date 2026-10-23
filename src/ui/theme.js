import { load } from "../lib/storage.js";

// Apply Settings > Appearance > Theme to this page, and follow changes live.
export async function applyTheme() {
  const set = (theme) => {
    if (theme === "light" || theme === "dark") document.documentElement.dataset.theme = theme;
    else delete document.documentElement.dataset.theme; // "system": follow prefers-color-scheme
  };
  const { settings } = await load("settings");
  set(settings.theme);
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes.settings) set(changes.settings.newValue?.theme);
  });
}
