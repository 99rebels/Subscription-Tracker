# Build handoff: Subscription Check

> **Status (2026-10-23): the build is complete.** Start with "Where things stand" at the top of [BUILD.md](BUILD.md): one open bug (renewal reminder didn't arrive in testing) and what's left.

For the agent building the product. Read this first, then **[BUILD.md](BUILD.md) (build plan and progress: where to pick up)**, then [product-plan.md](product-plan.md) (decisions, feature notes, reasoning) and skim [competitors.md](competitors.md). Written 2026-10-22.

## What we're building

A Chrome extension (Manifest V3) that shows people every subscription they pay for, what it costs, when they last used it, and when they're next charged, then makes cancelling easy. The founder's problem: *"I know I'm paying for things I don't need, I can't remember what they are, and I want to know before I'm charged."*

It finds subscriptions three ways, with as little typing as possible:
1. **Gmail scan:** reads ~15 months of receipts locally in the browser.
2. **Checkout detection:** notices signups as they happen and asks to confirm.
3. **Manual add:** fallback only.

## Ground rules (decided, don't change without asking the founder)

- **The designs are the spec (UX-first).** Build what the screens need, including features that were "backlog" earlier. There's no separate V1/V2 list.
- **Local-first. No servers for user data, no bank linking, no data selling.** Everything lives in `chrome.storage` in the user's browser. "Nothing leaves your computer" appears in the UI and must stay true.
- **No LLM.** Every number, insight and sentence comes from code: rules + sentence templates (product-plan §8).
- **Never add a subscription silently.** Detections and uncertain scan results are always confirmed by the user.
- **Wording about usage:** "No visits on this computer" / "No visits in 64 days", never "unused". We can't see phones or TVs.
- **Honest savings:** count only cancellations made while using the extension, from the cancellation date onward (product-plan §6).
- **Cancel help:** one verified link per service + general steps. If receipts come from Apple / Google Play / Amazon / PayPal, send the user there instead (product-plan §9).

## Designs

- **Files:** [docs/designs/](designs/), one `.dc.html` per screen (plain HTML with inline styles; the `<script type="text/x-dc">` block at the bottom just holds sample data and the accent colour). `canvas.json` lists them with titles and sizes. Open any file in a browser to see it, though fonts/runtime may not load outside the canvas.
- **Live canvas (clickable, Play mode):** https://claude.ai/artifact/ETmgXkGUmeJnW56Sx9pUXH. It's private to the founder's claude.ai account. The files in `docs/designs/` are a copy as of this handoff; if the founder edits the canvas later, ask whether to re-sync.
- **Dark mode only so far.** Light mode hasn't been designed. Build dark first with colours as CSS variables so light can be added (Settings has a System / Light / Dark switch in the design).

| Surface | Screen | File |
|---|---|---|
| Popup (380 wide, max 600 tall; header + footer fixed, middle scrolls) | Home | `Main.dc.html` |
| | Detected signup | `PopupDetected.dc.html` |
| | First run | `PopupEmpty.dc.html` |
| Side panel (designed at 360 wide, must stretch when the user drags it wider; header + tabs fixed, content scrolls) | Overview (incl. savings card, 12-month forecast, ring chart) | `PanelOverview.dc.html` |
| | Savings card, zero state (before any cancellation) | `SavingsZero.dc.html` |
| | Subscriptions, list view | `PanelList.dc.html` |
| | Subscriptions, calendar view (toggle, not a tab) | `PanelCalendar.dc.html` |
| | Subscription detail | `PanelDetail.dc.html` |
| | Review (please confirm + detections + already sorted) | `PanelReview.dc.html` |
| | Gmail scan results (after the scan) | `PanelScanResults.dc.html` |
| | Savings | `PanelSavings.dc.html` |
| | Settings | `PanelSettings.dc.html` |
| Reference | Components: colours, type, rows, tags, cards, buttons, budget meter | `Components.dc.html` |

**Navigation:** popup "Open full view" → side panel Overview. Side panel tabs: Overview · Subscriptions · Review. Settings via the header icon. First run "Scan my Gmail receipts" → scan runs in the **side panel** (a popup closes when you click away) → Scan results → "Add N subscriptions" → Overview.

**Visual rules:**
- Colours: background `#0D0E10`, surface `#15171A`, raised `#1C1F23`, border `#262A30`, text `#EDEEF0`, muted text `#A0A6AF`, accent `#8AB4FF`, attention amber `#F4B740` on tint `#2A2213`, cancel red `#FF7A7A`.
- **One solid accent per screen** (the main action). Amber only as text or a tint, never a solid fill. Cancel buttons: red text + red border.
- Service logos: neutral tile + softly tinted letter in the designs. In the build use Chrome's favicon cache (`favicon` permission, `chrome-extension://<id>/_favicon/?pageUrl=…&size=32`) with the letter tile as fallback.
- Inter in the designs; Chrome's UI uses the system font. Either is fine; money uses tabular figures.
- Sample data on the boards is illustrative and internally consistent (e.g. $85.95/mo = sum of the active subscriptions). Real screens compute everything.

## What exists in the code today

**Updated 2026-10-22, after the build:** every screen in the designs is built (popup, side panel, Gmail scan and re-sync, Review, Savings, Settings) and the data model below has been added. See [BUILD.md](BUILD.md) for what was built, where, and what's left; [TESTING.md](TESTING.md) for checks in real Chrome. The sections below up to "Validate during the build" describe the code *before* the build and are kept for history.

<details>
<summary>Before the build</summary>


Vanilla JS ES modules, no build step, no dependencies. Load unpacked from the repo root. `npm test` runs the parser tests (14 passing).

| Area | Files | State |
|---|---|---|
| Manifest | `manifest.json` | Permissions: storage, alarms, notifications, history, webNavigation, identity (+ sidePanel, favicon, activeTab, scripting added during the build, see BUILD.md); Gmail OAuth with a placeholder client ID |
| Background worker | `src/background.js` | Checkout detection → pending item + notification; live "last used" updates; hourly renewal check (rolls dates forward, notifies `reminderDays` before); notification buttons |
| Checkout detection | `src/lib/detection.js` | URL-pattern only (success pages, Stripe/Paddle/PayPal hosted checkouts, return-from-processor). Can't read prices yet |
| Gmail import | `src/lib/gmail.js`, `inbox-scan.js`, `receipts.js`, `src/import/` | Works with sample data; **not yet run against a real inbox** (needs a client ID, see README). Parser groups by merchant, extracts amount, cycle, renewal date, trial, cancelled/lapsed, confidence. Import UI is a full-page tab in an older style |
| Popup | `src/popup/` | Functional but old UI (list + add/edit form). Needs rebuilding from the designs |
| Dates / money / calendar | `src/lib/dates.js`, `money.js`, `calendar.js` | Billing-cycle maths (month-end anchoring), `.ics` and Google Calendar links |
| Services list | `data/services.json` | 24 services: name, domains, cancelUrl. **Cancel URLs were written from memory and are unverified** |
| Styling | `src/ui/tokens.css`, `src/ui/dom.js` | Old light/dark tokens (not the new palette); tiny DOM helper |

**Not built yet** (all shown in the designs): side panel, Review, Savings and savings ledger, budget + cut suggestions, 12-month forecast, categories / ring chart, weekly visit counts and cost per visit, price history and price-rise alerts, background Gmail re-sync, checkout price reading, reason templates (`reasonFor(candidate)`, product-plan §8), cancellation verification ("we'll watch for the cancellation email"), export/restore, theme switch.

## Data to add

- `subscriptions[]`: add `charges[]` (already written by the import), `category`, `status` (active / trial / cancelled), `cancelledAt`, `cancelledWhileTracking` (for honest savings), `priceSource` (checkout page / receipt / manual), `confirmedByReceipt`.
- Weekly visit counts per subscription (Chrome history only keeps ~90 days).
- A savings ledger, or derive savings from cancelled subscriptions + `cancelledAt`.
- `data/services.json`: add `category`, `plan` (e.g. "Prime", used in reason sentences), `verifiedAt` per link, and any channel hints.
- Sync: the subscription list and settings could use `chrome.storage.sync` (~100 KB limit); history stays in `storage.local`.

</details>

## Validate during the build

Things that were decided on reasoning or memory rather than tested. Check them before relying on them:

1. **Every cancel URL in `services.json`**: verify each, or fall back to the service's main site. Record `verifiedAt`.
2. **The receipt parser on real inboxes.** Set up the Gmail client ID (README), run on real accounts (Testing mode allows 100 test users; sign-ins expire weekly), and tune the rules. Watch Apple/Google Play receipts (several apps in one email) and Amazon (orders vs Prime).
3. **Chrome APIs:**
   - `chrome.sidePanel` (opening it from the popup button needs a user gesture)
   - the `favicon` permission and URL format
   - `chrome.action.openPopup` (used as a fallback from notification clicks; may need a focused window)
   - notification buttons on macOS
   - `unlimitedStorage` if needed
4. **The final permission list before the first store release.** Adding a permission later disables the extension for existing users until they approve it. Target install warning: only "Read your browsing history". Checkout price reading likely needs `activeTab` and/or host permissions for a curated list of payment processors (product-plan §3). Weigh the extra install warning.
5. **Google OAuth.** *Stage 1 done (2026-10-22):* Google Cloud project "Subscription Check" under the 99rebels organisation; Gmail API enabled; consent screen External, **Testing**, restricted scope `gmail.readonly`; dev Client ID (Chrome Extension type) is in `manifest.json`. **Since 2026-10-23 the extension ID is fixed** by the `key` in `manifest.json` (ID `poifdgfdbgmjpblgaogeidddepffcpjp`), so any copy loaded unpacked, from any folder or worktree, signs in; the OAuth client's Item ID must match it. The private key (`.pem`) lives outside the repo with the founder: needed for the Web Store, never committed. Test users are managed in Google Auth Platform → Audience. Restricted Gmail scope: the free verification is required for launch. The paid security assessment (CASA) should not apply because nothing is sent to a server, but confirm with Google in writing before launch. Verification takes 2–8 weeks; flag to the founder when it's time to start.
6. **Checkout detection false positives** (generic "thank you" pages). It only ever asks, but too many prompts annoy.
7. **Date handling:** local `YYYY-MM-DD` strings throughout. Check month-end and time-zone edges in any new code.

## Not decided: ask the founder

- Product name (the current one is generic).
- Free vs. paid split and pricing (reference: Subwatch, $11.99 one-time).
- The "Ideas to consider" list in product-plan.md (shared plans, overlap alerts, heads-up at checkout, shareable savings card, pause option, open-sourcing). **Not in scope unless the founder says so.**
- Light mode look.
- ~~Whether to add a framework or bundler.~~ Decided 2026-10-22: stay vanilla, no build step (product-plan decisions).

## Working with the founder

- Writes informally and thinks out loud. Explain in plain language, give a recommendation rather than a menu, keep replies short.
- **Record decisions and ideas in `docs/product-plan.md`** as they come up. They've asked for this.
- Git repo on `main`, **public** at https://github.com/99rebels/Subscription-Tracker (since 2026-10-23; history restarted as one clean commit). No personal data in code, tests or docs: use made-up examples; the founder's inbox export and answer sheet stay in git-ignored `tests/fixtures/inbox/`. Commit as you go with clear messages; ask before pushing or creating PRs.
