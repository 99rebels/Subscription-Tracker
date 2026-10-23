# Build plan and progress

The working plan for building the designs. Any instance picking this up: read [HANDOFF.md](HANDOFF.md) first (ground rules, designs, what existed before the build), then this file, then `git log`. Tick boxes and add notes here as you go, and commit with the work.

Decisions behind this plan are in [product-plan.md](product-plan.md) (decisions table): build order, no framework, `activeTab`-only price reading, currency conversion, and what's parked.

## Where things stand (2026-10-23)

**The build is complete.** Every screen in `docs/designs/` is built (steps 1–5 below), totals convert between currencies, and cancel links have had an automated check. 62 unit tests pass (`npm test`).

**Founder testing in real Chrome** ([TESTING.md](TESTING.md)): the founder reports everything works **except one thing:**

- **Renewal reminder didn't arrive.** The founder set a subscription's next charge to tomorrow (Detail › Edit) and got no notification. They're keeping an eye on it. This is the first thing to look at. Leads, most likely first:
  1. **Timing.** `checkRenewals()` in `src/background.js` runs on startup and then hourly (`renewal-check` alarm); editing a subscription doesn't trigger it. So a reminder can take up to an hour. Reloading the extension runs it at once. Likely fix: also run `checkRenewals()` when `subscriptions` change (the `storage.onChanged` listener already exists), so a reminder fires straight after an edit.
  2. **macOS / Chrome notification settings.** System Settings › Notifications › Google Chrome (allowed? Focus mode?), and `chrome://settings/content/notifications`. Chrome on macOS shows extension notifications as native ones.
  3. **State.** In the service worker console (`chrome://extensions` › service worker): `chrome.storage.local.get("subscriptions")` and check that sub's `nextRenewal`, `reminderDays`, `notifiedFor` (must not already equal `nextRenewal`), and `status` (trials use `trialReminderDays`, default 3). `chrome.alarms.getAll()` should list `renewal-check` and `gmail-sync`.
  4. **Notification options.** `notifyRenewal()` uses `requireInteraction: true` plus buttons; if nothing shows at all, try a bare notification from the console to rule out the options.

- **Receipt parser got real emails wrong** (2026-10-23): GoDaddy (yearly) came out monthly; a Canva "trial converting" email became a €12/mo receipt. Plan agreed: rebuild the parser around email types. See **Step 6** below and product-plan feature 10.

**What's left, none of it urgent:**
- Cancel links by hand: Paramount+, Canva, Peacock, Apple (see "Also to do" below), then record `verifiedAt`.
- Before the first store release: the install-warning check for the `favicon` permission and Google's OAuth verification (TESTING.md, last section).
- Founder decisions still open: product name, pricing (free vs paid), light-mode design.
- Backlog in product-plan.md (e.g. #8 charge after cancelling, parked by the founder).

**Working with the repo:** the founder sometimes runs another instance at the same time (the Gmail OAuth setup was done that way). Check `git log` / `git status` before committing.

## Conventions

- **Plain JS modules, no build step.** Load unpacked from the repo root; `npm test` runs Node tests.
- **Logic in `src/lib/`, pure where possible** (no `chrome.*`), with tests in `tests/*.test.mjs`. UI files only render.
- **Numbers vs words:** `summary.js` returns numbers and lists; sentence templates (usage wording, confirm reasons) go in a separate text module used by the UI (step 2), never an LLM.
- **Storage goes through `storage.js`.** Subscriptions are normalised by `normalizeSubscription()` in `model.js`; the shape is documented at the top of that file. Schema changes bump `SCHEMA_VERSION` and add a migration in `model.js`.
- **Status is the source of truth** (`active` / `trial` / `cancelled`). The old `isTrial` field is only read when migrating old data.
- **Every sum takes the currency converter** (`fx.js`, `state.conv` in the panel and popup); amounts on a single subscription stay in its own currency.
- **Check the screens visually** with `dev/preview.html` / `dev/popup-preview.html` and headless Chrome (see the comments at the top of those files). macOS has no `timeout`; guard headless runs with a background pid + kill.
- **Cancelling goes through `cancelSubscription()`** so honest-savings fields (`cancelledWhileTracking`, `avoidedFrom`, `cancelledDuringTrial`) are always set.
- **Dates:** local `YYYY-MM-DD` strings; helpers in `dates.js`.

## Step 1: Data model and colour setup (done)

- [x] `model.js`: subscription shape, `normalizeSubscription`, `cancelSubscription` / `undoCancel`, storage migrations (v1 → v2)
- [x] `dates.js`: `addDays`, `addMonths`, `addMonthsToKey`, `weekStart`
- [x] `money.js`: `formatMoney`, `monthlyCost` (status-aware), `monthlyPrice`, `cents`
- [x] `summary.js`: totals, budget, stale / worth reviewing, upcoming, trials ending, projected charges, month view, 12-month forecast, categories, savings (+ monthly series), price history, weekly visits, cost per visit
- [x] `usage.js`: weekly visit counts (30-minute visit gap), history backfill
- [x] `storage.js`: new defaults (visits, settings, stats, installedAt), settings merged with defaults, `migrateStorage`, visit recording
- [x] Legacy popup and import save the new shape (status, price source)
- [x] `background.js`: run migration on startup; set `installedAt` on install; honour `detectCheckouts` / `trackVisits`; detect re-subscribing to cancelled services; record weekly visits; backfill usage from history for any new subscription (via `storage.onChanged`, flag `usageBackfilled`); skip cancelled in reminders; trial → active when the trial ends; trial vs renewal reminder defaults; count `stats.remindersSent`
- [x] `data/services.json`: `category` for each service; `plan` where used in sentences (Amazon → "Prime")
- [x] `src/ui/tokens.css`: new dark palette as CSS variables (HANDOFF visual rules), light placeholders, `data-theme` switch; keep old variable names as aliases until legacy pages go
- [x] `manifest.json`: add `sidePanel`, `favicon`, `activeTab` (final permission list; see HANDOFF "Validate" #4)
- [x] Tests: `model`, `summary`, `usage` (fixtures are the design boards' sample account, so the tests prove the screens' numbers)
- [x] `src/ui/theme.js`: applies the theme setting to a page (call `applyTheme()` on load)

## Step 2: Side panel (Overview, Subscriptions, Detail) (done)

- [x] `side_panel` in manifest; `src/panel/` (header + tabs fixed, content scrolls, fluid width); hash routes listed at the top of `panel.js`
- [x] Shared component CSS (`src/ui/components.css`) and builders (`src/ui/components.js`: icons, logo tile, row, tags, chips, budget meter)
- [x] Logo tiles: Chrome favicon cache, compared against Chrome's generic globe so unknown sites get the letter tile. **Not yet checked in real Chrome** (HANDOFF validate #3)
- [x] Text module `src/ui/text.js` (+ tests): usage wording ("no visits in N days" for 30+), renewal lines, forecast note, dates/money
- [x] Overview: total, budget meter, savings card (+ zero state), needs attention (trials ending ≤7 days, signups spotted at checkout, price rises in the last 45 days), worth reviewing, coming up, 12-month forecast, where it goes (ring)
- [x] Subscriptions: search, sort, filter chips (via `#subscriptions?filter=…`), totals line, cancelled group; List / Calendar toggle with month grid, day card, all charges
- [x] Detail: price + receipt/pending tag, usage chart + cost per visit, next charge, reminder choice, billing, add to calendar (Google / .ics), price history, how to cancel (`src/lib/cancel.js` routes Apple / Google Play / Amazon / PayPal), "I still use it on another device", cancelled state with Undo
- [x] Add / edit form (`src/panel/edit.js`): no board for it; built from the components
- [x] Theme setting applied (`applyTheme()`)
- [x] Preview harness: `dev/preview.html` renders the real panel with the designs' sample account and a fake `chrome` (see the comment at its top). Use it with headless Chrome to screenshot screens.

Notes for later steps:
- **Cancel flow until Gmail sync exists:** the cancel button opens the site and sets `cancelStartedAt`; the Detail page then asks "Did you cancel X?" → `cancelSubscription()`. When background Gmail sync lands (step 4), add the design's "We'll watch for the cancellation email" and confirm automatically.
- **Placeholders** (`src/panel/placeholder.js`) stand in for Review (step 4), Savings and Settings (step 5).
- **Temporary:** the legacy popup has an "Open full view" button that opens the side panel; it goes when the popup is rebuilt (step 3).
- The Overview "Needs attention" should also show "Please confirm" items once Review exists (step 4).

## Step 3: Popup (done)

- [x] Home (`Main.dc.html`): total, budget meter, needs attention (trials ending, recent price rises, the most expensive thing not opened lately), coming up, Open full view
- [x] Detected signup (`PopupDetected.dc.html`): reads the price from the checkout tab with `activeTab` + `scripting` when the popup opens on that tab (`src/lib/checkout-price.js`, tested); price/cycle inputs when it can't; "over budget" note via `budgetImpact()`; Track it / Not a subscription
- [x] First run (`PopupEmpty.dc.html`). "Scan my Gmail receipts" still opens the old import page until step 4
- [x] Popup → side panel: `sidePanel.open()` inside the click (window id looked up first) plus a `panelNavigate` request in `storage.session` that the panel picks up, so buttons open the right screen
- [x] Notification clicks: renewal → side panel at that subscription; detection → popup (falls back to the panel). **Check in real Chrome** whether `sidePanel.open` works from a notification click (HANDOFF validate #3); it falls back to opening the panel page in a tab
- [x] Legacy popup removed. The `isTrial` shim stays until the import page is replaced (step 4); `calendar.js` also reads it
- [x] `dev/popup-preview.html` (Home, `?detected`, `?empty`)

**Permission added:** `scripting` (needed to read the checkout page under `activeTab`; no install warning). Final list: storage, alarms, notifications, history, webNavigation, identity, sidePanel, favicon, activeTab, scripting. **Check:** `favicon` has its own warning ("Access the icons of the websites you visit"); unconfirmed whether Chrome folds it into the history warning (docs/TESTING.md, "Before the first store release").

## Step 4: Gmail scan results and Review (done)

### 4a: Scan and Review (done)
- [x] Scan runs in the side panel (`#scan`, `?start=1` from the popup's first run and the Overview's empty state): intro → progress → results. Without an OAuth client ID it scans the sample inbox (`src/lib/sample-inbox.js`) and says so; the dev client ID is now in `manifest.json` (HANDOFF validate #5), so the unpacked extension reads the real inbox. The old `src/import/` page is gone; first install opens the panel page in a tab.
- [x] `analyseInbox()` in `receipts.js`: candidates plus `rejected` (irregular one-offs like Uber) and `questions` (a service sold as a plan the receipts never mention: "Do you have Prime?"); candidates gain `cancelledOn`, `processor` ("Billed via Stripe"), `billedVia` (PayPal)
- [x] `src/lib/scan.js` (+ tests): `classifyScan` → paying / please confirm / not added; `reasonFor` templates (one old receipt → "If it's yearly, it renews Nov 16"; receipts stopped; no price; one receipt; not sure); `candidateToSubscription` for every answer
- [x] Results screen: totals, "on things you don't open" callout, tick/untick, answer inline or later, "Add anyway", "Add N subscriptions". Cancelled candidates are stored as cancelled-before-you-joined (listed, never counted in savings)
- [x] Review tab (`src/panel/review.js`): Please confirm, Spotted while browsing (Track it / Not a subscription), Already sorted with Undo, Gmail card
- [x] `src/lib/review.js`: `answerReview`, `undoSorted`, `trackDetection`, shared by the panel, Overview and popup. Storage: `review`, `sorted`, `gmail`
- [x] Questions appear in "Needs attention" on the Overview and popup
- [x] `isTrial` shim removed; `status` is the only source of truth
- [x] Preview: `?click=Label` clicks buttons by text after loading, for flow checks with headless Chrome. (macOS has no `timeout`; guard headless runs with a background pid + kill.)

### 4b: Background Gmail re-sync (done)
- [x] `src/lib/resync.js` (+ tests) `mergeReceipts()`: new receipts append charges, confirm or correct a checkout-read price, roll `nextRenewal`, flag price rises; a cancellation email confirms a cancellation started with us (`cancelStartedAt`), otherwise asks "Did you cancel X?"; receipts from something new ask "Track X?". `gmail.askedKeys` stops repeat questions (the scan adds everything it showed).
- [x] Background `syncGmail()`: every 6 hours (`gmail-sync` alarm) and on "Check now" (`runtime.sendMessage({ type: "gmail-sync" })`). Never signs in interactively: an expired sign-in (weekly in Testing mode) sets `gmail.needsSignIn` and the Review card offers Reconnect.
- [x] Notifications: price rise ("Netflix went up to $19.99"), cancellation confirmed. Both open the side panel at the subscription.
- [x] Detail shows "We'll watch for the cancellation email…" when Gmail is connected, and "Confirmed by email" on cancelled ones.
- [x] Badge counts everything waiting in Review (signups + questions).
- Not done (backlog): a charge arriving *after* a cancellation ("Netflix charged you after you cancelled"); BillSensor has this. Easy to add in `mergeReceipts`.

**Needs a real inbox:** none of the Gmail paths (scan or re-sync) have run against real mail yet. Next manual check: load unpacked, run the scan, then "Check now" on Review (HANDOFF validate #2).

## Step 5: Savings and Settings (done)

- [x] Savings page (`src/panel/savings.js`): total, running-total chart, where it came from ("$9.99 × 6 months", trials "before its first charge"), also looked after, honest-counting note naming anything cancelled before joining; zero state shows what could be saved
- [x] "Also looked after": renewal reminders sent, price rises spotted (`stats.priceRisesSpotted`, counted by the re-sync), and **trials stopped in time** in place of the design's "Surprise charges", which needs a charge-after-cancelling check we don't have yet (backlog)
- [x] Settings (`src/panel/settings.js`): budget + suggest cuts, reminder defaults, monthly check-in, all renewals as one `.ics`, Gmail connect/disconnect, checkout detection and visit tracking switches, theme, currency, export (CSV / backup file), restore (`src/lib/backup.js`, tested), delete all data
- [x] Cut plan (`cutPlan()` in `summary.js`, tested): when over budget, under the Overview's meter: "You're $5.95 over. Cancelling Dropbox (no visits on this computer) brings you $4.04 under."
- [x] Monthly check-in notification on the first check of each month (background `checkRenewals`)
- [x] `h()` now flattens nested child arrays (two screens printed "[object …]" before)

## Step 6: Receipt parser rebuild (in progress)

Why and the design: product-plan feature 10. Work in this order so every change is measured.

- [x] **Test inbox (tool built; founder to run it):** `dev/export-inbox.html` (open as `chrome-extension://<id>/dev/export-inbox.html`) runs the real Gmail fetch + `htmlToText`, removes personal details (`src/lib/scrub.js`) and saves `inbox-export-YYYY-MM-DD.json`. Put it in `tests/fixtures/inbox/` (git-ignored). Each message records whether the scan's search found it (`inProductionQuery`; `npm run scorecard -- --scan-search` shows only those).
- [x] **Answer sheet (drafted, 29 services; founder to correct):** `tests/fixtures/inbox/answers.mjs` (personal, git-ignored, next to the export; `tests/fixtures/answers.example.mjs` shows the format), one entry per service: what the parser should conclude. Drafted from the founder's inbox; **founder corrects it**.
- [x] **Scorecard:** `npm run scorecard` (`scripts/scorecard.mjs`) runs `analyseInbox` + `classifyScan` over the export and prints right/wrong per field and per service, plus false positives. Not part of `npm test`, since it needs the private export.
- [x] **Email typing** (`src/lib/email-type.js` `classifyEmail()`, `tests/email-type.test.mjs`): receipt · upcoming · trial_start · trial_ending · cancellation · payment_failed · marketing · shipping · other. Gmail's Promotions/Social tabs and promo subjects are marketing; trial and reminder wording only counts in the subject + first 600 characters (`leadText()`, after stripping preview-line padding). In `analyseInbox`: only receipts make charges; trials get their end date and convert-at price; a trial that ended 14+ days ago with no receipt is cancelled; a failed payment counts as "still running" for lapsed; promos, personal mail providers and SENT mail are dropped; a candidate needs subscription wording near the top, a known service, or 3+ regular charges.
- [x] Also fixed on the way: "Subtotal"/"Sub total" taken as the total; "you'll be charged €X" taken as charged; `htmlToText` leaving `&zwnj;`/`&shy;`; "unsubscribe" matching "subscription"; "X dba Y" sender names; processor groups (Render via Stripe) merged with the merchant's own domain
- [x] **Re-sync** asks "Track your Canva trial? Free trial ends Oct 27, then €12.00/mo" (`resync.js`)
- [x] **Wider Gmail search** in `buildSearchQuery()` (Purchases tab, "order", "payment", "trialing", "will not renew"…). Safe now that typing drops promos and orders.
- **Scorecard (founder's inbox, 357 emails):** baseline 0 of 7 real subscriptions right, 18 of 30 services; now **34 of 35 services, 51 of 52 fields**, and every real subscription lands in the right group (paying / not added) for the right reason. Left: Bluehost's next charge (the email only gives the expiry date; Bluehost charges ~2 weeks earlier).
- [x] **Periods and dates** (`receipts.js`): `cycleHint()` reads "1 Year", "1 year(s)", "Membership: Monthly", "(Annual)", "/month" after `stripBoilerplate()` drops small print ("If your products are on a 1 month term…", terms of service, "Prices are current as of…"); first period in the email wins. `parseNumericDate()` tells DD/MM from MM/DD by the date itself, another date in the same email, or the reading closest to the send date. Trial "will begin automatically on" dates.
- [x] **Cycle order of trust** in `analyseInbox`: 3+ steady receipts → the newest receipt's wording → a reminder's or trial's wording → the gap between two receipts → typical (`services.json` `defaultCycle`, or "domain renewal" → yearly). Nothing → `cycleConfident: false`, and the scan asks ("Couldn't tell how often it charges") instead of adding it as monthly. A receipt that states its period or a long steady run raises confidence. Cancellation and failed-payment wording only counts in the subject and opening lines (Revolut's terms updates). Trials that ended show "Trial ended Sep 4, no charge since".
- [x] **Card digits read as a price** (founder found YouTube Premium at a four-figure monthly price): card digits `•••• 4242` then `€4.99` on the next line made "4242 €". Trailing-currency amounts must be on one line, not after card masking, and the sign mustn't start the next amount. The scrubber hid it (card digits → 0000), so it now writes 4s. Also: a known service whose receipts all read like one-off purchases (YouTube movies) isn't evidence of the subscription.
- [x] **Scan speed** (founder: 375 emails took ~5 min, 60 s waiting for 1 email): the time was waiting, not downloading. Now: (1) **Promotions and Social left out** of the main search, with a narrow receipt-subjects search of those tabs (`buildSearchQueries()`): 357 → 205 emails on the founder's export, same scorecard; (2) **all readers pause together** when Gmail says slow down and the pace halves, then recovers (`GmailClient` `#backOff`); request retries are short (2/4/8 s or Gmail's Retry-After); (3) **stragglers don't hold the scan**: two short passes (5 s, 15 s), then results show and the rest go to `gmail.unreadIds` for the background (longer passes, any date via `extraIds`); (4) **emails are read once** (`src/lib/mail-cache.js`, in `chrome.storage.local`, cleared on Disconnect and Delete all data), so later scans and the 6-hourly check only download new mail. Timings (`timing` from `scanInbox`, `stats` on the client) go to the console and the export file. **Measured (founder, 217 emails):** 134 s, `waitedMs` 107 s, 26 refusals; a later background check of 15 cached emails took 0.4 s. A simulation with Gmail as a **per-minute cap of ~125 reads** reproduces that run (old code: 127 s, 30 refusals), so our project seems to get far less than Gmail's documented ~3,000 reads/min/user. Pacing now: steady 20/s, one slowdown per pause (not one per refused reader), quick recovery; simulated 217 emails ≈ 76 s under that cap (~65 s is the floor), 11 s if the cap isn't there. (Learning the cap from recent successes was tried and simulated slower.)
- [x] **Found the cap: Gmail's May 2026 quotas.** Projects created on or after 1 May 2026 get **6,000 units per user per minute** (older projects keep 15,000; the console won't go above 6,000), and `messages.get` costs **60 units** for a full email (20 for metadata), `messages.list` 5. So ~100 full emails a minute, a hard floor. Source: developers.google.com/workspace/gmail/api/reference/quota. Reading headers first was checked and costs more (a safe header filter only rules out 54 of 205).
- [x] **Paced to the quota** (`GmailClient` `#reserve`): units counted over a rolling minute, capped at 5,700; a request waits until it fits instead of being refused. Simulated: 50 emails 3 s, 185 emails 65 s, 217 emails 121 s, 700 emails 7 min, all with 0 refusals. `secondsLeft()` estimates the time; `stats.units` / `quotaWaitMs`.
- [x] **Search trims** (free: searching costs 5 units a page): `-in:sent` and `-subject:(delivered OR dispatched OR "out for delivery" OR shipped OR "on its way")`. Founder's export: 205 → 186 emails, which fits in two quota windows (~65 s instead of ~2 min), same scorecard.
- [x] **Scan screen:** "Reading 120 of 217 emails · about 1 minute left"; a note when it'll take over half a minute ("Gmail lets apps read about 100 emails a minute…later scans are quick"); **Found so far**: names (and Trial) of what the emails read so far add up to, fading in as they turn up (`scanInbox` `onFound`, every 8 emails). Names only, since prices and dates can change as older emails arrive.
- [ ] Ask Google for a higher per-user quota (Quotas & System Limits); approval not guaranteed
- [x] **No email lost to Gmail's rate limits** (`gmail.js` `getMessages()`, `tests/gmail.test.mjs`): requests paced at 40/s (Gmail allows ~50 reads/s/user) with 5 in flight; request() retries 429/403-quota for over a minute; anything still refused gets up to 2 more passes 65 s apart; whatever's left is reported (scan results note, export `failures`), and the background sync keeps its marker so it re-reads those days. An expired sign-in stops the read at once. 700 emails ≈ 3,500 quota units, about 20 s at this pace.
- [x] Scan progress: slow spinner + a line that changes every 5 s ("Finding your subscriptions…"), drawn once; progress updates only the bar and the count in place, and a redraw mid-scan resumes the animations where they were (negative `animation-delay` from the scan's start). Sample-inbox scans step through the emails so the preview shows it.
- [x] Review › Already sorted: ✕ clears an entry from the list (`dismissSorted()`); what it stored stays.
- [ ] **Line items** ("what you're paying for", product-plan idea 7): keep each receipt's item lines on the charge; show on Detail; split one sender into products from them
- [ ] Grouping: `merchantOf()` matches services.json subdomains both ways, so every google.com sender (Workspace, Store, Play) becomes "Google Play subscriptions"; services.json only knows amazon.com (Prime here is amazon.de); one merchant across senders (Render: render.com then Stripe)
- [ ] **Overfitting check:** run the scorecard on testers' inboxes the rules weren't tuned on (same export page + their own answer sheet)
- [ ] Later: tester export flow (same page, for Testing-mode users), split one sender into products

## Also to do during the build

From HANDOFF "Validate during the build":

- [x] **Cancel links, automated pass (2026-10-22):** `npm run check-links` (`scripts/check-cancel-links.mjs`) visits every link in `services.json` and reports whether it still loads on the service's own site. All 24 load. Fixed: GitHub (`/settings/billing` was a 404 → `/settings/billing/summary`); Apple moved to `account.apple.com/…/subscriptions`. Store links in `cancel.js` checked with curl.
- [ ] **Cancel links, by hand (needs a person):** signed in, does each link open the subscription page? Record `verifiedAt` per service. Couldn't be checked automatically: **Paramount+** and **Canva** (block automated requests), **Peacock** (not available in Ireland, where this ran), **Apple** (decides with JavaScript).
- [ ] **Receipt parser on real inboxes (needs the founder):** run the scan on a real Gmail, then "Check now" on Review. See `docs/TESTING.md`.
- [ ] **Chrome APIs in real Chrome (needs the founder):** see `docs/TESTING.md`.

## Open questions found while building (all resolved)

- **Totals with mixed currencies:** resolved: converted at ECB daily rates (`src/lib/fx.js`, background `refreshRates()`; product-plan decisions).
- **Usage wording:** resolved: "No visits in N days" for 30+ (`text.js` `usage()`).
- **Forecast leaves trials out:** confirmed by the founder.
- **Charge after cancelling:** parked in the product-plan backlog (#8).
