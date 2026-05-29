/**
 * Federal Poverty Level calculator (BUILD-SPEC.md §4.1) — the foundation of
 * Pillar 2: nearly every program keys off a percentage of the poverty line.
 * Reads the HHS guideline for the chosen region (contiguous / Alaska / Hawaii)
 * and reports income as a percentage of the line, with the common program
 * thresholds marked. The figure is cited to the HHS guidelines.
 */
import { Money } from "../engine/money";
import { povertyLine, fplPercent } from "../engine/benefits";
import { el, option } from "../ui/dom";
import { field, parseNonNegative, tryExampleButton } from "../ui/form";
import { resultCard, type BreakdownLine } from "../ui/resultCard";
import type { FplRegion } from "../data/browser";
import type { SituationStore } from "../profile/situation";
import type { TileContext, TileDefinition } from "./types";

const REGIONS: { value: FplRegion; label: string }[] = [
  { value: "contiguous", label: "48 contiguous states & DC" },
  { value: "alaska", label: "Alaska" },
  { value: "hawaii", label: "Hawaii" },
];

interface Fields {
  householdSize: number;
  region: FplRegion;
  income: number;
}

const EXAMPLE: Fields = { householdSize: 4, region: "contiguous", income: 62400 };

function isRegion(v: string): v is FplRegion {
  return REGIONS.some((r) => r.value === v);
}

function regionFromState(code: string | undefined): FplRegion {
  if (code === "ak") return "alaska";
  if (code === "hi") return "hawaii";
  return "contiguous";
}

function readFields(p: URLSearchParams, profile: SituationStore): Fields {
  const r = p.get("region");
  return {
    householdSize: p.has("hh")
      ? Math.max(1, parseNonNegative(p.get("hh"), 1))
      : (profile.get("householdSize") ?? 1),
    region: r && isRegion(r) ? r : regionFromState(profile.get("stateCode")),
    income: p.has("inc") ? parseNonNegative(p.get("inc"), 0) : (profile.get("annualIncome") ?? 0),
  };
}

function writeFields(f: Fields): URLSearchParams {
  const p = new URLSearchParams();
  p.set("hh", String(f.householdSize));
  if (f.region !== "contiguous") p.set("region", f.region);
  p.set("inc", String(f.income));
  return p;
}

export function mountFpl(ctx: TileContext): void {
  const { root, data, profile } = ctx;
  root.replaceChildren();
  if (!data) {
    root.append(
      el("p", { class: "tile-error", text: "Poverty guideline data could not be loaded." }),
    );
    return;
  }
  // Capture the narrowed (non-null) datasets so the nested closures keep the type.
  const bundled = data;
  let fields = readFields(ctx.params, profile);

  const hhInput = el("input", {
    type: "number",
    name: "hh",
    min: 1,
    step: 1,
    value: fields.householdSize,
    attrs: { "aria-label": "Household size", inputmode: "numeric" },
  });
  const regionSelect = el(
    "select",
    { name: "region", attrs: { "aria-label": "Region" } },
    ...REGIONS.map((r) => option(r.value, r.label, r.value === fields.region)),
  );
  const incInput = el("input", {
    type: "number",
    name: "inc",
    min: 0,
    step: 1000,
    value: fields.income,
    attrs: { "aria-label": "Annual household income", inputmode: "decimal" },
  });

  const resultContainer = el("div", { class: "tile-result", attrs: { "aria-live": "polite" } });

  function compute(): void {
    const fpl = bundled.fpl(fields.region);
    if (!fpl) {
      resultContainer.replaceChildren(
        el("div", {
          class: "verify-banner",
          attrs: { role: "alert" },
          text: "Poverty guideline data is unavailable — verify before relying on any figure.",
        }),
      );
      return;
    }
    const line = povertyLine(fields.householdSize, fpl);
    const pctOfLine = fplPercent(fields.income, fields.householdSize, fpl);
    const fmt = (m: Money): string => m.format(ctx.locale);

    const lines: BreakdownLine[] = [
      { label: "Household size", value: String(fields.householdSize) },
      { label: "Poverty line (100% FPL)", value: fmt(line), citation: fpl.citation },
      { label: "Your household income", value: fmt(Money.from(fields.income)) },
      { label: "Income as % of poverty line", value: `${pctOfLine.toFixed(0)}%`, emphasis: true },
      {
        label: "Medicaid expansion (≤138%)",
        value: fmt(line.multiply(1.38)),
        citation: fpl.citation,
      },
      { label: "ACA subsidies (100–400%)", value: fmt(line.multiply(4)), citation: fpl.citation },
    ];

    resultContainer.replaceChildren(
      resultCard({
        label: "Your income vs. the poverty line",
        value: Money.from(pctOfLine),
        locale: ctx.locale,
        format: (n) => `${n.toFixed(0)}% of FPL`,
        copyText: `${pctOfLine.toFixed(0)}% of the federal poverty line`,
        breakdown: lines,
        permalink: () => ctx.permalink(writeFields(fields)),
      }),
    );
  }

  function recompute(): void {
    fields = {
      householdSize: Math.max(1, parseNonNegative(hhInput.value, 1)),
      region: isRegion(regionSelect.value) ? regionSelect.value : "contiguous",
      income: parseNonNegative(incInput.value, 0),
    };
    ctx.setParams(writeFields(fields));
    profile.set("householdSize", fields.householdSize);
    profile.set("annualIncome", fields.income);
    compute();
  }

  regionSelect.addEventListener("change", recompute);
  for (const i of [hhInput, incInput]) i.addEventListener("input", recompute);

  const tryExample = tryExampleButton(() => {
    fields = { ...EXAMPLE };
    hhInput.value = String(fields.householdSize);
    regionSelect.value = fields.region;
    incInput.value = String(fields.income);
    recompute();
  });

  const form = el(
    "form",
    { class: "tile-form", on: { submit: (e) => e.preventDefault() } },
    field("Household size", hhInput),
    field("Region", regionSelect),
    field("Annual household income", incInput),
    el("div", { class: "tile-form-actions" }, tryExample),
  );

  root.append(form, resultContainer);
  compute();
}

export const fplTile: TileDefinition = {
  id: "fpl",
  title: "Federal Poverty Level",
  pillar: "owed",
  description: "Your income as a percentage of the poverty line — the key to most programs.",
  keywords: ["fpl", "poverty", "guidelines", "medicaid", "subsidy threshold"],
  status: "ready",
  how: "Your household's poverty line is the HHS base amount for one person plus a fixed amount for each additional person, for your region (the 48 contiguous states, Alaska, or Hawaii). We divide your income by that line to get your percentage of the federal poverty level.\n\nThat percentage is the key to most programs: many cap Medicaid eligibility around 138% of FPL, and ACA marketplace subsidies generally apply from 100% to 400%.",
  resources: [
    {
      label: "HHS — federal poverty guidelines",
      url: "https://aspe.hhs.gov/topics/poverty-economic-mobility/poverty-guidelines",
    },
    {
      label: "HealthCare.gov — using your income estimate",
      url: "https://www.healthcare.gov/lower-costs/",
    },
  ],
  mount: mountFpl,
};
