/**
 * The Readout Report (BUILD-SPEC-2 §5): a downloadable, cited, reproducible
 * summary of where the user stands, generated entirely on the device. The
 * builder is pure — the same My Situation profile and the same dataset
 * versions always produce an identical model and an identical HTML document, so
 * the report is auditable and reproducible (no embedded timestamp, no randomness).
 *
 * It composes everything already built: the tax engine (snapshot + tax picture),
 * the What You're Owed benefits engine (the FPL position, Medicaid/ACA
 * likelihood, and the EITC/Child Tax Credit estimates), My Plan (the next right
 * step), the Safe Harbor readings (net worth, rainy-day months), and the dataset
 * manifest (the assumptions-and-sources appendix).
 */
import { Money, allocateRounded } from "../engine/money";
import { evaluateTaxes, type TaxInput, type TaxResult } from "../engine/tax";
import { resolveResidenceLocal } from "../ui/residenceLocal";
import { evaluatePlan, DEFAULT_CONFIG, type PlanConfig, type PlanInput } from "../engine/plan";
import {
  acaCreditEligible,
  estimateCtc,
  estimateEitc,
  fplPercent,
  medicaidEligibility,
} from "../engine/benefits";
import { pct } from "../ui/form";
import { crossedStatutoryStep, statutoryStepSentence } from "../ui/statuteStep";
import type { CitationData } from "../data/schemas";
import type { BundledData, FplRegion } from "../data/browser";
import type { SituationStore } from "../profile/situation";

function regionFromState(code: string | undefined): FplRegion {
  if (code === "ak") return "alaska";
  if (code === "hi") return "hawaii";
  return "contiguous";
}

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
    citations: {
      sourceDocument: string;
      sourceUrl: string;
      effectiveYear: number;
      /** The long rationale/transcription prose, kept out of the hover tooltip. */
      sourceNote?: string;
    }[];
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
    // No fallback figure. When the shard is unavailable the plan says so; see
    // PlanInput.retirementLimitAnnual.
    retirementLimitAnnual: limits?.limits.elective_deferral_401k ?? null,
    retirementLimitCitation: limits?.citation ?? null,
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
      sourceNote: c.sourceNote,
    });
  }
  return out;
}

/**
 * Build the report model deterministically from My Situation and the bundled
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
  // The mandatory county income tax (Maryland, Indiana), remembered by whichever
  // tile last asked. The report is the document a household keeps and comes back
  // to, so a tax every resident pays belongs in its effective rate, its marginal
  // rate and its take-home — not only in the tile where it was chosen.
  const county = resolveResidenceLocal(
    state ?? null,
    [profile.get("county") ?? ""].filter(Boolean),
  );
  const filingStatus = profile.get("filingStatus") ?? "single";
  const effectiveYear = federal?.taxYear ?? 2026;

  const citations: CitationData[] = [];
  const sections: ReportSection[] = [];

  const hasIncomeData = income > 0 && federal !== null && fica !== null;

  // --- Snapshot + tax picture (only when we can run the tax engine) ---
  if (hasIncomeData && federal && fica) {
    const ctx = { federal, fica, state };
    const input: TaxInput = {
      filingStatus,
      wages: income,
      deductionMode: "auto",
      localJurisdictionIds: county,
    };
    const result: TaxResult = evaluateTaxes(input, ctx);
    const plus = evaluateTaxes({ ...input, wages: income + 1000 }, ctx);
    const marginalCost = plus.totals.totalTax.subtract(result.totals.totalTax);

    citations.push(result.federal.citation, result.fica.citation);
    if (result.state) citations.push(result.state.citation);
    if (result.local.citation) citations.push(result.local.citation);

    const rainyMonths = essential > 0 ? savings / essential : null;
    // A marginal rate over 100% is arithmetic — the rate is measured over a
    // wage probe, and a filer just under a point where a state's schedule
    // charges a flat amount straddles it. Ohio's $332 at $26,050 is the only
    // such point in the repo. This document is the one a household saves and
    // comes back to, so a bare "351%" here outlives the session that produced
    // it; the sentence is shared with the Take-Home tile rather than written
    // twice, because a document that disagrees with the tile that made it is a
    // failure this project has already had once.
    const stepCrossed = crossedStatutoryStep(result, ctx.state);
    const snapshotNote =
      result.totals.marginalRate > 1 && stepCrossed && result.state
        ? statutoryStepSentence(stepCrossed, result.state.jurisdictionName, locale)
        : undefined;
    sections.push({
      title: "Snapshot",
      note: snapshotNote,
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

    // The parts of "Total tax", in the order they are printed. The county tax
    // belongs here for the same reason it is in the total: it is a tax the
    // household pays. Left out, the document listed three figures under a total
    // that included a fourth -- $23,486.38 of lines beneath a $26,316.78 total,
    // for a Maryland resident at $95,000, with nothing on the page accounting
    // for the difference. And the parts are allocated to the total by largest
    // remainder rather than each rounded to itself, so the column adds up
    // exactly: see `allocateRounded`.
    const taxParts: { label: string; amount: Money }[] = [
      { label: "Federal income tax", amount: result.federal.incomeTax },
      { label: "Social Security + Medicare (FICA)", amount: result.fica.total },
      ...(result.state
        ? [
            {
              label: `${result.state.jurisdictionName} income tax`,
              amount: result.state.incomeTax,
            },
          ]
        : []),
      ...result.local.lines.map((l) => ({ label: `${l.name} local tax`, amount: l.tax })),
    ];
    const taxShares = allocateRounded(
      taxParts.map((p) => p.amount),
      result.totals.totalTax,
    );

    sections.push({
      title: "My tax picture",
      lines: [
        ...taxParts.map((p, i) => ({ label: p.label, value: usd(taxShares[i]!) })),
        { label: "Total tax", value: usd(result.totals.totalTax) },
        {
          label: "Cost of your next $1,000 of income",
          value: `${usd(marginalCost)} (${pct(marginalCost.toNumber() / 1000)})`,
        },
        // This report is a document somebody saves and reads again months
        // later, computed from an income and a filing status alone — so every
        // figure above is high for a reader any of the Act's five new
        // deductions reaches. A document that will outlive the session has to
        // carry its own caveat; there is no tile beside it to explain.
        {
          label: "What this does not include",
          value:
            "Five deductions new for 2026 — tips, overtime, car loan interest, being 65, and giving without itemizing — are not in these figures, so your real tax may be lower. Take-Home and Federal Income Tax ask for them and apply them.",
        },
      ],
    });
  } else {
    sections.push({
      title: "Snapshot",
      lines: [
        { label: "Status", value: "Add your income in My Situation to compute your snapshot." },
      ],
    });
  }

  // --- What you may be owed (Pillar 2) ---
  // Composed from the same benefits engine the screener uses, on the household
  // already in My Situation: the FPL position, the Medicaid/ACA likelihood it
  // implies, and the refundable-credit dollar estimates. Qualifying children are
  // the household members under 17 (the CTC test); married follows filing status.
  const owedLines: ReportLine[] = [];
  const householdSize = profile.get("householdSize");
  const qualifyingChildren = (profile.get("ages") ?? []).filter((a) => a < 17).length;
  const married = filingStatus === "married_jointly";
  const fplData = data?.fpl(regionFromState(stateCode)) ?? null;
  const eitcCtc = data?.eitcCtc() ?? null;
  const medicaidData = data?.medicaid() ?? null;
  const acaData = data?.aca() ?? null;

  if (income > 0 && householdSize && fplData) {
    const p = fplPercent(income, householdSize, fplData);
    owedLines.push({
      label: "Household income vs. poverty line",
      value: `${p.toFixed(0)}% of FPL`,
    });
    citations.push(fplData.citation);
    // The Report used to test `p <= 138` and `p >= 100` against literals it
    // held itself. Both are figures somebody legislates and both live on
    // hashed, cited shards — the Medicaid expansion threshold with PER-STATE
    // overrides the Report was ignoring outright, and the ACA's eligibility
    // band, whose 400% ceiling came back for 2026 when §71302(a) repealed the
    // suspension. A document a household saves must not disagree with the tile
    // it was generated beside, so both questions are asked of the engine that
    // answers them everywhere else.
    const medicaid = medicaidData
      ? medicaidEligibility({ stateCode, income, householdSize }, medicaidData, fplData)
      : null;
    if (medicaid?.eligible) {
      owedLines.push({
        label: "Medicaid",
        value: `Likely eligible — at or under ${medicaid.thresholdPctFpl}% of the poverty line in ${stateCode.toUpperCase()}`,
      });
      citations.push(medicaidData!.citation);
    } else if (acaData && acaCreditEligible(p, acaData)) {
      owedLines.push({
        label: "ACA premium tax credit",
        value: "Likely eligible; size it in the ACA tool",
      });
      citations.push(acaData.citation);
    }
  }
  if (income > 0 && eitcCtc) {
    const eitc = estimateEitc({ earnedIncome: income, qualifyingChildren, married }, eitcCtc);
    if (eitc.credit.greaterThan(0)) {
      owedLines.push({ label: "Earned Income Tax Credit (estimated)", value: usd(eitc.credit) });
      citations.push(eitcCtc.citation);
    }
    const ctc = estimateCtc({ qualifyingChildren, magi: income, married }, eitcCtc);
    if (ctc.credit.greaterThan(0)) {
      owedLines.push({ label: "Child Tax Credit (estimated)", value: usd(ctc.credit) });
      citations.push(eitcCtc.citation);
    }
  }
  sections.push({
    title: "What you may be owed",
    lines: owedLines,
    note: "Estimated from your household. For SNAP, the Saver's Credit, and the full picture, use the What Am I Owed screener, which composes them together.",
  });

  // --- My Plan: the current next right step ---
  const plan = evaluatePlan(planInputFrom(profile, data), config);
  if (plan.current) {
    const c = plan.current;
    if (c.citation) citations.push(c.citation);
    sections.push({
      title: "My Plan, the next right step",
      lines: [
        { label: "Current step", value: c.title },
        { label: "Next action", value: c.action },
        ...c.math.map((m) => ({ label: m.label, value: m.value })),
      ],
    });
  } else {
    sections.push({
      title: "My Plan",
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
    { label: "My Enough Number multiple", value: `${config.enoughMultiple}× annual essentials` },
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
    .map((c) => {
      const note = c.sourceNote ? `<br /><span class="cite-note">${esc(c.sourceNote)}</span>` : "";
      return `        <li>${esc(c.sourceDocument)} (${c.effectiveYear}), <a href="${esc(c.sourceUrl)}">${esc(c.sourceUrl)}</a>${note}</li>`;
    })
    .join("\n");

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>My Readout Report · enklayve</title>
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
      .appendix li { margin-bottom: 0.4rem; }
      .cite-note { color: #5b5570; font-size: 0.85rem; line-height: 1.4; }
      a { color: #6d28d9; word-break: break-all; }
      footer { margin-top: 2rem; color: #5b5570; font-size: 0.85rem; }
    </style>
  </head>
  <body>
    <h1>My Readout Report</h1>
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
    <footer>enklayve, a calm, private money guide. Every figure is reproducible from the dataset versions above.</footer>
  </body>
</html>
`;
}
