/**
 * When PMI Ends, the interactive half (SPEC-5 Phase 28). Loaded on first use
 * with its shard; the definition in `pmiEndDate.ts` stays in the shell.
 */
import { Money } from "../engine/money";
import { pmiEndDates, type PmiMilestone } from "../engine/pmi";
import { el } from "../ui/dom";
import { field, parseNonNegative, parseNumber, tryExampleButton } from "../ui/form";
import { resultCard, type BreakdownLine } from "../ui/resultCard";
import type { TileContext } from "./types";

interface Fields {
  originalValue: number;
  loanAmount: number;
  ratePct: number;
  termYears: number;
  extraMonthly: number;
  /** "YYYY-MM", or "" when the reader has not said. */
  firstPayment: string;
}

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

/** "YYYY-MM" for a year and a month, as the month input holds it. */
function monthKey(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, "0")}`;
}

const EXAMPLE: Fields = {
  originalValue: 400000,
  loanAmount: 360000,
  ratePct: 6.5,
  termYears: 30,
  extraMonthly: 200,
  firstPayment: monthKey(2026, 12),
};

function readFields(p: URLSearchParams): Fields {
  const fp = p.get("fp") ?? "";
  return {
    originalValue: parseNonNegative(p.get("v"), 0),
    loanAmount: parseNonNegative(p.get("p"), 0),
    ratePct: parseNumber(p.get("r"), 6.5),
    termYears: Math.min(40, Math.max(1, Math.round(parseNonNegative(p.get("y"), 30)))),
    extraMonthly: parseNonNegative(p.get("x"), 0),
    firstPayment: MONTH.test(fp) ? fp : "",
  };
}

function writeFields(f: Fields): URLSearchParams {
  const p = new URLSearchParams();
  p.set("v", String(f.originalValue));
  p.set("p", String(f.loanAmount));
  p.set("r", String(f.ratePct));
  p.set("y", String(f.termYears));
  if (f.extraMonthly > 0) p.set("x", String(f.extraMonthly));
  if (f.firstPayment) p.set("fp", f.firstPayment);
  return p;
}

/** "7 yr 2 mo" for a count of payments. */
function formatTerm(months: number): string {
  const yrs = Math.floor(months / 12);
  const mos = months % 12;
  const parts: string[] = [];
  if (yrs > 0) parts.push(`${yrs} yr`);
  if (mos > 0 || yrs === 0) parts.push(`${mos} mo`);
  return parts.join(" ");
}

/** The calendar month of payment `n`, counting the first payment as 1. */
export function paymentMonth(firstPayment: string, n: number, locale: string): string {
  const [y, m] = firstPayment.split("-").map(Number) as [number, number];
  const index = y * 12 + (m - 1) + (n - 1);
  return new Intl.DateTimeFormat(locale, {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(Math.floor(index / 12), index % 12, 1)));
}

export function mountPmiEndDate(ctx: TileContext): void {
  const { root, data } = ctx;
  root.replaceChildren();
  const rules = data?.pmiCancellation();
  if (!rules) {
    root.append(
      el("div", {
        class: "verify-banner",
        attrs: { role: "alert" },
        text: "The cancellation rules are unavailable, so no dates are given. Your closing papers state both dates, and your servicer can confirm them.",
      }),
    );
    return;
  }
  let fields = readFields(ctx.params);

  const input = (name: string, label: string, value: number, step: number): HTMLInputElement =>
    el("input", {
      type: "number",
      name,
      min: 0,
      step,
      value,
      attrs: { "aria-label": label, inputmode: "decimal" },
    });
  const vInput = input("v", "Original value of the home", fields.originalValue, 1000);
  const pInput = input("p", "Amount borrowed", fields.loanAmount, 1000);
  const rInput = input("r", "Annual interest rate (percent)", fields.ratePct, 0.125);
  const yInput = input("y", "Term in years", fields.termYears, 1);
  const xInput = input("x", "Extra principal each month", fields.extraMonthly, 50);
  const fpInput = el("input", {
    type: "month",
    name: "fp",
    value: fields.firstPayment,
    attrs: { "aria-label": "Month of your first payment" },
  });

  const resultContainer = el("div", { class: "tile-result", attrs: { "aria-live": "polite" } });

  function compute(): void {
    const r = pmiEndDates({
      originalValue: fields.originalValue,
      loanAmount: fields.loanAmount,
      annualRatePct: fields.ratePct,
      termYears: fields.termYears,
      extraMonthly: fields.extraMonthly,
      requestShare: rules!.requestShareOfOriginalValue,
      automaticShare: rules!.automaticShareOfOriginalValue,
    });
    const fmt = (m: Money): string => m.format(ctx.locale);
    const pct = (share: number): string =>
      new Intl.NumberFormat(ctx.locale, { style: "percent", maximumFractionDigits: 1 }).format(
        share,
      );
    const when = (m: PmiMilestone | null): string =>
      m === null
        ? "not before the loan is paid off"
        : `payment ${m.payment}, ${formatTerm(m.payment)} in` +
          (fields.firstPayment
            ? ` (${paymentMonth(fields.firstPayment, m.payment, ctx.locale)})`
            : "");
    const cite = rules!.citation;

    if (fields.originalValue <= 0 || fields.loanAmount <= 0) {
      resultContainer.replaceChildren(
        el("p", {
          class: "pmi-empty",
          text: "Enter the home's original value and the amount you borrowed to see the dates.",
        }),
      );
      return;
    }
    if (r.atOrUnderRequestLine) {
      resultContainer.replaceChildren(
        el("p", {
          class: "pmi-none",
          text: `You borrowed ${pct(r.startingShare)} of the original value, which is already at or under the ${pct(rules!.requestShareOfOriginalValue)} line, so a lender would not usually require private mortgage insurance on this loan. If yours does, ask your servicer in writing why.`,
        }),
      );
      return;
    }

    const lines: BreakdownLine[] = [
      {
        label: "You borrowed, as a share of the original value",
        value: pct(r.startingShare),
      },
      {
        label: `You can ask to cancel: balance scheduled to reach ${fmt(r.requestLine)} (${pct(rules!.requestShareOfOriginalValue)})`,
        value: when(r.request),
        citation: cite,
      },
    ];
    if (r.requestWithExtra)
      lines.push({
        label: `With ${fmt(Money.from(fields.extraMonthly))} extra principal a month, you reach it at`,
        value: when(r.requestWithExtra),
        citation: cite,
      });
    lines.push(
      {
        label: `It ends on its own: balance scheduled to reach ${fmt(r.automaticLine)} (${pct(rules!.automaticShareOfOriginalValue)})`,
        value: when(r.automatic),
        emphasis: true,
        citation: cite,
      },
      {
        label: "The final cutoff, the month after the loan's midpoint",
        value: when(r.final),
        citation: cite,
      },
    );

    const months = r.automatic?.payment ?? r.final.payment;
    resultContainer.replaceChildren(
      resultCard({
        label: "Private mortgage insurance ends on its own after",
        value: Money.from(months),
        format: (n) => formatTerm(Math.round(n)),
        copyText: formatTerm(months),
        locale: ctx.locale,
        breakdown: lines,
        permalink: () => ctx.permalink(writeFields(fields)),
      }),
      el("p", {
        class: "pmi-note",
        text: "Extra principal moves only the date you can ask. The automatic date and the final cutoff are read off the original schedule, so paying ahead never delays them and never brings them forward. To cancel at the earlier date you must ask your servicer in writing, be current, have no payment 30 days late in the past year or 60 days late in the year before, and, if asked, show the home is worth at least its original value and has no second mortgage.",
      }),
    );
  }

  function recompute(): void {
    fields = {
      originalValue: parseNonNegative(vInput.value, 0),
      loanAmount: parseNonNegative(pInput.value, 0),
      ratePct: parseNumber(rInput.value, 6.5),
      termYears: Math.min(40, Math.max(1, Math.round(parseNonNegative(yInput.value, 30)))),
      extraMonthly: parseNonNegative(xInput.value, 0),
      firstPayment: MONTH.test(fpInput.value) ? fpInput.value : "",
    };
    ctx.setParams(writeFields(fields));
    compute();
  }

  for (const i of [vInput, pInput, rInput, yInput, xInput, fpInput])
    i.addEventListener("input", recompute);

  const tryExample = tryExampleButton(() => {
    fields = { ...EXAMPLE };
    vInput.value = String(fields.originalValue);
    pInput.value = String(fields.loanAmount);
    rInput.value = String(fields.ratePct);
    yInput.value = String(fields.termYears);
    xInput.value = String(fields.extraMonthly);
    fpInput.value = fields.firstPayment;
    recompute();
  });

  root.append(
    el(
      "form",
      { class: "tile-form", on: { submit: (e) => e.preventDefault() } },
      field("Original value (the lower of the price and the appraisal)", vInput),
      field("Amount borrowed", pInput),
      field("Annual rate (%)", rInput),
      field("Term (years)", yInput),
      field("Extra principal / month", xInput),
      field("First payment (month, optional)", fpInput),
      el("div", { class: "tile-form-actions" }, tryExample),
    ),
    resultContainer,
  );
  compute();
}
