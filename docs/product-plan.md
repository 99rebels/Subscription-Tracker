# Product plan

Living notes on what we're building and why. Newest decisions are at the top of each section. Competitor research is in [competitors.md](competitors.md).

## The problem (in the founder's words)

> "I know I'm paying for things I don't need every month. I wish I had a way to know what they are to cancel (I can't remember what I pay for) and I wish I knew when they were going to charge me so I would get some incentive to cancel."

The product's job: **make sure you never pay for something you're not using, with almost no effort from you.** No manual input unless there's truly no other way.

## Decisions so far

| Date | Decision | Why |
|---|---|---|
| 2026-10-24 | **Gmail only: no browsing history, no checkout detection.** Removed visit tracking ("last used", visit charts, cost per visit) and checkout detection (URL spotting + reading the price off the page). New signups are found from their receipt email: the re-sync now runs hourly and notifies "Track X?". Permissions drop `history`, `webNavigation`, `activeTab`, `scripting`, so the "Read your browsing history" install warning goes. | Founder: visits on one computer give false signals both ways (Netflix watched on the TV, insurance you'd never visit), and a tool reading your history can put people off. Price reading only worked if the user clicked our icon on the checkout page, which few would do; the receipt has better data and arrives anyway. Cost: a signup that sends no email at first (some trials) isn't seen until its first receipt or reminder. |
| 2026-10-24 | **"Still using it?" replaces usage.** We ask on each renewal reminder ("Keep it" / "Cancel / manage"), on Detail, and in **Still using these?** on the Overview (one-tap Keep). A yes is remembered for 90 days. The cut plan, "Worth reviewing", the savings zero state and the monthly check-in count only what hasn't been kept. | Never wrong, because it's the user's own answer; fits the founder's problem ("know before I'm charged") better than guessing from visits. Agreed with the founder. |
| 2026-10-23 | **First scan is paced to Gmail's quota and says how long it'll take**, showing what it finds as it goes. ~100 full emails a minute is a hard limit for our project (6,000 units/user/min, 60 per email since May 2026); later scans only read new mail. | Founder's 217-email scan took 134 s with 26 refusals. Pacing to the quota removes refusals; an honest time and live finds make the wait feel useful (founder suggested the live finds). |
| 2026-10-23 | **The scan skips Gmail's Promotions and Social tabs** (plus a narrow receipt-subjects search of them), keeps a local copy of emails it has read so they're never downloaded twice, and shows results without waiting for the last few emails Gmail is slow to give (the background fetches those). | Founder: a 375-email scan took ~5 minutes. 42% of matches were promotions the parser discards; time went on rate-limit waits. Same scorecard with 43% fewer emails. |
| 2026-10-23 | **Rebuild the receipt parser around email types** (feature 10): decide what each email *is* (receipt, reminder, trial, cancellation, failed payment, one-off order, other) before reading anything from it; only paid receipts count as charges; never default to monthly silently. Measured with a scorecard against the founder's real inbox and an answer sheet the founder corrects. | Founder testing: GoDaddy (yearly) came out monthly; a Canva trial-ending email was treated as a €12 monthly receipt. Both trace to "any email with a price is a charge". |
| 2026-10-23 | **Not relying on schema.org markup in emails.** Checked 16 real receipts/reminders (GoDaddy, Canva, Stripe, UFC, Scribd, Google, Steam, Uber…): none carry it. | It would only be a bonus path if some sender uses it. |
| 2026-10-23 | **Test emails come from a developer export page** (`dev/export-inbox.html`) that runs the extension's own Gmail fetch and HTML-to-text, removes personal details and saves a file. The same tool will collect emails from testers. Exports are git-ignored until the founder decides otherwise. | Gmail's plain-text versions differ from what the parser reads (Canva's invoice has no price in its plain text). No public dataset of subscription emails exists. |
| 2026-10-22 | **Totals convert between currencies** at the European Central Bank's daily rates (via Frankfurter, no key). Fetched at most once a day and only when something is priced in another currency; the request carries no user data. Individual prices stay in their own currency. | Founder decision. Keeps "nothing leaves your computer" true for user data. |
| 2026-10-22 | **Forecast leaves trials out** (matches the yearly total); the calendar shows them as "if you keep it". | Founder confirmed. |
| 2026-10-22 | **Not now: a warning when something charges you after you cancelled.** Parked in the backlog. | Founder decision. Savings shows "Trials stopped in time" instead of "Surprise charges" until then. |
| 2026-10-22 | *(Superseded 2026-10-24.)* **Cut plan only suggests subscriptions not opened in 30+ days**, ranked by monthly cost × days since the last visit; trials and "I still use it on another device" are never suggested. | Suggesting something used yesterday would feel wrong; if the not-visited ones don't cover the gap, it says how much they'd save instead. |
| 2026-10-22 | **Savings › "Also looked after" shows "Trials stopped in time"** instead of "Surprise charges" for now. | We can't count surprise charges honestly until the re-sync checks for charges after a cancellation (backlog). |
| 2026-10-22 | *(Superseded 2026-10-24.)* **`scripting` permission added** alongside `activeTab`: reading the checkout page needs both. No install warning. | Found during the popup build (BUILD.md step 3). |
| 2026-10-22 | *(Superseded 2026-10-24.)* **Checkout price reading uses `activeTab` only** (read the page when the user clicks our icon). A curated site list, if ever added, will be an *optional* permission requested in context, so existing users aren't disabled. The receipt email fills in prices we miss. | No extra install warning; keeps the privacy pitch. Closes open question on feature 3. |
| 2026-10-22 | **Build order:** 1) data model + colour tokens, 2) side panel Overview / Subscriptions / Detail, 3) popup Home, 4) Gmail scan results + Review, 5) Savings + Settings. | Almost every screen depends on the new data fields, so they come first. Gmail OAuth is being set up in parallel so the parser can be tested on a real inbox early. |
| 2026-10-22 | **No framework, no build step.** Plain JS modules plus a small helper for drawing screens. | Simplest to load and debug; MV3 forbids remote code anyway, so any library would have to be bundled. |
| 2026-10-22 | `docs/designs/` matches the live canvas as of the start of the build. | Founder confirmed. |
| 2026-10-22 | **Go broad (consumers + freelancers), not a niche.** Team features are parked. | Wider customer base; the difference is mostly marketing. Freelancer extras (business tags, export) can come later. |
| 2026-10-22 | **Win on distribution and execution, not features.** | No subscription-tracker extension has more than ~300 users; every feature exists somewhere, but nobody combines them or markets well. See [competitors.md](competitors.md). |
| 2026-10-22 | **Local-first, no bank login, no data selling.** | Trust is the main differentiator against Rocket Money (sells/shares some data unless you opt out) and the email-scanning stigma (Unroll.me). |
| 2026-10-22 | **Gmail via the API, reading locally in the browser.** | Free OAuth verification; the paid security assessment (CASA) applies only to apps that handle Gmail data on a server. Confirm in writing with Google before launch. Fallback: read the Gmail web page. |
| 2026-10-22 | **UX-first build.** Design the full experience we're happy with, backlog features included, then build whatever those screens need. No separate "V2" feature list to track; the designs are the spec. | Founder preference: simpler than juggling versions, and the product is shaped by the experience rather than by a feature list. |
| 2026-10-22 | **Calmer colour:** logos sit on neutral tiles (soft tinted letter / real site icon), amber is a tint not a fill, cancel buttons are red text on a neutral border. One solid accent per screen (the main action). | Founder feedback: solid brand tiles + amber + accent was too much for the eyes, and the side panel shows more items at once. |
| 2026-10-22 | **Popup: 380 wide, max 600 tall** (Chrome's limit is 800 × 600). Header and footer fixed; the middle scrolls. | Popups scroll natively; better than cramming. |
| 2026-10-22 | **Design dark mode first**; light mode adapted per view later. Palette: background #0D0E10, surface #15171A, accent #8AB4FF (adjustable), amber #F4B740 for "look at this", red #FF7A7A only for cancelling. Inter, tabular figures. Design canvas: https://claude.ai/artifact/ETmgXkGUmeJnW56Sx9pUXH | Founder: pick one mode for now. |
| 2026-10-22 | Pricing deferred. Reference point: Subwatch charges $11.99 one-time. | |
| 2026-10-22 | *(Superseded 2026-10-24.)* Usage wording is "No visits on this computer", never "Unused". | We can't see phones or TVs; being wrong about "unused" destroys trust. |

## Feature notes

### 1. Telling "cancelled a few months ago" apart from "still paying"

**Question:** If someone subscribed and cancelled within the 15-month scan, how do we know not to count it?

**What the import already does** ([receipts.js](../src/lib/receipts.js)) uses the billing-cycle idea:
- **Missed charges:** the billing cycle comes from the gaps between receipts. If the next expected charge never arrived (last charge more than 1.5 cycles + 7 days ago), it's marked **lapsed**. Example: Netflix receipts Jan–Apr, nothing since → lapsed, not counted.
- **Cancellation emails:** "your subscription has been cancelled" after the last charge → **cancelled**, which is stronger evidence.

**Where it can be wrong:**
- Services that don't email a receipt every cycle. Some only email on the first charge or when something changes, so silence doesn't mean cancelled.
- A yearly plan with one receipt and no "annual" wording gets guessed as monthly, so it looks lapsed after ~2 months.
- Paused subscriptions, switched billing email, payment-method changes.
- Apple / Google Play bundle many apps into one receipt sender.

**Improvements planned:**
- Record **why** each status was chosen (cancellation email vs. missing receipt) and show it.
- Track which merchants send receipts every cycle (learned from history: if a merchant sent 6 monthly receipts then stopped, that's strong; if it only ever sent one, that's weak).
- Missing receipts alone → **"Please confirm"**, never silently "cancelled".

### 2. A "please confirm" list

Agreed: anything uncertain should be a quick yes/no rather than silently included or excluded. The results screen becomes three groups:

| Group | What goes in it | Default |
|---|---|---|
| **You're paying for** | Regular receipts, known service, recent charge | Added |
| **Please confirm** | One receipt only, guessed billing cycle, unknown price, receipts stopped with no cancellation email, low confidence | Ask "Still paying for Dropbox? Yes / No", one tap each |
| **Cancelled** | Cancellation email after the last charge | Hidden, collapsed |

Every "Please confirm" item gets a **one-line reason** so the user can answer without digging, e.g.:
- "Last receipt was 7 months ago"
- "Only one receipt found (January), so we're not sure how often it charges"
- "Receipts stopped in June, but we didn't see a cancellation email"
- "Couldn't find a price in the receipt"

### 3. Price at checkout without manual input

> **Dropped 2026-10-24:** checkout detection and price reading were removed (decisions table). Kept below for history.

This is a core feature. Plan: **layers, each filling in what the previous one couldn't.**

1. **Read it off the page** at checkout or on the confirmation page. Checkout pages are good sources: "$20.00 per month", "billed annually", "free for 7 days, then $9.99/month" (which gives the trial length *and* the price). Hosted checkouts (Stripe, Paddle, Lemon Squeezy) have very consistent layouts.
   - **Permissions trade-off:** reading page content needs site access. Options, least to most scary:
     - `activeTab`: no install warning. Grants access to the current tab when the user clicks our icon. Flow: we detect the signup → badge/notification says "Did you just subscribe?" → user clicks the icon → we read the price from the page they're on.
     - **A curated list** of payment processor domains + the top ~200 subscription services. Works automatically with no clicks; the install warning lists "a number of websites".
     - **Optional per-site permission** requested from the confirm card ("Read price from this page").
     - All sites: the scariest warning; avoid.
   - **Recommendation:** `activeTab` + curated processor/service list. Ask per-site only as a fallback.
   - Also capture the plan the user clicked on a **pricing page** (the price on that card) as a provisional value.
2. **Confirm from the receipt email** (the founder's idea, and a good one). After a checkout detection, mark the subscription **"price pending"** and run a small targeted Gmail search a few times over the next 48 hours (`from:<merchant> newer_than:2d`). The receipt fills in or corrects price, cycle and renewal date. This needs **background Gmail sync**, which we want anyway for price-increase alerts.
3. **Known plan prices** from our services list as one-tap suggestions ("Netflix Standard $17.99?"). These go stale, so suggestions only.
4. **Ask** only if all of the above fail.

Status shown to the user: *"Price from checkout page, will confirm when the receipt arrives"* → *"Confirmed by receipt"*.

### 4. Subscription budget with a "what to cut" plan (new idea)

**The idea:** the user sets what they're willing to spend on subscriptions per month (annual plans count as price ÷ 12, as the dashboard already does). We track against it and, when over, suggest what to cut, ranked by how long since each was last used.

**Thoughts:**
- An **overall budget** plus optional **category budgets** (Streaming $30, Work tools $60, Music $12) fits better than a budget per subscription. A single subscription's price is fixed, so a per-item budget mostly says "keep/cut".
- The useful part is the **cut plan**: "You're $24 over. Cancelling Paramount+ (64 days since a visit) and Dropbox (no visits) brings you $6 under." Rank by monthly cost × time since last use. Skip trials (they're covered by the trial reminder), and let users pin "never suggest cutting this".
- Pairs well with the monthly digest and with streaming rotation ("keep 2 of your 4 streaming services at a time").
- We didn't see this in the [competitor research](competitors.md): budgeting apps (Monarch, Copilot, Rocket Money) budget general spending without usage data; QuietBurn (14 users) has Keep/Review/Cut from usage but no budget. Worth validating with users.

### 5. Where data lives (no database)

**Decision (proposed 2026-10-22): everything on the user's machine.**
- **Size:** a subscription with 2 years of charges ≈ 2 KB; weekly visit counts are a few hundred bytes. 40 subscriptions stays well under 1 MB. `chrome.storage.local` allows 10 MB (unlimited with the `unlimitedStorage` permission, which has no install warning); IndexedDB if we ever need queries.
- **Uninstall wipes local data:** Gmail receipts are the source of truth for money data, so a re-scan rebuilds price history. Export/restore in Settings covers the rest.
- **Chrome history only keeps ~90 days:** store our own **weekly visit counts per subscription**, so usage charts and cost per visit go back further. (The current code only stores `lastUsed`; this needs adding.)
- **Sync across computers:** `chrome.storage.sync` (~100 KB) syncs through the user's own Google account, not our servers. Enough for the subscription list and settings.
- **A server only when we need:** payments/licence checks, email reminders, or full multi-device history. Even then it holds who has paid, not their subscriptions.

### 6. Savings tracker (retention)

**Problem:** "saved this month" is usually $0, which argues against keeping the extension.

**Approach: show the running total since each cancellation.** A cancellation saves money every month after it, so the total grows on its own:
> **You've saved $412** since March: Hulu $9.99 × 7 months · Duolingo $12.99 × 5 months · Canva trial cancelled before its first $14.99 charge

- Supporting proof of value: trials stopped before charging, price increases caught, renewal reminders sent ("No surprise charges this month").
- **Zero state (no cancellations yet):** never show $0. Show the opportunity instead: "$27.97/mo is going to things you haven't used in 30+ days."
- **Honest counting:** only cancellations made while using the extension. Anything cancelled before install (found by the Gmail scan) appears as "Cancelled before you joined" and isn't counted.
- **Placement:** compact card near the top of Overview, tapping through to the full breakdown. Natural place to show value before any paid upgrade.

### 7. Calendar view

**Decided (2026-10-22):** a month grid doesn't earn its own tab: "when am I charged?" is already answered by Coming up and the list sorted by renewal. Proposed:
- Drop the Calendar tab; the grid becomes a List / Calendar toggle inside Subscriptions.
- Add a **12-month forecast strip** to Overview (monthly totals with big yearly charges labelled, e.g. "Nov $185, Dropbox renews"), which shows heavy months better than a grid.
- Keep the grid design for store screenshots and marketing.

### 8. Feasibility check: no LLM needed (2026-10-22)

Everything on the designs can be computed with ordinary code from three local sources: **receipts** (Gmail), **visits** (Chrome history + our own weekly counts), and **our services list**.

| Feature | How it's produced |
|---|---|
| Totals, yearly figure, budget meter, 12-month forecast, savings total | Arithmetic on stored subscriptions and charges |
| Needs attention, worth reviewing, confirm reasons ("Last receipt was 11 months ago") | Rules + text templates |
| Usage, last visit, cost per visit | Visit counts ÷ charges |
| Price history, price-rise alerts | Comparing amounts across receipts |
| Categories ("Where it goes") | A `category` field in our services list; unknown services go to "Other" and the user can change it |
| Receipt reading | Pattern rules (built, tested) |
| Price at checkout | Page-text patterns ("$X per month", "then $X/month") |
| Cancel help | Verified link + general steps (below) |

**How lines like "Found 9 order receipts. Do you have Prime?" are written:** a rule spots the situation from facts the parser already has (receipt count, regular or not, last charge, cancellation email), then fills a sentence template we wrote once. About 6–8 reason templates cover the "please confirm" list; per-service data is limited to small fields like `"plan": "Prime"`. **To build:** a `reasonFor(candidate)` function in `receipts.js`, with tests.

**Where an LLM would help, and the options:**
- Messy receipts the rules can't read (e.g. Apple receipts listing several apps), and unusual checkout pages.
- **Chrome's built-in on-device model (Gemini Nano / Prompt API):** runs locally, free, keeps the privacy promise. Not on every machine (it needs decent hardware and a large one-off model download), so it can only ever be an optional improvement with the rules as the fallback. Check current availability before relying on it.
- **A cloud LLM (e.g. the Claude API):** most capable, but sends email content to a server, costs money per scan and needs a backend. It breaks "nothing leaves your computer", so not for email content.
- **Decision:** no LLM in the product for now. An LLM can still help *us* offline, e.g. drafting service data that we then check by hand.

### 9. Cancel help: verified link + general steps

- For each known service we keep **one link we've checked** (the account/billing page, or just the main website if that's all we're sure of). Links get re-checked regularly, since services move pages.
- The steps are **general and work on almost any site**: open your account → find Subscription / Plan / Billing / Membership → Cancel and confirm (you may be offered a discount first).
- **Where they signed up decides where to cancel, and the receipt tells us:** if receipts come from Apple, Google Play, Amazon or PayPal, point the user there instead of the service's site. That's a rule in code, not per-service data.
- Unknown services: link to the website from the receipt sender, same general steps.

### 10. Receipt parser rebuild: email types first (2026-10-23)

**What went wrong in founder testing:**
- **GoDaddy came out monthly** (it's a yearly domain renewal). The receipt says `.COM Domain Renewal | €22.16 | 1 Year`, but our yearly pattern doesn't know "1 Year". Every GoDaddy receipt also carries boilerplate: *"If your products are on a 1 month subscription term, they will automatically renew next month"*. And GoDaddy's renewal notices, "may not renew" warnings and a separate new order all landed in one group, so the gaps between "charges" were meaningless and we fell back to monthly.
- **Canva trial shown as a €12 monthly receipt.** The email: *"Thanks for trialing Canva Pro! … your Monthly subscription will begin automatically on 27 October 2026 … Monthly (1 member) €12.00"*. "Trialing" isn't in our trial pattern, so the price counted as a charge; "will begin automatically on" isn't a date phrase we read. The re-sync also ignores trials entirely: it only raises a question when it sees a charge, and always words it as "New receipt".
- **The first scan couldn't have found the Canva trial:** Canva sent no email when it started. Only checkout detection can catch that.

**Real-world patterns (16 emails checked):** no structured data; amounts sometimes only in the HTML part; short dates both ways round (GoDaddy `06/01/2025` = 6 Jan, UFC `7/12/26` = 12 Jul); period wording varies ("1 Year", "Term: 1 Year", "Membership: Monthly", "(Annual)" in a plan name, "€10,99/month"); reminders and trial notices often state a date or period with no price, or a price that isn't a charge; usage-based receipts vary in amount (Render via Stripe); a €0 "subscription confirmation" can be a trial start (Scribd).

**The new pipeline:**
1. **Find** the emails: the existing Gmail search, widened (e.g. "trialing", "about to begin", "order", Gmail's Purchases category).
2. **Type each email** first: paid receipt · upcoming charge / renewal reminder · trial started · trial ending / converting · cancellation · failed payment · one-off order · other (ignored). Rules on subject + body phrases.
3. **Extract by type:** amount (the total, from the HTML version); billing period from the line by the price or a "Term" row, after stripping legal boilerplate (sentences starting "If…", terms-of-service paragraphs); dates in both day/month orders, resolved by the send date (a renewal date must be after the email).
4. **Timeline per service:** only receipts make charges and price history; reminders set the next charge and cycle; trial emails set "trial, ends X, then €Y/period"; cancellations and failed payments set status.
5. **Decide honestly:** cycle comes from receipt wording, then reminder wording, then gaps between real receipts, then a per-service default (`services.json`, e.g. registrars are yearly), then **ask**. Never a silent "monthly".

The background re-sync uses the same pipeline, so trials found there become "Canva Pro free trial ends Oct 27, then €12/mo: track it?".

**Later:** split one sender into several products (GoDaddy domain + email + hosting); usage-based amounts shown as "varies".

**How we measure it:** `npm run scorecard` runs the parser over an exported inbox and compares each service with an answer sheet (`tests/fixtures/inbox/answers.mjs`, git-ignored; example in `tests/fixtures/answers.example.mjs`) the founder corrects. It reports right/wrong per field plus anything added that shouldn't be.

## UI plan

**Style direction (proposed 2026-10-22):** simple, slick, straight to the point. Reference: subwatch.co (calendar view, logo tiles, "Netflix is about to renew in 3 days" alert card).
- Neutral greys with one accent colour; the services' own logos are the main source of colour.
- Numbers first: big, tabular figures for money.
- Compact, 1px borders over heavy shadows, ~10px radius, system font (matches Chrome's own UI).
- **Theme:** follows Chrome/system light or dark by default, with a System / Light / Dark setting. Chrome has no API for extensions to read a user's custom colour theme, so matching it exactly isn't possible.
- Service logos: Chrome's built-in favicon cache (`favicon` permission, no network request), with a letter tile as fallback.

**Pages**

| Surface | Page | Purpose |
|---|---|---|
| Popup (quick look, max 800×600) | **Home** | Monthly total, next 3 renewals, "needs attention" strip (detections, confirms), open side panel |
| | **Detected signup** | "Did you just subscribe to X? $9.99/mo (from checkout page)" Yes/No |
| | Quick add/edit | Minimal form, fallback only |
| | Empty / first run | Connect Gmail call to action |
| Side panel (stays open) | **Overview** | Total, budget meter, savings card (zero state: "you could be saving"), needs attention, worth reviewing, coming up, 12-month forecast, where it goes (ring) |
| | **Subscriptions** | Full list with sort/filter (cost, renewal date, last used) |
| | **Subscription detail** | Price history from receipts, usage, renewal, reminder setting, cancel link + guide, add to calendar, where the price came from |
| | Calendar | Not a tab: a List / Calendar toggle inside Subscriptions |
| | **Savings** | Running total saved since each cancellation, where it came from, trials stopped, price rises spotted; honest-counting note |
| | **Gmail scan results** | After the scan (side panel, since a popup closes when you click away): total, "on things you don't open" callout, You're paying for (ticked), Please confirm (with reasons), Not added (with "Add anyway") |
| | **Review / Please confirm** | Import results + detections in three groups, one-line reasons |
| | Budget + cut plan | Later (feature 4) |
| | **Settings** | Theme, reminder defaults, currency, Gmail connection, **export/backup**, privacy |
| Full page | Import / onboarding | Exists; restyle to match |

**Status (2026-10-22):** designed on the canvas: popup Home, Detected signup, First run; side panel Overview (savings card, 12-month forecast, ring chart), Subscriptions (List / Calendar toggle), Detail, Review, Settings, Savings; savings card zero state; component sheet. Still to do: light mode, restyled Gmail import page, notifications.

## Ideas to consider (2026-10-22, not decided)

1. **Shared plans:** mark a subscription as split ("Spotify Family, shared by 4") so totals show *your* share.
2. **Overlap alerts:** "YouTube Premium already includes YouTube Music, and you also pay for Spotify." An `includes` field in the services list plus a rule.
3. *(Needs checkout detection, removed 2026-10-24.)* **Heads-up at checkout:** when you're about to subscribe, "You cancelled this in May after 2 visits" or "This adds $16/mo and takes you over budget." Builds on checkout detection.
4. **Shareable savings card:** an image like "I've saved $412 with Subscription Check" with no subscription details. Helps distribution, our main edge.
5. **Pause instead of cancel:** some services let you pause; show it in the cancel help where we know it's offered.
6. **Open-source the extension:** strongest possible proof for the privacy promise. Weigh against monetisation.
7. **(2026-10-23, from founder testing)** The founder couldn't work out their own GoDaddy renewals: two domains, one sender, and for one of them no email at all. That's the product's pitch in one example. Ideas that follow:
   - **One sender, several products:** list each item on a receipt (GoDaddy domain + domain, later email or hosting) as its own subscription.
   - **"What you're paying for"** (founder idea, 2026-10-23): on the Detail page, show what the money buys, not just the price: "example.com · .COM domain renewal · 1 year", "WordPress Basic Hosting · example.ie", "Plan: Business Starter, 1 seat". Only where receipts list it (registrars, hosting, SaaS seats/plans); most streaming receipts just say the plan name. **How:** the parser keeps each receipt's line items (description + amount + term, e.g. GoDaddy's `.COM Domain Renewal | €22.16` / `EXAMPLE.COM` / `1 Year`) on the charge; Detail shows the latest set and how it changed. The same line items are what "one sender, several products" would split on, so build them together. No LLM: line items sit next to their prices in receipt tables.
   - **"Have we missed anything?"** prompt per known multi-product merchant (registrars, hosting): "You have 1 GoDaddy domain tracked. Any others?" with a quick manual add.
   - **Usage-based billing** (Render on-demand compute: $2 one month, $0 the next): show "varies, about $X/mo" or leave it out of totals. The founder is fine with not tracking these closely.
   - **Receipts sent to another address** (Codecademy goes to a different inbox): connect more than one Gmail account.
   - **Receipts don't arrive every cycle, and a failed payment isn't a cancellation** (UFC: failed in Sep, still subscribed). Status rules must not call these lapsed too eagerly.

## Before we build

- **Final permission list, decided up front.** Adding a permission later disables the extension for existing users until they approve it. Likely: storage, alarms, notifications, history, webNavigation, identity, sidePanel, activeTab, favicon. Install warning should stay "Read your browsing history".
- **Start Google's OAuth verification early** (2–8 weeks). Testing mode (100 users, weekly re-sign-in) covers us until then.
- **Test the receipt parser on real inboxes.** Accuracy is make-or-break; recruit 5–10 people as Testing-mode users.
- **Name** before the store listing and domain.
- **Free vs. paid split** affects a few screens (e.g. subscription limit, savings page); can be decided during the build.
- **Cancel-link checks:** a small script that re-checks every link on a schedule.

## Backlog (rough priority)

1. Three-group import review screen (feature 2) + status reasons (feature 1).
2. ~~Price capture at checkout with `activeTab` + curated list (feature 3, layer 1).~~ Dropped 2026-10-24.
3. Background Gmail sync: receipt confirmation, price-increase alerts, cancellation verification (feature 3, layer 2).
4. Widgets / UI pass (next up, UI-first).
5. Budget + cut plan (feature 4).
6. Split Apple / Google Play receipts per app.
7. Streaming rotation planner. (Monthly digest: built as the monthly check-in notification.)
8. **Charge after cancelling:** warn when a receipt arrives after a cancellation ("Netflix charged you $17.99 on Nov 3 after you cancelled"), and count "Surprise charges" on the Savings page. A rule in `resync.js` `mergeReceipts()`. Parked 2026-10-22.
9. Freelancer extras: business/personal tags, PDF export (CSV export is built). Team view (parked).
10. Email reminders via a backend; mobile companion app (phone/TV usage, home-screen widgets).

## Open questions

- Pricing model: one-time (Subwatch: $11.99) vs. subscription vs. free + paid extras. Ongoing costs to cover: keeping cancel links current, a possible backend later.
- A more distinctive name? "Subscription Check" is generic and hard to stand out with in store search.
- ~~Which permission option for checkout price reading (see feature 3)? Affects install conversion and store review.~~ Resolved 2026-10-24: no checkout reading at all.
