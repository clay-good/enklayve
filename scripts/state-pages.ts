/**
 * One crawlable paycheck-and-income-tax page per state, plus an index of them.
 *
 * "California paycheck calculator" and "Ohio income tax rate" are among the
 * most-searched questions in personal finance, and the site already answers
 * every one of them: the Take-Home tool covers all fifty states and DC. But the
 * only URL it had was `/tools/take-home`, which names no state, so none of those
 * fifty-one searches had a page here to land on.
 *
 * Each page is rendered from the state's own shipped shard and computed by the
 * same engine the calculator runs (evaluateTaxes), so the worked examples are
 * the numbers the tool would show, not a second model of them. A page that
 * quoted brackets the tool does not use would be worse than no page.
 */
import { evaluateTaxes, type TaxResult } from "../src/engine/tax";
import { US_STATES } from "../src/data/usStates";
import type { FilingStatus, Jurisdiction } from "../src/data";
import { escapeHtml, PAGE_STYLE, breadcrumb, INDEX_PAGE_URL } from "./tools-index";
import { SITE_ORIGIN } from "./sitemap";
import { federalJurisdiction, ficaData, stateJurisdiction, TAX_YEAR } from "./shards";

/** Where the index lives, and the folder each state's page sits in. */
export const STATES_INDEX_URL = "states";
export const STATES_INDEX_PATH = "states.html";

/** "District of Columbia" → "district-of-columbia". */
export function stateSlug(name: string): string {
  return name.toLowerCase().replace(/[^a-z]+/g, "-");
}

export function statePageUrl(name: string): string {
  return `${STATES_INDEX_URL}/${stateSlug(name)}`;
}

/** The salaries each page works through: a spread most readers will find
 *  themselves near, from an entry-level wage to a senior one. */
export const EXAMPLE_WAGES = [40_000, 60_000, 80_000, 100_000, 150_000];

/** The salary the calculator link opens on: the middle example. */
const CTA_WAGES = EXAMPLE_WAGES[2]!;

const FEDERAL = federalJurisdiction();
const FICA = ficaData();

/** Biweekly is the most common U.S. pay schedule. */
const PAYCHECKS_PER_YEAR = 26;

const STATE_STYLE = `
      .open {
        display: inline-block;
        margin: 1.25rem 0 0.5rem;
        padding: 0.75rem 1.25rem;
        background: #6d28d9;
        color: #fff;
        border-radius: 8px;
      }
      .open:hover { background: #5b21b6; text-decoration: none; }
      .scroll { overflow-x: auto; }
      table { border-collapse: collapse; width: 100%; font-variant-numeric: tabular-nums; font-size: 0.95rem; }
      th, td { text-align: right; padding: 0.45rem 0.6rem; border-bottom: 1px solid #e6def8; white-space: nowrap; }
      th:first-child, td:first-child { text-align: left; }
      th { color: #5b5570; font-weight: 600; }
      ul.states { columns: 2; padding-left: 1.1rem; }
      ul.states li { padding: 0.15rem 0; break-inside: avoid; }
      @media (min-width: 640px) { ul.states { columns: 3; } }
      @media (max-width: 480px) {
        .open { display: block; text-align: center; }
        th, td { padding: 0.4rem 0.35rem; font-size: 0.85rem; }
      }`;

const dollars = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});
const money = (n: number): string => dollars.format(Math.round(n));
const percent = (rate: number, digits = 3): string =>
  `${(rate * 100).toLocaleString("en-US", { maximumFractionDigits: digits })}%`;

interface StateInfo {
  code: string;
  name: string;
  jurisdiction: Jurisdiction;
}

/** Every state the tax engine ships a shard for, in alphabetical order. */
export function stateInfos(): StateInfo[] {
  return US_STATES.map(({ code, name }) => ({
    code,
    name,
    jurisdiction: stateJurisdiction(code.toLowerCase()),
  }));
}

/** The county a state's residence-local tax defaults to in the calculator, if any. */
function defaultLocal(j: Jurisdiction): { id: string; name: string; label: string } | null {
  const rl = j.residenceLocalTax;
  if (!rl) return null;
  const addOn = j.localAddOns?.find((a) => a.id === rl.defaultId);
  return addOn ? { id: addOn.id, name: addOn.name, label: rl.label } : null;
}

/** The engine's answer for a single W-2 earner at `wages`, as the calculator would compute it. */
export function workedExample(
  j: Jurisdiction,
  wages: number,
  filingStatus: FilingStatus = "single",
): TaxResult {
  const local = defaultLocal(j);
  return evaluateTaxes(
    {
      filingStatus,
      wages,
      deductionMode: "auto",
      localJurisdictionIds: local ? [local.id] : [],
    },
    { federal: FEDERAL, fica: FICA, state: j },
  );
}

function exampleTable(j: Jurisdiction): string {
  const hasLocal = defaultLocal(j) !== null;
  const rows = EXAMPLE_WAGES.map((w) => {
    const r = workedExample(j, w);
    const state = r.state?.incomeTax.toNumber() ?? 0;
    const local = r.local.total.toNumber();
    const takeHome = r.totals.takeHome.toNumber();
    return (
      `          <tr><td>${money(w)}</td>` +
      `<td>${money(r.federal.incomeTax.toNumber())}</td>` +
      `<td>${money(r.fica.total.toNumber())}</td>` +
      `<td>${money(state)}</td>` +
      (hasLocal ? `<td>${money(local)}</td>` : "") +
      `<td><strong>${money(takeHome)}</strong></td>` +
      `<td>${money(takeHome / PAYCHECKS_PER_YEAR)}</td>` +
      `<td>${percent(r.totals.effectiveRate, 1)}</td></tr>`
    );
  }).join("\n");
  return `    <div class="scroll">
      <table>
        <thead>
          <tr><th>Salary</th><th>Federal</th><th>FICA</th><th>State</th>${hasLocal ? "<th>County</th>" : ""}<th>Take-home</th><th>Per paycheck</th><th>Total tax rate</th></tr>
        </thead>
        <tbody>
${rows}
        </tbody>
      </table>
    </div>`;
}

const STATUS_LABEL: Partial<Record<FilingStatus, string>> = {
  single: "Single",
  married_jointly: "Married filing jointly",
};

function bracketTable(j: Jurisdiction, status: FilingStatus): string {
  const brackets = j.bracketsByFilingStatus[status];
  if (!brackets || brackets.length === 0) return "";
  const rows = brackets
    .map((b, i) => {
      const next = brackets[i + 1];
      const range = next
        ? `${money(b.lowerBound)} to ${money(next.lowerBound)}`
        : `Over ${money(b.lowerBound)}`;
      // Ohio-style schedules charge a fixed amount the moment a line is crossed.
      const rate = b.baseTax ? `${money(b.baseTax)} plus ${percent(b.rate)}` : percent(b.rate);
      return `          <tr><td>${range}</td><td>${rate}</td></tr>`;
    })
    .join("\n");
  return `    <h3>${STATUS_LABEL[status]}</h3>
    <div class="scroll">
      <table>
        <thead><tr><th>Taxable income</th><th>Rate</th></tr></thead>
        <tbody>
${rows}
        </tbody>
      </table>
    </div>`;
}

/** The one-line answer to "what is the income tax rate in this state?" */
function rateSummary(j: Jurisdiction): string {
  if (!j.hasIncomeTax) return "no income tax on wages";
  const brackets = j.bracketsByFilingStatus.single ?? [];
  const taxed = brackets.filter((b) => b.rate > 0);
  const top = Math.max(...taxed.map((b) => b.rate));
  const bottom = Math.min(...taxed.map((b) => b.rate));
  if (top !== bottom) return `rates from ${percent(bottom)} to ${percent(top)}`;
  // One rate, but over a tax-free first band (Ohio) is not a flat tax.
  const freeBand = taxed[0] && taxed[0].lowerBound > 0 ? taxed[0].lowerBound : 0;
  if (freeBand === 0) return `a flat ${percent(top)}`;
  const base = taxed[0]?.baseTax ? `${money(taxed[0].baseTax)} plus ` : "";
  return `no tax on the first ${money(freeBand)} of taxable income, then ${base}${percent(top)} of the rest`;
}

/** The rate in a few words, for the description a search result shows. */
function shortRate(j: Jurisdiction): string {
  if (!j.hasIncomeTax) return "no income tax on wages";
  const rates = (j.bracketsByFilingStatus.single ?? []).map((b) => b.rate).filter((r) => r > 0);
  const top = Math.max(...rates);
  return rates.length > 1 && Math.min(...rates) !== top
    ? `income tax rates up to ${percent(top)}`
    : `a ${percent(top)} income tax`;
}

export const stateTitle = (name: string): string =>
  `${name} Paycheck & Income Tax Calculator ${TAX_YEAR} · enklayve`;

export function stateDescription(info: StateInfo): string {
  const j = info.jurisdiction;
  return (
    `${info.name} take-home pay for ${TAX_YEAR}: ${shortRate(j)}, with worked examples ` +
    `from ${money(EXAMPLE_WAGES[0]!)} to ${money(EXAMPLE_WAGES.at(-1)!)}. Free, private, computed on your device.`
  );
}

function stateList(current?: string): string {
  return US_STATES.map(({ name }) =>
    name === current
      ? `        <li>${escapeHtml(name)}</li>`
      : `        <li><a href="/${statePageUrl(name)}">${escapeHtml(name)}</a></li>`,
  ).join("\n");
}

function head(title: string, description: string, canonical: string, jsonLd: string[]): string {
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
    <style>${PAGE_STYLE}${STATE_STYLE}
    </style>
  </head>`;
}

const NAV = `    <nav><a href="/">← enklayve home</a> · <a href="/${INDEX_PAGE_URL}">All tools</a> · <a href="/${STATES_INDEX_URL}">All states</a></nav>`;

const FOOTNOTE = `    <p class="note">
      Free forever, with no account and no ads. Computed entirely on your device — nothing is ever
      sent anywhere. Educational information, not financial, tax, or legal advice.
    </p>`;

/** Render the page for one state. */
export function renderStatePage(info: StateInfo): string {
  const j = info.jurisdiction;
  const canonical = `${SITE_ORIGIN}/${statePageUrl(info.name)}`;
  const title = stateTitle(info.name);
  const description = stateDescription(info);
  const local = defaultLocal(j);
  // Opens on the table's middle row, so the first figure a reader sees in the
  // calculator is one they just read here; an empty wage box is a dead end.
  const appUrl =
    `/#/paycheck-taxes?tool=take-home&st=${info.code.toLowerCase()}` +
    `&fs=single&w=${CTA_WAGES}` +
    (local ? `&loc=${local.id}` : "");

  const sd = j.standardDeductionByFilingStatus;
  const deduction = !j.hasIncomeTax
    ? ""
    : (sd.single ?? 0) > 0
      ? `<p>The ${info.name} standard deduction is ${money(sd.single ?? 0)} for a single filer` +
        (sd.married_jointly
          ? ` and ${money(sd.married_jointly)} for a married couple filing jointly`
          : "") +
        `. The calculator applies it, and any personal exemption or credit ${info.name} allows, before the rates below.</p>`
      : `<p>${info.name} has no standard deduction of its own. The calculator applies the exemptions and credits it does allow before the rates below.</p>`;

  const rules = (j.specialRules ?? [])
    .map(
      (r) => `      <li><strong>${escapeHtml(r.name)}.</strong> ${escapeHtml(r.description)}</li>`,
    )
    .join("\n");

  const ratesSection = j.hasIncomeTax
    ? `    <h2>${info.name} income tax brackets for ${TAX_YEAR}</h2>
    ${deduction}
${bracketTable(j, "single")}
${bracketTable(j, "married_jointly")}
${rules ? `    <h3>Also applies</h3>\n    <ul>\n${rules}\n    </ul>` : ""}`
    : `    <h2>${info.name} has no income tax on wages</h2>
    <p>Your paycheck in ${info.name} loses federal income tax and FICA (Social Security and Medicare), and nothing to the state. That is why the "State" column above is zero at every salary.</p>
${rules ? `    <ul>\n${rules}\n    </ul>` : ""}`;

  const localNote = local
    ? ` ${info.name} counties levy their own income tax, so these examples use ${escapeHtml(local.name)}, the calculator's default ${escapeHtml(local.label.toLowerCase())}; pick yours in the calculator.`
    : " Any city or county income tax is not included here; the calculator adds it where it applies.";

  const app = {
    "@context": "https://schema.org",
    "@type": "WebPage",
    name: title,
    url: canonical,
    description,
    about: { "@type": "State", name: info.name },
    isAccessibleForFree: true,
    publisher: { "@type": "Organization", name: "enklayve", url: `${SITE_ORIGIN}/` },
  };
  const crumbs = breadcrumb([
    { name: "enklayve", url: `${SITE_ORIGIN}/` },
    { name: "Paycheck calculators by state", url: `${SITE_ORIGIN}/${STATES_INDEX_URL}` },
    { name: info.name, url: canonical },
  ]);

  return `${head(title, description, canonical, [JSON.stringify(app), crumbs])}
  <body>
${NAV}
    <h1>${escapeHtml(info.name)} paycheck and income tax calculator, ${TAX_YEAR}</h1>
    <p class="lede">What a ${escapeHtml(info.name)} salary actually pays after federal income tax, Social Security, Medicare${j.hasIncomeTax ? ", and state income tax" : ""}. ${escapeHtml(info.name)} has ${rateSummary(j)}.</p>
    <a class="open" href="${appUrl}">Calculate your ${escapeHtml(info.name)} take-home pay →</a>
    <h2>Take-home pay in ${escapeHtml(info.name)}, at five salaries</h2>
    <p>A single filer paid by W-2, taking the standard deduction, with no pre-tax retirement or health savings. "Per paycheck" assumes ${PAYCHECKS_PER_YEAR} paychecks a year.${localNote}</p>
${exampleTable(j)}
    <p>Contributing to a 401(k) or HSA, a second earner, or a different filing status all change these figures. The calculator takes all of them.</p>
${ratesSection}
    <h2>Where these figures come from</h2>
    <p>${escapeHtml(j.citation.sourceDocument)}. <a href="${escapeHtml(j.citation.sourceUrl)}" rel="noopener noreferrer">Read the source</a>.</p>
    <h2>Other states</h2>
    <ul class="states">
${stateList(info.name)}
    </ul>
${FOOTNOTE}
  </body>
</html>
`;
}

export const STATES_TITLE = `Paycheck & Income Tax Calculators for All 50 States, ${TAX_YEAR} · enklayve`;
export const STATES_DESCRIPTION =
  `Take-home pay and state income tax brackets for ${TAX_YEAR}, for every state and DC, ` +
  "with worked examples. Free, private, and computed on your device.";

/** Render the index of state pages. */
export function renderStatesIndex(): string {
  const canonical = `${SITE_ORIGIN}/${STATES_INDEX_URL}`;
  const infos = stateInfos();
  const none = infos.filter((i) => !i.jurisdiction.hasIncomeTax).map((i) => i.name);
  const list = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: STATES_TITLE,
    numberOfItems: infos.length,
    itemListElement: infos.map((i, n) => ({
      "@type": "ListItem",
      position: n + 1,
      name: `${i.name} paycheck calculator`,
      url: `${SITE_ORIGIN}/${statePageUrl(i.name)}`,
    })),
  };
  const crumbs = breadcrumb([
    { name: "enklayve", url: `${SITE_ORIGIN}/` },
    { name: "Paycheck calculators by state", url: canonical },
  ]);
  return `${head(STATES_TITLE, STATES_DESCRIPTION, canonical, [JSON.stringify(list), crumbs])}
  <body>
${NAV}
    <h1>Paycheck and income tax calculators by state, ${TAX_YEAR}</h1>
    <p class="lede">Pick your state to see its ${TAX_YEAR} income tax brackets and what five common salaries take home there, computed by the same engine as the <a href="/tools/take-home">Take-Home Pay calculator</a>.</p>
    <ul class="states">
${stateList()}
    </ul>
    <h2>States with no income tax on wages</h2>
    <p>${escapeHtml(none.join(", "))}.</p>
${FOOTNOTE}
  </body>
</html>
`;
}

/** Every state page plus the index, as build assets. */
export function statePages(): { url: string; fileName: string; source: string }[] {
  return [
    { url: STATES_INDEX_URL, fileName: STATES_INDEX_PATH, source: renderStatesIndex() },
    ...stateInfos().map((info) => ({
      url: statePageUrl(info.name),
      fileName: `${statePageUrl(info.name)}.html`,
      source: renderStatePage(info),
    })),
  ];
}
