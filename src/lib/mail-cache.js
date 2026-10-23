// Emails already read from Gmail, kept in this browser (chrome.storage.local) so
// a second scan, or the background check, only downloads new mail. Holds the
// same parser input the scan builds ({ id, date, from, subject, snippet, body,
// labels }), never anything that leaves the computer. Cleared with "Disconnect
// Gmail" and "Delete all data".

const KEY = "mailCache";
// Bump when gmail.js / htmlToText change what a message's text looks like, so
// old entries are read again rather than parsed in the old shape.
export const MAIL_CACHE_VERSION = 1;
const MAX_BODY_CHARS = 20_000; // receipts are short; this trims the odd huge newsletter
const KEEP_DAYS = 500; // a bit more than the scan's 15 months
const DAY_MS = 86_400_000;

export async function readCache() {
  const { [KEY]: cache } = await chrome.storage.local.get(KEY);
  return cache?.version === MAIL_CACHE_VERSION ? cache.messages ?? {} : {};
}

// Add newly read messages and drop ones older than the scan ever looks.
export async function writeCache(existing, added, now = Date.now()) {
  const messages = { ...existing };
  for (const m of added) messages[m.id] = { ...m, body: (m.body ?? "").slice(0, MAX_BODY_CHARS) };
  for (const [id, m] of Object.entries(messages)) if (now - m.date > KEEP_DAYS * DAY_MS) delete messages[id];
  await chrome.storage.local.set({ [KEY]: { version: MAIL_CACHE_VERSION, messages } });
}

export async function clearCache() {
  await chrome.storage.local.remove(KEY);
}
