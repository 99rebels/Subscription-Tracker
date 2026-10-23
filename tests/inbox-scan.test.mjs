import { test } from "node:test";
import assert from "node:assert/strict";
import { scanInbox } from "../src/lib/inbox-scan.js";
import { GmailClient } from "../src/lib/gmail.js";

function instantClient() {
  const client = new GmailClient();
  client.token = "t";
  client.baseGapMs = 0;
  client.sleep = async () => {};
  return client;
}

// Just enough Chrome and Gmail to run the real scan: a search that finds
// `ids`, and message reads counted per id (the ones in `refuse` always fail
// with Gmail's quota error).
function fakeWorld(ids, { refuse = [] } = {}) {
  const store = {};
  const reads = {};
  globalThis.chrome = {
    runtime: { getManifest: () => ({ oauth2: { client_id: "test.apps.googleusercontent.com" } }), getURL: (p) => `chrome-extension://x/${p}` },
    identity: { getAuthToken: async () => ({ token: "t" }), removeCachedAuthToken: async () => {} },
    storage: { local: { get: async (k) => ({ [k]: store[k] }), set: async (o) => void Object.assign(store, structuredClone(o)), remove: async (k) => void delete store[k] } },
  };
  globalThis.fetch = async (url) => {
    const u = new URL(url);
    if (u.protocol === "chrome-extension:") return Response.json([]); // services.json
    if (u.pathname.endsWith("/messages")) return Response.json({ messages: ids.map((id) => ({ id })) });
    const id = u.pathname.split("/").pop();
    reads[id] = (reads[id] ?? 0) + 1;
    if (refuse.includes(id)) return new Response(JSON.stringify({ error: { message: "Quota exceeded" } }), { status: 429 });
    return Response.json({ id, internalDate: String(Date.now()), payload: { headers: [{ name: "From", value: "Acme <billing@acme.io>" }, { name: "Subject", value: "Your receipt" }] } });
  };
  return { store, reads };
}

const quiet = { passWaits: [], onProgress: () => {} };
const silence = (fn) => async () => {
  const [info, warn] = [console.info, console.warn];
  console.info = console.warn = () => {};
  try { await fn(); } finally { [console.info, console.warn] = [info, warn]; }
};

test("a second scan reads nothing it has read before", silence(async () => {
  const { reads } = fakeWorld(["a", "b", "c"]);
  const first = await scanInbox(quiet);
  assert.equal(first.timing.downloaded, 3);
  const second = await scanInbox(quiet);
  assert.equal(second.timing.downloaded, 0);
  assert.equal(second.timing.fromCache, 3);
  assert.deepEqual(reads, { a: 1, b: 1, c: 1 });
}));

test("emails Gmail won't give us are returned for later, and picked up then", silence(async () => {
  const world = fakeWorld(["a", "b"], { refuse: ["b"] });
  const first = await scanInbox({ ...quiet, client: instantClient() });
  assert.deepEqual(first.unreadIds, ["b"]);
  // Later (e.g. the background check), with b outside the search window now.
  fakeWorld(["a"]);
  Object.assign(globalThis.chrome.storage.local, { get: async (k) => ({ [k]: world.store[k] }) });
  const later = await scanInbox({ ...quiet, extraIds: first.unreadIds, client: instantClient() });
  assert.deepEqual(later.unreadIds, []);
  assert.equal(later.timing.downloaded, 1);
}));
