/**
 * Retirement Contribution Optimizer tile (BUILD-SPEC.md §3.4): how much more you
 * can still shelter this year across your 401(k), IRA, and HSA, against the
 * current IRS limits including the age-based catch-up amounts. Every limit is
 * read from the bundled IRS retirement-limits dataset, so each carries its
 * citation (no orphan numbers). The 401(k) contribution reads from and writes
 * back to My Situation so it feeds My Plan's "capture the match" step.
 *
 * That sentence was written before the match itself was asked about anywhere.
 * `employerMatchAnnual` and `employerMatchCaptured` existed in My Situation and
 * in the plan step that spends them, and no surface on the site set either —
 * so the step compared 0 against 0, called itself satisfied, and the plan
 * stepped over the highest-return move in personal finance without ever asking.
 * The two fields below are where the reader answers.
 */
import { Money } from "../engine/money";
import {
  catchUpMustBeRoth,
  electiveDeferralLimit,
  inEnhancedCatchUpWindow,
} from "../engine/contributionLimits";
import type { RetirementLimitsData } from "../data/schemas";
import { el, option } from "../ui/dom";
import { field, parseNonNegative, tryExampleButton } from "../ui/form";
import { resultCard, type BreakdownLine } from "../ui/resultCard";
import type { SituationStore } from "../profile/situation";
import type { TileContext, TileDefinition } from "./types";

type HsaCoverage = "none" | "self" | "family";
const COVERAGES: { value: HsaCoverage; label: string }[] = [
  { value: "none", label: "No HSA-eligible plan" },
  { value: "self", label: "Self-only HDHP" },
  { value: "family", label: "Family HDHP" },
];

interface Fields {
  age: number;
  /** Prior-year §3121(a) wages from the plan's employer — §414(v)(7)(A). */
  priorWages: number;
  contrib401k: number;
  contribIra: number;
  hsaCoverage: HsaCoverage;
  contribHsa: number;
  contribFsa: number;
  /** Full employer match on offer for the year, and what you are capturing. */
  matchAvailable: number;
  matchCaptured: number;
}

const EXAMPLE: Fields = {
  age: 52,
  priorWages: 0,
  contrib401k: 12000,
  contribIra: 3000,
  hsaCoverage: "family",
  contribHsa: 4000,
  contribFsa: 0,
  matchAvailable: 4000,
  matchCaptured: 2500,
};

function isCoverage(v: string): v is HsaCoverage {
  return COVERAGES.some((c) => c.value === v);
}

function readFields(p: URLSearchParams, profile: SituationStore): Fields {
  const cov = p.get("hsa");
  return {
    age: Math.max(0, parseNonNegative(p.get("age"), 35)),
    priorWages: parseNonNegative(p.get("pw"), 0),
    contrib401k: p.has("k")
      ? parseNonNegative(p.get("k"), 0)
      : (profile.get("retirementContributionsAnnual") ?? 0),
    contribIra: parseNonNegative(p.get("ira"), 0),
    hsaCoverage: cov && isCoverage(cov) ? cov : "none",
    contribHsa: parseNonNegative(p.get("h"), 0),
    contribFsa: parseNonNegative(p.get("f"), 0),
    matchAvailable: p.has("m")
      ? parseNonNegative(p.get("m"), 0)
      : (profile.get("employerMatchAnnual") ?? 0),
    matchCaptured: p.has("mc")
      ? parseNonNegative(p.get("mc"), 0)
      : (profile.get("employerMatchCaptured") ?? 0),
  };
}

function writeFields(f: Fields): URLSearchParams {
  const p = new URLSearchParams();
  p.set("age", String(f.age));
  if (f.priorWages > 0) p.set("pw", String(f.priorWages));
  p.set("k", String(f.contrib401k));
  if (f.contribIra > 0) p.set("ira", String(f.contribIra));
  if (f.hsaCoverage !== "none") p.set("hsa", f.hsaCoverage);
  if (f.contribHsa > 0) p.set("h", String(f.contribHsa));
  if (f.contribFsa > 0) p.set("f", String(f.contribFsa));
  // Both are written whether or not they are zero. A zero match is an answer —
  // "my employer offers none" — and My Plan reads the absence of one as a
  // question it still has to ask, so a link that dropped it would reopen on a
  // different plan than the sender saw.
  p.set("m", String(f.matchAvailable));
  p.set("mc", String(f.matchCaptured));
  return p;
}

/** The applicable limits for this person, given age and HSA coverage. */
function limitsFor(
  f: Fields,
  d: RetirementLimitsData,
): { k: number; ira: number; hsa: number; fsa: number } {
  const l = d.limits;
  const k = electiveDeferralLimit(f.age, l);
  const ira = l.ira_contribution + (f.age >= 50 ? l.ira_catch_up_50plus : 0);
  let hsa = 0;
  if (f.hsaCoverage === "self") hsa = l.hsa_self_only;
  else if (f.hsaCoverage === "family") hsa = l.hsa_family;
  if (f.hsaCoverage !== "none" && f.age >= 55) hsa += l.hsa_catch_up_55plus;
  // A general-purpose health FSA and an HSA do not stack: §223(c)(1)(B) makes
  // anyone covered by one HSA-ineligible, which is why the row appears only for
  // a household with no HDHP selected. A limited-purpose or post-deductible FSA
  // is the exception, and it is not a question this tile asks — offering the
  // room without asking would hand an HSA holder a number that disqualifies the
  // account they already have.
  const fsa = f.hsaCoverage === "none" ? (l.fsa_health ?? 0) : 0;
  return { k, ira, hsa, fsa };
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

  let fields = readFields(ctx.params, ctx.profile);

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
  const fInput = num("f", fields.contribFsa, "Current health FSA contribution this year");
  const mInput = num("m", fields.matchAvailable, "Full employer match offered this year");
  const mcInput = num("mc", fields.matchCaptured, "Employer match you are capturing this year");
  const pwInput = num(
    "pw",
    fields.priorWages,
    "Last year's wages from the employer sponsoring your 401(k)",
  );

  const resultContainer = el("div", { class: "tile-result", attrs: { "aria-live": "polite" } });

  function compute(): void {
    const lim = limitsFor(fields, limits!);
    const fmt = (m: Money): string => m.format(ctx.locale);
    const cite = limits!.citation;

    const room401k = Math.max(0, lim.k - fields.contrib401k);
    const roomIra = Math.max(0, lim.ira - fields.contribIra);
    const roomHsa = Math.max(0, lim.hsa - fields.contribHsa);
    const roomFsa = Math.max(0, lim.fsa - fields.contribFsa);
    const totalRoom = room401k + roomIra + roomHsa + roomFsa;

    const catchUp = fields.age >= 50;
    // 60 through 63 is a window, not a floor: §414(v)(2)(E)(i) reaches a
    // participant who attains 60 but not 64, so the label must not follow a
    // 64-year-old into a year they no longer get it.
    const enhanced = inEnhancedCatchUpWindow(fields.age, limits!.limits);
    const lines: BreakdownLine[] = [
      {
        label: `401(k) limit${enhanced ? " (with the 60–63 catch-up)" : catchUp ? " (with catch-up)" : ""}`,
        value: fmt(Money.from(lim.k)),
        citation: cite,
      },
      { label: "401(k) room remaining", value: fmt(Money.from(room401k)), emphasis: true },
      ...(catchUp && catchUpMustBeRoth(fields.priorWages, limits!.limits)
        ? [
            {
              label: "Your catch-up has to be Roth",
              value:
                "Last year's wages from that employer were over the threshold, so §414(v)(7) lets you make the catch-up only as designated Roth contributions. The room above is real and the amount does not change — but the catch-up part of it is after-tax, so it does not lower this year's taxable income. 2026 is the first year this applies.",
              citation: cite,
            },
          ]
        : []),
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
    } else if (lim.fsa > 0) {
      lines.push(
        { label: "Health FSA limit", value: fmt(Money.from(lim.fsa)), citation: cite },
        { label: "Health FSA room remaining", value: fmt(Money.from(roomFsa)), emphasis: true },
        {
          label: "Note",
          value:
            "A health FSA is your employer's to offer, and it is use-it-or-lose-it: what is left at the end of the plan year is generally forfeited, beyond whatever carryover or grace period your plan allows. It also rules out an HSA while you have one.",
        },
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
      contribFsa: parseNonNegative(fInput.value, 0),
      priorWages: parseNonNegative(pwInput.value, 0),
      matchAvailable: parseNonNegative(mInput.value, 0),
      matchCaptured: parseNonNegative(mcInput.value, 0),
    };
  }

  function recompute(): void {
    collect();
    ctx.setParams(writeFields(fields));
    // Feed My Plan's retirement step with the 401(k) contribution.
    ctx.profile.set("retirementContributionsAnnual", fields.contrib401k);
    // The two the plan had no other way of learning.
    ctx.profile.set("employerMatchAnnual", fields.matchAvailable);
    ctx.profile.set("employerMatchCaptured", fields.matchCaptured);
    compute();
  }

  hsaSelect.addEventListener("change", recompute);
  for (const i of [ageInput, kInput, iraInput, hInput, fInput, pwInput, mInput, mcInput])
    i.addEventListener("input", recompute);

  const tryExample = tryExampleButton(() => {
    fields = { ...EXAMPLE };
    ageInput.value = String(fields.age);
    kInput.value = String(fields.contrib401k);
    iraInput.value = String(fields.contribIra);
    hsaSelect.value = fields.hsaCoverage;
    hInput.value = String(fields.contribHsa);
    fInput.value = String(fields.contribFsa);
    pwInput.value = String(fields.priorWages);
    mInput.value = String(fields.matchAvailable);
    mcInput.value = String(fields.matchCaptured);
    recompute();
  });

  const form = el(
    "form",
    { class: "tile-form", on: { submit: (e) => e.preventDefault() } },
    field("Your age", ageInput),
    field("401(k) so far this year", kInput),
    field("Full employer match offered this year", mInput),
    field("Employer match captured so far", mcInput),
    field("IRA so far this year", iraInput),
    field("HSA coverage", hsaSelect),
    field("HSA so far this year", hInput),
    field("Health FSA so far this year", fInput),
    field("Last year's wages from your 401(k)'s employer", pwInput),
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
  how: "Each account has a yearly IRS limit, and once you turn 50 (55 for an HSA) you get an extra 'catch-up' amount on top. We take this year's limit for your age and subtract what you've put in so far, so you can see exactly how much room is left to shelter from tax before the year ends.\n\nEvery limit here is read straight from the IRS notice for the current year and cites it, so you can check the figure yourself. If last year's wages from your 401(k)'s employer were over the §414(v)(7) threshold, the catch-up part of your room has to go in as Roth from 2026 — the same amount, but after-tax, so it does not lower this year's taxable income. Enter those wages and the page will say so. Your 401(k) number flows into My Plan's 'capture the match' and 'fund retirement' steps.",
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
