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
}

const EXAMPLE: Fields = { householdSize: 3, monthlyIncome: 2200 };

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
  };
}

function writeFields(f: Fields): URLSearchParams {
  const p = new URLSearchParams();
  p.set("hh", String(f.householdSize));
  p.set("inc", String(f.monthlyIncome));
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

  const resultContainer = el("div", { class: "tile-result", attrs: { "aria-live": "polite" } });

  function compute(): void {
    const r = estimateSnap(
      { householdSize: fields.householdSize, monthlyGrossIncome: fields.monthlyIncome },
      snap!,
      fpl!,
    );
    const fmt = (m: Money): string => m.format(ctx.locale);
    const yesno = (b: boolean): string => (b ? "Pass" : "Over the limit");

    const lines: BreakdownLine[] = [
      {
        label: "Gross income test (≤130% FPL)",
        value: `${fmt(r.grossMonthlyIncome)} vs ${fmt(r.grossLimit)}: ${yesno(r.passedGrossTest)}`,
        citation: fpl!.citation,
      },
      {
        label: "Net income after deductions",
        value: fmt(r.netMonthlyIncome),
        citation: snap!.citation,
      },
      {
        label: "Net income test (≤100% FPL)",
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
    };
    ctx.setParams(writeFields(fields));
    profile.set("householdSize", fields.householdSize);
    compute();
  }

  for (const i of [hhInput, incInput]) i.addEventListener("input", recompute);

  const tryExample = tryExampleButton(() => {
    fields = { ...EXAMPLE };
    hhInput.value = String(fields.householdSize);
    incInput.value = String(fields.monthlyIncome);
    recompute();
  });

  const form = el(
    "form",
    { class: "tile-form", on: { submit: (e) => e.preventDefault() } },
    field("Household size", hhInput),
    field("Monthly gross income", incInput),
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
  how: "SNAP (food assistance) runs two monthly income tests. The gross test checks your income against 130% of the poverty line for your household size. If you pass, the net test checks income after the standard deduction and a 20% earned-income deduction against 100% of the line. If both pass, your benefit is the maximum allotment minus about 30% of your net income.\n\nThis is a deterministic estimate using the FY2024 figures for the 48 contiguous states and DC. It doesn't model the shelter, dependent-care, or medical deductions (which only raise the benefit), and households with an elderly or disabled member skip the gross test. Alaska, Hawaii, and the territories use different amounts. States vary, and the agency makes the final decision.",
  resources: [
    { label: "USDA, SNAP eligibility", url: "https://www.fns.usda.gov/snap/recipient/eligibility" },
    { label: "Benefits.gov, SNAP", url: "https://www.benefits.gov/benefit/361" },
  ],
  mount: mountSnap,
};
