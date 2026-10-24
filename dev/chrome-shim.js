// A fake `chrome` for previewing extension pages in a normal browser tab
// (dev/preview.html). In-memory storage only; nothing here ships in the extension.

const listeners = [];

function area(name) {
  const store = {};
  const pick = (keys) => pickFrom(store, keys);
  return {
    async get(keys) {
      return pick(keys);
    },
    async set(values) {
      const changes = {};
      for (const [k, v] of Object.entries(values)) {
        changes[k] = { oldValue: store[k], newValue: structuredClone(v) };
        store[k] = structuredClone(v);
      }
      for (const fn of listeners) fn(changes, name);
    },
    async remove(keys) {
      for (const k of [].concat(keys)) delete store[k];
    },
  };
}

function pickFrom(store, keys) {
  if (keys == null) return structuredClone(store);
  if (typeof keys === "string") keys = [keys];
  if (Array.isArray(keys)) return Object.fromEntries(keys.filter((k) => k in store).map((k) => [k, structuredClone(store[k])]));
  return Object.fromEntries(Object.entries(keys).map(([k, fallback]) => [k, k in store ? structuredClone(store[k]) : fallback]));
}


globalThis.chrome = {
  storage: { local: area("local"), session: area("session"), onChanged: { addListener: (fn) => listeners.push(fn) } },
  runtime: { getURL: (path) => new URL(`../${path.replace(/^\//, "")}`, location.href).toString(), getManifest: () => ({}) },
  tabs: { create: async ({ url }) => window.open(url, "_blank") },
  sidePanel: { open: async () => {} },
  action: { setBadgeText: async () => {}, setBadgeBackgroundColor: async () => {}, setBadgeTextColor: async () => {} },
  windows: { getCurrent: async () => ({ id: 1 }) },
};
