/**
 * Umbrella Liability Coverage tile (BUILD-SPEC-2 §6.6): how much personal
 * umbrella liability coverage to consider. The common guideline is to cover at
 * least your net worth — what a lawsuit or judgment could reach — above the
 * liability limits already on your auto and home policies. We round the
 * uncovered exposure up to the $1M layer umbrellas are sold in. A labeled
 * guideline, not a cited rule. Information, not advice.
 */
import { Money } from "../engine/money";
import { umbrellaCoverageNeed } from "../engine/finance";
import { el } from "../ui/dom";
import { field, parseNonNegative, tryExampleButton } from "../ui/form";
import { resultCard, type BreakdownLine } from "../ui/resultCard";
import type { TileContext, TileDefinition } from "./types";

/** Umbrella policies are sold in $1,000,000 layers. */
const POLICY_INCREMENT = 1_000_000;

interface Fields {
  netWorth: number;
  futureIncomeExposure: number;
  existingLiabilityCoverage: number;
}

const EXAMPLE: Fields = {
  netWorth: 1300000,
  futureIncomeExposure: 0,
  existingLiabilityCoverage: 500000,
};

function readFields(p: URLSearchParams): Fields {
  return {
    netWorth: parseNonNegative(p.get("nw"), 0),
    futureIncomeExposure: parseNonNegative(p.get("fi"), 0),
    existingLiabilityCoverage: parseNonNegative(p.get("cov"), 0),
  };
}

function writeFields(f: Fields): URLSearchParams {
  const p = new URLSearchParams();
  p.set("nw", String(f.netWorth));
  if (f.futureIncomeExposure > 0) p.set("fi", String(f.futureIncomeExposure));
  if (f.existingLiabilityCoverage > 0) p.set("cov", String(f.existingLiabilityCoverage));
  return p;
}

export function mountUmbrella(ctx: TileContext): void {
  const { root } = ctx;
  root.replaceChildren();
  let fields = readFields(ctx.params);

  const mkNum = (name: string, label: string, value: number): HTMLInputElement =>
    el("input", {
      type: "number",
      name,
      min: 0,
      step: 50000,
      value,
      attrs: { "aria-label": label, inputmode: "decimal" },
    });
  const nwInput = mkNum("nw", "Net worth to protect", fields.netWorth);
  const fiInput = mkNum("fi", "Extra future-income exposure", fields.futureIncomeExposure);
  const covInput = mkNum("cov", "Existing liability coverage", fields.existingLiabilityCoverage);

  const resultContainer = el("div", { class: "tile-result", attrs: { "aria-live": "polite" } });

  function compute(): void {
    const r = umbrellaCoverageNeed({
      netWorth: fields.netWorth,
      futureIncomeExposure: fields.futureIncomeExposure,
      existingLiabilityCoverage: fields.existingLiabilityCoverage,
      policyIncrement: POLICY_INCREMENT,
    });
    const fmt = (m: Money): string => m.format(ctx.locale);

    const lines: BreakdownLine[] = [
      { label: "Total exposure", value: fmt(r.exposure) },
      {
        label: "Already covered (auto + home)",
        value: fmt(Money.from(fields.existingLiabilityCoverage)),
      },
      { label: "Uncovered exposure", value: fmt(r.uncoveredExposure) },
      { label: "Umbrella to consider", value: fmt(r.recommendedUmbrella), emphasis: true },
      {
        label: "About the guideline",
        value:
          "A common rule of thumb is to carry umbrella coverage at least equal to your net worth, on top of your auto and home liability limits. Umbrella is usually inexpensive per million.",
      },
    ];

    resultContainer.replaceChildren(
      resultCard({
        label: "Umbrella liability coverage to consider",
        value: r.recommendedUmbrella,
        locale: ctx.locale,
        breakdown: lines,
        permalink: () => ctx.permalink(writeFields(fields)),
      }),
    );
  }

  function recompute(): void {
    fields = {
      netWorth: parseNonNegative(nwInput.value, 0),
      futureIncomeExposure: parseNonNegative(fiInput.value, 0),
      existingLiabilityCoverage: parseNonNegative(covInput.value, 0),
    };
    ctx.setParams(writeFields(fields));
    compute();
  }

  for (const i of [nwInput, fiInput, covInput]) i.addEventListener("input", recompute);

  const tryExample = tryExampleButton(() => {
    fields = { ...EXAMPLE };
    nwInput.value = String(fields.netWorth);
    fiInput.value = String(fields.futureIncomeExposure);
    covInput.value = String(fields.existingLiabilityCoverage);
    recompute();
  });

  const form = el(
    "form",
    { class: "tile-form", on: { submit: (e) => e.preventDefault() } },
    field("Net worth to protect", nwInput),
    field("Extra future-income exposure", fiInput),
    field("Existing liability coverage (auto + home)", covInput),
    el("div", { class: "tile-form-actions" }, tryExample),
  );

  root.append(form, resultContainer);
  compute();
}

export const umbrellaTile: TileDefinition = {
  id: "umbrella-liability",
  title: "Umbrella Liability Coverage",
  pillar: "protect",
  description: "Size personal umbrella coverage to your net worth.",
  keywords: ["umbrella", "liability", "lawsuit", "asset protection", "coverage", "protection"],
  status: "ready",
  how: "An umbrella policy adds liability protection above the limits on your auto and home insurance — the layer that protects your savings if you're sued for more than those policies cover. The common guideline is to carry at least as much umbrella coverage as your net worth, since that's what a judgment could reach.\n\nWe take your net worth (plus any extra future-income exposure you add), subtract the liability coverage you already carry, and round what's left up to the $1M layer umbrella is sold in. It's an inexpensive coverage per million, so rounding up is usually cheap peace of mind. This is a guideline, not advice — your agent can confirm the underlying limits an umbrella requires.",
  resources: [
    { label: "Insurance Information Institute", url: "https://www.iii.org/" },
    { label: "Investor.gov", url: "https://www.investor.gov/" },
  ],
  mount: mountUmbrella,
};
