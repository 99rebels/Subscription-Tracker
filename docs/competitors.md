# Competitor research

Snapshot from 2026-10-22, from two research passes (Chrome extensions; apps/SaaS/fintech). Numbers are as found that day; anything inferred is marked. Re-check before relying on them.

## Summary

- **Chrome extensions:** very fragmented and tiny. **No dedicated subscription tracker has more than ~300 users** (of ~70 checked). Most are under 6 months old, built by solo developers, and many have reviews that look seeded (reviewers sharing the developer's surname, same-day near-identical 5-star reviews).
- **Apps:** **Rocket Money** dominates (10M+ users). Banks offer free basic tools. About a dozen Gmail-scanning apps launched in 2026; all have under 1K downloads.
- **Nobody with real users combines** checkout detection + Gmail import + usage tracking + reminders. Each piece exists in a 10–100 user extension.
- **Warning sign:** top trackers in the Chrome Web Store have ~300–1,000 users, so people aren't finding this through store search. Distribution has to come from elsewhere (Reddit, TikTok, content, word of mouth).

## Biggest competitors

| # | Name | Type | Scale | Detection | Price | Why it matters |
|---|---|---|---|---|---|---|
| 1 | **Rocket Money** | iOS/Android/web | 10M+ users; 4.5★ (401K iOS) | Bank (Plaid); **email since Aug 2026** (Rowan AI agent) | Free; Premium $7–14/mo; Premium+ $15/mo; bill negotiation 35–60% of savings | The giant. Cancel concierge, negotiation, now email too |
| 2 | Bank tools (Capital One via Minna; Chase; Apple/Google subscription settings) | Built into the bank's app or the phone | Every cardholder | Card transactions | Free | Free and already installed. But one card only, some merchants only, no usage |
| 3 | Monarch / Copilot | Budgeting apps | Monarch 4.9★ (115K); Copilot 4.8★ (31K) | Bank | ~$95–100/yr | Own the paying personal-finance user; subscriptions are a side tab, no cancel help |
| 4 | **BillSensor** | Extension + account | 10 users | Gmail as you open emails; Outlook | Free; Pro $9/mo; Business $29/mo | **Closest feature match to our plan:** price-increase alerts, post-cancel charge monitoring, cancel links. Reviews look seeded (inferred) |
| 5 | **Subwatch** (subwatch.co) | Extension + web + API/MCP | 70 users; 5.0 (8) | Gmail scan with on-device Gemini Nano (12 months); manual | Free up to 3; **$11.99 one-time** | Best-executed extension; actively updated (Oct 2026). 3+ of 7 reviews are from developer-surname reviewers (inferred friends and family) |
| 6 | **Substash** | Extension (Chrome/Edge/Firefox) + cloud sync | 274 users | Manual only | Free | Highest-installed dedicated tracker. Low activity: Chrome version a year old; listing links to a dead domain (substash.io → moved to substash.fyi) |
| 7 | CentryAI / SubRadar / Substract / 0+ / SubGate | iOS apps | each <1K downloads | Gmail scan | ~$0.49–8/mo | Same pitch as ours, no traction. CentryAI has a "zombie score" (time since last use); feedback: 90-day lookback misses annual charges |
| 8 | Privacy.com | Virtual cards + extension | ~100K extension users | None (prevents charges with pausable cards) | Free–$25/mo | Not a tracker; potential partner/integration |

Note: two different extensions are called "SubWatch". The $12 one is subwatch.co. "SubWatch by Cobrain" has 5 users.

## Gaps nobody fills well

- **Real usage tracking** for consumers. Consumer apps either ask users to check in or show an unexplained score; only enterprise tools (Torii, Productiv) measure real usage, via a browser extension.
- **Checkout capture confirmed by the receipt.** Detection is always single-step and never cross-checked.
- **Cancellation verification.** Only BillSensor (10 users) monitors for charges after cancelling.
- **Streaming rotation:** not found anywhere.
- **Subscription budget + usage-ranked cut plan:** not found (see [product-plan.md](product-plan.md), feature 4).
- **Privacy-first automation:** the only private automated options are tiny.
- **Non-US users:** big players are US-only because of Plaid; email works anywhere.
- **Freelancers / small teams:** nothing between manual trackers ($6–18/mo) and SMB tools (£100/mo+, 25+ staff).

## What users complain about (to avoid)

- Negotiation fees charged up front on savings that disappear (Rocket Money, Hiatus).
- Paywalls sprung after the user has connected everything.
- Hard to cancel the tracker itself.
- Bank links that keep breaking (~20% of Rocket Money's negative Play reviews).
- Local-only data lost on reinstall (Monthly Bill Tracker); we need export/backup.
- Broken sign-in, broken automations when sites change.
- Free tiers capped at 3–5 subscriptions.

## Key sources

- Rocket Money Rowan: https://www.rocketmoney.com/learn/personal-finance/what-is-rowan
- Subwatch: https://subwatch.co
- Substash: https://substash.fyi
- CentryAI: https://www.producthunt.com/posts/centryai
- Capital One subscription management: https://www.capitalone.com/digital/tools/subscription-management/
- Google restricted scope verification: https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification
- Chrome Web Store listings: `https://chromewebstore.google.com/detail/<id>` (IDs in the original research notes)
