/**
 * Backdoor Roth tile (BUILD-SPEC-2 §6.5): the step-by-step math for getting
 * money into a Roth when income blocks a direct contribution. Two modes:
 *
 * - Backdoor: a nondeductible traditional-IRA contribution converted to a Roth.
 *   The pro-rata rule (IRC §408(d)(2)) taxes the conversion in proportion to any
 *   pre-tax IRA balances, so the tile shows the taxable portion and the tax owed.
 * - Mega-backdoor: after-tax 401(k) contributions up to the §415(c) limit, less
 *   your deferrals and employer money, then converted to Roth.
 *
 * Both limits read from (and cite) the bundled IRS retirement-limits dataset.
 * Information, not advice.
 */
import { Money } from "../engine/money";
import { backdoorRoth, megaBackdoorRoth } from "../engine/taxMoves";
import type { CitationData, RetirementLimitsData } from "../data/schemas";
import { el, option } from "../ui/dom";
import { field, parseNonNegative, tryExampleButton } from "../ui/form";
import { resultCard, type BreakdownLine } from "../ui/resultCard";
import type { TileContext, TileDefinition } from "./types";

type Mode = "backdoor" | "mega";

/** The pro-rata rule for IRA conversions (IRC §408(d)(2)). */
const PRO_RATA_CITATION: CitationData = {
  sourceUrl: "https://www.irs.gov/publications/p590a",
  sourceDocument: "IRS Publication 590-A, IRA conversion pro-rata rule (IRC §408(d)(2))",
  effectiveYear: 2026,
  dateRetrieved: "2026-05-29",
};

interface Fields {
  mode: Mode;
  age: number;
  contribution: number;
  pretaxIra: number;
  ordinaryRatePct: number;
  electiveDeferral: number;
  employerContributions: number;
}

/** The IRA contribution limit for an age, including the age-50 catch-up. */
function iraLimitFor(age: number, l: RetirementLimitsData["limits"]): number {
  return (l.ira_contribution ?? 0) + (age >= 50 ? (l.ira_catch_up_50plus ?? 0) : 0);
}

const EXAMPLE: Fields = {
  mode: "backdoor",
  age: 35,
  contribution: 7500,
  pretaxIra: 0,
  ordinaryRatePct: 24,
  electiveDeferral: 24500,
  employerContributions: 8000,
};

function readFields(p: URLSearchParams): Fields {
  const mode = p.get("m") === "mega" ? "mega" : "backdoor";
  return {
    mode,
    age: Math.round(parseNonNegative(p.get("age"), 35)),
    contribution: p.has("c") ? parseNonNegative(p.get("c"), 0) : 7500,
    pretaxIra: parseNonNegative(p.get("pt"), 0),
    ordinaryRatePct: parseNonNegative(p.get("ord"), 24),
    electiveDeferral: parseNonNegative(p.get("ed"), 24500),
    employerContributions: parseNonNegative(p.get("er"), 0),
  };
}

function writeFields(f: Fields): URLSearchParams {
  const p = new URLSearchParams();
  if (f.mode === "mega") p.set("m", "mega");
  if (f.mode === "backdoor") {
    p.set("age", String(f.age));
    p.set("c", String(f.contribution));
    if (f.pretaxIra > 0) p.set("pt", String(f.pretaxIra));
    p.set("ord", String(f.ordinaryRatePct));
  } else {
    p.set("ed", String(f.electiveDeferral));
    if (f.employerContributions > 0) p.set("er", String(f.employerContributions));
  }
  return p;
}

export function mountBackdoorRoth(ctx: TileContext): void {
  const { root, data } = ctx;
  root.replaceChildren();
  const limits = data?.retirementLimits();
  if (!limits) {
    root.append(
      el("div", {
        class: "verify-banner",
        attrs: { role: "alert" },
        text: "IRS contribution-limit data is unavailable, verify before relying on any figure.",
      }),
    );
    return;
  }

  let fields = readFields(ctx.params);

  const modeSelect = el(
    "select",
    { name: "m", attrs: { "aria-label": "Strategy" } },
    option("backdoor", "Backdoor (IRA → Roth)", fields.mode === "backdoor"),
    option("mega", "Mega-backdoor (after-tax 401k → Roth)", fields.mode === "mega"),
  );

  const mkNum = (name: string, label: string, value: number, step: number): HTMLInputElement =>
    el("input", {
      type: "number",
      name,
      min: 0,
      step,
      value,
      attrs: { "aria-label": label, inputmode: "decimal" },
    });
  const ageInput = mkNum("age", "Your age", fields.age, 1);
  const contribInput = mkNum("c", "Nondeductible IRA contribution", fields.contribution, 500);
  const pretaxInput = mkNum("pt", "Existing pre-tax IRA balance", fields.pretaxIra, 1000);
  const ordInput = mkNum("ord", "Ordinary tax rate (percent)", fields.ordinaryRatePct, 1);
  const edInput = mkNum("ed", "Your 401(k) deferrals this year", fields.electiveDeferral, 500);
  const erInput = mkNum("er", "Employer contributions", fields.employerContributions, 500);

  const backdoorGroup = el(
    "div",
    { class: "field-group" },
    field("Your age", ageInput),
    field("Nondeductible IRA contribution", contribInput),
    field("Existing pre-tax IRA balance", pretaxInput),
    field("Your ordinary tax rate (%)", ordInput),
  );
  const megaGroup = el(
    "div",
    { class: "field-group" },
    field("Your 401(k) deferrals this year", edInput),
    field("Employer contributions", erInput),
  );

  const resultContainer = el("div", { class: "tile-result", attrs: { "aria-live": "polite" } });

  function syncGroups(): void {
    backdoorGroup.hidden = fields.mode !== "backdoor";
    megaGroup.hidden = fields.mode !== "mega";
  }

  function compute(): void {
    const fmt = (m: Money): string => m.format(ctx.locale);
    if (fields.mode === "backdoor") {
      const iraLimit = iraLimitFor(fields.age, limits!.limits);
      const contribution = Math.min(fields.contribution, iraLimit);
      const r = backdoorRoth({
        contribution,
        pretaxIraBalance: fields.pretaxIra,
        ordinaryRatePct: fields.ordinaryRatePct,
      });
      const lines: BreakdownLine[] = [
        {
          label: `IRA limit${fields.age >= 50 ? " (with catch-up)" : ""}`,
          value: fmt(Money.from(iraLimit)),
          citation: limits!.citation,
        },
        { label: "Into your Roth", value: fmt(r.contribution), emphasis: true },
        {
          label: "Taxable portion (pro-rata)",
          value: fmt(r.taxablePortion),
          citation: PRO_RATA_CITATION,
        },
        { label: "Tax-free portion (your basis)", value: fmt(r.nontaxablePortion) },
        { label: "Tax owed on the conversion", value: fmt(r.taxOwed) },
        {
          label: r.isClean ? "A clean backdoor" : "Heads up: the pro-rata rule",
          value: r.isClean
            ? "No pre-tax IRA balance, so the whole conversion is tax-free."
            : "Pre-tax IRA money makes part of every conversion taxable. Rolling it into a 401(k) first can clear the way.",
          citation: r.isClean ? null : PRO_RATA_CITATION,
        },
      ];
      resultContainer.replaceChildren(
        resultCard({
          label: "Moved into your Roth this year",
          value: r.contribution,
          locale: ctx.locale,
          breakdown: lines,
          permalink: () => ctx.permalink(writeFields(fields)),
        }),
      );
    } else {
      const dcLimit = limits!.limits.defined_contribution_415c ?? 0;
      const r = megaBackdoorRoth({
        definedContributionLimit: dcLimit,
        electiveDeferral: fields.electiveDeferral,
        employerContributions: fields.employerContributions,
      });
      const lines: BreakdownLine[] = [
        {
          label: "Total 401(k) limit (§415(c))",
          value: fmt(Money.from(dcLimit)),
          citation: limits!.citation,
        },
        { label: "− Your elective deferrals", value: fmt(Money.from(fields.electiveDeferral)) },
        {
          label: "− Employer contributions",
          value: fmt(Money.from(fields.employerContributions)),
        },
        { label: "After-tax room to convert", value: fmt(r.afterTaxRoom), emphasis: true },
        {
          label: "Note",
          value:
            "Your plan must allow after-tax contributions and in-plan Roth conversions (or in-service rollouts) to use this.",
        },
      ];
      resultContainer.replaceChildren(
        resultCard({
          label: "Extra after-tax Roth space this year",
          value: r.afterTaxRoom,
          locale: ctx.locale,
          breakdown: lines,
          permalink: () => ctx.permalink(writeFields(fields)),
        }),
      );
    }
  }

  function recompute(): void {
    fields = {
      mode: modeSelect.value === "mega" ? "mega" : "backdoor",
      age: Math.round(parseNonNegative(ageInput.value, 35)),
      contribution: parseNonNegative(contribInput.value, 0),
      pretaxIra: parseNonNegative(pretaxInput.value, 0),
      ordinaryRatePct: parseNonNegative(ordInput.value, 24),
      electiveDeferral: parseNonNegative(edInput.value, 24500),
      employerContributions: parseNonNegative(erInput.value, 0),
    };
    syncGroups();
    ctx.setParams(writeFields(fields));
    compute();
  }

  modeSelect.addEventListener("change", recompute);
  for (const i of [ageInput, contribInput, pretaxInput, ordInput, edInput, erInput])
    i.addEventListener("input", recompute);

  const tryExample = tryExampleButton(() => {
    fields = { ...EXAMPLE };
    modeSelect.value = fields.mode;
    ageInput.value = String(fields.age);
    contribInput.value = String(fields.contribution);
    pretaxInput.value = String(fields.pretaxIra);
    ordInput.value = String(fields.ordinaryRatePct);
    edInput.value = String(fields.electiveDeferral);
    erInput.value = String(fields.employerContributions);
    recompute();
  });

  const form = el(
    "form",
    { class: "tile-form", on: { submit: (e) => e.preventDefault() } },
    field("Strategy", modeSelect),
    backdoorGroup,
    megaGroup,
    el("div", { class: "tile-form-actions" }, tryExample),
  );

  syncGroups();
  root.append(form, resultContainer);
  compute();
}

export const backdoorRothTile: TileDefinition = {
  id: "backdoor-roth",
  title: "Backdoor Roth",
  pillar: "retirement",
  description: "Backdoor and mega-backdoor Roth math, with the pro-rata rule.",
  keywords: [
    "backdoor roth",
    "mega backdoor",
    "pro rata",
    "after-tax 401k",
    "roth conversion",
    "590-a",
  ],
  status: "ready",
  how: "When your income is too high to contribute to a Roth directly, two moves get money in anyway. The backdoor: contribute to a traditional IRA without deducting it, then convert it to a Roth. The catch is the pro-rata rule: if you hold any pre-tax IRA money, the IRS treats every conversion as a proportional mix of pre-tax and after-tax dollars, so part of it is taxable. With no pre-tax IRA balance, the conversion is tax-free.\n\nThe mega-backdoor uses after-tax 401(k) contributions: your plan's overall §415(c) limit minus your own deferrals and your employer's contributions is room you can fill with after-tax money and convert to Roth, but only if your plan allows after-tax contributions and in-plan conversions. The IRS limits here are read from the current-year notice and cited. This is information, not advice.",
  resources: [
    { label: "IRS Publication 590-A", url: "https://www.irs.gov/publications/p590a" },
    { label: "IRS, Roth IRAs", url: "https://www.irs.gov/retirement-plans/roth-iras" },
  ],
  mount: mountBackdoorRoth,
};
