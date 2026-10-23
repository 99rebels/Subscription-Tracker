// Minimal Gmail API client. Runs entirely in the browser: the OAuth token comes
// from chrome.identity and requests go straight to Google; nothing passes
// through a server of ours.

import { htmlToText, decodeEntities } from "./receipts.js";

const API = "https://gmail.googleapis.com/gmail/v1/users/me";
const PLACEHOLDER_CLIENT_ID = "YOUR_CLIENT_ID.apps.googleusercontent.com";

export class GmailNotConfiguredError extends Error {
  constructor() {
    super("Gmail import isn't configured yet: add your OAuth client ID to manifest.json (see README).");
  }
}

export function isConfigured() {
  const clientId = chrome.runtime.getManifest().oauth2?.client_id;
  return !!clientId && clientId !== PLACEHOLDER_CLIENT_ID;
}

async function getToken(interactive) {
  if (!isConfigured()) throw new GmailNotConfiguredError();
  const result = await chrome.identity.getAuthToken({ interactive });
  return typeof result === "string" ? result : result?.token;
}

export async function disconnect() {
  try {
    const token = await getToken(false);
    if (!token) return;
    await chrome.identity.removeCachedAuthToken({ token });
    await fetch(`https://oauth2.googleapis.com/revoke?token=${token}`, { method: "POST" });
  } catch {
    // already disconnected
  }
}

export class GmailNeedsSignInError extends Error {
  constructor() {
    super("Gmail needs you to sign in again.");
  }
}

// Gmail's quota (projects created from 1 May 2026): 6,000 units per user per
// minute, and reading one full email costs 60 units, a search 5
// (developers.google.com/workspace/gmail/api/reference/quota). So ~100 full
// emails a minute, whatever we do. We count units over the last minute and wait
// before going over, instead of being refused: short scans run at full speed,
// long ones at Gmail's pace with nothing refused.
export const UNITS_PER_MINUTE = 5_700; // 95% of 6,000, a little headroom
export const UNITS = { list: 5, full: 60, metadata: 20, profile: 5 };
const REQUESTS_PER_SECOND = 20; // a courtesy gap between requests on top
const SLOWEST_GAP_MS = 250; // never slower than 4/s
const RECOVER_AFTER = 10; // successes before speeding back up
const READ_CONCURRENCY = 5;
// Retries inside one request stay short (2 + 4 + 8 s, or Gmail's Retry-After);
// what still fails gets another pass after these pauses.
const REQUEST_RETRIES = 3;
export const SCAN_PASS_WAITS = [5_000, 15_000];
export const BACKGROUND_PASS_WAITS = [5_000, 15_000, 60_000];

export class GmailClient {
  // Overridable in tests.
  baseGapMs = 1000 / REQUESTS_PER_SECOND;
  sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  // What the scan reports so we can see where the time goes. waitedMs is time
  // the whole scan stood still, not the sum of every reader's wait.
  stats = { requests: 0, units: 0, rateLimited: 0, slowdowns: 0, serverErrors: 0, waitedMs: 0, quotaWaitMs: 0 };
  unitsPerMinute = UNITS_PER_MINUTE;
  #spent = []; // { at, units } over the last minute
  #gapMs = null;
  #nextSlot = 0;
  #okStreak = 0;
  #pausedUntil = 0;

  get currentGapMs() {
    return this.#gapMs ?? this.baseGapMs;
  }

  #unitsInLastMinute(now) {
    this.#spent = this.#spent.filter((s) => s.at > now - 60_000);
    return this.#spent.reduce((a, s) => a + s.units, 0);
  }

  // Wait until spending `units` keeps the last minute under the quota, then
  // record it. Check-and-record is synchronous, so parallel readers can't both
  // take the last units.
  async #reserve(units) {
    for (;;) {
      const now = Date.now();
      const used = this.#unitsInLastMinute(now);
      if (used + units <= this.unitsPerMinute) {
        this.#spent.push({ at: now, units });
        this.stats.units += units;
        return;
      }
      let over = used + units - this.unitsPerMinute;
      let freeAt = now;
      for (const s of this.#spent) {
        over -= s.units;
        freeAt = s.at + 60_000;
        if (over <= 0) break;
      }
      const waitMs = Math.max(freeAt - now, 0) + 20;
      this.stats.quotaWaitMs += waitMs;
      await this.sleep(waitMs);
    }
  }

  /**
   * Roughly how long reading `count` more full emails will take at Gmail's pace,
   * in seconds, for the progress screen. Quota is the limit once a scan is past
   * its first ~95 emails; before that it's round trips.
   */
  secondsLeft(count, units = UNITS.full) {
    const free = Math.max(0, this.unitsPerMinute - this.#unitsInLastMinute(Date.now()));
    const overQuota = Math.max(0, count * units - free);
    return Math.ceil(Math.max((overQuota / this.unitsPerMinute) * 60, count * 0.12));
  }

  // Space requests out evenly, however many are in flight.
  async #throttle() {
    const gap = this.#gapMs ?? this.baseGapMs;
    const now = Date.now();
    const slot = Math.max(now, this.#nextSlot);
    this.#nextSlot = slot + gap;
    if (slot > now) await this.sleep(slot - now);
  }

  // Gmail said slow down. Every reader pauses together (the retry waits in
  // #throttle like any request) and the pace halves, but only once per pause:
  // the other readers' refusals during it are the same "slow down", not new ones.
  // (Halving on each of them took the founder's scan down to 1 email a second.)
  // Learning Gmail's per-minute cap from recent successes was tried and came out
  // slower in simulation (it probes back up and gets refused more).
  #backOff(waitMs) {
    this.stats.rateLimited += 1;
    const now = Date.now();
    if (now < this.#pausedUntil) return;
    this.stats.slowdowns += 1;
    this.stats.waitedMs += waitMs;
    this.#pausedUntil = now + waitMs;
    this.#gapMs = Math.min(this.currentGapMs * 2, SLOWEST_GAP_MS);
    this.#nextSlot = Math.max(this.#nextSlot, this.#pausedUntil);
    this.#okStreak = 0;
  }

  // Speed back up quickly once Gmail is happy again.
  #succeeded() {
    if (this.#gapMs == null || ++this.#okStreak < RECOVER_AFTER) return;
    this.#okStreak = 0;
    this.#gapMs = this.#gapMs * 0.7 <= this.baseGapMs ? null : this.#gapMs * 0.7;
  }

  // interactive: false in the background, where we must never pop up a sign-in;
  // Testing-mode sign-ins expire weekly, so that throws GmailNeedsSignInError.
  static async connect({ interactive = true } = {}) {
    const client = new GmailClient();
    client.interactive = interactive;
    try {
      client.token = await getToken(interactive);
    } catch (err) {
      if (err instanceof GmailNotConfiguredError) throw err;
      throw interactive ? err : new GmailNeedsSignInError();
    }
    if (!client.token) throw new GmailNeedsSignInError();
    return client;
  }

  // units: what Gmail charges for this call (UNITS), counted against the quota.
  async request(path, params = {}, { units = UNITS.list, attempt = 0 } = {}) {
    const url = new URL(API + path);
    for (const [key, value] of Object.entries(params)) {
      for (const v of [].concat(value)) url.searchParams.append(key, v);
    }
    await this.#reserve(units);
    await this.#throttle();
    this.stats.requests += 1;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${this.token}` } });

    if (res.status === 401 && attempt === 0) {
      // Token expired: drop it from Chrome's cache and get a fresh one.
      await chrome.identity.removeCachedAuthToken({ token: this.token });
      this.token = await getToken(this.interactive).catch(() => null);
      if (!this.token) throw new GmailNeedsSignInError();
      return this.request(path, params, { units, attempt: attempt + 1 });
    }
    // Gmail reports its per-user limits as 403 ("Quota exceeded … Units per
    // minute per user", rateLimitExceeded) as well as 429.
    const rateLimited = res.status === 429 || (res.status === 403 && /rate ?limit|quota/i.test(await res.clone().text()));
    if ((rateLimited || res.status >= 500) && attempt < REQUEST_RETRIES) {
      const retryAfter = Number(res.headers.get("retry-after"));
      const waitMs = (retryAfter > 0 ? Math.min(retryAfter, 60) * 1000 : 2000 * 2 ** attempt) + Math.random() * 300;
      if (rateLimited) {
        this.#backOff(waitMs); // the retry waits for the shared pause in #throttle
      } else {
        this.stats.serverErrors += 1;
        await this.sleep(waitMs);
      }
      return this.request(path, params, { units, attempt: attempt + 1 });
    }
    if (!res.ok) throw new Error(`Gmail API ${res.status}: ${await res.text()}`);
    this.#succeeded();
    return res.json();
  }

  async listMessageIds(query, max = 2000) {
    const ids = [];
    let pageToken;
    do {
      const page = await this.request("/messages", { q: query, maxResults: 500, ...(pageToken && { pageToken }) });
      ids.push(...(page.messages ?? []).map((m) => m.id));
      pageToken = page.nextPageToken;
    } while (pageToken && ids.length < max);
    return ids.slice(0, max);
  }

  async getMessage(id, format = "metadata") {
    const params = format === "metadata" ? { format, metadataHeaders: ["From", "Subject"] } : { format };
    const units = format === "metadata" || format === "minimal" ? UNITS.metadata : UNITS.full;
    return normalizeMessage(await this.request(`/messages/${id}`, params, { units }));
  }

  /**
   * Read many emails in full without dropping any quietly: whatever still fails
   * after request()'s retries gets another pass after each of passWaits (the
   * scan uses short pauses and leaves stragglers to the background; the
   * background waits longer). Returns { messages, failures: [{ id, error }] } in
   * the order of ids. onProgress({ phase: "read" | "retry", done, total, secondsLeft }).
   * onMessage(message) as each one arrives (the scan's "found so far").
   */
  async getMessages(ids, { onProgress = () => {}, onMessage = () => {}, passWaits = SCAN_PASS_WAITS } = {}) {
    const results = new Map();
    let todo = ids;
    let errors = new Map();
    for (let pass = 0; pass <= passWaits.length && todo.length; pass++) {
      if (pass > 0) {
        onProgress({ phase: "retry", done: results.size, total: ids.length, waiting: todo.length });
        this.stats.waitedMs += passWaits[pass - 1];
        await this.sleep(passWaits[pass - 1]);
      }
      errors = new Map();
      let signIn = null;
      await mapWithConcurrency(
        todo,
        pass === 0 ? READ_CONCURRENCY : 2,
        (id) =>
          this.getMessage(id, "full").then(
            (m) => {
              results.set(id, m);
              onMessage(m);
            },
            (err) => {
              // An expired sign-in fails every read; stop and ask instead of retrying.
              if (err instanceof GmailNeedsSignInError) signIn = err;
              else errors.set(id, String(err?.message ?? err).slice(0, 300));
            },
          ),
        () => onProgress({ phase: pass === 0 ? "read" : "retry", done: results.size, total: ids.length, secondsLeft: this.secondsLeft(ids.length - results.size) }),
      );
      if (signIn) throw signIn;
      todo = todo.filter((id) => !results.has(id));
    }
    return {
      messages: ids.filter((id) => results.has(id)).map((id) => results.get(id)),
      failures: todo.map((id) => ({ id, error: errors.get(id) ?? "unknown" })),
    };
  }
}

function header(payload, name) {
  return payload?.headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? "";
}

function decodeBase64Url(data) {
  const binary = atob(data.replace(/-/g, "+").replace(/_/g, "/"));
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function findPart(part, mimeType) {
  if (!part) return null;
  if (part.mimeType === mimeType && part.body?.data) return part;
  for (const child of part.parts ?? []) {
    const found = findPart(child, mimeType);
    if (found) return found;
  }
  return null;
}

// Prefer the HTML part: receipt totals are often only in the HTML version.
function extractBody(payload) {
  const html = findPart(payload, "text/html");
  if (html) return htmlToText(decodeBase64Url(html.body.data));
  const plain = findPart(payload, "text/plain");
  return plain ? decodeBase64Url(plain.body.data) : "";
}

function normalizeMessage(raw) {
  return {
    id: raw.id,
    date: Number(raw.internalDate),
    from: header(raw.payload, "From"),
    subject: header(raw.payload, "Subject"),
    snippet: decodeEntities(raw.snippet ?? ""),
    body: raw.payload?.parts || raw.payload?.body?.data ? extractBody(raw.payload) : "",
    labels: raw.labelIds ?? [], // e.g. CATEGORY_PURCHASES
  };
}

// Run `fn` over `items` with at most `limit` in flight (Gmail allows ~50 message
// reads per second per user).
export async function mapWithConcurrency(items, limit, fn, onEach) {
  const results = new Array(items.length);
  let next = 0;
  let done = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      try {
        results[i] = await fn(items[i]);
      } catch (err) {
        results[i] = null;
        console.warn("Gmail fetch failed", items[i], err);
      }
      onEach?.(++done, items.length);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}
