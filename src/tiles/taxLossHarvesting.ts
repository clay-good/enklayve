/**
 * Tax-Loss Harvesting tile (BUILD-SPEC-2 §6.5): given the gains you've realized
 * and the losses you could realize, estimate the tax that harvesting the losses
 * saves. Nets short- and long-term per the Schedule D rules, applies the $3,000
 * ($1,500 if married filing separately) ordinary-income offset limit, and
 * carries the rest forward. Deterministic from your lots; the limit and the
 * wash-sale rule cite the Internal Revenue Code. Filing status reads from My
 * Situation. Information, not advice.
 */
import { Money } from "../engine/money";
import { taxLossHarvest } from "../engine/taxMoves";
import type { CitationData } from "../data/schemas";
import { el } from "../ui/dom";
import { field, parseNonNegative, tryExampleButton } from "../ui/form";
import { resultCard, type BreakdownLine } from "../ui/resultCard";
import type { SituationStore } from "../profile/situation";
import type { TileContext, TileDefinition } from "./types";

/** The net-capital-loss ordinary-income offset limit (IRC §1211(b)). */
const LOSS_LIMIT_CITATION: CitationData = {
  sourceUrl: "https://www.irs.gov/taxtopics/tc409",
  sourceDocument: "IRS Topic No. 409, Capital Gains and Losses (IRC §1211(b))",
  effectiveYear: 2024,
  dateRetrieved: "2026-05-29",
};
/** The wash-sale rule (IRC §1091). */
const WASH_SALE_CITATION: CitationData = {
  sourceUrl: "https://www.irs.gov/publications/p550",
  sourceDocument: "IRS Publication 550, Wash Sales (IRC §1091)",
  effectiveYear: 2024,
  dateRetrieved: "2026-05-29",
};

interface Fields {
  stGain: number;
  stLoss: number;
  ltGain: number;
  ltLoss: number;
  ordinaryRatePct: number;
  longTermRatePct: number;
  mfs: boolean;
}

const EXAMPLE: Fields = {
  stGain: 0,
  stLoss: 4000,
  ltGain: 20000,
  ltLoss: 15000,
  ordinaryRatePct: 24,
  longTermRatePct: 15,
  mfs: false,
};

function readFields(p: URLSearchParams, profile: SituationStore): Fields {
  const mfsFromProfile = profile.get("filingStatus") === "married_separately";
  return {
    stGain: parseNonNegative(p.get("stg"), 0),
    stLoss: parseNonNegative(p.get("stl"), 0),
    ltGain: parseNonNegative(p.get("ltg"), 0),
    ltLoss: parseNonNegative(p.get("ltl"), 0),
    ordinaryRatePct: parseNonNegative(p.get("ord"), 24),
    longTermRatePct: parseNonNegative(p.get("lt"), 15),
    mfs: p.has("mfs") ? p.get("mfs") === "1" : mfsFromProfile,
  };
}

function writeFields(f: Fields): URLSearchParams {
  const p = new URLSearchParams();
  if (f.stGain > 0) p.set("stg", String(f.stGain));
  if (f.stLoss > 0) p.set("stl", String(f.stLoss));
  if (f.ltGain > 0) p.set("ltg", String(f.ltGain));
  if (f.ltLoss > 0) p.set("ltl", String(f.ltLoss));
  p.set("ord", String(f.ordinaryRatePct));
  p.set("lt", String(f.longTermRatePct));
  if (f.mfs) p.set("mfs", "1");
  return p;
}

export function mountTaxLossHarvesting(ctx: TileContext): void {
  const { root, profile } = ctx;
  root.replaceChildren();
  let fields = readFields(ctx.params, profile);

  const mkNum = (name: string, label: string, value: number, step: number): HTMLInputElement =>
    el("input", {
      type: "number",
      name,
      min: 0,
      step,
      value,
      attrs: { "aria-label": label, inputmode: "decimal" },
    });
  const stgInput = mkNum("stg", "Short-term gains realized", fields.stGain, 500);
  const stlInput = mkNum("stl", "Short-term losses to harvest", fields.stLoss, 500);
  const ltgInput = mkNum("ltg", "Long-term gains realized", fields.ltGain, 500);
  const ltlInput = mkNum("ltl", "Long-term losses to harvest", fields.ltLoss, 500);
  const ordInput = mkNum("ord", "Ordinary tax rate (percent)", fields.ordinaryRatePct, 1);
  const ltInput = mkNum("lt", "Long-term gains rate (percent)", fields.longTermRatePct, 1);
  const mfsInput = el("input", {
    type: "checkbox",
    name: "mfs",
    attrs: { "aria-label": "Married filing separately ($1,500 limit)" },
  });
  mfsInput.checked = fields.mfs;

  const resultContainer = el("div", { class: "tile-result", attrs: { "aria-live": "polite" } });

  function compute(): void {
    const limit = fields.mfs ? 1500 : 3000;
    const r = taxLossHarvest({
      shortTermGain: fields.stGain,
      shortTermLoss: fields.stLoss,
      longTermGain: fields.ltGain,
      longTermLoss: fields.ltLoss,
      ordinaryRatePct: fields.ordinaryRatePct,
      longTermRatePct: fields.longTermRatePct,
      ordinaryOffsetLimit: limit,
    });
    const fmt = (m: Money): string => m.format(ctx.locale);

    const lines: BreakdownLine[] = [
      { label: "Net short-term", value: fmt(r.netShortTerm) },
      { label: "Net long-term", value: fmt(r.netLongTerm) },
    ];
    if (r.taxableShortTermGain.greaterThan(0))
      lines.push({ label: "Taxable short-term gain", value: fmt(r.taxableShortTermGain) });
    if (r.taxableLongTermGain.greaterThan(0))
      lines.push({ label: "Taxable long-term gain", value: fmt(r.taxableLongTermGain) });
    if (r.netCapitalLoss.greaterThan(0)) {
      lines.push({ label: "Net capital loss", value: fmt(r.netCapitalLoss) });
      lines.push({
        label: `Offsets ordinary income (max ${fmt(Money.from(limit))})`,
        value: fmt(r.deductibleAgainstOrdinary),
        citation: LOSS_LIMIT_CITATION,
      });
      if (r.lossCarryforward.greaterThan(0))
        lines.push({ label: "Carries forward to next year", value: fmt(r.lossCarryforward) });
    }
    lines.push({
      label: "Estimated tax saved by harvesting",
      value: fmt(r.taxSaved),
      emphasis: true,
    });
    lines.push({
      label: "Watch the wash-sale rule",
      value:
        "Buying the same or a substantially identical security within 30 days before or after the sale disallows the loss.",
      citation: WASH_SALE_CITATION,
    });

    resultContainer.replaceChildren(
      resultCard({
        label: "Estimated tax saved by harvesting these losses",
        value: r.taxSaved,
        locale: ctx.locale,
        breakdown: lines,
        permalink: () => ctx.permalink(writeFields(fields)),
      }),
    );
  }

  function recompute(): void {
    fields = {
      stGain: parseNonNegative(stgInput.value, 0),
      stLoss: parseNonNegative(stlInput.value, 0),
      ltGain: parseNonNegative(ltgInput.value, 0),
      ltLoss: parseNonNegative(ltlInput.value, 0),
      ordinaryRatePct: parseNonNegative(ordInput.value, 24),
      longTermRatePct: parseNonNegative(ltInput.value, 15),
      mfs: mfsInput.checked,
    };
    ctx.setParams(writeFields(fields));
    compute();
  }

  for (const i of [stgInput, stlInput, ltgInput, ltlInput, ordInput, ltInput])
    i.addEventListener("input", recompute);
  mfsInput.addEventListener("change", recompute);

  const tryExample = tryExampleButton(() => {
    fields = { ...EXAMPLE };
    stgInput.value = String(fields.stGain);
    stlInput.value = String(fields.stLoss);
    ltgInput.value = String(fields.ltGain);
    ltlInput.value = String(fields.ltLoss);
    ordInput.value = String(fields.ordinaryRatePct);
    ltInput.value = String(fields.longTermRatePct);
    mfsInput.checked = fields.mfs;
    recompute();
  });

  const form = el(
    "form",
    { class: "tile-form", on: { submit: (e) => e.preventDefault() } },
    field("Short-term gains realized", stgInput),
    field("Short-term losses to harvest", stlInput),
    field("Long-term gains realized", ltgInput),
    field("Long-term losses to harvest", ltlInput),
    field("Your ordinary tax rate (%)", ordInput),
    field("Your long-term gains rate (%)", ltInput),
    field("Married filing separately ($1,500 limit)", mfsInput),
    el("div", { class: "tile-form-actions" }, tryExample),
  );

  root.append(form, resultContainer);
  compute();
}

export const taxLossHarvestingTile: TileDefinition = {
  id: "tax-loss-harvesting",
  title: "Tax-Loss Harvesting",
  pillar: "investing",
  description: "Turn investment losses into a tax saving, deterministically.",
  keywords: ["tax loss harvesting", "capital loss", "wash sale", "carryforward", "schedule d"],
  status: "ready",
  how: "Selling an investment at a loss lets that loss offset capital gains, and any leftover loss offsets up to $3,000 of ordinary income each year ($1,500 if married filing separately), with the rest carried forward to future years.\n\nWe net your short-term and long-term gains and losses the way Schedule D does (like characters net first, then a net loss in one bucket offsets a net gain in the other) and estimate the tax saved at the rates you enter. Watch the wash-sale rule: if you buy the same or a substantially identical security within 30 days before or after the sale, the loss is disallowed.",
  resources: [
    {
      label: "IRS Topic No. 409, Capital Gains and Losses",
      url: "https://www.irs.gov/taxtopics/tc409",
    },
    { label: "IRS Publication 550", url: "https://www.irs.gov/publications/p550" },
  ],
  mount: mountTaxLossHarvesting,
};
