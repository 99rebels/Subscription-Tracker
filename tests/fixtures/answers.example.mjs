// Answer sheet for the receipt parser scorecard (npm run scorecard): what the
// scan *should* conclude about each service in an exported inbox. This is an
// example with made-up services. The real one is personal (it lists what
// someone pays for), so it lives next to the export in tests/fixtures/inbox/
// (git-ignored) as answers.mjs; the scorecard uses it when it's there.
//
//   domains:  sender domains that identify the parser's group (any one matches)
//   names:    group names that also match (for senders that share a domain, e.g. google.com)
//   expect:   { subscription: false } for things that must not be added (cancelled before
//             you joined and one-offs pass as long as they're "Not added"), else any of
//             status ("active" | "trial" | "cancelled" | "lapsed"), cycle ("weekly" | "monthly" | "yearly"),
//             price (the amount charged, incl. tax), currency, nextRenewal ("YYYY-MM-DD"; trial end for trials)
//   note:     why, gotchas, or what the person needs to confirm
//   checked:  true once the person whose inbox it is has confirmed it

export const answers = [
  {
    name: "Example Domains",
    domains: ["example-registrar.com"],
    expect: { status: "active", cycle: "yearly", price: 24.99, currency: "EUR" },
    note: "Yearly domain renewal; receipts say '1 Year' and the small print mentions a '1 month term'.",
    checked: true,
  },
  {
    name: "Example Design Pro",
    domains: ["example-design.com"],
    expect: { status: "trial", cycle: "monthly", price: 12, currency: "EUR", nextRenewal: "2026-10-27" },
    note: "'Thanks for trialing … will begin automatically on 27 October 2026 … €12.00'.",
    checked: true,
  },
  { name: "Example Food Delivery", domains: ["example-food.com"], expect: { subscription: false }, note: "Food orders, not a subscription.", checked: true },
];
