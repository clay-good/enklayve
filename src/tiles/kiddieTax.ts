/**
 * Kiddie-tax estimator (SPEC-3 §4.5). "How is my child's investment income taxed?"
 * Shows the IRC §1(g) three-band stack — the dependent standard-deduction shelter,
 * the next band at the child's own rate, and the remainder at the parents' marginal
 * rate — plus the effective rate on the unearned portion. Gates on the federal and
 * kiddie-tax shards; frames the result as an estimate and points to a pro.
 */
import { Money } from "../engine/money";
import { kiddieTax } from "../engine/kiddieTax";
import { bracketsFor, standardDeductionFor } from "../engine/tax";
import { el, option } from "../ui/dom";
import { field, parseNonNegative, pct, tryExampleButton } from "../ui/form";
import { resultCard, type BreakdownLine } from "../ui/resultCard";
import type { TileContext, TileDefinition } from "./types";

interface Fields {
  unearned: number;
  earned: number;
  parentRate: number;
}

const EXAMPLE: Fields = { unearned: 8000, earned: 0, parentRate: 0.24 };

function readFields(p: URLSearchParams): Fields {
  return {
    unearned: parseNonNegative(p.get("u"), 0),
    earned: parseNonNegative(p.get("e"), 0),
    parentRate: parseNonNegative(p.get("pr"), 0.24),
  };
}

function writeFields(f: Fields): URLSearchParams {
  const p = new URLSearchParams();
  p.set("u", String(f.unearned));
  if (f.earned > 0) p.set("e", String(f.earned));
  p.set("pr", String(f.parentRate));
  return p;
}

export function mountKiddieTax(ctx: TileContext): void {
  const { root, data } = ctx;
  root.replaceChildren();
  const fed = data?.federal();
  const kid = data?.kiddieTax();
  if (!fed || !kid) {
    root.append(
      el("div", {
        class: "verify-banner",
        attrs: { role: "alert" },
        text: "Federal or kiddie-tax data is unavailable, verify before relying on any figure.",
      }),
    );
    return;
  }
  let fields = readFields(ctx.params);

  // The parents' marginal-rate options are the distinct federal ordinary rates.
  const singleBrackets = bracketsFor(fed, "single");
  const rates = Array.from(new Set(singleBrackets.map((b) => b.rate))).sort((a, b) => a - b);
  const prSelect = el(
    "select",
    { name: "pr", attrs: { "aria-label": "Parents' marginal tax rate" } },
    ...rates.map((r) => option(String(r), pct(r, 0), Math.abs(r - fields.parentRate) < 1e-9)),
  );
  const mkNum = (name: string, label: string, value: number): HTMLInputElement =>
    el("input", {
      type: "number",
      name,
      min: 0,
      step: 500,
      value,
      attrs: { "aria-label": label, inputmode: "decimal" },
    });
  const uInput = mkNum("u", "Child's unearned income", fields.unearned);
  const eInput = mkNum("e", "Child's earned income", fields.earned);

  const resultContainer = el("div", { class: "tile-result", attrs: { "aria-live": "polite" } });

  function compute(): void {
    const r = kiddieTax(
      {
        unearnedIncome: fields.unearned,
        earnedIncome: fields.earned,
        parentMarginalRate: fields.parentRate,
      },
      kid!,
      {
        singleBrackets,
        singleStandardDeduction: standardDeductionFor(fed!, "single"),
      },
    );
    const fmt = (m: Money): string => m.format(ctx.locale);
    const lines: BreakdownLine[] = [
      {
        label: "Dependent standard deduction (sheltered)",
        value: fmt(r.dependentStandardDeduction),
        citation: kid!.citation,
      },
      { label: "Taxable income", value: fmt(r.taxableIncome) },
      {
        label: `Taxed at the child's own rate`,
        value: `${fmt(r.amountAtChildRate)} → ${fmt(r.taxAtChildRate)}`,
        citation: fed!.citation,
      },
      {
        label: `Taxed at the parents' rate (${pct(fields.parentRate, 0)})`,
        value: `${fmt(r.amountAtParentRate)} → ${fmt(r.taxAtParentRate)}`,
        citation: kid!.citation,
      },
      { label: "Estimated total tax", value: fmt(r.totalTax), emphasis: true },
      {
        label: "Effective rate on the unearned income",
        value: r.effectiveRateOnUnearned > 0 ? pct(r.effectiveRateOnUnearned, 1) : "0%",
      },
      {
        label: r.subjectToKiddieTax ? "Kiddie tax applies" : "Below the kiddie-tax threshold",
        value: r.subjectToKiddieTax
          ? "Unearned income clears twice the dependent deduction, so the top slice is taxed at the parents' rate (Form 8615). An estimate — see a pro for the parents'-return interaction and any state tax."
          : "Unearned income is under twice the dependent deduction, so none is pushed to the parents' rate.",
      },
    ];

    resultContainer.replaceChildren(
      resultCard({
        label: "Estimated tax on your child's income",
        value: r.totalTax,
        locale: ctx.locale,
        breakdown: lines,
        permalink: () => ctx.permalink(writeFields(fields)),
      }),
    );
  }

  function recompute(): void {
    fields = {
      unearned: parseNonNegative(uInput.value, 0),
      earned: parseNonNegative(eInput.value, 0),
      parentRate: parseNonNegative(prSelect.value, 0.24),
    };
    ctx.setParams(writeFields(fields));
    compute();
  }

  prSelect.addEventListener("change", recompute);
  for (const i of [uInput, eInput]) i.addEventListener("input", recompute);

  const tryExample = tryExampleButton(() => {
    fields = { ...EXAMPLE };
    uInput.value = String(fields.unearned);
    eInput.value = String(fields.earned);
    prSelect.value = String(fields.parentRate);
    recompute();
  });

  const form = el(
    "form",
    { class: "tile-form", on: { submit: (e) => e.preventDefault() } },
    field("Child's unearned income (interest, dividends, gains)", uInput),
    field("Child's earned income (wages)", eInput),
    field("Parents' marginal tax rate", prSelect),
    el("div", { class: "tile-form-actions" }, tryExample),
  );

  root.append(form, resultContainer);
  compute();
}

export const kiddieTaxTile: TileDefinition = {
  id: "kiddie-tax",
  title: "Kiddie Tax Estimator",
  pillar: "investing",
  description: "How a child's investment income is taxed across the three IRC §1(g) bands.",
  keywords: [
    "kiddie tax",
    "child",
    "unearned income",
    "investment income",
    "form 8615",
    "8615",
    "dependent",
    "1(g)",
    "custodial",
    "ugma",
    "utma",
  ],
  status: "ready",
  how: "When a child has investment income, the \"kiddie tax\" stops families from sheltering it in the child's low bracket. It stacks in three bands: the dependent standard deduction shelters the first slice tax-free; the next slice (up to twice the base) is taxed at the child's own low rate; and everything above that is taxed at the parents' marginal rate, as if it sat on top of the parents' income.\n\nEnter the child's unearned income (interest, dividends, capital gains), any earned income (wages, always taxed at the child's rate), and the parents' top marginal rate. We use the 2026 dependent standard-deduction base ($1,350) and the federal single brackets for the child's-rate band. This is an estimate — the exact Form 8615 interaction with the parents' return has edge cases, and states tax this differently — so check the result against the form or a preparer.",
  resources: [
    { label: "IRS Topic 553, the kiddie tax", url: "https://www.irs.gov/taxtopics/tc553" },
    { label: "IRS Form 8615", url: "https://www.irs.gov/forms-pubs/about-form-8615" },
  ],
  mount: mountKiddieTax,
};
