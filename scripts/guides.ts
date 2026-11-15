/**
 * The guides: the site's stance on budgeting and investing, on pages a search
 * engine can find.
 *
 * The anti-budget is what enklayve leads with, and it lived only on the home,
 * which the browser renders, so to every crawler it did not exist. These pages
 * carry it as plain HTML, each step linked to the calculator that does it. The
 * anti-budget copy is the home's own (src/ui/guideCopy.ts); the step-by-step
 * guide expands its "fund things in this order" paragraph and adds no figure
 * the home does not already state.
 */
import { SUB_TOOLS } from "../src/tiles/registry";
import { ANTI_BUDGET_TITLE, ANTI_BUDGET_SECTIONS } from "../src/ui/guideCopy";
import { escapeHtml, PAGE_STYLE, breadcrumb, INDEX_PAGE_URL } from "./tools-index";
import { toolPageUrl } from "./tool-pages";
import { SITE_ORIGIN } from "./sitemap";

export const GUIDES_INDEX_URL = "guides";

interface Step {
  heading: string;
  body: string;
  tools: string[];
}

interface Guide {
  slug: string;
  title: string;
  /** The `<title>`: subject first, brand last. */
  pageTitle: string;
  description: string;
  lede: string;
  steps: Step[];
}

const ANTI_BUDGET_TOOLS: Record<string, string[]> = {
  "": ["spending-plan", "cash-flow", "sinking-fund"],
  "Then make it automatic": ["retirement-optimizer", "take-home"],
  "Fund things in this order": ["debt-freedom", "retirement-optimizer"],
  "Just do the next thing": ["peace-of-mind"],
};

export const GUIDES: Guide[] = [
  {
    slug: "anti-budget",
    title: "The anti-budget",
    pageTitle: "The Anti-Budget: A Budgeting Method That Runs on Autopay · enklayve",
    description:
      "Why most budgets fail by week three, and the one that does not: give every dollar a job before the month starts, then automate it. Free tools for each step.",
    lede:
      ANTI_BUDGET_TITLE.replace(/^The anti-budget: /, "").replace(/^./, (c) => c.toUpperCase()) +
      ", then get yourself out of the way.",
    steps: ANTI_BUDGET_SECTIONS.map((s) => ({
      heading: s.heading ?? "Why budgets fail, and what to do instead",
      body: s.body,
      tools: ANTI_BUDGET_TOOLS[s.heading ?? ""] ?? [],
    })),
  },
  {
    slug: "money-order",
    title: "What to do with your money, in order",
    pageTitle: "What to Do With Your Money, in Order: A Step-by-Step Plan · enklayve",
    description:
      "Cushion, 401(k) match, high-interest debt, a six-month fund, then invest. The order to fund things, one move at a time, with a free calculator for each step.",
    lede: "Cushion, match, debt, six-month fund, then invest, one move at a time. Find the first step you have not finished and do only that one.",
    steps: [
      {
        heading: "1. A small cushion",
        body: "Before anything else, keep a little cash between you and the next surprise, so a flat tire does not land on a credit card. It does not need to be big yet. It needs to exist.",
        tools: ["bill-triage", "sinking-fund"],
      },
      {
        heading: "2. Your full 401(k) match",
        body: "If your employer matches what you put in, put in enough to get all of it. A match is part of your pay that you only collect by asking for it, and no investment return beats free money.",
        tools: ["retirement-optimizer", "take-home"],
      },
      {
        heading: "3. High-interest debt, fast",
        body: "Clearing a 24% card is a guaranteed 24% raise, which no market promises. Pay the minimums on everything, then throw every spare dollar at the highest rate until it is gone.",
        tools: ["debt-freedom", "balance-transfer", "freedom-date"],
      },
      {
        heading: "4. Six months of expenses",
        body: "Build the cushion into a real emergency fund: six months of expenses in a high-yield savings account. This is what lets a layoff or a medical bill be an inconvenience instead of a crisis.",
        tools: ["peace-of-mind", "sabbatical"],
      },
      {
        heading: "5. Invest, in this order",
        body: "With the foundation in place, invest: 401(k), traditional IRA, HSA, then a regular brokerage. The tax-advantaged accounts come first because what is inside them grows without a yearly tax bill. A brokerage account is for what is left once they are full.",
        tools: ["retirement-optimizer", "ira-deduction", "backdoor-roth", "compound-growth"],
      },
      {
        heading: "6. Make it automatic",
        body: "Turn on automatic contributions, put every bill on autopay, and move savings on payday. Once the plan runs on its own, it no longer depends on willpower, and willpower is what budgets run out of.",
        tools: ["spending-plan", "cash-flow"],
      },
    ],
  },
];

const TITLES = new Map(SUB_TOOLS.map(({ tile }) => [tile.id, tile.title] as const));

const GUIDE_STYLE = `
      .step { margin-top: 1.75rem; }
      .step p { margin: 0.35rem 0; }
      .use { color: #5b5570; font-size: 0.95rem; }
      .open {
        display: inline-block;
        margin: 1.5rem 0 0.5rem;
        padding: 0.75rem 1.25rem;
        background: #6d28d9;
        color: #fff;
        border-radius: 8px;
      }
      .open:hover { background: #5b21b6; text-decoration: none; }
      @media (max-width: 480px) { .open { display: block; text-align: center; } }`;

export const guideUrl = (slug: string): string => `${GUIDES_INDEX_URL}/${slug}`;

function toolLinks(ids: string[]): string {
  const links = ids
    .filter((id) => TITLES.has(id))
    .map((id) => `<a href="/${toolPageUrl(id)}">${escapeHtml(TITLES.get(id)!)}</a>`);
  return links.length ? `      <p class="use">Use: ${links.join(" · ")}</p>\n` : "";
}

function page(
  title: string,
  description: string,
  canonical: string,
  jsonLd: string[],
  body: string,
): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <title>${escapeHtml(title)}</title>
    <meta name="description" content="${escapeHtml(description)}" />
    <link rel="canonical" href="${canonical}" />
    <meta name="robots" content="index, follow" />
    <meta name="theme-color" content="#6D28D9" />
    <meta property="og:type" content="article" />
    <meta property="og:site_name" content="enklayve" />
    <meta property="og:title" content="${escapeHtml(title)}" />
    <meta property="og:description" content="${escapeHtml(description)}" />
    <meta property="og:url" content="${canonical}" />
    <meta property="og:image" content="${SITE_ORIGIN}/og-image.png" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${escapeHtml(title)}" />
    <meta name="twitter:description" content="${escapeHtml(description)}" />
    <meta name="twitter:image" content="${SITE_ORIGIN}/og-image.png" />
${jsonLd.map((s) => `    <script type="application/ld+json">${s}</script>`).join("\n")}
    <style>${PAGE_STYLE}${GUIDE_STYLE}
    </style>
  </head>
  <body>
    <nav><a href="/">← enklayve home</a> · <a href="/${GUIDES_INDEX_URL}">Guides</a> · <a href="/${INDEX_PAGE_URL}">All tools</a></nav>
${body}
    <p class="note">
      Free forever, with no account and no ads. Educational information, not financial, tax,
      investment, or legal advice.
    </p>
  </body>
</html>
`;
}

/** Render one guide. */
export function renderGuide(g: Guide): string {
  const canonical = `${SITE_ORIGIN}/${guideUrl(g.slug)}`;
  const others = GUIDES.filter((o) => o.slug !== g.slug)
    .map((o) => `      <li><a href="/${guideUrl(o.slug)}">${escapeHtml(o.title)}</a></li>`)
    .join("\n");
  const steps = g.steps
    .map(
      (s) =>
        `    <section class="step">\n      <h2>${escapeHtml(s.heading)}</h2>\n` +
        `      <p>${escapeHtml(s.body)}</p>\n${toolLinks(s.tools)}    </section>`,
    )
    .join("\n");
  const article = JSON.stringify({
    "@context": "https://schema.org",
    "@type": "Article",
    headline: g.title,
    description: g.description,
    url: canonical,
    isAccessibleForFree: true,
    publisher: { "@type": "Organization", name: "enklayve", url: `${SITE_ORIGIN}/` },
  });
  const crumbs = breadcrumb([
    { name: "enklayve", url: `${SITE_ORIGIN}/` },
    { name: "Guides", url: `${SITE_ORIGIN}/${GUIDES_INDEX_URL}` },
    { name: g.title, url: canonical },
  ]);
  return page(
    g.pageTitle,
    g.description,
    canonical,
    [article, crumbs],
    `    <h1>${escapeHtml(g.title)}</h1>
    <p class="lede">${escapeHtml(g.lede)}</p>
${steps}
    <a class="open" href="/">See where you stand: open the free budget →</a>
    <h2>Keep reading</h2>
    <ul class="tools">
${others}
      <li><a href="/about">Why enklayve is free and private</a></li>
    </ul>`,
  );
}

export const GUIDES_TITLE = "Personal Finance Guides: Budgeting and Investing, Plainly · enklayve";
export const GUIDES_DESCRIPTION =
  "How enklayve thinks about money: a budget that runs on autopay instead of willpower, and the order to fund things in. Each step links a free calculator.";

/** Render the guides index. */
export function renderGuidesIndex(): string {
  const canonical = `${SITE_ORIGIN}/${GUIDES_INDEX_URL}`;
  const items = GUIDES.map(
    (g) =>
      `      <li><a href="/${guideUrl(g.slug)}">${escapeHtml(g.title)}</a>` +
      `<span class="d">, ${escapeHtml(g.description)}</span></li>`,
  ).join("\n");
  const crumbs = breadcrumb([
    { name: "enklayve", url: `${SITE_ORIGIN}/` },
    { name: "Guides", url: canonical },
  ]);
  return page(
    GUIDES_TITLE,
    GUIDES_DESCRIPTION,
    canonical,
    [crumbs],
    `    <h1>Guides</h1>
    <p class="lede">How enklayve thinks about budgeting and investing, one plain page at a time.</p>
    <ul class="tools">
${items}
      <li><a href="/states">Paycheck and income tax by state</a><span class="d">, what a salary takes home in each state, with its brackets.</span></li>
    </ul>`,
  );
}

/** Every guide page plus the index, as build assets. */
export function guidePages(): { url: string; fileName: string; source: string }[] {
  return [
    { url: GUIDES_INDEX_URL, fileName: `${GUIDES_INDEX_URL}.html`, source: renderGuidesIndex() },
    ...GUIDES.map((g) => ({
      url: guideUrl(g.slug),
      fileName: `${guideUrl(g.slug)}.html`,
      source: renderGuide(g),
    })),
  ];
}
