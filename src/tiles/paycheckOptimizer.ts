/**
 * Paycheck Optimizer tile (BUILD-SPEC-2 §6.4): how your pre-tax levers move your
 * take-home and your tax. Built on the existing tax engine, so every figure is
 * the same deterministic federal + FICA + state math the take-home tile uses. It
 * shows your take-home now and the tax saved by the next $1,000 into each lever —
 * a 401(k) deferral (income tax only) versus an HSA (which also escapes FICA, so
 * it saves more). Reads filing status, state, and income from My Situation.
 */
import { Money } from "../engine/money";
import { evaluateTaxes, type TaxInput } from "../engine/tax";
import type { FilingStatus } from "../data/schemas";
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

const STEP = 1000; // the marginal lever we measure (tax saved per $1,000).

interface Fields {
  fs: FilingStatus;
  state: string;
  wages: number;
  k401: number;
  hsa: number;
}

const EXAMPLE: Fields = { fs: "single", state: "ca", wages: 95000, k401: 8000, hsa: 2000 };

function isFilingStatus(v: string): v is FilingStatus {
  return FILING_STATUSES.some((f) => f.value === v);
}

function readFields(p: URLSearchParams, profile: SituationStore): Fields {
  const fs = p.get("fs");
  const st = p.get("st");
  return {
    fs: fs && isFilingStatus(fs) ? fs : (profile.get("filingStatus") ?? "single"),
    state: st !== null ? st : (profile.get("stateCode") ?? ""),
    wages: p.has("w") ? parseNonNegative(p.get("w"), 0) : (profile.get("annualIncome") ?? 0),
    k401: parseNonNegative(p.get("k"), 0),
    hsa: parseNonNegative(p.get("hsa"), 0),
  };
}

function writeFields(f: Fields): URLSearchParams {
  const p = new URLSearchParams();
  p.set("fs", f.fs);
  p.set("st", f.state);
  p.set("w", String(f.wages));
  if (f.k401 > 0) p.set("k", String(f.k401));
  if (f.hsa > 0) p.set("hsa", String(f.hsa));
  return p;
}

export function mountPaycheckOptimizer(ctx: TileContext): void {
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
  // Ensure the control reflects the resolved state even if it isn't a seeded
  // jurisdiction (the option list only holds states we have tax data for).
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
  const wInput = mkNum("w", "Gross annual wages", fields.wages);
  const kInput = mkNum("k", "401(k) contribution", fields.k401);
  const hsaInput = mkNum("hsa", "HSA contribution", fields.hsa);

  const resultContainer = el("div", { class: "tile-result", attrs: { "aria-live": "polite" } });

  /** Total tax for given 401(k) and HSA amounts (HSA also cuts the FICA wage base). */
  function taxFor(k401: number, hsa: number): { tax: Money; takeHome: Money; rate: number } {
    const input: TaxInput = {
      filingStatus: fields.fs,
      wages: Math.max(0, fields.wages - hsa), // HSA leaves wages → cuts income tax AND FICA
      adjustments: k401, // 401(k) reduces AGI (income tax) but not the FICA base
    };
    const state = fields.state ? (data?.state(fields.state) ?? undefined) : undefined;
    const r = evaluateTaxes(input, { federal: fed!, fica: fica!, state });
    return { tax: r.totals.totalTax, takeHome: r.totals.takeHome, rate: r.totals.effectiveRate };
  }

  function compute(): void {
    const base = taxFor(fields.k401, fields.hsa);
    const k401Bumped = taxFor(fields.k401 + STEP, fields.hsa);
    const hsaBumped = taxFor(fields.k401, fields.hsa + STEP);
    const k401Saving = base.tax.subtract(k401Bumped.tax);
    const hsaSaving = base.tax.subtract(hsaBumped.tax);
    const fmt = (m: Money): string => m.format(ctx.locale);

    const lines: BreakdownLine[] = [
      {
        label: "Total tax (federal + FICA + state)",
        value: fmt(base.tax),
        citation: fed!.citation,
      },
      { label: "Effective tax rate", value: pct(base.rate) },
      {
        label: "Tax saved per $1,000 into your 401(k)",
        value: fmt(k401Saving),
        citation: fed!.citation,
      },
      {
        label: "Tax saved per $1,000 into your HSA",
        value: fmt(hsaSaving),
        citation: fica!.citation,
      },
      {
        label: "Why the HSA saves more",
        value: `An HSA contribution also skips Social Security and Medicare tax, so it beats the 401(k) by ${fmt(hsaSaving.subtract(k401Saving))} per $1,000 — though HSA money is for medical costs.`,
      },
    ];

    resultContainer.replaceChildren(
      resultCard({
        label: "Your take-home with these contributions",
        value: base.takeHome,
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
      wages: parseNonNegative(wInput.value, 0),
      k401: parseNonNegative(kInput.value, 0),
      hsa: parseNonNegative(hsaInput.value, 0),
    };
    ctx.setParams(writeFields(fields));
    rememberShared(profile, {
      filingStatus: fields.fs,
      stateCode: fields.state || undefined,
      annualIncome: fields.wages,
    });
    compute();
  }

  for (const s of [fsSelect, stateSelect]) s.addEventListener("change", recompute);
  for (const i of [wInput, kInput, hsaInput]) i.addEventListener("input", recompute);

  const tryExample = tryExampleButton(() => {
    fields = { ...EXAMPLE };
    fsSelect.value = fields.fs;
    stateSelect.value = fields.state;
    wInput.value = String(fields.wages);
    kInput.value = String(fields.k401);
    hsaInput.value = String(fields.hsa);
    recompute();
  });

  const form = el(
    "form",
    { class: "tile-form", on: { submit: (e) => e.preventDefault() } },
    field("Filing status", fsSelect),
    field("State", stateSelect),
    field("Gross annual wages", wInput),
    field("401(k) contribution", kInput),
    field("HSA contribution", hsaInput),
    el("div", { class: "tile-form-actions" }, tryExample),
  );

  root.append(form, resultContainer);
  compute();
}

export const paycheckOptimizerTile: TileDefinition = {
  id: "paycheck-optimizer",
  title: "Paycheck Optimizer",
  pillar: "take-home",
  description: "See how 401(k) and HSA contributions move your take-home.",
  keywords: ["paycheck", "optimizer", "401k", "hsa", "pre-tax", "take home", "tax savings"],
  status: "ready",
  how: "Pre-tax contributions lower your tax bill, but not all of them the same way. A traditional 401(k) deferral cuts your income tax. An HSA contribution through payroll cuts your income tax too — and it also skips Social Security and Medicare (FICA) tax, so each dollar saves a little more. This shows your take-home now and the tax saved by the next $1,000 into each, using the same federal + FICA + state engine as the take-home tile.\n\nThe figures are exact for the numbers you enter. HSA money is meant for medical costs and needs an HSA-eligible health plan, so it isn't a free lunch — but if you have one, it's the most tax-efficient dollar on your paycheck. Filing status, state, and income flow to and from My Situation. Tuning the W-4 itself arrives with the withholding estimator in a later wave.",
  resources: [
    {
      label: "IRS, retirement topics — contributions",
      url: "https://www.irs.gov/retirement-plans",
    },
    { label: "IRS Publication 969 (HSAs)", url: "https://www.irs.gov/publications/p969" },
  ],
  mount: mountPaycheckOptimizer,
};
