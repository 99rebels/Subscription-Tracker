// Fake receipt emails for trying the Gmail scan without connecting Gmail (used
// until an OAuth client ID is set up, see README). They go through the real
// parser, so this also exercises it.

const DAY = 86_400_000;

function monthlyDates(count, dayOffset) {
  return Array.from({ length: count }, (_, i) => Date.now() - (dayOffset + i * 30.4) * DAY);
}

let id = 0;
const mail = (date, from, subject, body) => ({ id: `sample-${id++}`, date, from, subject, snippet: "", body });

export function sampleInbox() {
  const futureDate = (days) =>
    new Date(Date.now() + days * DAY).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });

  return [
    ...monthlyDates(6, 12).map((d) =>
      mail(d, "Netflix <info@account.netflix.com>", "Your Netflix payment receipt", "Standard plan membership. Total $17.99"),
    ),
    ...monthlyDates(6, 3).map((d) =>
      mail(d, "Spotify <no-reply@spotify.com>", "Your Spotify Premium receipt", "Premium Individual subscription. Total $11.99"),
    ),
    ...monthlyDates(5, 20).map((d) =>
      mail(d, "OpenAI <noreply@tm.openai.com>", "Your ChatGPT Plus receipt", "ChatGPT Plus subscription. Amount paid $20.00"),
    ),
    ...monthlyDates(4, 8).map((d) =>
      mail(d, "Linear via Stripe <invoice+statements@stripe.com>", "Your receipt from Linear", "Standard plan subscription. Amount paid $8.00"),
    ),
    ...monthlyDates(3, 1).map((d) =>
      mail(d, "Paramount+ <paramountplus@email.paramountplus.com>", "Your Paramount+ receipt", "Paramount+ Essential monthly subscription. Total $7.99"),
    ),
    mail(Date.now() - 300 * DAY, "Adobe <mail@mail.adobe.com>", "Your Adobe invoice", "Creative Cloud Photography annual plan. Amount charged: $119.88 per year."),
    mail(Date.now() - 340 * DAY, "Dropbox <no-reply@dropbox.com>", "Your Dropbox Plus receipt", "Dropbox Plus subscription. Total $119.88"),
    mail(Date.now() - 5 * DAY, "Canva <hello@canva.com>", "Welcome to your Canva Pro free trial", `Your free trial ends on ${futureDate(2)}. Then $14.99/month.`),
    // Lapsed: last charge months ago
    ...monthlyDates(3, 150).map((d) =>
      mail(d, "Duolingo <no-reply@duolingo.com>", "Your Super Duolingo receipt", "Monthly subscription. Total $12.99"),
    ),
    // Cancelled
    ...monthlyDates(2, 70).map((d) => mail(d, "Hulu <hulu@hulumail.com>", "Your Hulu receipt", "Hulu (With Ads) monthly subscription. Total $9.99")),
    mail(Date.now() - 60 * DAY, "Hulu <hulu@hulumail.com>", "Your subscription has been cancelled", "We're sorry to see you go."),
    // Noise that should be ignored
    ...[23.1, 8.45, 41, 12.75].map((amt, i) =>
      mail(Date.now() - (3 + i * 9) * DAY, "Uber Receipts <noreply@uber.com>", "Your trip receipt", `Total $${amt}`),
    ),
    mail(Date.now() - 4 * DAY, "Amazon <shipment-tracking@amazon.com>", "Your order has shipped", "Total $49.99"),
    // Orders from a service sold as a plan: asks "Do you have Prime?"
    ...[24.99, 12.5, 63.2, 8.99, 31.4, 19.99, 45, 15.75, 22.1].map((amt, i) =>
      mail(Date.now() - (6 + i * 37) * DAY, "Amazon.com <auto-confirm@amazon.com>", "Your Amazon.com order", `Order total $${amt}`),
    ),
  ];
}
