/**
 * Freedom Date tile (BUILD-SPEC.md §5.1) — debt payoff, reframed calmly: the
 * date your debts are gone. Deterministic month-by-month payoff at a fixed
 * payment (the engine's {@link debtPayoff}). Defaults pull the balance and a
 * balance-weighted rate from the debts in My Situation, so a number entered
 * once flows here. The full multi-debt snowball-vs-avalanche comparison is the
 * Debt Freedom Planner (debtFreedom.ts); this answers the single question
 * "when am I free?" for one balance.
 */
import { Money } from "../engine/money";
import { debtPayoff } from "../engine/finance";
import { el } from "../ui/dom";
import { field, parseNonNegative, parseNumber, pct, tryExampleButton } from "../ui/form";
import { resultCard, type BreakdownLine } from "../ui/resultCard";
import type { SituationStore } from "../profile/situation";
import type { TileContext, TileDefinition } from "./types";

interface Fields {
  balance: number;
  /** Annual interest rate as a percentage. */
  ratePct: number;
  monthlyPayment: number;
}

const EXAMPLE: Fields = { balance: 6000, ratePct: 22, monthlyPayment: 300 };

/** Profile defaults: total balance and a balance-weighted average rate. */
function profileDefaults(profile: SituationStore): { balance: number; ratePct: number } {
  const debts = profile.get("debts") ?? [];
  const balance = debts.reduce((s, d) => s + d.balance, 0);
  const weighted = balance > 0 ? debts.reduce((s, d) => s + d.balance * d.ratePct, 0) / balance : 0;
  return { balance, ratePct: Math.round(weighted * 100) / 100 };
}

function readFields(p: URLSearchParams, profile: SituationStore): Fields {
  const d = profileDefaults(profile);
  return {
    balance: p.has("b") ? parseNonNegative(p.get("b"), 0) : d.balance,
    ratePct: p.has("r") ? parseNumber(p.get("r"), 0) : d.ratePct,
    monthlyPayment: parseNonNegative(p.get("pay"), 0),
  };
}

function writeFields(f: Fields): URLSearchParams {
  const p = new URLSearchParams();
  p.set("b", String(f.balance));
  p.set("r", String(f.ratePct));
  p.set("pay", String(f.monthlyPayment));
  return p;
}

function freedomDateLabel(monthsAhead: number, locale: string): string {
  const d = new Date();
  d.setMonth(d.getMonth() + monthsAhead);
  return d.toLocaleDateString(locale, { month: "long", year: "numeric" });
}

export function mountFreedomDate(ctx: TileContext): void {
  const { root, profile } = ctx;
  root.replaceChildren();
  let fields = readFields(ctx.params, profile);

  const balanceInput = el("input", {
    type: "number",
    name: "b",
    min: 0,
    step: 100,
    value: fields.balance,
    attrs: { "aria-label": "Debt balance", inputmode: "decimal" },
  });
  const rateInput = el("input", {
    type: "number",
    name: "r",
    min: 0,
    step: 0.25,
    value: fields.ratePct,
    attrs: { "aria-label": "Annual interest rate (percent)", inputmode: "decimal" },
  });
  const paymentInput = el("input", {
    type: "number",
    name: "pay",
    min: 0,
    step: 25,
    value: fields.monthlyPayment,
    attrs: { "aria-label": "Monthly payment", inputmode: "decimal" },
  });

  const resultContainer = el("div", { class: "tile-result", attrs: { "aria-live": "polite" } });

  function compute(): void {
    const result = debtPayoff(fields.balance, fields.ratePct, fields.monthlyPayment);
    resultContainer.replaceChildren();

    if (fields.balance <= 0) {
      resultContainer.append(
        el("p", {
          class: "ph-empty",
          text: "No debt entered, you're already free here. 🎉",
        }),
      );
      return;
    }

    if (!result) {
      // Genuine warning (red is allowed here, §5.3): the payment can't retire it.
      resultContainer.append(
        el("div", {
          class: "verify-banner",
          attrs: { role: "alert" },
          text: `At ${Money.from(fields.monthlyPayment).format(ctx.locale)}/mo, the interest at ${pct(fields.ratePct / 100)} keeps pace with the payment, so the balance never falls. Try a higher monthly payment.`,
        }),
      );
      return;
    }

    const fmt = (m: Money): string => m.format(ctx.locale);
    const breakdown: BreakdownLine[] = [
      { label: "Debt balance", value: fmt(Money.from(fields.balance)) },
      {
        label: "Interest rate (your rate)",
        value: `${pct(fields.ratePct / 100)} (your assumption)`,
      },
      { label: "Monthly payment", value: fmt(Money.from(fields.monthlyPayment)) },
      { label: "Freedom date", value: freedomDateLabel(result.months, ctx.locale), emphasis: true },
      { label: "Total interest paid", value: fmt(result.totalInterest) },
      { label: "Total paid", value: fmt(result.totalPaid) },
    ];

    resultContainer.append(
      resultCard({
        label: "Time to debt-free",
        value: Money.from(result.months),
        locale: ctx.locale,
        format: (n) => `${Math.round(n)} month${Math.round(n) === 1 ? "" : "s"}`,
        copyText: `${result.months} months`,
        breakdown,
        permalink: () => ctx.permalink(writeFields(fields)),
      }),
    );
  }

  function recompute(): void {
    fields = {
      balance: parseNonNegative(balanceInput.value, 0),
      ratePct: parseNumber(rateInput.value, 0),
      monthlyPayment: parseNonNegative(paymentInput.value, 0),
    };
    ctx.setParams(writeFields(fields));
    compute();
  }

  for (const input of [balanceInput, rateInput, paymentInput]) {
    input.addEventListener("input", recompute);
  }

  const tryExample = tryExampleButton(() => {
    fields = { ...EXAMPLE };
    balanceInput.value = String(fields.balance);
    rateInput.value = String(fields.ratePct);
    paymentInput.value = String(fields.monthlyPayment);
    recompute();
  });

  const form = el(
    "form",
    { class: "tile-form", on: { submit: (e) => e.preventDefault() } },
    field("Debt balance", balanceInput),
    field("Annual interest rate (%)", rateInput),
    field("Monthly payment", paymentInput),
    el("div", { class: "tile-form-actions" }, tryExample),
  );

  root.append(form, resultContainer);
  compute();
}

export const freedomDateTile: TileDefinition = {
  id: "freedom-date",
  title: "Freedom Date",
  pillar: "debt",
  description: "When your debts are gone, at a payment you choose.",
  keywords: ["debt payoff", "freedom", "debt free", "payoff date", "amortization"],
  status: "ready",
  how: "We amortize your balance month by month: each month adds interest (your annual rate ÷ 12 on the remaining balance) and subtracts your payment, until the balance reaches zero. That count of months is your freedom date, and we total the interest you'll pay along the way.\n\nIf the payment can't cover even the monthly interest, the balance never falls, we tell you plainly instead of showing an impossible date.",
  resources: [
    {
      label: "CFPB, dealing with debt",
      url: "https://www.consumerfinance.gov/consumer-tools/debt-collection/",
    },
    {
      label: "CFPB, debt payoff strategies",
      url: "https://www.consumerfinance.gov/about-us/blog/",
    },
  ],
  mount: mountFreedomDate,
};
