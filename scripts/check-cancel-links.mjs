// Checks every cancel link in data/services.json still loads and stays on the
// service's own site (product-plan "Cancel-link checks"). Run: npm run check-links
//
// It can only tell that a page exists. Most account pages redirect to a sign-in
// page, which is expected; whether the link opens the right page once signed in
// still needs a person (record that as verifiedAt in services.json).

import { readFile } from "node:fs/promises";

const services = JSON.parse(await readFile(new URL("../data/services.json", import.meta.url), "utf8"));
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";

// Big shared sign-in pages, and country sites of the same brand (audible.fr for
// audible.com) are fine: this runs from wherever you are, so redirects vary.
const SIGN_IN_HOSTS = ["accounts.google.com", "login.microsoftonline.com", "login.live.com", "appleid.apple.com"];
const brand = (host) => host.split(".").slice(-3).find((label, i, all) => i === all.length - 2 || (all.length === 3 && i === 1 && !/^(co|com)$/.test(label))) ?? host;
const sameSite = (host, domains) =>
  SIGN_IN_HOSTS.includes(host) || domains.some((d) => host === d || host.endsWith(`.${d}`) || brand(host) === brand(d));

async function check(service) {
  const url = service.cancelUrl;
  try {
    const res = await fetch(url, { redirect: "follow", headers: { "user-agent": UA, accept: "text/html" }, signal: AbortSignal.timeout(20_000) });
    const final = new URL(res.url);
    const onSite = sameSite(final.hostname, [...service.domains, new URL(url).hostname]);
    const signIn = /sign.?in|log.?in|auth|account|identity|accounts\./i.test(final.href) && final.href !== url;
    let verdict = "ok";
    if (res.status === 404 || res.status === 410) verdict = "BROKEN";
    else if (/unavailable|not-available|region/i.test(final.pathname)) verdict = "region-locked here";
    else if (res.status >= 500) verdict = "server error";
    else if (!onSite) verdict = "LEAVES SITE";
    else if (res.status >= 400) verdict = signIn ? "ok (sign-in wall)" : `bot-blocked (${res.status}): check by hand`;
    else if (signIn || SIGN_IN_HOSTS.includes(final.hostname)) verdict = "ok (sign-in)";
    return { name: service.name, status: res.status, verdict, final: final.href === url ? "" : final.href };
  } catch (err) {
    return { name: service.name, status: "-", verdict: `ERROR ${err.cause?.code ?? err.name}`, final: "" };
  }
}

const results = [];
for (let i = 0; i < services.length; i += 6) results.push(...(await Promise.all(services.slice(i, i + 6).map(check))));
for (const r of results) console.log(`${r.verdict.padEnd(18)} ${String(r.status).padEnd(4)} ${r.name.padEnd(26)} ${r.final}`);
const bad = results.filter((r) => /BROKEN|LEAVES|ERROR/.test(r.verdict));
console.log(`\n${results.length} links checked, ${bad.length} need attention.`);
process.exitCode = bad.length ? 1 : 0;
