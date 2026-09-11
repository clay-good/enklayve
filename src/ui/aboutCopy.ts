/**
 * The "Why enklayve" copy, as data rather than markup.
 *
 * This page is the site's argument — free, private, shows its work — and it
 * lived only inside the app, at the fragment route `#/about`. A fragment is not
 * a URL a search engine can index, so the one page that explains what the site
 * is and why it is free was invisible to every crawler. It is now rendered in
 * two places from these strings: the in-app view in shell.ts, and the static,
 * crawlable `/about.html` the build emits (scripts/about-page.ts).
 *
 * Data, not DOM, so neither renderer can quietly say something the other does
 * not.
 */

/** The opening line of the page. */
export const ABOUT_LEDE =
  "There are a thousand budgeting apps, tax calculators, and money coaches. Almost all of " +
  "them want your email, your data, your attention, or your money. enklayve wants none of it. " +
  "Here is what makes it different.";

/** The six claims the site makes for itself. */
export const ABOUT_POINTS: { title: string; body: string }[] = [
  {
    title: "Free, forever",
    body: "No accounts, no ads, no cookie banner, no upsell, no premium tier, ever. The finance celebrities sell this; we think knowing where you stand should be a public good, free for everyone.",
  },
  {
    title: "Truly private",
    body: "Every number is computed on your device. There is no server to send your data to, so it cannot leak, be sold, or train anything. Your money stays yours.",
  },
  {
    title: "Shows its work",
    body: "Every figure shows the exact math and links the public rule behind it. You never have to trust a personality. You can verify it yourself, down to the citation.",
  },
  {
    title: "Genuinely useful",
    body: "Your real take-home pay, federal and state taxes, the benefits and credits you may be owed, debt payoff, and your next right step, all in one calm place.",
  },
  {
    title: "No dark patterns",
    body: "No streaks, no guilt, no fear-of-missing-out, no notifications begging you back. It respects your time and never tries to manipulate you. Just answers.",
  },
  {
    title: "Built to last",
    body: "Open source, deterministic, and reproducible from public data. It works offline, installs like an app, and will still give the same honest answer years from now.",
  },
];

/** Where the rules it encodes apply, and where they do not yet. */
export const WHERE_IT_WORKS =
  "enklayve covers U.S. federal and state taxes and benefits today. Support for more places, " +
  "starting with Europe, India, China, and Russia, is on the roadmap as we learn each one's " +
  "rules properly. We would rather be right than everywhere.";

/** Trusted U.S. resources to learn the public rules behind the numbers. */
export const US_RESOURCES: { label: string; url: string }[] = [
  { label: "IRS, federal taxes", url: "https://www.irs.gov/" },
  { label: "USA.gov, federal benefits", url: "https://www.usa.gov/benefit-finder" },
  { label: "HealthCare.gov, ACA marketplace", url: "https://www.healthcare.gov/" },
  {
    label: "Consumer Financial Protection Bureau",
    url: "https://www.consumerfinance.gov/consumer-tools/",
  },
  { label: "Social Security Administration", url: "https://www.ssa.gov/" },
  { label: "Federal Student Aid (FAFSA)", url: "https://studentaid.gov/" },
];
