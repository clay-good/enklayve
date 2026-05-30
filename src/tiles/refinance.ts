/**
 * Refinance Break-Even tile (BUILD-SPEC.md §3.3): compare your current loan to a
 * proposed new one and see how many months of monthly savings it takes to
 * recoup the closing costs. The rate is the loan's own terms, so there is no
 * external rule to cite — the tile shows the math from the user's numbers.
 */
import { Money } from "../engine/money";
import { refinanceBreakEven } from "../engine/finance";
import { el } from "../ui/dom";
import { field, parseNonNegative, parseNumber, tryExampleButton } from "../ui/form";
import { resultCard, type BreakdownLine } from "../ui/resultCard";
import type { TileContext, TileDefinition } from "./types";

interface Fields {
  balance: number;
  currentRatePct: number;
  currentRemainingYears: number;
  newRatePct: number;
  newTermYears: number;
  closingCosts: number;
}

const EXAMPLE: Fields = {
  balance: 300000,
  currentRatePct: 7,
  currentRemainingYears: 27,
  newRatePct: 5.5,
  newTermYears: 30,
  closingCosts: 6000,
};

/** "X yr Y mo" from a whole number of months. */
function formatTerm(months: number): string {
  const yrs = Math.floor(months / 12);
  const mos = months % 12;
  const parts: string[] = [];
  if (yrs > 0) parts.push(`${yrs} yr`);
  if (mos > 0 || yrs === 0) parts.push(`${mos} mo`);
  return parts.join(" ");
}

function readFields(p: URLSearchParams): Fields {
  return {
    balance: parseNonNegative(p.get("b"), 0),
    currentRatePct: parseNumber(p.get("cr"), 7),
    currentRemainingYears: Math.max(1, parseNonNegative(p.get("cy"), 27)),
    newRatePct: parseNumber(p.get("nr"), 5.5),
    newTermYears: Math.max(1, parseNonNegative(p.get("ny"), 30)),
    closingCosts: parseNonNegative(p.get("cc"), 0),
  };
}

function writeFields(f: Fields): URLSearchParams {
  const p = new URLSearchParams();
  p.set("b", String(f.balance));
  p.set("cr", String(f.currentRatePct));
  p.set("cy", String(f.currentRemainingYears));
  p.set("nr", String(f.newRatePct));
  p.set("ny", String(f.newTermYears));
  if (f.closingCosts > 0) p.set("cc", String(f.closingCosts));
  return p;
}

export function mountRefinance(ctx: TileContext): void {
  const { root } = ctx;
  root.replaceChildren();
  let fields = readFields(ctx.params);

  const num = (name: string, value: number, label: string, step: number): HTMLInputElement =>
    el("input", {
      type: "number",
      name,
      min: 0,
      step,
      value,
      attrs: { "aria-label": label, inputmode: "decimal" },
    });
  const bInput = num("b", fields.balance, "Current loan balance", 1000);
  const crInput = num("cr", fields.currentRatePct, "Current rate (percent)", 0.125);
  const cyInput = num("cy", fields.currentRemainingYears, "Years remaining on current loan", 1);
  const nrInput = num("nr", fields.newRatePct, "New rate (percent)", 0.125);
  const nyInput = num("ny", fields.newTermYears, "New loan term in years", 1);
  const ccInput = num("cc", fields.closingCosts, "Closing costs", 100);

  const resultContainer = el("div", { class: "tile-result", attrs: { "aria-live": "polite" } });

  function compute(): void {
    const r = refinanceBreakEven(fields);
    const fmt = (m: Money): string => m.format(ctx.locale);
    const worthwhile = r.breakEvenMonths !== null;

    const lines: BreakdownLine[] = [
      { label: "Current monthly payment", value: fmt(r.currentPayment) },
      { label: "New monthly payment", value: fmt(r.newPayment) },
      {
        label: worthwhile ? "Monthly savings" : "Monthly change",
        value: fmt(r.monthlySavings),
        emphasis: true,
      },
      { label: "Interest left on current loan", value: fmt(r.currentRemainingInterest) },
      { label: "Interest over new loan", value: fmt(r.newTotalInterest) },
    ];

    // Headline: the break-even point in months (or zero when there's nothing to
    // recoup). We render it as a duration via the result card's format hook.
    const headlineMonths = r.breakEvenMonths ?? 0;
    resultContainer.replaceChildren(
      resultCard({
        label: worthwhile ? "Break-even point" : "No break-even at this rate",
        value: Money.from(headlineMonths),
        locale: ctx.locale,
        format: (n) => formatTerm(Math.round(n)),
        copyText: worthwhile ? formatTerm(headlineMonths) : "No break-even",
        breakdown: lines,
        permalink: () => ctx.permalink(writeFields(fields)),
      }),
    );

    if (!worthwhile) {
      resultContainer.append(
        el("p", {
          class: "readout-note",
          text: "The new payment isn't lower, so the closing costs are never recouped from monthly savings. A shorter term can still cut total interest.",
        }),
      );
    }
  }

  function collect(): void {
    fields = {
      balance: parseNonNegative(bInput.value, 0),
      currentRatePct: parseNumber(crInput.value, 7),
      currentRemainingYears: Math.max(1, parseNonNegative(cyInput.value, 27)),
      newRatePct: parseNumber(nrInput.value, 5.5),
      newTermYears: Math.max(1, parseNonNegative(nyInput.value, 30)),
      closingCosts: parseNonNegative(ccInput.value, 0),
    };
  }

  function recompute(): void {
    collect();
    ctx.setParams(writeFields(fields));
    compute();
  }

  for (const i of [bInput, crInput, cyInput, nrInput, nyInput, ccInput]) {
    i.addEventListener("input", recompute);
  }

  const tryExample = tryExampleButton(() => {
    fields = { ...EXAMPLE };
    bInput.value = String(fields.balance);
    crInput.value = String(fields.currentRatePct);
    cyInput.value = String(fields.currentRemainingYears);
    nrInput.value = String(fields.newRatePct);
    nyInput.value = String(fields.newTermYears);
    ccInput.value = String(fields.closingCosts);
    recompute();
  });

  const form = el(
    "form",
    { class: "tile-form", on: { submit: (e) => e.preventDefault() } },
    field("Current balance", bInput),
    field("Current rate (%)", crInput),
    field("Years left on current loan", cyInput),
    field("New rate (%)", nrInput),
    field("New term (years)", nyInput),
    field("Closing costs", ccInput),
    el("div", { class: "tile-form-actions" }, tryExample),
  );

  root.append(form, resultContainer);
  compute();
}

export const refinanceTile: TileDefinition = {
  id: "refinance",
  title: "Refinance Break-Even",
  pillar: "debt",
  description: "When refinancing pays for itself.",
  keywords: ["refinance", "break even", "mortgage", "closing costs", "rate"],
  status: "ready",
  how: "We figure your current monthly payment over the years you have left, and the payment on the new loan you're considering. The difference is your monthly saving. Dividing the closing costs by that saving tells you how many months it takes to come out ahead, your break-even point.\n\nIf you'll keep the loan past the break-even point, refinancing pays off. We also show the interest left on each loan so you can weigh a lower payment against stretching the term back out. These are your own loan terms, so there's no rule to cite, just the arithmetic.",
  resources: [
    {
      label: "CFPB, should I refinance?",
      url: "https://www.consumerfinance.gov/ask-cfpb/what-does-it-mean-to-refinance-my-mortgage-en-114/",
    },
    { label: "CFPB, owning a home", url: "https://www.consumerfinance.gov/owning-a-home/" },
  ],
  mount: mountRefinance,
};
