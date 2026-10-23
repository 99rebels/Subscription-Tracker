import { GmailClient, BACKGROUND_PASS_WAITS, UNITS } from "../src/lib/gmail.js";
import { buildSearchQueries } from "../src/lib/receipts.js";
import { scrubMessage } from "../src/lib/scrub.js";
import { today } from "../src/lib/dates.js";

const MAX_MESSAGES = 2500;
const MAX_BODY_CHARS = 15000;
const WORDS_KEY = "exportInboxWords";

const $ = (id) => document.getElementById(id);
const status = (text) => ($("status").textContent = text);

try {
  $("words").value = localStorage.getItem(WORDS_KEY) ?? "";
} catch {
  // storage unavailable; the list just isn't remembered
}

// Wider than the scan's searches so the scorecard can show what they miss
// (npm run scorecard -- --scan-search shows the scan's own view): the main
// search with Promotions and Social put back, and account/plan emails from Updates.
// Each message records whether the scan's own searches find it.
function widerQueries([main]) {
  const after = main.match(/after:\S+/)[0];
  return [
    main.replace(" -category:promotions -category:social", ""),
    `${after} category:updates (subject:(account OR plan OR confirm OR confirmation OR welcome OR reminder OR expire OR expiring) OR "per month" OR "per year" OR "/month")`,
  ];
}

$("go").addEventListener("click", async () => {
  $("go").disabled = true;
  const words = $("words").value.split("\n").map((w) => w.trim()).filter(Boolean);
  try {
    localStorage.setItem(WORDS_KEY, words.join("\n"));
  } catch {
    // not remembered
  }

  try {
    status("Connecting to Gmail…");
    const client = await GmailClient.connect({ interactive: true });
    const { emailAddress } = await client.request("/profile", {}, { units: UNITS.profile });

    status("Searching…");
    const started = Date.now();
    const productionQueries = buildSearchQueries();
    const productionIds = [];
    for (const q of productionQueries) productionIds.push(...(await client.listMessageIds(q, MAX_MESSAGES)));
    const extraIds = [];
    for (const q of widerQueries(productionQueries)) extraIds.push(...(await client.listMessageIds(q, MAX_MESSAGES)));
    const inProduction = new Set(productionIds);
    const ids = [...new Set([...productionIds, ...extraIds])].slice(0, MAX_MESSAGES);

    const searched = Date.now();
    // Thorough rather than quick: the background's longer pauses between passes.
    const { messages, failures: failed } = await client.getMessages(ids, {
      passWaits: BACKGROUND_PASS_WAITS,
      onProgress: (p) => status(p.phase === "retry" ? `Gmail asked us to slow down. Trying ${p.total - p.done} emails again shortly…` : `Reading ${p.done} of ${p.total} emails…`),
    });
    const timing = { totalMs: Date.now() - started, searchMs: searched - started, readMs: Date.now() - searched, found: ids.length, ...client.stats };
    console.info("Export timing", timing);
    const failures = failed.map((f) => ({ inProductionQuery: inProduction.has(f.id), error: f.error }));

    const options = { userEmails: [emailAddress], words };
    const scrubbed = messages
      .filter(Boolean)
      .sort((a, b) => a.date - b.date)
      .map((m, i) => scrubMessage({ ...m, body: m.body.slice(0, MAX_BODY_CHARS), inProductionQuery: inProduction.has(m.id) }, options, i));

    const file = {
      exportedAt: today(),
      productionQueries,
      widerQueries: widerQueries(productionQueries),
      timing,
      found: ids.length,
      count: scrubbed.length,
      inProductionQuery: scrubbed.filter((m) => m.inProductionQuery).length,
      failures,
      messages: scrubbed,
    };
    const name = `inbox-export-${file.exportedAt}.json`;
    const url = URL.createObjectURL(new Blob([JSON.stringify(file, null, 1)], { type: "application/json" }));
    const a = Object.assign(document.createElement("a"), { href: url, download: name });
    a.click();

    status("");
    $("status").append(
      Object.assign(document.createElement("p"), {
        textContent: `Saved ${name}: ${file.count} of ${file.found} emails (${file.inProductionQuery} found by the scan's searches) in ${Math.round(timing.totalMs / 1000)} s; Gmail asked us to slow down ${timing.rateLimited} times${failures.length ? `; ${failures.length} couldn't be read, see "failures" in the file` : ""}. Check the sample below for anything personal; if you find something, add it to the list and export again.`,
      }),
      Object.assign(document.createElement("pre"), {
        textContent: scrubbed
          .filter((m) => m.body)
          .slice(-5)
          .map((m) => `${m.from}\n${m.subject}\n${m.body.slice(0, 1200)}`)
          .join("\n\n────────\n\n"),
      }),
    );
  } catch (err) {
    status(`Export failed: ${err.message ?? err}`);
  } finally {
    $("go").disabled = false;
  }
});
