/**
 * Auto Loan & True Cost of Credit tile (BUILD-SPEC.md §3.3): the monthly
 * payment, the total of payments, and the true cost of credit (every dollar of
 * interest), plus the effective annual rate the APR works out to once it
 * compounds monthly. The rate is the loan's own terms, so nothing to cite.
 */
import { Money } from "../engine/money";
import { amortizationSummary } from "../engine/finance";
import { el } from "../ui/dom";
import { field, parseNonNegative, parseNumber, pct, tryExampleButton } from "../ui/form";
import { resultCard, type BreakdownLine } from "../ui/resultCard";
import type { TileContext, TileDefinition } from "./types";

interface Fields {
  amount: number;
  aprPct: number;
  termYears: number;
  /** Fees / taxes rolled into the financed amount (optional). */
  fees: number;
}

const EXAMPLE: Fields = { amount: 32000, aprPct: 7.5, termYears: 6, fees: 1500 };

function readFields(p: URLSearchParams): Fields {
  return {
    amount: parseNonNegative(p.get("a"), 0),
    aprPct: parseNumber(p.get("apr"), 7.5),
    termYears: Math.max(1, parseNonNegative(p.get("y"), 6)),
    fees: parseNonNegative(p.get("f"), 0),
  };
}

function writeFields(f: Fields): URLSearchParams {
  const p = new URLSearchParams();
  p.set("a", String(f.amount));
  p.set("apr", String(f.aprPct));
  p.set("y", String(f.termYears));
  if (f.fees > 0) p.set("f", String(f.fees));
  return p;
}

/** Effective annual rate an APR compounds to monthly: (1 + apr/12)^12 − 1. */
function effectiveAnnualRate(aprPct: number): number {
  return Math.pow(1 + aprPct / 100 / 12, 12) - 1;
}

export function mountAutoLoan(ctx: TileContext): void {
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
  const aInput = num("a", fields.amount, "Vehicle price or amount financed", 500);
  const aprInput = num("apr", fields.aprPct, "Annual percentage rate", 0.25);
  const yInput = num("y", fields.termYears, "Term in years", 1);
  const fInput = num("f", fields.fees, "Fees and taxes financed", 100);

  const resultContainer = el("div", { class: "tile-result", attrs: { "aria-live": "polite" } });

  function compute(): void {
    const principal = fields.amount + fields.fees;
    const r = amortizationSummary({
      principal,
      annualRatePct: fields.aprPct,
      termYears: fields.termYears,
      extraMonthly: 0,
    });
    const fmt = (m: Money): string => m.format(ctx.locale);

    const lines: BreakdownLine[] = [
      { label: "Amount financed", value: fmt(Money.from(principal)) },
      { label: "Monthly payment", value: fmt(r.scheduledPayment), emphasis: true },
      { label: "Total of payments", value: fmt(r.totalPaid) },
      { label: "True cost of credit (interest)", value: fmt(r.totalInterest) },
      { label: "Effective annual rate", value: pct(effectiveAnnualRate(fields.aprPct)) },
    ];

    resultContainer.replaceChildren(
      resultCard({
        label: "Monthly payment",
        value: r.scheduledPayment,
        locale: ctx.locale,
        breakdown: lines,
        permalink: () => ctx.permalink(writeFields(fields)),
      }),
    );
  }

  function collect(): void {
    fields = {
      amount: parseNonNegative(aInput.value, 0),
      aprPct: parseNumber(aprInput.value, 7.5),
      termYears: Math.max(1, parseNonNegative(yInput.value, 6)),
      fees: parseNonNegative(fInput.value, 0),
    };
  }

  function recompute(): void {
    collect();
    ctx.setParams(writeFields(fields));
    compute();
  }

  for (const i of [aInput, aprInput, yInput, fInput]) i.addEventListener("input", recompute);

  const tryExample = tryExampleButton(() => {
    fields = { ...EXAMPLE };
    aInput.value = String(fields.amount);
    aprInput.value = String(fields.aprPct);
    yInput.value = String(fields.termYears);
    fInput.value = String(fields.fees);
    recompute();
  });

  const form = el(
    "form",
    { class: "tile-form", on: { submit: (e) => e.preventDefault() } },
    field("Vehicle price / amount", aInput),
    field("APR (%)", aprInput),
    field("Term (years)", yInput),
    field("Fees & taxes financed", fInput),
    el("div", { class: "tile-form-actions" }, tryExample),
  );

  root.append(form, resultContainer);
  compute();
}

export const autoLoanTile: TileDefinition = {
  id: "auto-loan",
  title: "Auto Loan & True Cost of Credit",
  pillar: "debt",
  description: "APR to nominal rate and the real cost of borrowing.",
  keywords: ["auto loan", "car", "apr", "credit", "interest", "true cost"],
  status: "ready",
  how: "We amortize the amount you finance (the price plus any fees and taxes you roll in) at your APR over the term, the same exact month-by-month schedule a lender uses. That gives your monthly payment, the total of all payments, and the true cost of credit, every dollar of interest you'll pay on top of what you borrowed.\n\nThe APR is a yearly rate that's charged monthly, so it quietly compounds to a slightly higher effective annual rate, which we show too. These are your own loan terms, so there's no rule to cite, just the arithmetic.",
  resources: [
    {
      label: "CFPB, auto loans",
      url: "https://www.consumerfinance.gov/consumer-tools/auto-loans/",
    },
    {
      label: "CFPB, what is APR?",
      url: "https://www.consumerfinance.gov/ask-cfpb/what-is-the-difference-between-a-mortgage-interest-rate-and-an-apr-en-135/",
    },
  ],
  mount: mountAutoLoan,
};
