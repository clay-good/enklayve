/**
 * Self-Employed Retirement (BUILD-SPEC-2 §6.4). Working for yourself means no
 * employer 401(k) — but the self-employed plans are more generous, not less. A
 * SEP-IRA lets you stash ~20% of your net earnings; a Solo 401(k) adds an employee
 * deferral on top of that same employer share, so it almost always lets you put
 * away more at the same income. This shows both, capped at the IRS limits, from
 * your net profit. Built on the existing SE-tax engine and the bundled IRS limits.
 */
import { Money } from "../engine/money";
import {
  electiveDeferralCatchUp,
  inEnhancedCatchUpWindow,
  selfEmployedPlanCeilings,
} from "../engine/contributionLimits";
import { selfEmploymentTax } from "../engine/tax";
import type { FilingStatus } from "../data/schemas";
import { el, option } from "../ui/dom";
import { field, parseNonNegative, tryExampleButton } from "../ui/form";
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

interface Fields {
  fs: FilingStatus;
  profit: number;
  age: number;
}

const EXAMPLE: Fields = { fs: "single", profit: 90000, age: 45 };

function isFilingStatus(v: string): v is FilingStatus {
  return FILING_STATUSES.some((f) => f.value === v);
}

function readFields(p: URLSearchParams, profile: SituationStore): Fields {
  const fs = p.get("fs");
  return {
    fs: fs && isFilingStatus(fs) ? fs : (profile.get("filingStatus") ?? "single"),
    profit: p.has("np") ? parseNonNegative(p.get("np"), 0) : (profile.get("annualIncome") ?? 0),
    age: Math.min(120, parseNonNegative(p.get("age"), 45)),
  };
}

function writeFields(f: Fields): URLSearchParams {
  const p = new URLSearchParams();
  p.set("fs", f.fs);
  p.set("np", String(f.profit));
  p.set("age", String(f.age));
  return p;
}

export function mountSelfEmployedRetirement(ctx: TileContext): void {
  const { root, data, profile } = ctx;
  root.replaceChildren();
  const fica = data?.fica();
  const limitsData = data?.retirementLimits();
  if (!fica || !limitsData) {
    root.append(
      el("div", {
        class: "verify-banner",
        attrs: { role: "alert" },
        text: "Retirement and FICA data are unavailable, verify before relying on any figure.",
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
  fsSelect.value = fields.fs;
  const npInput = el("input", {
    type: "number",
    name: "np",
    min: 0,
    step: 1000,
    value: fields.profit,
    attrs: { "aria-label": "Net business profit", inputmode: "decimal" },
  });
  const ageInput = el("input", {
    type: "number",
    name: "age",
    min: 0,
    max: 120,
    step: 1,
    value: fields.age,
    attrs: { "aria-label": "Your age", inputmode: "numeric" },
  });

  const resultContainer = el("div", { class: "tile-result", attrs: { "aria-live": "polite" } });

  function compute(): void {
    const limits = limitsData!.limits;
    const catchUp = electiveDeferralCatchUp(fields.age, limits);

    const se = selfEmploymentTax(Money.from(fields.profit), fields.fs, fica!);
    const netEarnings = Money.from(fields.profit).subtract(se.deductibleHalf);
    const net = netEarnings.isNegative() ? Money.zero() : netEarnings;

    // Both ceilings, and the §415(c)(1)(B) compensation limb that used to be
    // missing here — see `selfEmployedPlanCeilings`. This tile applied only the
    // dollar limb, so at low profit it offered a solo-401(k) total of 120% of
    // what the person earned.
    const ceilings = selfEmployedPlanCeilings(net.toNumber(), fields.age, limits);
    const sep = Money.from(ceilings.sep);
    const employerShare = Money.from(ceilings.employerShare);
    const employeeDeferral = Money.from(ceilings.employeeDeferral + ceilings.catchUp);
    const solo = Money.from(ceilings.solo);

    const best = solo.greaterThan(sep) ? solo : sep;
    const fmt = (m: Money): string => m.format(ctx.locale);

    const lines: BreakdownLine[] = [
      { label: "Net business profit", value: fmt(Money.from(fields.profit)) },
      {
        label: "Net self-employment earnings (after ½ SE tax)",
        value: fmt(net),
        citation: se.citation,
      },
      {
        label: "SEP-IRA maximum (≈20% of net earnings)",
        value: fmt(sep),
        citation: limitsData!.citation,
      },
      {
        label: `Solo 401(k): employee deferral${
          inEnhancedCatchUpWindow(fields.age, limits)
            ? " (incl. 60–63 catch-up)"
            : catchUp > 0
              ? " (incl. 50+ catch-up)"
              : ""
        }`,
        value: fmt(employeeDeferral),
        citation: limitsData!.citation,
      },
      {
        label: "Solo 401(k): employer share (≈20%)",
        value: fmt(employerShare),
        citation: limitsData!.citation,
      },
      {
        label: "Solo 401(k) total",
        value: fmt(solo),
        citation: limitsData!.citation,
        emphasis: true,
      },
      ...(ceilings.cappedByCompensation
        ? [
            {
              label: "Why this is lower than 20% plus the full deferral",
              value:
                "§415(c)(1) caps what may go into the plan at the lesser of the annual dollar limit and 100% of your compensation, and for a self-employed person compensation is net earnings after the contributions themselves. At this profit the second limit is the one that binds, so the total stops at what you earned rather than adding a 20% employer share on top of it.",
              citation: limitsData!.citation,
            },
          ]
        : []),
      {
        label: "Which lets you save more",
        value: solo.greaterThan(sep)
          ? `The Solo 401(k), by ${fmt(solo.subtract(sep))}: its employee deferral stacks on top of the same employer share.`
          : "They're equal at this income; the SEP-IRA is simpler to open and run.",
      },
    ];

    resultContainer.replaceChildren(
      resultCard({
        label: "Most you can contribute",
        value: best,
        locale: ctx.locale,
        breakdown: lines,
        permalink: () => ctx.permalink(writeFields(fields)),
      }),
    );
  }

  function recompute(): void {
    fields = {
      fs: isFilingStatus(fsSelect.value) ? fsSelect.value : "single",
      profit: parseNonNegative(npInput.value, 0),
      age: Math.min(120, parseNonNegative(ageInput.value, 45)),
    };
    ctx.setParams(writeFields(fields));
    rememberShared(profile, { filingStatus: fields.fs, annualIncome: fields.profit });
    compute();
  }

  fsSelect.addEventListener("change", recompute);
  for (const i of [npInput, ageInput]) i.addEventListener("input", recompute);

  const tryExample = tryExampleButton(() => {
    fields = { ...EXAMPLE };
    fsSelect.value = fields.fs;
    npInput.value = String(fields.profit);
    ageInput.value = String(fields.age);
    recompute();
  });

  const form = el(
    "form",
    { class: "tile-form", on: { submit: (e) => e.preventDefault() } },
    field("Filing status", fsSelect),
    field("Net business profit", npInput),
    field("Your age", ageInput),
    el("div", { class: "tile-form-actions" }, tryExample),
  );

  root.append(form, resultContainer);
  compute();
}

export const selfEmployedRetirementTile: TileDefinition = {
  id: "se-retirement",
  title: "Self-Employed Retirement",
  pillar: "retirement",
  description: "How much you can stash tax-advantaged: SEP-IRA vs Solo 401(k).",
  keywords: [
    "self employed",
    "1099",
    "freelance",
    "contractor",
    "gig",
    "sep ira",
    "solo 401k",
    "solo 401(k)",
    "retirement",
    "contribution",
  ],
  status: "ready",
  how: "Self-employment doesn't shut you out of retirement accounts; the opposite. Two plans let you contribute as both the 'employer' and the 'employee' of your own business. We start from your net self-employment earnings (your profit minus the deductible half of self-employment tax), then compute each plan.\n\nA SEP-IRA lets you contribute about 20% of those net earnings (the employer share), capped at the annual defined-contribution limit. A Solo 401(k) lets you make that same ~20% employer contribution AND add an employee deferral on top, up to the 401(k) elective limit (plus a catch-up if you're 50 or older). Because the deferral stacks on top, the Solo 401(k) lets you save more, while the SEP-IRA is simpler to open and administer.\n\nThere are two ceilings, not one. §415(c)(1) limits what may go into the plan to the LESSER of the annual dollar limit and 100% of your compensation — which, for someone self-employed, is net earnings after the contributions themselves. Above roughly the elective-deferral limit the dollar figure is what binds and the 20% stacks on top as you would expect. Below it the second ceiling binds instead: the deferral alone already reaches everything you earned, so an employer contribution just takes room away from itself, and the total stops at your net earnings. When that happens the breakdown says so rather than quietly showing a smaller number. The catch-up sits outside this limit by statute, so it is added after.\n\nFiling status and income flow to and from My Situation. The limits carry their IRS citation; this is the contribution ceiling, not advice on how much to actually save.",
  resources: [
    {
      label: "IRS, retirement plans for the self-employed",
      url: "https://www.irs.gov/retirement-plans/retirement-plans-for-self-employed-people",
    },
    {
      label: "IRS, one-participant 401(k) plans",
      url: "https://www.irs.gov/retirement-plans/one-participant-401k-plans",
    },
  ],
  mount: mountSelfEmployedRetirement,
};
