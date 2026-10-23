# Testing in real Chrome

**Results, 2026-10-23 (founder's report):** everything below works except the renewal notification in section 4 (set a charge to tomorrow; no notification arrived). Leads for that are in BUILD.md, "Where things stand".

The build has been checked with unit tests and with a preview page that fakes Chrome (`dev/preview.html`). These checks need the real browser and a real inbox. About 30 minutes. Note anything odd next to the step; screenshots help.

## Set up

1. Open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked** and pick the `subscription_check` folder. It must be this folder: Gmail sign-in is tied to it (HANDOFF validate #5).
2. Pin the extension (puzzle icon → pin).
3. A tab opens with the full view on its welcome screen. That's expected on first install.

## 1. Gmail scan (the most important one)

1. Click the extension icon. You should see **Find everything you're paying for**. Click **Scan my Gmail receipts**.
2. The side panel opens and Google asks for read-only Gmail access. Allow it.
3. Watch the progress bar, then the results.
   - [ ] Is everything under **You're paying for** really a subscription you pay for?
   - [ ] Is anything you pay for **missing**? (Note the name and where its receipts come from.)
   - [ ] Are the prices and renewal dates right?
   - [ ] Do the **Please confirm** questions make sense?
   - [ ] Is anything under **Not added** wrong?
   - [ ] Apple, Google Play and Amazon receipts: how do they show up?
4. Click **Add N subscriptions**. You land on the Overview.
5. Open **Review** and click **Check now** on the Gmail card. It should say "Gmail checked just now".

## 2. Side panel and popup

- [ ] Popup: **Open full view** opens the side panel. Does it open on the right screen when you click a row (e.g. a trial's **Cancel**)?
- [ ] The side panel stretches properly when you drag it wider.
- [ ] Site icons: do real logos show (Netflix's red N, and so on), or letter tiles? Letter tiles are expected for sites you've never visited.
- [ ] Settings › Theme: Light and Dark switch straight away. (Light is a placeholder look until it's designed.)
- [ ] `chrome://extensions` › Subscription Check › **Details** › Permissions lists the warnings the install prompt will show. Is it just "Read your browsing history", or is there also a line about website icons? (See "Before the first store release" below.)

## 3. Spotting a signup at checkout

Use a free trial or a cheap plan you were going to buy anyway, or a test checkout page if you have one.

- [ ] After paying, a notification asks **Did you just subscribe to …?** and the icon shows a badge.
- [ ] Click the extension icon **while still on the confirmation page**. Is the price read from the page?
- [ ] **Track it** adds it; **Not a subscription** dismisses it.
- [ ] While browsing normally for a day: any false alarms on ordinary "thank you" pages? (HANDOFF validate #6)

## 4. Notifications (macOS)

Edit a subscription's next charge to tomorrow (Detail › Edit) and wait up to an hour, or reload the extension to trigger the check.

- [ ] The renewal notification appears, and its buttons work (**Cancel / manage**, **Keep it**).
- [ ] Clicking the notification opens the side panel at that subscription. If a tab opens instead, note it: it's a fallback, but worth knowing.

## 5. Cancelling

On a subscription you don't mind testing with (or just to see the flow):

- [ ] Detail › **Cancel …** opens the service's site in a new tab.
- [ ] Back in the panel, **Did you cancel?** appears. **Yes, it's cancelled** moves it to Cancelled, and the Savings card appears on the Overview.
- [ ] **Undo** (Detail) puts it back.

## 6. Cancel links (by hand)

Signed in to each service you use, does the link on its Detail page open the place to cancel? The automated check couldn't confirm these, so they matter most: **Paramount+, Canva, Peacock, Apple**.

## 7. Your data

- [ ] Settings › Export a backup › **Backup file**, then **Restore from a backup** with that file. Everything comes back.
- [ ] **CSV for spreadsheets** opens cleanly in Numbers or Excel.

## Before the first store release (not now)

- The install prompt should only say **"Read your browsing history"** (HANDOFF validate #4). Check it on the Web Store's test install. The `favicon` permission (real site logos) has its own warning, "Access the icons of the websites you visit", and it's unconfirmed whether Chrome folds it into the history warning. If it shows as a separate line, the choice is: keep it, or drop it and use letter tiles only (one line in `manifest.json`; the tiles already fall back to letters).
- Google's OAuth verification (2–8 weeks) needs starting before launch (HANDOFF validate #5).
