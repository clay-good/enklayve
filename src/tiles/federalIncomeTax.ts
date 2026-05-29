/**
 * Federal Income Tax tile (BUILD-SPEC.md §3.2): federal income tax with a
 * marginal and effective breakdown and a standard-vs-itemized toggle (the "big
 * four" itemized inputs). Reuses the deterministic engine and the federal
 * jurisdiction dataset, so every figure carries the IRS citation.
 */
import { Money } from "../engine/money";
import { evaluateTaxes, type TaxInput } from "../engine/tax";
import type { DeductionMode, ItemizedInput } from "../engine/tax/types";
import type { FilingStatus, Jurisdiction, FicaData } from "../data/schemas";
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

const DEDUCTION_MODES: { value: DeductionMode; label: string }[] = [
  { value: "auto", label: "Larger of standard / itemized" },
  { value: "standard", label: "Standard deduction" },
  { value: "itemized", label: "Itemized (big four)" },
];

interface Fields {
  fs: FilingStatus;
  income: number;
  adjustments: number;
  dm: DeductionMode;
  salt: number;
  mortgage: number;
  charitable: number;
  medical: number;
}

const EXAMPLE: Fields = {
  fs: "single",
  income: 95000,
  adjustments: 0,
  dm: "auto",
  salt: 9000,
  mortgage: 8000,
  charitable: 3000,
  medical: 0,
};

function isFilingStatus(v: string): v is FilingStatus {
  return FILING_STATUSES.some((f) => f.value === v);
}
function isDeductionMode(v: string): v is DeductionMode {
  return DEDUCTION_MODES.some((d) => d.value === v);
}

function readFields(p: URLSearchParams, profile: SituationStore): Fields {
  const fs = p.get("fs");
  const dm = p.get("dm");
  return {
    // Precedence: URL fragment > session profile > built-in default.
    fs: fs && isFilingStatus(fs) ? fs : (profile.get("filingStatus") ?? "single"),
    income: p.has("inc") ? parseNonNegative(p.get("inc"), 0) : (profile.get("annualIncome") ?? 0),
    adjustments: parseNonNegative(p.get("adj"), 0),
    dm: dm && isDeductionMode(dm) ? dm : "auto",
    salt: parseNonNegative(p.get("salt"), 0),
    mortgage: parseNonNegative(p.get("mort"), 0),
    charitable: parseNonNegative(p.get("char"), 0),
    medical: parseNonNegative(p.get("med"), 0),
  };
}

function writeFields(f: Fields): URLSearchParams {
  const p = new URLSearchParams();
  p.set("fs", f.fs);
  p.set("inc", String(f.income));
  if (f.adjustments > 0) p.set("adj", String(f.adjustments));
  if (f.dm !== "auto") p.set("dm", f.dm);
  if (f.salt > 0) p.set("salt", String(f.salt));
  if (f.mortgage > 0) p.set("mort", String(f.mortgage));
  if (f.charitable > 0) p.set("char", String(f.charitable));
  if (f.medical > 0) p.set("med", String(f.medical));
  return p;
}

function itemizedOf(f: Fields): ItemizedInput {
  return {
    stateAndLocalTaxes: f.salt,
    mortgageInterest: f.mortgage,
    charitable: f.charitable,
    medicalExpenses: f.medical,
  };
}

/** Federal income tax owed at a given wage level (income tax only, no FICA). */
function federalTaxAt(income: number, f: Fields, fed: Jurisdiction, fica: FicaData): Money {
  const input: TaxInput = {
    filingStatus: f.fs,
    wages: income,
    adjustments: f.adjustments,
    deductionMode: f.dm,
    itemized: itemizedOf(f),
  };
  return evaluateTaxes(input, { federal: fed, fica }).federal.incomeTax;
}

export function mountFederalIncomeTax(ctx: TileContext): void {
  const { root, data } = ctx;
  root.replaceChildren();
  const fed = data?.federal();
  const fica = data?.fica();
  if (!fed || !fica) {
    root.append(
      el("div", {
        class: "verify-banner",
        attrs: { role: "alert" },
        text: "Federal tax data is unavailable — verify before relying on any figure.",
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
  const incInput = el("input", {
    type: "number",
    name: "inc",
    min: 0,
    step: 1000,
    value: fields.income,
    attrs: { "aria-label": "Taxable wages and income", inputmode: "decimal" },
  });
  const adjInput = el("input", {
    type: "number",
    name: "adj",
    min: 0,
    step: 500,
    value: fields.adjustments,
    attrs: { "aria-label": "Pre-tax adjustments", inputmode: "decimal" },
  });
  const dmSelect = el(
    "select",
    { name: "dm", attrs: { "aria-label": "Deduction method" } },
    ...DEDUCTION_MODES.map((d) => option(d.value, d.label, d.value === fields.dm)),
  );

  const mkMoney = (name: string, value: number, label: string): HTMLInputElement =>
    el("input", {
      type: "number",
      name,
      min: 0,
      step: 500,
      value,
      attrs: { "aria-label": label, inputmode: "decimal" },
    });
  const saltInput = mkMoney("salt", fields.salt, "State and local taxes");
  const mortInput = mkMoney("mort", fields.mortgage, "Mortgage interest");
  const charInput = mkMoney("char", fields.charitable, "Charitable contributions");
  const medInput = mkMoney("med", fields.medical, "Medical expenses");

  const itemizedGroup = el(
    "div",
    { class: "local-addons" },
    el("p", { class: "field-group-label", text: "Itemized deductions (big four)" }),
    field("State & local taxes", saltInput),
    field("Mortgage interest", mortInput),
    field("Charitable", charInput),
    field("Medical expenses", medInput),
  );

  const resultContainer = el("div", { class: "tile-result", attrs: { "aria-live": "polite" } });

  function syncItemizedVisibility(): void {
    itemizedGroup.hidden = dmSelect.value === "standard";
  }

  function collect(): void {
    fields = {
      fs: isFilingStatus(fsSelect.value) ? fsSelect.value : "single",
      income: parseNonNegative(incInput.value, 0),
      adjustments: parseNonNegative(adjInput.value, 0),
      dm: isDeductionMode(dmSelect.value) ? dmSelect.value : "auto",
      salt: parseNonNegative(saltInput.value, 0),
      mortgage: parseNonNegative(mortInput.value, 0),
      charitable: parseNonNegative(charInput.value, 0),
      medical: parseNonNegative(medInput.value, 0),
    };
  }

  function compute(): void {
    const result = evaluateTaxes(
      {
        filingStatus: fields.fs,
        wages: fields.income,
        adjustments: fields.adjustments,
        deductionMode: fields.dm,
        itemized: itemizedOf(fields),
      },
      { federal: fed!, fica: fica! },
    );
    const f = result.federal;
    const gross = result.grossIncome;
    const probe = 100;
    const marginal = federalTaxAt(fields.income + probe, fields, fed!, fica!)
      .subtract(f.incomeTax)
      .divide(probe)
      .toNumber();
    const effective = gross.isZero() ? 0 : f.incomeTax.divide(gross.toNumber()).toNumber();
    const fmt = (m: Money): string => m.format(ctx.locale);

    const lines: BreakdownLine[] = [
      { label: "Adjusted gross income", value: fmt(result.agi) },
      {
        label: `${f.deduction.kind === "itemized" ? "Itemized" : "Standard"} deduction`,
        value: fmt(f.deduction.amount),
        citation: f.citation,
      },
      { label: "Taxable income", value: fmt(f.taxableIncome) },
      {
        label: "Federal income tax",
        value: fmt(f.incomeTax),
        citation: f.citation,
        emphasis: true,
      },
      { label: "Effective rate", value: pct(Math.max(0, effective)) },
      { label: "Marginal rate (next dollar)", value: pct(Math.max(0, marginal)) },
    ];

    resultContainer.replaceChildren(
      resultCard({
        label: "Federal income tax",
        value: f.incomeTax,
        locale: ctx.locale,
        breakdown: lines,
        permalink: () => ctx.permalink(writeFields(fields)),
      }),
    );
  }

  function recompute(): void {
    collect();
    syncItemizedVisibility();
    ctx.setParams(writeFields(fields));
    rememberShared(ctx.profile, { filingStatus: fields.fs, annualIncome: fields.income });
    compute();
  }

  for (const c of [fsSelect, dmSelect]) c.addEventListener("change", recompute);
  for (const i of [incInput, adjInput, saltInput, mortInput, charInput, medInput]) {
    i.addEventListener("input", recompute);
  }

  const tryExample = tryExampleButton(() => {
    fields = { ...EXAMPLE };
    fsSelect.value = fields.fs;
    incInput.value = String(fields.income);
    adjInput.value = String(fields.adjustments);
    dmSelect.value = fields.dm;
    saltInput.value = String(fields.salt);
    mortInput.value = String(fields.mortgage);
    charInput.value = String(fields.charitable);
    medInput.value = String(fields.medical);
    recompute();
  });

  const form = el(
    "form",
    { class: "tile-form", on: { submit: (e) => e.preventDefault() } },
    field("Filing status", fsSelect),
    field("Wages and income", incInput),
    field("Pre-tax adjustments", adjInput),
    field("Deduction method", dmSelect),
    itemizedGroup,
    el("div", { class: "tile-form-actions" }, tryExample),
  );

  root.append(form, resultContainer);
  syncItemizedVisibility();
  compute();
}

export const federalIncomeTaxTile: TileDefinition = {
  id: "federal-income-tax",
  title: "Federal Income Tax",
  pillar: "take-home",
  description: "Marginal and effective breakdown, standard vs itemized.",
  keywords: ["federal", "tax", "marginal", "effective", "deduction", "itemized"],
  status: "ready",
  how: "We start from your income and subtract the larger of the standard deduction or your itemized 'big four' — state and local taxes (capped at $10,000), mortgage interest, charitable gifts, and medical expenses above 7.5% of your income. Then we apply the IRS marginal brackets for your filing status.\n\nYour effective rate is total tax ÷ income. Your marginal rate is the bracket your next dollar of income lands in — handy for weighing a raise or a pre-tax contribution.",
  resources: [
    {
      label: "IRS — tax brackets & rates",
      url: "https://www.irs.gov/filing/federal-income-tax-rates-and-brackets",
    },
    { label: "IRS — standard vs. itemized deductions", url: "https://www.irs.gov/taxtopics/tc501" },
  ],
  mount: mountFederalIncomeTax,
};
