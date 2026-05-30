/**
 * Self-Employed Retirement (BUILD-SPEC-2 §6.4). Working for yourself means no
 * employer 401(k) — but the self-employed plans are more generous, not less. A
 * SEP-IRA lets you stash ~20% of your net earnings; a Solo 401(k) adds an employee
 * deferral on top of that same employer share, so it almost always lets you put
 * away more at the same income. This shows both, capped at the IRS limits, from
 * your net profit. Built on the existing SE-tax engine and the bundled IRS limits.
 */
import { Money } from "../engine/money";
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

// The employer-side share both plans allow: ~20% of net self-employment earnings
// (the 25%-of-net-after-contribution rule, expressed as 20% of net earnings).
const EMPLOYER_SHARE_RATE = 0.2;

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
    const elective = limits["elective_deferral_401k"] ?? 23000;
    const catchUp = fields.age >= 50 ? (limits["catch_up_401k_50plus"] ?? 7500) : 0;
    const dc415 = limits["defined_contribution_415c"] ?? 69000;
    const overallCap = dc415 + catchUp; // §415(c) plus the 50+ catch-up

    const se = selfEmploymentTax(Money.from(fields.profit), fields.fs, fica!);
    const netEarnings = Money.from(fields.profit).subtract(se.deductibleHalf);
    const net = netEarnings.isNegative() ? Money.zero() : netEarnings;

    const employerShare = net.multiply(EMPLOYER_SHARE_RATE);

    // SEP-IRA: employer share only, capped at §415(c).
    const sep = employerShare.greaterThan(dc415) ? Money.from(dc415) : employerShare;

    // Solo 401(k): employee deferral (capped at earnings) + the same employer
    // share, capped overall at §415(c) plus any catch-up.
    const deferralCap = elective + catchUp;
    const employeeDeferral = net.greaterThan(deferralCap) ? Money.from(deferralCap) : net;
    const soloRaw = employeeDeferral.add(employerShare);
    const solo = soloRaw.greaterThan(overallCap) ? Money.from(overallCap) : soloRaw;

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
        label: `Solo 401(k): employee deferral${catchUp > 0 ? " (incl. 50+ catch-up)" : ""}`,
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
      {
        label: "Which lets you save more",
        value: solo.greaterThan(sep)
          ? `The Solo 401(k), by ${fmt(solo.subtract(sep))} — its employee deferral stacks on top of the same employer share.`
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
  how: "Self-employment doesn't shut you out of retirement accounts — the opposite. Two plans let you contribute as both the 'employer' and the 'employee' of your own business. We start from your net self-employment earnings (your profit minus the deductible half of self-employment tax), then compute each plan.\n\nA SEP-IRA lets you contribute about 20% of those net earnings (the employer share), capped at the annual defined-contribution limit. A Solo 401(k) lets you make that same ~20% employer contribution AND add an employee deferral on top, up to the 401(k) elective limit (plus a catch-up if you're 50 or older), with the combined total capped at the same overall limit. Because the deferral stacks on top, the Solo 401(k) almost always lets you save more — especially at low-to-moderate profit — while the SEP-IRA is simpler to open and administer.\n\nFiling status and income flow to and from My Situation. The limits carry their IRS citation; this is the contribution ceiling, not advice on how much to actually save.",
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
