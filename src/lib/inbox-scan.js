import { GmailClient, SCAN_PASS_WAITS } from "./gmail.js";
import { analyseInbox, buildSearchQueries } from "./receipts.js";
import { loadServices } from "./services.js";
import { readCache, writeCache } from "./mail-cache.js";

const MAX_MESSAGES = 1500;

/**
 * Search ~15 months of receipt-like email and analyse it (receipts.js
 * analyseInbox). Emails read before come from the local cache (mail-cache.js),
 * so only new mail is downloaded.
 *
 * onProgress receives { phase: "connect" | "search" | "read" | "retry", done, total, secondsLeft }.
 * onFound(candidates) is called every few emails with what the emails read so
 * far add up to (newest emails come first, so recent subscriptions show early).
 * Returns { analysis, scanned, unreadIds, timing }:
 *   unreadIds: emails Gmail still wouldn't give us after retrying. Shown, never
 *              hidden, and read again by the background check (extraIds).
 *   timing:    where the time went, for the console (and the export page).
 */
const FOUND_EVERY = 8; // emails between "found so far" updates

export async function scanInbox({ onProgress = () => {}, onFound = () => {}, lookbackDays, interactive = true, max = MAX_MESSAGES, passWaits = SCAN_PASS_WAITS, extraIds = [], client: given = null } = {}) {
  const started = Date.now();
  onProgress({ phase: "connect" });
  const client = given ?? (await GmailClient.connect({ interactive })); // tests pass their own

  onProgress({ phase: "search" });
  // extraIds: emails an earlier read couldn't get, outside today's search window.
  const found = [];
  for (const query of buildSearchQueries(undefined, lookbackDays)) found.push(...(await client.listMessageIds(query, max)));
  const ids = [...new Set([...found.slice(0, max), ...extraIds])];
  const searched = Date.now();

  const cache = await readCache();
  const toRead = ids.filter((id) => !cache[id]);
  const services = await loadServices();
  // Before the first read, tell the screen how long Gmail's quota will make it.
  onProgress({ phase: "read", done: ids.length - toRead.length, total: ids.length, secondsLeft: client.secondsLeft(toRead.length) });

  // "Found so far": re-run the (fast, local) analysis as emails arrive.
  const soFar = ids.map((id) => cache[id]).filter(Boolean);
  const report = () => onFound(analyseInbox(soFar, { services }).candidates);
  if (soFar.length) report();
  let sinceReport = 0;

  const { messages: fresh, failures } = await client.getMessages(toRead, {
    passWaits,
    // Progress counts the whole scan, cached emails included.
    onProgress: (p) => onProgress({ ...p, done: p.done + (ids.length - toRead.length), total: ids.length }),
    onMessage: (m) => {
      soFar.push(m);
      if (++sinceReport >= FOUND_EVERY) {
        sinceReport = 0;
        report();
      }
    },
  });
  const read = Date.now();
  await writeCache(cache, fresh);

  const freshById = new Map(fresh.map((m) => [m.id, m]));
  const messages = ids.map((id) => cache[id] ?? freshById.get(id)).filter(Boolean);
  const analysis = analyseInbox(messages, { services });

  const timing = {
    totalMs: Date.now() - started,
    searchMs: searched - started,
    readMs: read - searched,
    found: ids.length,
    fromCache: ids.length - toRead.length,
    downloaded: fresh.length,
    unread: failures.length,
    ...client.stats,
  };
  console.info("Gmail scan", timing);
  if (failures.length) console.warn(`Gmail: ${failures.length} of ${ids.length} emails couldn't be read yet`, failures);
  return { analysis, scanned: ids.length, unreadIds: failures.map((f) => f.id), timing };
}
