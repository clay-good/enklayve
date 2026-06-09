/**
 * Downshift Point tile (BUILD-SPEC.md §5.1) — the calm version of coast-FIRE:
 * the point after which you can stop adding savings and still arrive at My
 * Enough Number on schedule. Given a balance today and an assumed real return,
 * we project what it grows to by your target age with no further contributions,
 * and the "coast number" — the balance today that would coast exactly to the
 * target. The return is your assumption, clearly labeled; we never predict
 * markets (§2.1). Tone frames progress, never "behind" (§5.3).
 */
import { Money } from "../engine/money";
import { coastFireProjection } from "../engine/finance";
import { el } from "../ui/dom";
import {
  assumptionHint,
  field,
  parseNonNegative,
  parseNumber,
  pct,
  tryExampleButton,
} from "../ui/form";
import { resultCard, type BreakdownLine } from "../ui/resultCard";
import type { SituationStore } from "../profile/situation";
import type { TileContext, TileDefinition } from "./types";

/** Defensible band for the assumed real (after-inflation) return; outside it,
 *  a calm hint signposts a stress scenario (SPEC-3 §2.4). Never a clamp. */
const RETURN_BAND = { low: -15, high: 15, label: "Assumed real return" };

interface Fields {
  currentAge: number;
  targetAge: number;
  currentBalance: number;
  realReturnPct: number;
  /** My Enough Number — the balance to coast to. */
  target: number;
}

const EXAMPLE: Fields = {
  currentAge: 40,
  targetAge: 65,
  currentBalance: 150000,
  realReturnPct: 5,
  target: 1000000,
};

/** Default the Enough Number from essentials (annual essentials at a 4% rate). */
function enoughFromProfile(profile: SituationStore): number {
  const essential = profile.get("essentialMonthlyExpenses") ?? 0;
  return essential > 0 ? Math.round((essential * 12) / 0.04) : 0;
}

function readFields(p: URLSearchParams, profile: SituationStore): Fields {
  const ages = profile.get("ages") ?? [];
  return {
    currentAge: Math.max(0, Math.round(parseNonNegative(p.get("age"), ages[0] ?? 40))),
    targetAge: Math.max(1, Math.round(parseNonNegative(p.get("ret"), 65))),
    currentBalance: p.has("bal")
      ? parseNonNegative(p.get("bal"), 0)
      : (profile.get("liquidSavings") ?? 0),
    realReturnPct: parseNumber(p.get("r"), 5),
    target: p.has("t") ? parseNonNegative(p.get("t"), 0) : enoughFromProfile(profile),
  };
}

function writeFields(f: Fields): URLSearchParams {
  const p = new URLSearchParams();
  p.set("age", String(f.currentAge));
  p.set("ret", String(f.targetAge));
  p.set("bal", String(f.currentBalance));
  p.set("r", String(f.realReturnPct));
  p.set("t", String(f.target));
  return p;
}

export function mountDownshift(ctx: TileContext): void {
  const { root, profile } = ctx;
  root.replaceChildren();
  let fields = readFields(ctx.params, profile);

  const mkNum = (
    name: string,
    label: string,
    value: number,
    step: number,
    mode = "decimal",
  ): HTMLInputElement =>
    el("input", {
      type: "number",
      name,
      min: 0,
      step,
      value,
      attrs: { "aria-label": label, inputmode: mode },
    });
  const ageInput = mkNum("age", "Your current age", fields.currentAge, 1, "numeric");
  const retInput = mkNum("ret", "Target age", fields.targetAge, 1, "numeric");
  const balInput = mkNum("bal", "Invested balance today", fields.currentBalance, 1000);
  const rInput = mkNum("r", "Assumed real annual return (percent)", fields.realReturnPct, 0.25);
  const tInput = mkNum("t", "My Enough Number (target)", fields.target, 1000);

  const resultContainer = el("div", { class: "tile-result", attrs: { "aria-live": "polite" } });

  function compute(): void {
    resultContainer.replaceChildren();
    if (fields.target <= 0) {
      resultContainer.append(
        el("p", {
          class: "ph-empty",
          text: "Add your Enough Number (or your essential expenses in My Situation) to find your Downshift Point.",
        }),
      );
      return;
    }
    const years = Math.max(0, fields.targetAge - fields.currentAge);
    const r = coastFireProjection({
      currentBalance: fields.currentBalance,
      annualRealReturnPct: fields.realReturnPct,
      years,
      targetNumber: fields.target,
    });
    const fmt = (m: Money): string => m.format(ctx.locale);

    const status: BreakdownLine = r.reached
      ? {
          label: "Where you stand",
          value: `Reached: you could stop adding and still coast to ${fmt(Money.from(fields.target))} by age ${fields.targetAge}.`,
          emphasis: true,
        }
      : {
          label: "Where you stand",
          value: `${fmt(r.gap)} more invested today would put you at your Downshift Point. Every bit counts.`,
          emphasis: true,
        };

    const lines: BreakdownLine[] = [
      { label: "Years until your target age", value: `${years}` },
      {
        label: "Assumed real return",
        value: `${pct(fields.realReturnPct / 100)} (your assumption)`,
      },
      {
        label: `Projected balance at age ${fields.targetAge} if you stop saving now`,
        value: fmt(r.projected),
      },
      { label: "Coast number (invest this today, then you can stop)", value: fmt(r.coastNumber) },
      status,
    ];

    resultContainer.append(
      resultCard({
        label: "Your Downshift Point",
        value: r.coastNumber,
        locale: ctx.locale,
        breakdown: lines,
        permalink: () => ctx.permalink(writeFields(fields)),
      }),
    );
    const hint = assumptionHint(fields.realReturnPct, RETURN_BAND);
    if (hint) resultContainer.append(hint);
  }

  function recompute(): void {
    fields = {
      currentAge: Math.max(0, Math.round(parseNonNegative(ageInput.value, 40))),
      targetAge: Math.max(1, Math.round(parseNonNegative(retInput.value, 65))),
      currentBalance: parseNonNegative(balInput.value, 0),
      realReturnPct: parseNumber(rInput.value, 5),
      target: parseNonNegative(tInput.value, 0),
    };
    ctx.setParams(writeFields(fields));
    compute();
  }

  for (const i of [ageInput, retInput, balInput, rInput, tInput]) {
    i.addEventListener("input", recompute);
  }

  const tryExample = tryExampleButton(() => {
    fields = { ...EXAMPLE };
    ageInput.value = String(fields.currentAge);
    retInput.value = String(fields.targetAge);
    balInput.value = String(fields.currentBalance);
    rInput.value = String(fields.realReturnPct);
    tInput.value = String(fields.target);
    recompute();
  });

  const form = el(
    "form",
    { class: "tile-form", on: { submit: (e) => e.preventDefault() } },
    field("Your current age", ageInput),
    field("Target age", retInput),
    field("Invested balance today", balInput),
    field("Assumed real annual return (%)", rInput),
    field("My Enough Number (target)", tInput),
    el("div", { class: "tile-form-actions" }, tryExample),
  );

  root.append(form, resultContainer);
  compute();
}

export const downshiftTile: TileDefinition = {
  id: "downshift",
  title: "Downshift Point",
  pillar: "retirement",
  description: "When continued saving becomes optional.",
  keywords: ["coast fire", "downshift", "retirement", "coast", "optional", "enough"],
  status: "ready",
  how: "Your Downshift Point is the moment your invested savings are large enough that, left to grow on their own, they reach your Enough Number by your target age, so adding more becomes optional. We grow today's balance at the real (after-inflation) return you choose, with no further contributions, and compare it to your target. We also show the 'coast number': the balance today that would coast exactly to the target.\n\nThe return is your assumption, clearly labeled, never a forecast. Use a real return (e.g. 4–5%) so the target stays in today's dollars. This is about optionality, not pressure: reaching it means you could ease off, not that you must.",
  resources: [
    {
      label: "Investor.gov, compound interest",
      url: "https://www.investor.gov/financial-tools-calculators/calculators/compound-interest-calculator",
    },
    {
      label: "CFPB, planning for retirement",
      url: "https://www.consumerfinance.gov/consumer-tools/retirement/",
    },
  ],
  mount: mountDownshift,
};
