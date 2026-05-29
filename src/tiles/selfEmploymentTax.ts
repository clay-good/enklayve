/**
 * Self-Employment Tax tile (BUILD-SPEC.md §3.2): self-employment tax plus the
 * quarterly estimated-payment schedule (the 1040-ES cadence). Built on the same
 * FICA dataset as the employee-side computation, so the rates carry the SSA/IRS
 * citation; the four quarterly due dates cite IRS Form 1040-ES.
 */
import { Money } from "../engine/money";
import { selfEmploymentTax } from "../engine/tax";
import type { CitationData, FilingStatus } from "../data/schemas";
import { el, option } from "../ui/dom";
import { field, parseNonNegative, pct, tryExampleButton } from "../ui/form";
import { resultCard, type BreakdownLine } from "../ui/resultCard";
import { rememberShared } from "./profileSync";
import type { SituationStore } from "../profile/situation";
import type { TileContext, TileDefinition } from "./types";

const FILING_STATUSES: { value: FilingStatus; label: string }[] = [
  { value: "single", label: "Single" },
  { value: "married_jointly", label: "Married filing jointly" },
  { value: "married_separately", label: "Married filing separately" },
  { value: "head_of_household", label: "Head of household" },
  { value: "qualifying_surviving_spouse", label: "Qualifying surviving spouse" },
];

/** The four equal 1040-ES installments and their statutory due dates. */
const QUARTERS = ["Apr 15", "Jun 15", "Sep 15", "Jan 15 (next year)"];

const ESTIMATED_PAYMENT_CITATION: CitationData = {
  sourceUrl: "https://www.irs.gov/forms-pubs/about-form-1040-es",
  sourceDocument: "IRS Form 1040-ES, Estimated Tax for Individuals",
  effectiveYear: 2024,
  dateRetrieved: "2024-02-01",
};

interface Fields {
  fs: FilingStatus;
  netProfit: number;
}

const EXAMPLE: Fields = { fs: "single", netProfit: 80000 };

function isFilingStatus(v: string): v is FilingStatus {
  return FILING_STATUSES.some((f) => f.value === v);
}

function readFields(p: URLSearchParams, profile: SituationStore): Fields {
  const fs = p.get("fs");
  return {
    fs: fs && isFilingStatus(fs) ? fs : (profile.get("filingStatus") ?? "single"),
    netProfit: parseNonNegative(p.get("np"), 0),
  };
}

function writeFields(f: Fields): URLSearchParams {
  const p = new URLSearchParams();
  p.set("fs", f.fs);
  p.set("np", String(f.netProfit));
  return p;
}

export function mountSelfEmploymentTax(ctx: TileContext): void {
  const { root, data } = ctx;
  root.replaceChildren();
  const fica = data?.fica();
  if (!fica) {
    root.append(
      el("div", {
        class: "verify-banner",
        attrs: { role: "alert" },
        text: "FICA data is unavailable, verify before relying on any figure.",
      }),
    );
    return;
  }

  let fields = readFields(ctx.params, ctx.profile);

  const fsSelect = el(
    "select",
    { name: "fs", attrs: { "aria-label": "Filing status" } },
    ...FILING_STATUSES.map((s) => option(s.value, s.label, s.value === fields.fs)),
  );
  const npInput = el("input", {
    type: "number",
    name: "np",
    min: 0,
    step: 1000,
    value: fields.netProfit,
    attrs: { "aria-label": "Net self-employment profit", inputmode: "decimal" },
  });

  const resultContainer = el("div", { class: "tile-result", attrs: { "aria-live": "polite" } });

  function compute(): void {
    const r = selfEmploymentTax(Money.from(fields.netProfit), fields.fs, fica!);
    const fmt = (m: Money): string => m.format(ctx.locale);
    const quarterly = r.total.divide(4);
    const effective = fields.netProfit > 0 ? r.total.divide(fields.netProfit).toNumber() : 0;

    const lines: BreakdownLine[] = [
      {
        label: "Earnings subject to SE tax (92.35%)",
        value: fmt(r.taxableBase),
        citation: r.citation,
      },
      { label: "Social Security (12.4%)", value: fmt(r.socialSecurity), citation: r.citation },
      { label: "Medicare (2.9%)", value: fmt(r.medicare), citation: r.citation },
    ];
    if (r.additionalMedicare.greaterThan(0)) {
      lines.push({
        label: "Additional Medicare (0.9%)",
        value: fmt(r.additionalMedicare),
        citation: r.citation,
      });
    }
    lines.push(
      {
        label: "Total self-employment tax",
        value: fmt(r.total),
        citation: r.citation,
        emphasis: true,
      },
      {
        label: "Deductible half (adjustment to income)",
        value: fmt(r.deductibleHalf),
        citation: r.citation,
      },
      { label: "Effective SE-tax rate", value: pct(Math.max(0, effective)) },
    );
    for (const due of QUARTERS) {
      lines.push({
        label: `Quarterly estimate, ${due}`,
        value: fmt(quarterly),
        citation: ESTIMATED_PAYMENT_CITATION,
      });
    }

    resultContainer.replaceChildren(
      resultCard({
        label: "Self-employment tax",
        value: r.total,
        locale: ctx.locale,
        breakdown: lines,
        permalink: () => ctx.permalink(writeFields(fields)),
      }),
    );
  }

  function collect(): void {
    fields = {
      fs: isFilingStatus(fsSelect.value) ? fsSelect.value : "single",
      netProfit: parseNonNegative(npInput.value, 0),
    };
  }

  function recompute(): void {
    collect();
    ctx.setParams(writeFields(fields));
    rememberShared(ctx.profile, { filingStatus: fields.fs });
    compute();
  }

  fsSelect.addEventListener("change", recompute);
  npInput.addEventListener("input", recompute);

  const tryExample = tryExampleButton(() => {
    fields = { ...EXAMPLE };
    fsSelect.value = fields.fs;
    npInput.value = String(fields.netProfit);
    recompute();
  });

  const form = el(
    "form",
    { class: "tile-form", on: { submit: (e) => e.preventDefault() } },
    field("Filing status", fsSelect),
    field("Net self-employment profit", npInput),
    el("div", { class: "tile-form-actions" }, tryExample),
  );

  root.append(form, resultContainer);
  compute();
}

export const selfEmploymentTaxTile: TileDefinition = {
  id: "self-employment-tax",
  title: "Self-Employment Tax",
  pillar: "take-home",
  description: "SE tax plus the quarterly estimated payment schedule.",
  keywords: ["1099", "se tax", "quarterly", "estimated", "self employed", "schedule c"],
  status: "ready",
  how: "When you work for yourself you pay both halves of Social Security and Medicare, so the rate is the full 15.3% rather than the 7.65% an employee sees. We apply it to 92.35% of your net profit (the slice that excludes the employer-equivalent share), cap the 12.4% Social Security portion at the annual wage base, and add the 0.9% Additional Medicare surtax on earnings above your filing-status threshold.\n\nHalf of the total is deductible above the line, so it lowers the income your income tax is figured on. Because no employer withholds for you, the IRS expects four roughly equal estimated payments across the year — we split your total into the 1040-ES quarters so you can see each one.",
  resources: [
    {
      label: "IRS, self-employment tax",
      url: "https://www.irs.gov/businesses/small-businesses-self-employed/self-employment-tax-social-security-and-medicare-taxes",
    },
    {
      label: "IRS, Form 1040-ES (estimated tax)",
      url: "https://www.irs.gov/forms-pubs/about-form-1040-es",
    },
  ],
  mount: mountSelfEmploymentTax,
};
