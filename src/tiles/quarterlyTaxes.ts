/**
 * Quarterly Taxes & Set-Aside (BUILD-SPEC-2 §6.4). The question every 1099 worker
 * actually has: "how much of each payment do I keep for the IRS, and what do I send
 * in every quarter?" No employer withholds for you, so you self-withhold. This adds
 * up the two taxes a self-employed person owes — self-employment tax (both halves of
 * Social Security and Medicare) AND federal + state income tax — then shows the
 * share to skim off every payment into a tax bucket and the four equal 1040-ES
 * installments. Built on the same deterministic engine as the take-home tile.
 *
 * Simplification: we omit the QBI / §199A deduction, so the figure errs slightly
 * high — the safe direction when the goal is "set enough aside."
 */
import { Money } from "../engine/money";
import { evaluateTaxes, selfEmploymentTax, type TaxInput } from "../engine/tax";
import type { CitationData, FilingStatus } from "../data/schemas";
import { el, option } from "../ui/dom";
import { field, parseNonNegative, pct, tryExampleButton } from "../ui/form";
import { resultCard, type BreakdownLine } from "../ui/resultCard";
import { donutChart, paletteVar } from "../ui/charts";
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

// The safe harbor rises from 100% to 110% of last year's tax above this AGI.
const SAFE_HARBOR_HIGH_AGI = 150000;

interface Fields {
  fs: FilingStatus;
  state: string;
  profit: number;
  other: number;
  lastYearTax: number;
}

const EXAMPLE: Fields = { fs: "single", state: "ca", profit: 90000, other: 0, lastYearTax: 0 };

function isFilingStatus(v: string): v is FilingStatus {
  return FILING_STATUSES.some((f) => f.value === v);
}

function readFields(p: URLSearchParams, profile: SituationStore): Fields {
  const fs = p.get("fs");
  const st = p.get("st");
  return {
    fs: fs && isFilingStatus(fs) ? fs : (profile.get("filingStatus") ?? "single"),
    state: st !== null ? st : (profile.get("stateCode") ?? ""),
    profit: p.has("np") ? parseNonNegative(p.get("np"), 0) : (profile.get("annualIncome") ?? 0),
    other: parseNonNegative(p.get("oth"), 0),
    lastYearTax: parseNonNegative(p.get("ly"), 0),
  };
}

function writeFields(f: Fields): URLSearchParams {
  const p = new URLSearchParams();
  p.set("fs", f.fs);
  p.set("st", f.state);
  p.set("np", String(f.profit));
  if (f.other > 0) p.set("oth", String(f.other));
  if (f.lastYearTax > 0) p.set("ly", String(f.lastYearTax));
  return p;
}

export function mountQuarterlyTaxes(ctx: TileContext): void {
  const { root, data, profile } = ctx;
  root.replaceChildren();
  const fed = data?.federal();
  const fica = data?.fica();
  if (!fed || !fica) {
    root.append(
      el("div", {
        class: "verify-banner",
        attrs: { role: "alert" },
        text: "Federal tax data is unavailable, verify before relying on any figure.",
      }),
    );
    return;
  }

  let fields = readFields(ctx.params, profile);

  const fsSelect = el(
    "select",
    { name: "fs", attrs: { "aria-label": "Filing status" } },
    ...FILING_STATUSES.map((s) => option(s.value, s.label, s.value === fields.fs)),
  );
  const stateCodes = data?.stateCodes() ?? [];
  const stateSelect = el(
    "select",
    { name: "st", attrs: { "aria-label": "State" } },
    option("", "No state income tax", fields.state === ""),
    ...stateCodes.map((c) => option(c, c.toUpperCase(), c === fields.state)),
  );
  fsSelect.value = fields.fs;
  stateSelect.value = fields.state;

  const mkNum = (name: string, label: string, value: number): HTMLInputElement =>
    el("input", {
      type: "number",
      name,
      min: 0,
      step: 1000,
      value,
      attrs: { "aria-label": label, inputmode: "decimal" },
    });
  const npInput = mkNum("np", "Net business profit", fields.profit);
  const othInput = mkNum("oth", "Other taxable household income", fields.other);
  const lyInput = mkNum("ly", "Last year's total tax (optional)", fields.lastYearTax);

  const chartContainer = el("div", { class: "tile-charts" });
  const resultContainer = el("div", { class: "tile-result", attrs: { "aria-live": "polite" } });

  function compute(): void {
    const se = selfEmploymentTax(Money.from(fields.profit), fields.fs, fica!);
    const stateJur = fields.state ? (data?.state(fields.state) ?? undefined) : undefined;
    const input: TaxInput = {
      filingStatus: fields.fs,
      wages: 0, // self-employed: no W-2 wages, so no employee FICA here
      otherIncome: fields.profit + fields.other, // income-tax-only
      adjustments: se.deductibleHalf.toNumber(), // half of SE tax is above-the-line
    };
    const r = evaluateTaxes(input, { federal: fed!, fica: fica!, state: stateJur });
    const fedIncome = r.federal.incomeTax;
    const stateIncome = r.state?.incomeTax ?? Money.zero();
    const incomeTax = fedIncome.add(stateIncome);
    const totalTax = incomeTax.add(se.total);

    const totalIncome = fields.profit + fields.other;
    const setAside = totalIncome > 0 ? totalTax.divide(totalIncome).toNumber() : 0;
    const quarterly = totalTax.divide(4);
    const kept = Money.from(totalIncome).subtract(totalTax);
    const fmt = (m: Money): string => m.format(ctx.locale);

    const lines: BreakdownLine[] = [
      { label: "Net business profit", value: fmt(Money.from(fields.profit)) },
      { label: "Self-employment tax", value: fmt(se.total), citation: se.citation },
      { label: "Federal income tax", value: fmt(fedIncome), citation: fed!.citation },
    ];
    if (stateJur) {
      lines.push({
        label: `State income tax (${fields.state.toUpperCase()})`,
        value: fmt(stateIncome),
        citation: r.state?.citation ?? null,
      });
    }
    lines.push(
      { label: "Total estimated tax for the year", value: fmt(totalTax), emphasis: true },
      {
        label: "Set aside this share of every payment",
        value: pct(Math.max(0, setAside), 1),
      },
    );
    for (const due of QUARTERS) {
      lines.push({
        label: `Quarterly payment, ${due}`,
        value: fmt(quarterly),
        citation: ESTIMATED_PAYMENT_CITATION,
      });
    }
    if (fields.lastYearTax > 0) {
      const factor = r.agi.greaterThan(SAFE_HARBOR_HIGH_AGI) ? 1.1 : 1.0;
      const byLastYear = Money.from(fields.lastYearTax).multiply(factor);
      const byThisYear = totalTax.multiply(0.9);
      const safe = byLastYear.lessThan(byThisYear) ? byLastYear : byThisYear;
      lines.push({
        label: "Safe-harbor minimum for the year (avoids the underpayment penalty)",
        value: `${fmt(safe)} (${fmt(safe.divide(4))} per quarter)`,
        citation: ESTIMATED_PAYMENT_CITATION,
      });
    }
    lines.push({
      label: "Note",
      value:
        "We don't subtract the QBI (20% pass-through) deduction, so this errs a little high — the safe side when you're setting money aside.",
    });

    chartContainer.replaceChildren(
      donutChart({
        slices: [
          { label: "Self-employment tax", value: se.total.toNumber(), color: paletteVar(0) },
          { label: "Federal income tax", value: fedIncome.toNumber(), color: paletteVar(1) },
          ...(stateJur && stateIncome.greaterThan(0)
            ? [{ label: "State income tax", value: stateIncome.toNumber(), color: paletteVar(2) }]
            : []),
          {
            label: "What you keep",
            value: Math.max(0, kept.toNumber()),
            color: "var(--enk-accent)",
          },
        ],
        locale: ctx.locale,
        ariaLabel: "Your income split between taxes and what you keep",
        centerValue: pct(Math.max(0, setAside), 0),
        centerLabel: "to taxes",
      }),
    );

    resultContainer.replaceChildren(
      resultCard({
        label: "Estimated tax for the year",
        value: totalTax,
        locale: ctx.locale,
        breakdown: lines,
        permalink: () => ctx.permalink(writeFields(fields)),
      }),
    );
  }

  function recompute(): void {
    fields = {
      fs: isFilingStatus(fsSelect.value) ? fsSelect.value : "single",
      state: stateSelect.value,
      profit: parseNonNegative(npInput.value, 0),
      other: parseNonNegative(othInput.value, 0),
      lastYearTax: parseNonNegative(lyInput.value, 0),
    };
    ctx.setParams(writeFields(fields));
    rememberShared(profile, {
      filingStatus: fields.fs,
      stateCode: fields.state || undefined,
      annualIncome: fields.profit,
    });
    compute();
  }

  for (const s of [fsSelect, stateSelect]) s.addEventListener("change", recompute);
  for (const i of [npInput, othInput, lyInput]) i.addEventListener("input", recompute);

  const tryExample = tryExampleButton(() => {
    fields = { ...EXAMPLE };
    fsSelect.value = fields.fs;
    stateSelect.value = fields.state;
    npInput.value = String(fields.profit);
    othInput.value = String(fields.other);
    lyInput.value = String(fields.lastYearTax);
    recompute();
  });

  const form = el(
    "form",
    { class: "tile-form", on: { submit: (e) => e.preventDefault() } },
    field("Filing status", fsSelect),
    field("State", stateSelect),
    field("Net business profit", npInput),
    field("Other taxable household income", othInput),
    field("Last year's total tax (optional)", lyInput),
    el("div", { class: "tile-form-actions" }, tryExample),
  );

  root.append(form, chartContainer, resultContainer);
  compute();
}

export const quarterlyTaxesTile: TileDefinition = {
  id: "quarterly-taxes",
  title: "Quarterly Taxes & Set-Aside",
  pillar: "paycheck",
  description: "How much of every 1099 payment to keep for taxes, and what to pay each quarter.",
  keywords: [
    "self employed",
    "1099",
    "freelance",
    "contractor",
    "gig",
    "quarterly",
    "estimated tax",
    "set aside",
    "1040-es",
    "schedule c",
  ],
  status: "ready",
  how: "When you work for yourself, no employer withholds taxes from your pay, so you have to do it yourself — and you owe two taxes, not one. First is self-employment tax: both halves of Social Security and Medicare (15.3% on 92.35% of your profit). Second is regular income tax, federal and state, on your profit minus the deductible half of that SE tax. We add the two together to get your tax for the year.\n\nFrom that we show the share to skim off every payment you receive (move it to a separate tax account the day it lands) and the four equal estimated payments the IRS expects on the 1040-ES schedule. If you enter last year's total tax, we also show the safe-harbor minimum — pay at least that much across the year and you avoid the underpayment penalty even if you earn more than expected.\n\nWe don't subtract the QBI (20% qualified business income) deduction, so the number leans slightly high, which is the safe side when the whole point is setting enough aside. Filing status, state, and income flow to and from My Situation.",
  resources: [
    {
      label: "IRS, estimated taxes",
      url: "https://www.irs.gov/businesses/small-businesses-self-employed/estimated-taxes",
    },
    {
      label: "IRS, Form 1040-ES (estimated tax)",
      url: "https://www.irs.gov/forms-pubs/about-form-1040-es",
    },
  ],
  mount: mountQuarterlyTaxes,
};
