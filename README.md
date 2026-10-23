# Subscription Check

A Chrome extension (Manifest V3) that finds every subscription you pay for, what it costs, when you last used it and when you're next charged, then makes cancelling easy. Everything is stored locally in `chrome.storage.local`; nothing leaves your computer.

**Building this?** Start with [docs/HANDOFF.md](docs/HANDOFF.md), then [docs/BUILD.md](docs/BUILD.md) (build plan and progress). Testing in real Chrome: [docs/TESTING.md](docs/TESTING.md).

## Run it

1. Open `chrome://extensions` and turn on **Developer mode**.
2. Click **Load unpacked** and select this folder.
3. Pin the extension and click its icon.

After editing files, click the reload icon on the extension's card. To debug the background worker, click its **service worker** link on that card.

- `npm test` runs the unit tests (Node 20+, no dependencies).
- `npm run check-links` checks every cancel link in `data/services.json` still loads.

### Preview the screens without loading the extension

`dev/preview.html` (side panel) and `dev/popup-preview.html` (popup) render the real UI with the designs' sample account and a fake `chrome`. Serve the repo root (`python3 -m http.server 8765`) and open `http://localhost:8765/dev/preview.html`. Options are listed in the comment at the top of each file.

### Gmail

The dev OAuth client ID in `manifest.json` is tied to the unpacked extension loaded from this folder (Testing mode, up to 100 test users; Google asks testers to sign in again weekly). Loading from another folder changes the extension ID and breaks sign-in; see HANDOFF validate #5. Without a client ID, the scan uses a sample inbox and says so.

## How it works

| Feature | Where | How |
|---|---|---|
| Screens | `src/popup/`, `src/panel/`, `src/ui/` | Popup for a quick look; side panel for everything else (Overview, Subscriptions, Review, Detail, Savings, Settings, Gmail scan). Built from `docs/designs/`; plain JS modules, no build step. |
| Numbers and wording | `src/lib/summary.js`, `src/ui/text.js` | Totals, forecast, categories, savings, budget and cut plan; every sentence is a template (no LLM). |
| Gmail scan | `src/lib/receipts.js`, `scan.js`, `gmail.js` | Reads ~15 months of receipts in the browser (read-only), groups them by merchant, works out price, cycle, renewal, trial and cancellation, and sorts the results into "You're paying for", "Please confirm" (with a reason) and "Not added". |
| Gmail re-sync | `src/lib/resync.js`, `src/background.js` | Every 6 hours: new receipts confirm prices and catch price rises and cancellation emails; anything new becomes a question in Review. Never adds anything silently. |
| Checkout detection | `src/lib/detection.js`, `checkout-price.js` | Spots signups from the URL; clicking the icon on the confirmation page reads the price from the page (`activeTab`). Always asks before adding. |
| Last used | `src/lib/usage.js`, `src/background.js` | Visits to a subscription's sites, counted per week; backfilled from Chrome history (~90 days) when a subscription is added. |
| Reminders | `src/background.js`, `src/lib/calendar.js` | Notifications before renewals and trial ends, a monthly check-in, and `.ics` / Google Calendar events that work with Chrome closed. |
| Cancel help | `data/services.json`, `src/lib/cancel.js` | One link per service plus general steps; receipts from Apple, Google Play, Amazon or PayPal send you there instead. |
| Currencies | `src/lib/fx.js` | Totals convert at the ECB's daily rates, fetched only when something is priced in another currency; the request carries no user data. |

Permissions: `storage`, `alarms`, `notifications`, `history`, `webNavigation`, `identity` (Gmail sign-in), `sidePanel`, `favicon` (site logos from Chrome's cache), `activeTab` + `scripting` (reading a price from the checkout page you're on, only when you click the icon). No host permissions.

## Known limitations

- Cancel links have only been checked automatically (they load); whether each opens the right page once signed in needs a person (BUILD.md).
- The receipt parser hasn't been run on real inboxes yet. Apple and Google Play receipts show as one entry per store rather than per app.
- "Last used" counts any visit to the site (watching free YouTube counts for YouTube Premium), and usage on other devices isn't seen.
- Light mode uses placeholder colours until it's designed.

## Roadmap and product notes

See [docs/product-plan.md](docs/product-plan.md) for decisions, feature notes and the backlog, and [docs/competitors.md](docs/competitors.md) for competitor research.
