/**
 * ACA Premium Tax Credit tile (BUILD-SPEC.md §4.2): the marketplace subsidy
 * estimate. The credit is your benchmark (second-lowest-cost silver) plan
 * premium minus your expected contribution — income times the applicable
 * percentage for your FPL band. For plan year 2026 the enhanced subsidies have
 * expired, so the applicable percentages rise and the 400%-FPL cliff returns
 * (no credit above it). The applicable-percentage table is bundled and cited; the
 * benchmark premium is per-county, so you enter it (look it up on
 * HealthCare.gov). Reads household size, state, and income from My Situation.
 */
import { Money } from "../engine/money";
import { estimatePremiumTaxCredit } from "../engine/benefits";
import { el, option } from "../ui/dom";
import { field, parseNonNegative, pct, tryExampleButton } from "../ui/form";
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
  benchmarkMonthly: number;
}

const EXAMPLE: Fields = {
  householdSize: 1,
  region: "contiguous",
  income: 35000,
  benchmarkMonthly: 550,
};

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
    householdSize: Math.max(
      1,
      Math.round(
        p.has("hh") ? parseNonNegative(p.get("hh"), 1) : (profile.get("householdSize") ?? 1),
      ),
    ),
    region: r && isRegion(r) ? r : regionFromState(profile.get("stateCode")),
    income: p.has("inc") ? parseNonNegative(p.get("inc"), 0) : (profile.get("annualIncome") ?? 0),
    benchmarkMonthly: parseNonNegative(p.get("bm"), 0),
  };
}

function writeFields(f: Fields): URLSearchParams {
  const p = new URLSearchParams();
  p.set("hh", String(f.householdSize));
  if (f.region !== "contiguous") p.set("region", f.region);
  p.set("inc", String(f.income));
  p.set("bm", String(f.benchmarkMonthly));
  return p;
}

export function mountAcaPtc(ctx: TileContext): void {
  const { root, data, profile } = ctx;
  root.replaceChildren();
  const aca = data?.aca();
  if (!aca) {
    root.append(
      el("div", {
        class: "verify-banner",
        attrs: { role: "alert" },
        text: "ACA subsidy data is unavailable, verify before relying on any figure.",
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
  const regionSelect = el(
    "select",
    { name: "region", attrs: { "aria-label": "Region" } },
    ...REGIONS.map((r) => option(r.value, r.label, r.value === fields.region)),
  );
  regionSelect.value = fields.region;
  const incInput = el("input", {
    type: "number",
    name: "inc",
    min: 0,
    step: 1000,
    value: fields.income,
    attrs: { "aria-label": "Annual household income (MAGI)", inputmode: "decimal" },
  });
  const bmInput = el("input", {
    type: "number",
    name: "bm",
    min: 0,
    step: 25,
    value: fields.benchmarkMonthly,
    attrs: { "aria-label": "Benchmark silver plan monthly premium", inputmode: "decimal" },
  });

  const resultContainer = el("div", { class: "tile-result", attrs: { "aria-live": "polite" } });

  function compute(): void {
    resultContainer.replaceChildren();
    const fpl = data?.fpl(fields.region);
    if (!fpl) {
      resultContainer.append(
        el("div", {
          class: "verify-banner",
          attrs: { role: "alert" },
          text: "Poverty-guideline data is unavailable for this region.",
        }),
      );
      return;
    }
    if (fields.benchmarkMonthly <= 0) {
      resultContainer.append(
        el("p", {
          class: "ph-empty",
          text: "Enter your benchmark silver plan premium (look it up on HealthCare.gov) to estimate the credit.",
        }),
      );
      return;
    }
    const r = estimatePremiumTaxCredit(
      {
        householdSize: fields.householdSize,
        annualIncome: fields.income,
        benchmarkMonthlyPremium: fields.benchmarkMonthly,
      },
      aca!,
      fpl,
    );
    const fmt = (m: Money): string => m.format(ctx.locale);

    const lines: BreakdownLine[] = [
      { label: "Income vs poverty line", value: `${r.fplPercent.toFixed(0)}% FPL` },
      {
        label: "Expected contribution",
        value: `${pct(r.applicablePercent / 100)} of income · ${fmt(r.expectedMonthlyContribution)}/mo`,
        citation: aca!.citation,
      },
      {
        label: "Benchmark silver premium",
        value: `${fmt(Money.from(fields.benchmarkMonthly))}/mo`,
      },
      {
        label: "Estimated premium tax credit",
        value: `${fmt(r.monthlyCredit)}/mo · ${fmt(r.annualCredit)}/yr`,
        emphasis: true,
        citation: aca!.citation,
      },
    ];
    if (r.belowMedicaidFloor) {
      lines.push({
        label: "Heads up",
        value:
          "Income below 100% of the poverty line usually points to Medicaid (in expansion states) rather than a marketplace credit. Check the Medicaid tile.",
      });
    } else if (r.aboveSubsidyCap) {
      lines.push({
        label: "Heads up",
        value:
          "Above 400% of the poverty line there is no premium tax credit for 2026: the enhanced subsidies expired at the end of 2025 and the cliff returned, so you pay the full premium.",
      });
    } else if (!r.eligible) {
      lines.push({
        label: "Note",
        value:
          "Your expected contribution already covers the benchmark plan, so there's no credit at this income, but a plan cheaper than the benchmark still costs you less.",
      });
    }

    resultContainer.append(
      resultCard({
        label: "Estimated monthly premium tax credit",
        value: r.monthlyCredit,
        locale: ctx.locale,
        breakdown: lines,
        copyText: `${fmt(r.monthlyCredit)}/mo`,
        permalink: () => ctx.permalink(writeFields(fields)),
      }),
    );
  }

  function recompute(): void {
    fields = {
      householdSize: Math.max(1, Math.round(parseNonNegative(hhInput.value, 1))),
      region: isRegion(regionSelect.value) ? regionSelect.value : "contiguous",
      income: parseNonNegative(incInput.value, 0),
      benchmarkMonthly: parseNonNegative(bmInput.value, 0),
    };
    ctx.setParams(writeFields(fields));
    compute();
  }

  regionSelect.addEventListener("change", recompute);
  for (const i of [hhInput, incInput, bmInput]) i.addEventListener("input", recompute);

  const tryExample = tryExampleButton(() => {
    fields = { ...EXAMPLE };
    hhInput.value = String(fields.householdSize);
    regionSelect.value = fields.region;
    incInput.value = String(fields.income);
    bmInput.value = String(fields.benchmarkMonthly);
    recompute();
  });

  const form = el(
    "form",
    { class: "tile-form", on: { submit: (e) => e.preventDefault() } },
    field("Household size", hhInput),
    field("Region", regionSelect),
    field("Annual household income (MAGI)", incInput),
    field("Benchmark silver plan premium (monthly)", bmInput),
    el("div", { class: "tile-form-actions" }, tryExample),
  );

  root.append(form, resultContainer);
  compute();
}

export const acaPtcTile: TileDefinition = {
  id: "aca-ptc",
  title: "ACA Premium Tax Credit",
  pillar: "owed",
  description: "Marketplace subsidy from the applicable-percentage table.",
  keywords: ["aca", "obamacare", "premium tax credit", "subsidy", "marketplace", "healthcare.gov"],
  status: "ready",
  how: "If you buy health coverage on the marketplace, the premium tax credit caps what you pay for a benchmark plan at a set share of your income. We compute that expected contribution (your income times the applicable percentage for your income relative to the federal poverty line) and subtract it from the benchmark premium to estimate your monthly credit. The ARPA/IRA-enhanced subsidies expired at the end of 2025, so for 2026 the applicable percentages rise across the board and the 400%-of-poverty cliff returns: above that line there is no credit and you pay the full premium.\n\nThe applicable-percentage table is bundled and cited. The one figure that's local, the benchmark (second-lowest-cost silver) plan premium for your county and ages, you enter yourself; look it up with the HealthCare.gov plan preview or your state marketplace. The actual credit is reconciled on your tax return (Form 8962) against your real income, so treat this as an estimate.",
  resources: [
    {
      label: "HealthCare.gov, see plans & prices",
      url: "https://www.healthcare.gov/see-plans/",
    },
    {
      label: "IRS, the Premium Tax Credit",
      url: "https://www.irs.gov/affordable-care-act/individuals-and-families/the-premium-tax-credit-the-basics",
    },
  ],
  mount: mountAcaPtc,
};
