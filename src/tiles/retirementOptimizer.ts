/**
 * Retirement Contribution Optimizer tile (BUILD-SPEC.md §3.4): how much more you
 * can still shelter this year across your 401(k), IRA, and HSA, against the
 * current IRS limits including the age-based catch-up amounts. Every limit is
 * read from the bundled IRS retirement-limits dataset, so each carries its
 * citation (no orphan numbers). The 401(k) contribution reads from and writes
 * back to My Situation so it feeds My Plan's "capture the match" step.
 */
import { Money } from "../engine/money";
import type { RetirementLimitsData } from "../data/schemas";
import { el, option } from "../ui/dom";
import { field, parseNonNegative, tryExampleButton } from "../ui/form";
import { resultCard, type BreakdownLine } from "../ui/resultCard";
import type { TileContext, TileDefinition } from "./types";

type HsaCoverage = "none" | "self" | "family";
const COVERAGES: { value: HsaCoverage; label: string }[] = [
  { value: "none", label: "No HSA-eligible plan" },
  { value: "self", label: "Self-only HDHP" },
  { value: "family", label: "Family HDHP" },
];

interface Fields {
  age: number;
  contrib401k: number;
  contribIra: number;
  hsaCoverage: HsaCoverage;
  contribHsa: number;
}

const EXAMPLE: Fields = {
  age: 52,
  contrib401k: 12000,
  contribIra: 3000,
  hsaCoverage: "family",
  contribHsa: 4000,
};

function isCoverage(v: string): v is HsaCoverage {
  return COVERAGES.some((c) => c.value === v);
}

function readFields(p: URLSearchParams, contrib401kDefault: number): Fields {
  const cov = p.get("hsa");
  return {
    age: Math.max(0, parseNonNegative(p.get("age"), 35)),
    contrib401k: p.has("k") ? parseNonNegative(p.get("k"), 0) : contrib401kDefault,
    contribIra: parseNonNegative(p.get("ira"), 0),
    hsaCoverage: cov && isCoverage(cov) ? cov : "none",
    contribHsa: parseNonNegative(p.get("h"), 0),
  };
}

function writeFields(f: Fields): URLSearchParams {
  const p = new URLSearchParams();
  p.set("age", String(f.age));
  p.set("k", String(f.contrib401k));
  if (f.contribIra > 0) p.set("ira", String(f.contribIra));
  if (f.hsaCoverage !== "none") p.set("hsa", f.hsaCoverage);
  if (f.contribHsa > 0) p.set("h", String(f.contribHsa));
  return p;
}

/** The applicable limits for this person, given age and HSA coverage. */
function limitsFor(f: Fields, d: RetirementLimitsData): { k: number; ira: number; hsa: number } {
  const l = d.limits;
  const k = l.elective_deferral_401k + (f.age >= 50 ? l.catch_up_401k_50plus : 0);
  const ira = l.ira_contribution + (f.age >= 50 ? l.ira_catch_up_50plus : 0);
  let hsa = 0;
  if (f.hsaCoverage === "self") hsa = l.hsa_self_only;
  else if (f.hsaCoverage === "family") hsa = l.hsa_family;
  if (f.hsaCoverage !== "none" && f.age >= 55) hsa += l.hsa_catch_up_55plus;
  return { k, ira, hsa };
}

export function mountRetirementOptimizer(ctx: TileContext): void {
  const { root, data } = ctx;
  root.replaceChildren();
  const limits = data?.retirementLimits();
  if (!limits) {
    root.append(
      el("div", {
        class: "verify-banner",
        attrs: { role: "alert" },
        text: "IRS retirement-limit data is unavailable, verify before relying on any figure.",
      }),
    );
    return;
  }

  let fields = readFields(ctx.params, ctx.profile.get("retirementContributionsAnnual") ?? 0);

  const ageInput = el("input", {
    type: "number",
    name: "age",
    min: 0,
    step: 1,
    value: fields.age,
    attrs: { "aria-label": "Your age", inputmode: "decimal" },
  });
  const num = (name: string, value: number, label: string): HTMLInputElement =>
    el("input", {
      type: "number",
      name,
      min: 0,
      step: 500,
      value,
      attrs: { "aria-label": label, inputmode: "decimal" },
    });
  const kInput = num("k", fields.contrib401k, "Current 401(k) contribution this year");
  const iraInput = num("ira", fields.contribIra, "Current IRA contribution this year");
  const hsaSelect = el(
    "select",
    { name: "hsa", attrs: { "aria-label": "HSA coverage" } },
    ...COVERAGES.map((c) => option(c.value, c.label, c.value === fields.hsaCoverage)),
  );
  const hInput = num("h", fields.contribHsa, "Current HSA contribution this year");

  const resultContainer = el("div", { class: "tile-result", attrs: { "aria-live": "polite" } });

  function compute(): void {
    const lim = limitsFor(fields, limits!);
    const fmt = (m: Money): string => m.format(ctx.locale);
    const cite = limits!.citation;

    const room401k = Math.max(0, lim.k - fields.contrib401k);
    const roomIra = Math.max(0, lim.ira - fields.contribIra);
    const roomHsa = Math.max(0, lim.hsa - fields.contribHsa);
    const totalRoom = room401k + roomIra + roomHsa;

    const catchUp = fields.age >= 50;
    const lines: BreakdownLine[] = [
      {
        label: `401(k) limit${catchUp ? " (with catch-up)" : ""}`,
        value: fmt(Money.from(lim.k)),
        citation: cite,
      },
      { label: "401(k) room remaining", value: fmt(Money.from(room401k)), emphasis: true },
      {
        label: `IRA limit${catchUp ? " (with catch-up)" : ""}`,
        value: fmt(Money.from(lim.ira)),
        citation: cite,
      },
      { label: "IRA room remaining", value: fmt(Money.from(roomIra)), emphasis: true },
    ];
    if (fields.hsaCoverage !== "none") {
      lines.push(
        {
          label: `HSA limit${fields.age >= 55 ? " (with catch-up)" : ""}`,
          value: fmt(Money.from(lim.hsa)),
          citation: cite,
        },
        { label: "HSA room remaining", value: fmt(Money.from(roomHsa)), emphasis: true },
      );
    }

    resultContainer.replaceChildren(
      resultCard({
        label: "Tax-advantaged room left this year",
        value: Money.from(totalRoom),
        locale: ctx.locale,
        breakdown: lines,
        permalink: () => ctx.permalink(writeFields(fields)),
      }),
    );
  }

  function collect(): void {
    fields = {
      age: Math.max(0, parseNonNegative(ageInput.value, 35)),
      contrib401k: parseNonNegative(kInput.value, 0),
      contribIra: parseNonNegative(iraInput.value, 0),
      hsaCoverage: isCoverage(hsaSelect.value) ? hsaSelect.value : "none",
      contribHsa: parseNonNegative(hInput.value, 0),
    };
  }

  function recompute(): void {
    collect();
    ctx.setParams(writeFields(fields));
    // Feed My Plan's retirement step with the 401(k) contribution.
    ctx.profile.set("retirementContributionsAnnual", fields.contrib401k);
    compute();
  }

  hsaSelect.addEventListener("change", recompute);
  for (const i of [ageInput, kInput, iraInput, hInput]) i.addEventListener("input", recompute);

  const tryExample = tryExampleButton(() => {
    fields = { ...EXAMPLE };
    ageInput.value = String(fields.age);
    kInput.value = String(fields.contrib401k);
    iraInput.value = String(fields.contribIra);
    hsaSelect.value = fields.hsaCoverage;
    hInput.value = String(fields.contribHsa);
    recompute();
  });

  const form = el(
    "form",
    { class: "tile-form", on: { submit: (e) => e.preventDefault() } },
    field("Your age", ageInput),
    field("401(k) so far this year", kInput),
    field("IRA so far this year", iraInput),
    field("HSA coverage", hsaSelect),
    field("HSA so far this year", hInput),
    el("div", { class: "tile-form-actions" }, tryExample),
  );

  root.append(form, resultContainer);
  compute();
}

export const retirementOptimizerTile: TileDefinition = {
  id: "retirement-optimizer",
  title: "Retirement Contribution Optimizer",
  pillar: "retirement",
  description: "401(k), IRA, and HSA against the current IRS limits.",
  keywords: ["401k", "ira", "roth", "hsa", "retirement", "catch up", "limit"],
  status: "ready",
  how: "Each account has a yearly IRS limit, and once you turn 50 (55 for an HSA) you get an extra 'catch-up' amount on top. We take this year's limit for your age and subtract what you've put in so far, so you can see exactly how much room is left to shelter from tax before the year ends.\n\nEvery limit here is read straight from the IRS notice for the current year and cites it, so you can check the figure yourself. Your 401(k) number flows into My Plan's 'capture the match' and 'fund retirement' steps.",
  resources: [
    {
      label: "IRS, retirement topics: contribution limits",
      url: "https://www.irs.gov/retirement-plans/plan-participant-employee/retirement-topics-contributions",
    },
    {
      label: "IRS, HSA limits (Pub. 969)",
      url: "https://www.irs.gov/publications/p969",
    },
  ],
  related: [
    {
      hubId: "retirement",
      tool: "backdoor-roth",
      label: "Backdoor Roth",
      note: "if income blocks a direct Roth and there's room",
    },
  ],
  mount: mountRetirementOptimizer,
};
