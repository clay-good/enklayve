/**
 * SNAP Eligibility tile (BUILD-SPEC.md §4.3): the gross and net income tests
 * against the poverty line, the standard and earned-income deductions, and an
 * estimated monthly benefit from the maximum allotment. Cited to the USDA FNS
 * cost-of-living adjustment. First wave covers the 48 contiguous states and DC;
 * Alaska, Hawaii, and the territories use different allotments (noted).
 */
import { Money } from "../engine/money";
import { estimateSnap } from "../engine/benefits";
import { el } from "../ui/dom";
import { field, parseNonNegative, tryExampleButton } from "../ui/form";
import { resultCard, type BreakdownLine } from "../ui/resultCard";
import type { SituationStore } from "../profile/situation";
import type { TileContext, TileDefinition } from "./types";

interface Fields {
  householdSize: number;
  monthlyIncome: number;
  /** The part of it that is wages or self-employment (7 CFR §273.9(d)(2)). */
  earnedIncome: number;
  elderlyOrDisabled: boolean;
}

const EXAMPLE: Fields = {
  householdSize: 3,
  monthlyIncome: 2200,
  earnedIncome: 2200,
  elderlyOrDisabled: false,
};

function readFields(p: URLSearchParams, profile: SituationStore): Fields {
  const annual = profile.get("annualIncome");
  return {
    householdSize: p.has("hh")
      ? Math.max(1, parseNonNegative(p.get("hh"), 1))
      : (profile.get("householdSize") ?? 1),
    monthlyIncome: p.has("inc")
      ? parseNonNegative(p.get("inc"), 0)
      : annual !== undefined
        ? Math.round(annual / 12)
        : 0,
    elderlyOrDisabled: p.get("ed") === "1",
    // 7 CFR §273.9(d)(2)'s 20% deduction is against EARNED income only, so it
    // is asked rather than assumed: this engine defaulted it to the whole
    // income, which handed the deduction to a household living on Social
    // Security or SSI. Absent from the link it starts at zero, which is the
    // answer for that household and the one the reader can see is wrong if it
    // is not theirs.
    earnedIncome: p.has("earn")
      ? parseNonNegative(p.get("earn"), 0)
      : p.has("inc")
        ? parseNonNegative(p.get("inc"), 0)
        : 0,
  };
}

function writeFields(f: Fields): URLSearchParams {
  const p = new URLSearchParams();
  p.set("hh", String(f.householdSize));
  p.set("inc", String(f.monthlyIncome));
  p.set("earn", String(f.earnedIncome));
  if (f.elderlyOrDisabled) p.set("ed", "1");
  return p;
}

export function mountSnap(ctx: TileContext): void {
  const { root, data, profile } = ctx;
  root.replaceChildren();
  const snap = data?.snap();
  const fpl = data?.fpl("contiguous");
  if (!snap || !fpl) {
    root.append(
      el("div", {
        class: "verify-banner",
        attrs: { role: "alert" },
        text: "SNAP data is unavailable, verify before relying on any figure.",
      }),
    );
    return;
  }
  let fields = readFields(ctx.params, profile);

  const hhInput = el("input", {
    type: "number",
    name: "hh",
    min: 1,
    step: 1,
    value: fields.householdSize,
    attrs: { "aria-label": "Household size", inputmode: "numeric" },
  });
  const incInput = el("input", {
    type: "number",
    name: "inc",
    min: 0,
    step: 100,
    value: fields.monthlyIncome,
    attrs: { "aria-label": "Monthly gross income", inputmode: "decimal" },
  });

  const earnInput = el("input", {
    type: "number",
    name: "earn",
    min: 0,
    step: 100,
    value: fields.earnedIncome,
    attrs: { "aria-label": "Monthly income from work", inputmode: "decimal" },
  });
  const edBox = el("input", {
    type: "checkbox",
    name: "ed",
    checked: fields.elderlyOrDisabled,
    attrs: { "aria-label": "Someone in the household is 60 or older, or has a disability" },
  });

  const resultContainer = el("div", { class: "tile-result", attrs: { "aria-live": "polite" } });

  function compute(): void {
    const r = estimateSnap(
      {
        householdSize: fields.householdSize,
        monthlyGrossIncome: fields.monthlyIncome,
        monthlyEarnedIncome: fields.earnedIncome,
        elderlyOrDisabled: fields.elderlyOrDisabled,
      },
      snap!,
      fpl!,
    );
    const fmt = (m: Money): string => m.format(ctx.locale);
    const yesno = (b: boolean): string => (b ? "Pass" : "Over the limit");

    const lines: BreakdownLine[] = [
      {
        label: `Gross income test (≤${snap!.grossIncomeLimitPctFpl}% FPL)`,
        value: r.grossTestApplies
          ? `${fmt(r.grossMonthlyIncome)} vs ${fmt(r.grossLimit)}: ${yesno(r.passedGrossTest)}`
          : "Does not apply — a household with a member 60 or older, or with a disability, meets the net standard only",
        citation: fpl!.citation,
      },
      {
        label: "Counted as earned (the 20% deduction is on this)",
        value: fmt(r.earnedMonthlyIncome),
        citation: snap!.citation,
      },
      {
        label: "Net income after deductions",
        value: fmt(r.netMonthlyIncome),
        citation: snap!.citation,
      },
      {
        label: `Net income test (≤${snap!.netIncomeLimitPctFpl}% FPL)`,
        value: `${fmt(r.netMonthlyIncome)} vs ${fmt(r.netLimit)}: ${yesno(r.passedNetTest)}`,
        citation: fpl!.citation,
      },
      {
        label: "Maximum monthly allotment",
        value: fmt(r.maxAllotment),
        citation: snap!.citation,
      },
      {
        label: "Estimated monthly benefit",
        value: r.eligible ? fmt(r.monthlyBenefit) : "Not eligible at this income",
        emphasis: true,
        citation: snap!.citation,
      },
    ];

    resultContainer.replaceChildren(
      resultCard({
        label: r.eligible ? "Estimated monthly SNAP benefit" : "SNAP estimate",
        value: r.monthlyBenefit,
        locale: ctx.locale,
        breakdown: lines,
        permalink: () => ctx.permalink(writeFields(fields)),
      }),
    );
  }

  function recompute(): void {
    fields = {
      householdSize: Math.max(1, parseNonNegative(hhInput.value, 1)),
      monthlyIncome: parseNonNegative(incInput.value, 0),
      earnedIncome: parseNonNegative(earnInput.value, 0),
      elderlyOrDisabled: edBox.checked,
    };
    ctx.setParams(writeFields(fields));
    profile.set("householdSize", fields.householdSize);
    compute();
  }

  for (const i of [hhInput, incInput, earnInput]) i.addEventListener("input", recompute);
  edBox.addEventListener("change", recompute);

  const tryExample = tryExampleButton(() => {
    fields = { ...EXAMPLE };
    hhInput.value = String(fields.householdSize);
    incInput.value = String(fields.monthlyIncome);
    earnInput.value = String(fields.earnedIncome);
    edBox.checked = fields.elderlyOrDisabled;
    recompute();
  });

  const form = el(
    "form",
    { class: "tile-form", on: { submit: (e) => e.preventDefault() } },
    field("Household size", hhInput),
    field("Monthly gross income", incInput),
    field("Of that, from work (wages or self-employment)", earnInput),
    field("Someone is 60+ or has a disability", edBox),
    el("div", { class: "tile-form-actions" }, tryExample),
  );

  root.append(form, resultContainer);
  compute();
}

export const snapTile: TileDefinition = {
  id: "snap",
  title: "SNAP Eligibility",
  pillar: "owed",
  description: "Gross and net income tests against the poverty line.",
  keywords: ["snap", "food stamps", "benefits", "ebt", "nutrition"],
  status: "ready",
  how: "SNAP (food assistance) runs two monthly income tests. The gross test checks your income against 130% of the poverty line for your household size. If you pass, the net test checks income after the standard deduction and a 20% earned-income deduction against 100% of the line. That 20% is on the part of your income that comes from work — 7 CFR §273.9(d)(2) — which is why this asks for it separately: a household living on Social Security or SSI does not get it. If both pass, your benefit is the maximum allotment minus about 30% of your net income.\n\nThis is a deterministic estimate using the FY2026 figures for the 48 contiguous states and DC. It doesn't model the shelter, dependent-care, or medical deductions, which only raise the benefit. Tick the box if someone in the household is 60 or older or has a disability: 7 CFR §273.9(a) holds those households to the net standard only, so the gross test does not apply to them at all. Alaska, Hawaii, and the territories use different amounts. States vary, and the agency makes the final decision.",
  resources: [
    { label: "USDA, SNAP eligibility", url: "https://www.fna.usda.gov/snap/recipient/eligibility" },
    { label: "USA.gov, SNAP", url: "https://www.usa.gov/food-stamps" },
  ],
  mount: mountSnap,
};
