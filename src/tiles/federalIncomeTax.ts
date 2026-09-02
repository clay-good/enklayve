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
import { OBBBA_DEDUCTIONS_HOW } from "./deductionCopy";

const FILING_STATUSES: { value: FilingStatus; label: string }[] = [
  { value: "single", label: "Single" },
  { value: "married_jointly", label: "Married filing jointly" },
  { value: "married_separately", label: "Married filing separately" },
  { value: "head_of_household", label: "Head of household" },
  { value: "qualifying_surviving_spouse", label: "Qualifying surviving spouse" },
];

/** IRC §151(d)(5)(C) reaches the taxpayer and, on a joint return, the spouse. */
const SENIOR_COUNTS = [
  { value: "0", label: "Neither of us" },
  { value: "1", label: "One of us" },
  { value: "2", label: "Both of us (joint return)" },
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
  /** How many on the return are 65 or over (IRC §151(d)(5)(C)). */
  seniors: number;
  /** Qualified car loan interest (IRC §163(h)(4)). Not one of the big four:
   *  §63(b)(7) reaches it whether or not the filer itemizes, so it sits
   *  outside the itemized group and stays visible when that group is hidden. */
  carLoanInterest: number;
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
  seniors: 0,
  carLoanInterest: 0,
};

/**
 * At most two people can be 65 on one return, and only on a joint one — but a
 * hostile deep link can say anything, so the value is clamped where it is read
 * rather than trusted. The engine clamps again by filing status; this keeps the
 * SELECT from being handed a value it has no option for, which is what the
 * catalog sweep means by "every enum param falls back to a value the reader can
 * see".
 */
function clampSeniors(n: number): number {
  return Math.min(2, Math.max(0, Math.round(n)));
}

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
    seniors: clampSeniors(parseNonNegative(p.get("age65"), 0)),
    carLoanInterest: parseNonNegative(p.get("carint"), 0),
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
  if (f.seniors > 0) p.set("age65", String(f.seniors));
  if (f.carLoanInterest > 0) p.set("carint", String(f.carLoanInterest));
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
    seniorsAge65Plus: f.seniors,
    vehicleLoanInterest: f.carLoanInterest,
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
        text: "Federal tax data is unavailable, verify before relying on any figure.",
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

  const seniorSelect = el(
    "select",
    { name: "age65", attrs: { "aria-label": "How many of you are 65 or older" } },
    ...SENIOR_COUNTS.map((c) => option(c.value, c.label, Number(c.value) === fields.seniors)),
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
  const carIntInput = mkMoney("carint", fields.carLoanInterest, "Car loan interest paid");

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
      seniors: clampSeniors(parseNonNegative(seniorSelect.value, 0)),
      carLoanInterest: parseNonNegative(carIntInput.value, 0),
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
        seniorsAge65Plus: fields.seniors,
        vehicleLoanInterest: fields.carLoanInterest,
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
      // §63(b)(4) subtracts this alongside the standard deduction rather than
      // as part of it, and the reader can see AGI and taxable income on the
      // same card — so leaving it out would show arithmetic that does not add up.
      ...(f.deduction.nonItemizedCharitable.isZero()
        ? []
        : [
            {
              label: "Charitable giving (no itemizing)",
              value: fmt(f.deduction.nonItemizedCharitable),
              citation: f.citation,
            },
          ]),
      ...(f.deduction.senior.isZero()
        ? []
        : [
            {
              label: "Deduction at 65",
              value: fmt(f.deduction.senior),
              citation: f.citation,
            },
          ]),
      // §68 only ever bites above the 37% bracket, so this line is absent for
      // almost every reader — and present for the one who would otherwise see a
      // deduction smaller than the figures they typed, with nothing saying why.
      ...(f.deduction.itemizedLimitation.isZero()
        ? []
        : [
            {
              label: "Less §68 cap on itemized value (35¢ on the dollar)",
              value: `−${fmt(f.deduction.itemizedLimitation)}`,
              citation: f.citation,
            },
          ]),
      ...(f.deduction.vehicleLoanInterest.isZero()
        ? []
        : [
            {
              label: "Car loan interest",
              value: fmt(f.deduction.vehicleLoanInterest),
              citation: f.citation,
            },
          ]),
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

  for (const c of [fsSelect, dmSelect, seniorSelect]) c.addEventListener("change", recompute);
  for (const i of [incInput, adjInput, saltInput, mortInput, charInput, medInput, carIntInput]) {
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
    seniorSelect.value = String(fields.seniors);
    carIntInput.value = String(fields.carLoanInterest);
    recompute();
  });

  const form = el(
    "form",
    { class: "tile-form", on: { submit: (e) => e.preventDefault() } },
    field("Filing status", fsSelect),
    field("Wages and income", incInput),
    field("Pre-tax adjustments", adjInput),
    field("Deduction method", dmSelect),
    field("Aged 65 or older", seniorSelect),
    field("Car loan interest paid", carIntInput),
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
  pillar: "paycheck",
  description: "Marginal and effective breakdown, standard vs itemized.",
  keywords: ["federal", "tax", "marginal", "effective", "deduction", "itemized"],
  status: "ready",
  how:
    "We start from your income and subtract the larger of the standard deduction or your itemized 'big four', state and local taxes (capped at $40,400 for 2026, sliding down above $505,000 of income to a $10,000 floor, and halved if you file separately), mortgage interest, charitable gifts, and medical expenses above 7.5% of your income. Then we apply the IRS marginal brackets for your filing status.\n\nYour effective rate is total tax ÷ income. Your marginal rate is the bracket your next dollar of income lands in, handy for weighing a raise or a pre-tax contribution.\n\n" +
    OBBBA_DEDUCTIONS_HOW,
  resources: [
    {
      label: "IRS, tax brackets & rates",
      url: "https://www.irs.gov/filing/federal-income-tax-rates-and-brackets",
    },
    { label: "IRS, standard vs. itemized deductions", url: "https://www.irs.gov/taxtopics/tc501" },
    {
      label: "26 U.S.C. §164(b), the SALT limitation",
      url: "https://www.law.cornell.edu/uscode/text/26/164",
    },
    {
      label: "26 U.S.C. §163(h), car loan interest",
      url: "https://www.law.cornell.edu/uscode/text/26/163",
    },
  ],
  related: [
    {
      hubId: "paycheck-taxes",
      tool: "marginal-explorer",
      label: "Marginal Rate Explorer",
      note: "what your next $1,000 of income costs",
    },
  ],
  mount: mountFederalIncomeTax,
};
