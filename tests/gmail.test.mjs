import { test } from "node:test";
import assert from "node:assert/strict";
import { GmailClient, GmailNeedsSignInError } from "../src/lib/gmail.js";

// A Gmail stand-in: each message id fails `failures[id]` times with Gmail's
// per-minute quota error before it's returned.
function fakeGmail(failures = {}, status = 403) {
  const calls = {};
  globalThis.fetch = async (url) => {
    const id = new URL(url).pathname.split("/").pop();
    calls[id] = (calls[id] ?? 0) + 1;
    if (calls[id] <= (failures[id] ?? 0)) {
      const body = JSON.stringify({ error: { code: status, message: "Quota exceeded for quota metric 'Total Query Cost' and limit 'Units per minute per user'" } });
      return new Response(body, { status });
    }
    return Response.json({ id, internalDate: "1", payload: { headers: [{ name: "Subject", value: `Email ${id}` }] } });
  };
  globalThis.chrome = { identity: { removeCachedAuthToken: async () => {} } };
  const client = new GmailClient();
  client.token = "t";
  client.baseGapMs = 0;
  const slept = [];
  client.sleep = async (ms) => void slept.push(ms);
  return { client, calls, slept };
}

const ids = Array.from({ length: 30 }, (_, i) => `m${i}`);

test("every email comes back when Gmail rate-limits some of them", async () => {
  const { client } = fakeGmail({ m3: 2, m7: 5, m20: 1 });
  const { messages, failures } = await client.getMessages(ids);
  assert.equal(messages.length, 30);
  assert.deepEqual(messages.map((m) => m.id), ids); // in order
  assert.deepEqual(failures, []);
});

test("emails still refused after request() retries get another pass shortly after", async () => {
  // request()'s own retries aren't enough for m5; the second pass gets it.
  const { client, slept } = fakeGmail({ m5: 5 });
  const progress = [];
  const { messages, failures } = await client.getMessages(ids, { onProgress: (p) => progress.push(p.phase) });
  assert.equal(messages.length, 30);
  assert.deepEqual(failures, []);
  assert.ok(slept.includes(5_000), "a short pause, not a minute");
  assert.ok(progress.includes("retry"));
});

test("what can't be read after every pass is reported, never dropped quietly", async () => {
  const { client } = fakeGmail({ m9: 1000 });
  const { messages, failures } = await client.getMessages(ids);
  assert.equal(messages.length, 29);
  assert.equal(failures.length, 1);
  assert.equal(failures[0].id, "m9");
  assert.match(failures[0].error, /Quota exceeded/);
});

test("an expired sign-in stops the read instead of retrying for minutes", async () => {
  const { client } = fakeGmail({ m0: 1000, m1: 1000 }, 401);
  await assert.rejects(client.getMessages(ids), GmailNeedsSignInError);
});

test("requests are spaced out", async () => {
  const { client, slept } = fakeGmail();
  client.baseGapMs = 25;
  await client.getMessages(ids.slice(0, 10));
  assert.ok(slept.filter((ms) => ms > 0).length >= 8);
});

test("the ✕ on 'Already sorted' clears only the record, not what it stored", async () => {
  const store = {
    sorted: [{ id: "s1", name: "Peacock", subId: "peacock" }, { id: "s2", name: "Figma", subId: "figma" }],
    subscriptions: [{ id: "peacock", name: "Peacock" }, { id: "figma", name: "Figma" }],
  };
  globalThis.chrome = {
    storage: {
      local: {
        get: async (keys) => {
          // keys: a name, a list of names, or { name: default }
          const defaults = keys && typeof keys === "object" && !Array.isArray(keys) ? keys : {};
          const names = Array.isArray(keys) ? keys : typeof keys === "string" ? [keys] : Object.keys(defaults);
          return Object.fromEntries(names.map((k) => [k, structuredClone(k in store ? store[k] : defaults[k])]));
        },
        set: async (obj) => void Object.assign(store, structuredClone(obj)),
      },
    },
  };
  const { dismissSorted } = await import("../src/lib/review.js");
  await dismissSorted("s1");
  assert.deepEqual(store.sorted.map((s) => s.id), ["s2"]);
  assert.equal(store.subscriptions.length, 2);
});

test("a burst of refusals is one slowdown, and the pace recovers", async () => {
  // Five readers all refused at once (Gmail's "slow down" hits whatever's in flight).
  const { client } = fakeGmail({ m0: 1, m1: 1, m2: 1, m3: 1, m4: 1 });
  client.baseGapMs = 50;
  const realNow = Date.now;
  let t = realNow();
  Date.now = () => t; // the pause hasn't passed while the five refusals arrive
  try {
    const first = client.getMessages(ids.slice(0, 5));
    await first;
    assert.equal(client.stats.rateLimited, 5);
    assert.equal(client.stats.slowdowns, 1, "one pause, not five");
    assert.equal(client.currentGapMs, 100, "pace halved once");
    t += 60_000;
    await client.getMessages(ids.slice(5, 30));
    assert.equal(client.currentGapMs, 50, "back to full pace after a run of successes");
  } finally {
    Date.now = realNow;
  }
});

test("reading 217 emails under Gmail's 2026 quota: paced to it, nothing refused", async () => {
  // Gmail as of May 2026: 6,000 units per user per minute, 60 per full email.
  const realNow = Date.now;
  let t = 1_000_000;
  Date.now = () => t;
  const charged = [];
  let refused = 0;
  globalThis.fetch = async (url) => {
    while (charged.length && charged[0].at <= t - 60_000) charged.shift();
    const used = charged.reduce((a, c) => a + c.units, 0);
    if (used + 60 > 6000) {
      refused += 1;
      return new Response(JSON.stringify({ error: { message: "Quota exceeded for quota metric 'Total Query Cost'" } }), { status: 403 });
    }
    charged.push({ at: t, units: 60 });
    return Response.json({ id: new URL(url).pathname.split("/").pop(), internalDate: "1", payload: {} });
  };
  globalThis.chrome = { identity: { removeCachedAuthToken: async () => {} } };
  const client = new GmailClient();
  client.token = "t";
  client.baseGapMs = 0;
  client.sleep = async (ms) => void (t += ms); // time passes only when we wait
  try {
    const many = Array.from({ length: 217 }, (_, i) => `e${i}`);
    assert.ok(client.secondsLeft(217) >= 60, "estimate says it'll take over a minute");
    const { messages, failures } = await client.getMessages(many);
    assert.equal(messages.length, 217);
    assert.deepEqual(failures, []);
    assert.equal(refused, 0, "paced to the quota, so Gmail never refuses");
    assert.equal(client.stats.units, 217 * 60);
  } finally {
    Date.now = realNow;
  }
});
