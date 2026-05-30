/**
 * Loan & Mortgage Amortization tile (BUILD-SPEC.md §3.3): the scheduled monthly
 * payment, the full-term interest, and an extra-payment what-if showing the
 * interest and the time saved. The rate is the loan's own terms, so there is no
 * external rule to cite — the tile shows the math from the user's numbers.
 */
import { Money } from "../engine/money";
import { amortizationSummary } from "../engine/finance";
import { el } from "../ui/dom";
import { field, parseNonNegative, parseNumber, tryExampleButton } from "../ui/form";
import { resultCard, type BreakdownLine } from "../ui/resultCard";
import type { TileContext, TileDefinition } from "./types";

interface Fields {
  principal: number;
  ratePct: number;
  termYears: number;
  extraMonthly: number;
}

const EXAMPLE: Fields = { principal: 320000, ratePct: 6.5, termYears: 30, extraMonthly: 200 };

/** Human-friendly "X yr Y mo" from a whole number of months. */
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
    principal: parseNonNegative(p.get("p"), 0),
    ratePct: parseNumber(p.get("r"), 6.5),
    termYears: Math.max(1, parseNonNegative(p.get("y"), 30)),
    extraMonthly: parseNonNegative(p.get("x"), 0),
  };
}

function writeFields(f: Fields): URLSearchParams {
  const p = new URLSearchParams();
  p.set("p", String(f.principal));
  p.set("r", String(f.ratePct));
  p.set("y", String(f.termYears));
  if (f.extraMonthly > 0) p.set("x", String(f.extraMonthly));
  return p;
}

export function mountLoanAmortization(ctx: TileContext): void {
  const { root } = ctx;
  root.replaceChildren();
  let fields = readFields(ctx.params);

  const pInput = el("input", {
    type: "number",
    name: "p",
    min: 0,
    step: 1000,
    value: fields.principal,
    attrs: { "aria-label": "Loan amount", inputmode: "decimal" },
  });
  const rInput = el("input", {
    type: "number",
    name: "r",
    min: 0,
    step: 0.125,
    value: fields.ratePct,
    attrs: { "aria-label": "Annual interest rate (percent)", inputmode: "decimal" },
  });
  const yInput = el("input", {
    type: "number",
    name: "y",
    min: 1,
    step: 1,
    value: fields.termYears,
    attrs: { "aria-label": "Term in years", inputmode: "decimal" },
  });
  const xInput = el("input", {
    type: "number",
    name: "x",
    min: 0,
    step: 50,
    value: fields.extraMonthly,
    attrs: { "aria-label": "Extra payment each month", inputmode: "decimal" },
  });

  const resultContainer = el("div", { class: "tile-result", attrs: { "aria-live": "polite" } });

  function compute(): void {
    const r = amortizationSummary({
      principal: fields.principal,
      annualRatePct: fields.ratePct,
      termYears: fields.termYears,
      extraMonthly: fields.extraMonthly,
    });
    const fmt = (m: Money): string => m.format(ctx.locale);
    const hasExtra = fields.extraMonthly > 0;

    const lines: BreakdownLine[] = [
      { label: "Scheduled monthly payment", value: fmt(r.scheduledPayment), emphasis: true },
    ];
    if (hasExtra) {
      lines.push({
        label: "Total monthly payment (with extra)",
        value: fmt(r.scheduledPayment.add(fields.extraMonthly)),
      });
    }
    lines.push(
      { label: "Payoff time", value: formatTerm(r.payoffMonths) },
      { label: "Total interest", value: fmt(r.totalInterest) },
      { label: "Total paid", value: fmt(r.totalPaid) },
    );
    if (hasExtra) {
      lines.push(
        { label: "Interest saved by the extra payment", value: fmt(r.interestSaved) },
        { label: "Time saved", value: formatTerm(r.monthsSaved) },
      );
    }

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
      principal: parseNonNegative(pInput.value, 0),
      ratePct: parseNumber(rInput.value, 6.5),
      termYears: Math.max(1, parseNonNegative(yInput.value, 30)),
      extraMonthly: parseNonNegative(xInput.value, 0),
    };
  }

  function recompute(): void {
    collect();
    ctx.setParams(writeFields(fields));
    compute();
  }

  for (const i of [pInput, rInput, yInput, xInput]) i.addEventListener("input", recompute);

  const tryExample = tryExampleButton(() => {
    fields = { ...EXAMPLE };
    pInput.value = String(fields.principal);
    rInput.value = String(fields.ratePct);
    yInput.value = String(fields.termYears);
    xInput.value = String(fields.extraMonthly);
    recompute();
  });

  const form = el(
    "form",
    { class: "tile-form", on: { submit: (e) => e.preventDefault() } },
    field("Loan amount", pInput),
    field("Annual rate (%)", rInput),
    field("Term (years)", yInput),
    field("Extra payment / month", xInput),
    el("div", { class: "tile-form-actions" }, tryExample),
  );

  root.append(form, resultContainer);
  compute();
}

export const loanAmortizationTile: TileDefinition = {
  id: "loan-amortization",
  title: "Loan & Mortgage Amortization",
  pillar: "debt",
  description: "Full schedule with extra-payment what-ifs.",
  keywords: ["loan", "mortgage", "amortization", "schedule", "payment", "extra"],
  status: "ready",
  how: "Your scheduled payment is the level amount that pays the loan to zero over its term: each month interest is charged on the remaining balance and the rest of the payment chips away at principal. We total the interest you pay across the whole loan from that exact month-by-month schedule.\n\nPaying a little extra each month goes straight to principal, so the balance falls faster and less interest accrues. We run the same schedule with your extra payment to show how much interest and how many months it saves. The rate is your loan's own terms, so there is no rule to cite, just the arithmetic.",
  resources: [
    { label: "CFPB, mortgages", url: "https://www.consumerfinance.gov/owning-a-home/" },
    {
      label: "CFPB, paying extra on your mortgage",
      url: "https://www.consumerfinance.gov/ask-cfpb/what-is-amortization-en-103/",
    },
  ],
  mount: mountLoanAmortization,
};
