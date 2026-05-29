/**
 * The Readout Report (BUILD-SPEC-2 §5): a downloadable, cited, reproducible
 * summary of where the user stands, generated entirely on the device. The
 * builder is pure — the same Your Situation profile and the same dataset
 * versions always produce an identical model and an identical HTML document, so
 * the report is auditable and reproducible (no embedded timestamp, no randomness).
 *
 * It composes everything already built: the tax engine (snapshot + tax picture),
 * Your Plan (the next right step), the Safe Harbor readings (net worth, rainy-day
 * months), and the dataset manifest (the assumptions-and-sources appendix). The
 * "What you may be owed" section lands with the What You're Owed pillar (Phase 6).
 */
import { Money } from "../engine/money";
import { evaluateTaxes, type TaxInput, type TaxResult } from "../engine/tax";
import { evaluatePlan, DEFAULT_CONFIG, type PlanConfig, type PlanInput } from "../engine/plan";
import { pct } from "../ui/form";
import type { CitationData } from "../data/schemas";
import type { BundledData } from "../data/browser";
import type { SituationStore } from "../profile/situation";

/** Same public IRS figure the plan cites when the bundled limits are unavailable. */
const FALLBACK_LIMIT = 23000;
const FALLBACK_CITATION: CitationData = {
  sourceUrl: "https://www.irs.gov/pub/irs-drop/n-23-75.pdf",
  sourceDocument: "IRS Notice 2023-75 (2024 retirement plan limits)",
  effectiveYear: 2024,
  dateRetrieved: "2024-02-01",
};

export interface ReportLine {
  label: string;
  value: string;
}

export interface ReportSection {
  title: string;
  lines: ReportLine[];
  /** Optional explanatory note (e.g. a pending-pillar caveat). */
  note?: string;
}

export interface ReportModel {
  /** The dataset effective year the figures were computed from (deterministic). */
  effectiveYear: number;
  /** False when the profile has no income yet (the report is then mostly empty). */
  hasIncomeData: boolean;
  sections: ReportSection[];
  appendix: {
    assumptions: ReportLine[];
    datasets: { id: string; effectiveYear: number; status: string }[];
    citations: { sourceDocument: string; sourceUrl: string; effectiveYear: number }[];
  };
}

export interface BuildReportOptions {
  locale?: string;
  config?: PlanConfig;
}

function planInputFrom(profile: SituationStore, data: BundledData | null): PlanInput {
  const limits = data?.retirementLimits() ?? null;
  return {
    liquidSavings: profile.get("liquidSavings") ?? 0,
    essentialMonthlyExpenses: profile.get("essentialMonthlyExpenses") ?? 0,
    employerMatchAnnual: profile.get("employerMatchAnnual") ?? 0,
    employerMatchCaptured: profile.get("employerMatchCaptured") ?? 0,
    debts: profile.get("debts") ?? [],
    retirementContributionsAnnual: profile.get("retirementContributionsAnnual") ?? 0,
    retirementLimitAnnual: limits?.limits.elective_deferral_401k ?? FALLBACK_LIMIT,
    retirementLimitCitation: limits?.citation ?? FALLBACK_CITATION,
    sinkingGoals: [],
  };
}

/** Deduplicate citations by source document + year. */
function dedupeCitations(citations: CitationData[]): ReportModel["appendix"]["citations"] {
  const seen = new Set<string>();
  const out: ReportModel["appendix"]["citations"] = [];
  for (const c of citations) {
    const key = `${c.sourceDocument}|${c.effectiveYear}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      sourceDocument: c.sourceDocument,
      sourceUrl: c.sourceUrl,
      effectiveYear: c.effectiveYear,
    });
  }
  return out;
}

/**
 * Build the report model deterministically from Your Situation and the bundled
 * datasets. Pure: identical inputs yield an identical model.
 */
export function buildReport(
  profile: SituationStore,
  data: BundledData | null,
  options: BuildReportOptions = {},
): ReportModel {
  const locale = options.locale ?? "en-US";
  const config = options.config ?? DEFAULT_CONFIG;
  const usd = (m: Money): string => m.format(locale);

  const income = profile.get("annualIncome") ?? 0;
  const essential = profile.get("essentialMonthlyExpenses") ?? 0;
  const savings = profile.get("liquidSavings") ?? 0;
  const debts = (profile.get("debts") ?? []).reduce((s, d) => s + d.balance, 0);
  const netWorth = Money.from(savings).subtract(debts);

  const federal = data?.federal() ?? null;
  const fica = data?.fica() ?? null;
  const stateCode = profile.get("stateCode") ?? "";
  const state = stateCode ? (data?.state(stateCode) ?? undefined) : undefined;
  const filingStatus = profile.get("filingStatus") ?? "single";
  const effectiveYear = federal?.taxYear ?? 2024;

  const citations: CitationData[] = [];
  const sections: ReportSection[] = [];

  const hasIncomeData = income > 0 && federal !== null && fica !== null;

  // --- Snapshot + tax picture (only when we can run the tax engine) ---
  if (hasIncomeData && federal && fica) {
    const ctx = { federal, fica, state };
    const input: TaxInput = { filingStatus, wages: income, deductionMode: "auto" };
    const result: TaxResult = evaluateTaxes(input, ctx);
    const plus = evaluateTaxes({ ...input, wages: income + 1000 }, ctx);
    const marginalCost = plus.totals.totalTax.subtract(result.totals.totalTax);

    citations.push(result.federal.citation, result.fica.citation);
    if (result.state) citations.push(result.state.citation);

    const rainyMonths = essential > 0 ? savings / essential : null;
    sections.push({
      title: "Snapshot",
      lines: [
        { label: "Annual income", value: usd(Money.from(income)) },
        { label: "Effective tax rate", value: pct(result.totals.effectiveRate) },
        { label: "Marginal rate (next dollar)", value: pct(result.totals.marginalRate) },
        { label: "Annual take-home", value: usd(result.totals.takeHome) },
        { label: "Net worth (savings − debts)", value: usd(netWorth) },
        {
          label: "Rainy-day months covered",
          value:
            rainyMonths === null ? "add essential expenses" : `${rainyMonths.toFixed(1)} months`,
        },
      ],
    });

    sections.push({
      title: "Your tax picture",
      lines: [
        { label: "Federal income tax", value: usd(result.federal.incomeTax) },
        { label: "Social Security + Medicare (FICA)", value: usd(result.fica.total) },
        ...(result.state
          ? [
              {
                label: `${result.state.jurisdictionName} income tax`,
                value: usd(result.state.incomeTax),
              },
            ]
          : []),
        { label: "Total tax", value: usd(result.totals.totalTax) },
        {
          label: "Cost of your next $1,000 of income",
          value: `${usd(marginalCost)} (${pct(marginalCost.toNumber() / 1000)})`,
        },
      ],
    });
  } else {
    sections.push({
      title: "Snapshot",
      lines: [
        { label: "Status", value: "Add your income in Your Situation to compute your snapshot." },
      ],
    });
  }

  // --- What you may be owed (pending the What You're Owed pillar) ---
  sections.push({
    title: "What you may be owed",
    lines: [],
    note: "Benefits and aid eligibility (Federal Poverty Level, EITC, Child Tax Credit, ACA, SNAP, Medicaid, FAFSA) arrive with the What You're Owed pillar and will be summarized here.",
  });

  // --- Your Plan: the current next right step ---
  const plan = evaluatePlan(planInputFrom(profile, data), config);
  if (plan.current) {
    const c = plan.current;
    if (c.citation) citations.push(c.citation);
    sections.push({
      title: "Your Plan — the next right step",
      lines: [
        { label: "Current step", value: c.title },
        { label: "Next action", value: c.action },
        ...c.math.map((m) => ({ label: m.label, value: m.value })),
      ],
    });
  } else {
    sections.push({
      title: "Your Plan",
      lines: [{ label: "Status", value: "You're on track across every step for now." }],
    });
  }

  // --- Assumptions & sources appendix ---
  const assumptions: ReportLine[] = [
    { label: "Federal deduction method", value: "Larger of standard / itemized (auto)" },
    { label: "Rainy-day target", value: `${config.rainyDayMonths} months of essentials` },
    {
      label: "Debt payoff order",
      value:
        config.debtStrategy === "highest-rate" ? "Highest rate first" : "Smallest balance first",
    },
    { label: "Your Enough Number multiple", value: `${config.enoughMultiple}× annual essentials` },
  ];

  const datasets = (data?.manifest.datasets ?? []).map((d) => ({
    id: d.id,
    effectiveYear: d.effectiveYear,
    status: d.status,
  }));

  return {
    effectiveYear,
    hasIncomeData,
    sections,
    appendix: { assumptions, datasets, citations: dedupeCitations(citations) },
  };
}

/** Escape text for safe interpolation into the report HTML. */
function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function sectionHtml(section: ReportSection): string {
  const rows = section.lines
    .map((l) => `        <tr><th scope="row">${esc(l.label)}</th><td>${esc(l.value)}</td></tr>`)
    .join("\n");
  const table = section.lines.length > 0 ? `      <table>\n${rows}\n      </table>` : "";
  const note = section.note ? `      <p class="note">${esc(section.note)}</p>` : "";
  return `    <section>\n      <h2>${esc(section.title)}</h2>\n${[table, note].filter(Boolean).join("\n")}\n    </section>`;
}

/**
 * Render the report model as a self-contained, printable HTML document. No
 * external assets, no scripts: the file opens and prints anywhere, and (given
 * the same model) the output is byte-identical — the report is reproducible.
 */
export function renderReportHtml(model: ReportModel): string {
  const body = model.sections.map(sectionHtml).join("\n");

  const assumptions = model.appendix.assumptions
    .map((a) => `        <tr><th scope="row">${esc(a.label)}</th><td>${esc(a.value)}</td></tr>`)
    .join("\n");
  const datasets = model.appendix.datasets
    .map(
      (d) =>
        `        <tr><th scope="row">${esc(d.id)}</th><td>${d.effectiveYear}</td><td>${esc(d.status)}</td></tr>`,
    )
    .join("\n");
  const citations = model.appendix.citations
    .map(
      (c) =>
        `        <li>${esc(c.sourceDocument)} (${c.effectiveYear}) — <a href="${esc(c.sourceUrl)}">${esc(c.sourceUrl)}</a></li>`,
    )
    .join("\n");

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Your Readout Report — enklayve</title>
    <style>
      :root { color-scheme: light; }
      body {
        font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
        max-width: 46rem;
        margin: 0 auto;
        padding: 2.5rem 1.5rem;
        color: #1e1b2e;
        background: #ffffff;
        line-height: 1.5;
      }
      h1 { color: #6d28d9; margin-bottom: 0.25rem; }
      h2 { color: #5b21b6; margin: 1.75rem 0 0.5rem; font-size: 1.1rem; }
      p.lede { color: #5b5570; margin-top: 0; }
      p.note { color: #5b5570; font-style: italic; }
      table { width: 100%; border-collapse: collapse; margin: 0.25rem 0 0.75rem; }
      th, td { text-align: left; padding: 0.3rem 0.5rem; border-bottom: 1px solid #e6def8; vertical-align: top; }
      th[scope="row"] { font-weight: 600; color: #3a3450; width: 60%; }
      td { color: #1e1b2e; }
      .appendix { margin-top: 2rem; border-top: 2px solid #ede9fe; padding-top: 1rem; }
      .appendix ul { padding-left: 1.1rem; }
      a { color: #6d28d9; word-break: break-all; }
      footer { margin-top: 2rem; color: #5b5570; font-size: 0.85rem; }
    </style>
  </head>
  <body>
    <h1>Your Readout Report</h1>
    <p class="lede">Where you stand, computed entirely on your device from ${model.effectiveYear} data. Nothing was sent anywhere.</p>
${body}
    <section class="appendix">
      <h2>Assumptions &amp; sources</h2>
      <h3>Assumptions you accepted</h3>
      <table>
${assumptions}
      </table>
      <h3>Dataset versions used</h3>
      <table>
        <tr><th scope="col">Dataset</th><th scope="col">Effective year</th><th scope="col">Status</th></tr>
${datasets}
      </table>
      <h3>Citations</h3>
      <ul>
${citations}
      </ul>
    </section>
    <footer>enklayve — a calm, private money guide. Every figure is reproducible from the dataset versions above.</footer>
  </body>
</html>
`;
}
