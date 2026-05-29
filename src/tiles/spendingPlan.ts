/**
 * 50/30/20 Spending Plan tile (BUILD-SPEC-2 §6.1). Splits monthly take-home into
 * needs, wants, and savings using a chosen framework. The split is a popular
 * starting guideline, not a rule — shown as a clearly-labeled assumption the
 * user can change (there is no external source to cite, like Compound Growth).
 */
import { Money } from "../engine/money";
import { el } from "../ui/dom";
import { field, parseNonNegative, pct, tryExampleButton } from "../ui/form";
import { resultCard, type BreakdownLine } from "../ui/resultCard";
import type { TileContext, TileDefinition } from "./types";

interface Fields {
  monthlyTakeHome: number;
  needsPct: number;
  wantsPct: number;
}

const EXAMPLE: Fields = { monthlyTakeHome: 5000, needsPct: 50, wantsPct: 30 };

const PRESETS: { label: string; needs: number; wants: number }[] = [
  { label: "50 / 30 / 20", needs: 50, wants: 30 },
  { label: "60 / 20 / 20", needs: 60, wants: 20 },
  { label: "70 / 20 / 10", needs: 70, wants: 20 },
];

/** Savings is whatever is left after needs and wants, never negative. */
function savingsPctOf(needsPct: number, wantsPct: number): number {
  return Math.max(0, 100 - needsPct - wantsPct);
}

function readFields(p: URLSearchParams): Fields {
  const needsPct = Math.min(100, parseNonNegative(p.get("n"), 50));
  const wantsPct = Math.min(100 - needsPct, parseNonNegative(p.get("w"), 30));
  return {
    monthlyTakeHome: parseNonNegative(p.get("th"), 0),
    needsPct,
    wantsPct,
  };
}

function writeFields(f: Fields): URLSearchParams {
  const p = new URLSearchParams();
  p.set("th", String(f.monthlyTakeHome));
  if (f.needsPct !== 50) p.set("n", String(f.needsPct));
  if (f.wantsPct !== 30) p.set("w", String(f.wantsPct));
  return p;
}

export function mountSpendingPlan(ctx: TileContext): void {
  const { root } = ctx;
  root.replaceChildren();
  let fields = readFields(ctx.params);

  const thInput = el("input", {
    type: "number",
    name: "th",
    min: 0,
    step: 100,
    value: fields.monthlyTakeHome,
    attrs: { "aria-label": "Monthly take-home pay", inputmode: "decimal" },
  });
  const needsInput = el("input", {
    type: "number",
    name: "n",
    min: 0,
    max: 100,
    step: 1,
    value: fields.needsPct,
    attrs: { "aria-label": "Needs percentage", inputmode: "decimal" },
  });
  const wantsInput = el("input", {
    type: "number",
    name: "w",
    min: 0,
    max: 100,
    step: 1,
    value: fields.wantsPct,
    attrs: { "aria-label": "Wants percentage", inputmode: "decimal" },
  });

  const resultContainer = el("div", { class: "tile-result", attrs: { "aria-live": "polite" } });

  function compute(): void {
    const savingsPct = savingsPctOf(fields.needsPct, fields.wantsPct);
    const th = Money.from(fields.monthlyTakeHome);
    const needs = th.multiply(fields.needsPct / 100);
    const wants = th.multiply(fields.wantsPct / 100);
    const savings = th.multiply(savingsPct / 100);
    const fmt = (m: Money): string => m.format(ctx.locale);

    const lines: BreakdownLine[] = [
      { label: `Needs (${pct(fields.needsPct / 100, 0)})`, value: fmt(needs) },
      { label: `Wants (${pct(fields.wantsPct / 100, 0)})`, value: fmt(wants) },
      {
        label: `Savings & debt payoff (${pct(savingsPct / 100, 0)})`,
        value: fmt(savings),
        emphasis: true,
      },
      { label: "Savings per year", value: fmt(savings.multiply(12)) },
      { label: "Framework", value: "A popular starting point — adjust the split to fit you." },
    ];

    resultContainer.replaceChildren(
      resultCard({
        label: "Monthly take-home, allocated",
        value: th,
        locale: ctx.locale,
        breakdown: lines,
        permalink: () => ctx.permalink(writeFields(fields)),
      }),
    );
  }

  function collect(): void {
    const needsPct = Math.min(100, parseNonNegative(needsInput.value, 50));
    const wantsPct = Math.min(100 - needsPct, parseNonNegative(wantsInput.value, 30));
    fields = {
      monthlyTakeHome: parseNonNegative(thInput.value, 0),
      needsPct,
      wantsPct,
    };
    // Reflect any clamping back into the inputs.
    if (Number(needsInput.value) !== needsPct) needsInput.value = String(needsPct);
    if (Number(wantsInput.value) !== wantsPct) wantsInput.value = String(wantsPct);
  }

  function recompute(): void {
    collect();
    ctx.setParams(writeFields(fields));
    compute();
  }

  for (const i of [thInput, needsInput, wantsInput]) i.addEventListener("input", recompute);

  const presetButtons = PRESETS.map((preset) =>
    el("button", {
      type: "button",
      class: "btn btn--ghost",
      text: preset.label,
      attrs: { "aria-label": `Use the ${preset.label} split` },
      on: {
        click: () => {
          fields = { ...fields, needsPct: preset.needs, wantsPct: preset.wants };
          needsInput.value = String(preset.needs);
          wantsInput.value = String(preset.wants);
          recompute();
        },
      },
    }),
  );

  const tryExample = tryExampleButton(() => {
    fields = { ...EXAMPLE };
    thInput.value = String(fields.monthlyTakeHome);
    needsInput.value = String(fields.needsPct);
    wantsInput.value = String(fields.wantsPct);
    recompute();
  });

  const form = el(
    "form",
    { class: "tile-form", on: { submit: (e) => e.preventDefault() } },
    field("Monthly take-home pay", thInput),
    field("Needs (%)", needsInput),
    field("Wants (%)", wantsInput),
    el("div", { class: "field-group-label", text: "Quick splits" }),
    el("div", { class: "tile-form-actions" }, ...presetButtons),
    el("div", { class: "tile-form-actions" }, tryExample),
  );

  root.append(form, resultContainer);
  compute();
}

export const spendingPlanTile: TileDefinition = {
  id: "spending-plan",
  title: "50/30/20 Spending Plan",
  pillar: "take-home",
  description: "Split your take-home into needs, wants, and savings.",
  keywords: ["budget", "50/30/20", "spending plan", "needs wants savings", "cash flow"],
  status: "ready",
  mount: mountSpendingPlan,
};
