// Side panel · Review (docs/designs/PanelReview.dc.html): questions from the
// scan, signups spotted at checkout, and what's already been sorted (Undo).
import { h } from "../ui/dom.js";
import { icon, logoTile } from "../ui/components.js";
import * as t from "../ui/text.js";
import { answerReview, undoSorted, dismissSorted, trackDetection } from "../lib/review.js";
import { dismissPending } from "../lib/storage.js";
import { GmailClient } from "../lib/gmail.js";

const OUTCOME = { added: "added", cancelled: "cancelled", not_subscription: "not a subscription", kept: "still paying" };

export function renderReview(state) {
  const { review, pending, sorted, gmail } = state;
  const count = review.length + pending.length;

  const intro = h(
    "section",
    { style: "display: flex; flex-direction: column; gap: 4px" },
    h("h1", { style: "font-size: 18px; font-weight: 700; letter-spacing: -0.01em" }, count ? `${t.plural(count, "thing")} to check` : "Nothing to check"),
    h("p", { class: "caption", style: "font-size: 13px; line-height: 1.5" }, count ? "Quick answers keep your totals right. Nothing changes until you say so." : "We'll ask here when something needs a quick answer."),
  );

  const confirm = review.length
    ? h(
        "section",
        { class: "section" },
        h("h2", { class: "label" }, "Please confirm"),
        ...review.map((r) => {
          const item = r.item;
          const price = Number(item.price) > 0 ? `${t.money(item.price, item.currency)}${r.kind === "yearly" ? "/yr" : t.cycleUnit(item.cycle)}` : null;
          const subline = [item.plan && r.kind !== "plan" ? item.plan : null, price].filter(Boolean).join(" · ") || (item.domain ?? item.domains?.[0] ?? "");
          return h(
            "div",
            { class: "card card-pad", style: "border-radius: 14px" },
            h("div", { style: "display: flex; align-items: center; gap: 10px" }, logoTile(item), h("div", { style: "flex-grow: 1; min-width: 0" }, h("div", { style: "font-size: 14px; font-weight: 600" }, r.title), subline ? h("div", { class: "caption" }, subline) : null)),
            h("div", { class: "note raised" }, icon("info", { size: 14 }), r.detail),
            h("div", { class: "btn-row" }, h("button", { class: "btn primary md", onclick: () => answerReview(r.id, "yes") }, r.yes), h("button", { class: "btn md", onclick: () => answerReview(r.id, "no") }, r.no)),
          );
        }),
      )
    : null;

  const spotted = pending.length
    ? h(
        "section",
        { class: "section" },
        h("h2", { class: "label" }, "Spotted while browsing"),
        ...pending.map((p) => {
          const hasPrice = p.price != null;
          return h(
            "div",
            { class: "card card-pad", style: "border-radius: 14px" },
            h(
              "div",
              { style: "display: flex; align-items: center; gap: 10px" },
              logoTile({ name: p.name, domains: [p.domain] }),
              h("div", { style: "flex-grow: 1; min-width: 0" }, h("div", { style: "font-size: 14px; font-weight: 600" }, p.name), h("div", { class: "caption" }, `${p.domain} · ${t.spottedAt(p.detectedAt)}`)),
              hasPrice ? h("div", { class: "row-price" }, h("div", { class: "amount", style: "font-size: 14px" }, t.money(p.price, p.currency)), h("div", { class: "unit" }, t.cycleUnit(p.cycle))) : null,
            ),
            h("div", { class: "note raised" }, icon("info", { size: 14 }), hasPrice ? "Price read from the checkout page. No receipt yet." : "We couldn't read the price. Open the popup on the checkout page to read it, or add it after tracking."),
            h("div", { class: "btn-row" }, h("button", { class: "btn md", style: "font-weight: 600", onclick: () => trackDetection(p.id) }, "Track it"), h("button", { class: "btn md", onclick: () => dismissPending(p.id) }, "Not a subscription")),
          );
        }),
      )
    : null;

  const done = sorted.length
    ? h(
        "section",
        { class: "section" },
        h("div", { class: "section-head" }, h("h2", { class: "muted" }, "Already sorted"), h("span", { class: "caption faint" }, "Newest first")),
        h(
          "div",
          { class: "cancelled-list" },
          ...sorted.slice(0, 12).map((s) =>
            h(
              "div",
              { class: "row compact" },
              h("span", { class: "muted", style: "display: flex" }, icon("check", { size: 14, stroke: 2.6 })),
              h("div", { class: "row-main" }, h("div", { class: "row-title", style: "font-weight: 400" }, h("span", { class: "name" }, `${s.name}, ${OUTCOME[s.outcome] ?? s.outcome}`)), h("div", { class: "row-sub faint" }, s.note)),
              s.review || s.subId || s.pending ? h("a", { href: "#", style: "font-size: 12px", onclick: (e) => (e.preventDefault(), undoSorted(s.id)) }, "Undo") : null,
              h("button", { class: "icon-btn sm", "aria-label": `Remove ${s.name} from this list`, title: "Remove from this list", onclick: () => dismissSorted(s.id) }, icon("x", { size: 14, stroke: 2 })),
            ),
          ),
        ),
      )
    : null;

  return h("main", { class: "content", style: "gap: 20px" }, intro, confirm, spotted, done, gmailCard(gmail));
}

function gmailCard(gmail) {
  const tile = h("div", { class: "icon-tile", style: "width: 28px; height: 28px; border-radius: 7px; background: var(--raised); color: var(--muted)" }, icon("mail", { size: 15 }));
  let title;
  let sub;
  let action;
  if (gmail.connected && gmail.needsSignIn) {
    title = "Gmail needs you to sign in again";
    sub = "Google asks every so often. Until then, new receipts aren't picked up.";
    action = h("button", { class: "btn sm", onclick: () => reconnect(action) }, "Reconnect");
  } else if (gmail.connected) {
    title = `Gmail checked ${t.ago(gmail.lastCheckedAt ?? gmail.lastScanAt)}`;
    sub = "New receipts are picked up automatically";
    action = h("button", { class: "btn sm", onclick: () => checkNow(action) }, "Check now");
  } else {
    title = gmail.sample ? "Scanned a sample inbox" : "Scan your Gmail receipts";
    sub = gmail.sample ? "Gmail isn't connected in this build yet" : "Find what you're paying for in about a minute";
    action = h("a", { class: "btn sm", href: "#scan?start=1" }, gmail.sample ? "Scan again" : "Scan");
  }
  return h(
    "section",
    { style: "display: flex; align-items: center; gap: 12px; padding: 12px 14px; border-radius: 12px; border: 1px solid var(--border)" },
    tile,
    h("div", { class: "row-main" }, h("div", { style: "font-size: 13px; font-weight: 500" }, title), h("div", { class: "caption" }, sub)),
    action,
  );
}

async function checkNow(button) {
  button.disabled = true;
  button.textContent = "Checking…";
  const result = await chrome.runtime.sendMessage({ type: "gmail-sync" }).catch((err) => ({ ok: false, error: String(err) }));
  if (!result?.ok) {
    button.disabled = false;
    button.textContent = "Try again";
  }
}

// Sign in again (interactive, so it has to happen here, not in the background).
async function reconnect(button) {
  button.disabled = true;
  try {
    await GmailClient.connect({ interactive: true });
    await checkNow(button);
  } catch {
    button.disabled = false;
  }
}
