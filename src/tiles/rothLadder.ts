/**
 * Roth Conversion Ladder tile (BUILD-SPEC-2 §6.5): convert a fixed amount from a
 * traditional account to a Roth each year and tap it penalty-free five years
 * later. Lays out the seasoning schedule so you can see when each conversion
 * unlocks and the steady annual stream it builds — the classic early-retirement
 * bridge. Deterministic; the conversion tax is estimated at the rate you enter.
 * The 5-year rule cites IRC §408A(d)(3) / IRS Pub 590-B. Information, not advice.
 */
import { Money } from "../engine/money";
import { rothConversionLadder } from "../engine/taxMoves";
import type { CitationData } from "../data/schemas";
import { el } from "../ui/dom";
import { field, parseNonNegative, tryExampleButton } from "../ui/form";
import { resultCard, type BreakdownLine } from "../ui/resultCard";
import type { TileContext, TileDefinition } from "./types";

/** The 5-year seasoning rule for converted amounts (IRC §408A(d)(3)). */
const ROTH_5YR_CITATION: CitationData = {
  sourceUrl: "https://www.irs.gov/publications/p590b",
  sourceDocument: "IRS Publication 590-B, Roth IRA 5-year rule (IRC §408A(d)(3))",
  effectiveYear: 2026,
  dateRetrieved: "2026-05-29",
};

/** Statutory seasoning period before a conversion is penalty-free. */
const SEASONING_YEARS = 5;

interface Fields {
  startYear: number;
  annualConversion: number;
  ladderYears: number;
  ordinaryRatePct: number;
}

const EXAMPLE: Fields = {
  startYear: 2026,
  annualConversion: 40000,
  ladderYears: 5,
  ordinaryRatePct: 12,
};

function readFields(p: URLSearchParams): Fields {
  return {
    startYear: Math.round(parseNonNegative(p.get("y0"), 2026)),
    annualConversion: parseNonNegative(p.get("amt"), 0),
    ladderYears: Math.max(0, Math.round(parseNonNegative(p.get("n"), 5))),
    ordinaryRatePct: parseNonNegative(p.get("ord"), 12),
  };
}

function writeFields(f: Fields): URLSearchParams {
  const p = new URLSearchParams();
  p.set("y0", String(f.startYear));
  p.set("amt", String(f.annualConversion));
  p.set("n", String(f.ladderYears));
  p.set("ord", String(f.ordinaryRatePct));
  return p;
}

export function mountRothLadder(ctx: TileContext): void {
  const { root } = ctx;
  root.replaceChildren();
  let fields = readFields(ctx.params);

  const mkNum = (name: string, label: string, value: number, step: number): HTMLInputElement =>
    el("input", {
      type: "number",
      name,
      min: 0,
      step,
      value,
      attrs: { "aria-label": label, inputmode: "numeric" },
    });
  const y0Input = mkNum("y0", "First conversion year", fields.startYear, 1);
  const amtInput = mkNum("amt", "Amount to convert each year", fields.annualConversion, 1000);
  const nInput = mkNum("n", "Number of years converting", fields.ladderYears, 1);
  const ordInput = mkNum("ord", "Ordinary tax rate (percent)", fields.ordinaryRatePct, 1);

  const resultContainer = el("div", { class: "tile-result", attrs: { "aria-live": "polite" } });

  function compute(): void {
    resultContainer.replaceChildren();
    if (fields.annualConversion <= 0 || fields.ladderYears <= 0) {
      resultContainer.append(
        el("p", {
          class: "ph-empty",
          text: "Enter an amount to convert and how many years you'll convert.",
        }),
      );
      return;
    }
    const r = rothConversionLadder({
      startYear: fields.startYear,
      annualConversion: fields.annualConversion,
      ladderYears: fields.ladderYears,
      ordinaryRatePct: fields.ordinaryRatePct,
      seasoningYears: SEASONING_YEARS,
    });
    const fmt = (m: Money): string => m.format(ctx.locale);

    const lines: BreakdownLine[] = r.rungs.map((rung, i) => ({
      label: `Convert in ${rung.year}`,
      value: `${fmt(rung.converted)}: penalty-free in ${rung.accessibleYear}`,
      citation: i === 0 ? ROTH_5YR_CITATION : null,
    }));
    lines.push({ label: "Total converted", value: fmt(r.totalConverted), emphasis: true });
    lines.push({
      label: `Estimated conversion tax (at ${fields.ordinaryRatePct}%)`,
      value: fmt(r.totalEstimatedTax),
    });
    lines.push({
      label: "Steady amount unlocked each year",
      value: `${fmt(r.annualAccessibleAmount)} starting ${r.firstAccessibleYear}`,
    });

    resultContainer.append(
      resultCard({
        label: `Penalty-free each year, starting ${r.firstAccessibleYear}`,
        value: r.annualAccessibleAmount,
        locale: ctx.locale,
        breakdown: lines,
        permalink: () => ctx.permalink(writeFields(fields)),
      }),
    );
  }

  function recompute(): void {
    fields = {
      startYear: Math.round(parseNonNegative(y0Input.value, 2026)),
      annualConversion: parseNonNegative(amtInput.value, 0),
      ladderYears: Math.max(0, Math.round(parseNonNegative(nInput.value, 5))),
      ordinaryRatePct: parseNonNegative(ordInput.value, 12),
    };
    ctx.setParams(writeFields(fields));
    compute();
  }

  for (const i of [y0Input, amtInput, nInput, ordInput]) i.addEventListener("input", recompute);

  const tryExample = tryExampleButton(() => {
    fields = { ...EXAMPLE };
    y0Input.value = String(fields.startYear);
    amtInput.value = String(fields.annualConversion);
    nInput.value = String(fields.ladderYears);
    ordInput.value = String(fields.ordinaryRatePct);
    recompute();
  });

  const form = el(
    "form",
    { class: "tile-form", on: { submit: (e) => e.preventDefault() } },
    field("First conversion year", y0Input),
    field("Amount to convert each year", amtInput),
    field("Number of years converting", nInput),
    field("Your ordinary tax rate (%)", ordInput),
    el("div", { class: "tile-form-actions" }, tryExample),
  );

  root.append(form, resultContainer);
  compute();
}

export const rothLadderTile: TileDefinition = {
  id: "roth-ladder",
  title: "Roth Conversion Ladder",
  pillar: "retirement",
  description: "Schedule penalty-free Roth access with the 5-year rule.",
  keywords: ["roth", "conversion", "ladder", "early retirement", "5-year rule", "590-b"],
  status: "ready",
  how: "A Roth conversion ladder moves money from a traditional account to a Roth a slice at a time. Each converted amount can be withdrawn penalty-free five years after the conversion (the IRS 5-year rule for conversions), so a steady yearly conversion builds a steady yearly stream of penalty-free money, a common way to bridge spending before age 59½.\n\nWe lay out the schedule: what you convert each year, the year it becomes accessible, and the conversion tax estimated at the rate you enter (each conversion is taxable income that year). Converting in a low-income year keeps that tax down. This is a starting plan, not advice: confirm the rules for your accounts with the IRS or a qualified professional.",
  resources: [
    { label: "IRS Publication 590-B", url: "https://www.irs.gov/publications/p590b" },
    {
      label: "IRS, Roth IRAs",
      url: "https://www.irs.gov/retirement-plans/roth-iras",
    },
  ],
  mount: mountRothLadder,
};
