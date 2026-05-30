/**
 * Balance Transfer & Consolidation Break-Even tile (BUILD-SPEC-2 §6.2): compares
 * keeping your current card against moving the balance to a new card — paying a
 * transfer fee, then a promotional APR for the intro window, then the post-intro
 * APR — at the same monthly payment. Deterministic from the fees and rates you
 * enter. Information, not advice.
 */
import { Money } from "../engine/money";
import { balanceTransferBreakEven } from "../engine/finance";
import { el } from "../ui/dom";
import { field, parseNonNegative, tryExampleButton } from "../ui/form";
import { resultCard, type BreakdownLine } from "../ui/resultCard";
import type { TileContext, TileDefinition } from "./types";

interface Fields {
  balance: number;
  currentAprPct: number;
  monthlyPayment: number;
  transferFeePct: number;
  introAprPct: number;
  introMonths: number;
  postIntroAprPct: number;
}

const EXAMPLE: Fields = {
  balance: 6000,
  currentAprPct: 24,
  monthlyPayment: 1000,
  transferFeePct: 3,
  introAprPct: 0,
  introMonths: 12,
  postIntroAprPct: 18,
};

function readFields(p: URLSearchParams): Fields {
  return {
    balance: parseNonNegative(p.get("bal"), 0),
    currentAprPct: parseNonNegative(p.get("apr"), 24),
    monthlyPayment: parseNonNegative(p.get("pay"), 0),
    transferFeePct: parseNonNegative(p.get("fee"), 3),
    introAprPct: parseNonNegative(p.get("intro"), 0),
    introMonths: Math.max(0, Math.round(parseNonNegative(p.get("im"), 12))),
    postIntroAprPct: parseNonNegative(p.get("post"), 18),
  };
}

function writeFields(f: Fields): URLSearchParams {
  const p = new URLSearchParams();
  p.set("bal", String(f.balance));
  p.set("apr", String(f.currentAprPct));
  p.set("pay", String(f.monthlyPayment));
  if (f.transferFeePct !== 3) p.set("fee", String(f.transferFeePct));
  if (f.introAprPct !== 0) p.set("intro", String(f.introAprPct));
  if (f.introMonths !== 12) p.set("im", String(f.introMonths));
  if (f.postIntroAprPct !== 18) p.set("post", String(f.postIntroAprPct));
  return p;
}

export function mountBalanceTransfer(ctx: TileContext): void {
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
      attrs: { "aria-label": label, inputmode: "decimal" },
    });
  const balInput = mkNum("bal", "Balance to transfer", fields.balance, 500);
  const aprInput = mkNum("apr", "Current APR (percent)", fields.currentAprPct, 0.5);
  const payInput = mkNum("pay", "Monthly payment", fields.monthlyPayment, 50);
  const feeInput = mkNum("fee", "Transfer fee (percent)", fields.transferFeePct, 0.5);
  const introInput = mkNum("intro", "Intro APR (percent)", fields.introAprPct, 0.5);
  const imInput = mkNum("im", "Intro months", fields.introMonths, 1);
  const postInput = mkNum("post", "Post-intro APR (percent)", fields.postIntroAprPct, 0.5);

  const resultContainer = el("div", { class: "tile-result", attrs: { "aria-live": "polite" } });

  function compute(): void {
    resultContainer.replaceChildren();
    if (fields.balance <= 0 || fields.monthlyPayment <= 0) {
      resultContainer.append(
        el("p", {
          class: "ph-empty",
          text: "Enter a balance and a monthly payment to compare the two paths.",
        }),
      );
      return;
    }
    const r = balanceTransferBreakEven(fields);
    const fmt = (m: Money): string => m.format(ctx.locale);
    const monthsText = (m: number | null): string =>
      m === null ? "never at this payment" : `${m} mo`;

    const verdict: BreakdownLine =
      r.interestSaved === null
        ? {
            label: "Heads up",
            value:
              "At this payment one path never clears. Raise the monthly payment to compare a real break-even.",
            emphasis: true,
          }
        : r.interestSaved.isNegative()
          ? {
              label: "Verdict",
              value: `Keeping your card is cheaper by ${fmt(r.interestSaved.abs())}: the fee outweighs the savings.`,
              emphasis: true,
            }
          : {
              label: "Verdict",
              value: `Transferring saves ${fmt(r.interestSaved)} after the ${fmt(r.transferFee)} fee.`,
              emphasis: true,
            };

    const lines: BreakdownLine[] = [
      {
        label: "Current card",
        value: `${r.currentInterest ? fmt(r.currentInterest) : "-"} interest · ${monthsText(r.currentMonths)}`,
      },
      { label: "Transfer fee", value: fmt(r.transferFee) },
      {
        label: "Transfer card",
        value: `${r.transferInterest ? fmt(r.transferInterest) : "-"} interest · ${monthsText(r.transferMonths)}`,
      },
      {
        label: "Transfer total cost (fee + interest)",
        value: r.transferTotalCost ? fmt(r.transferTotalCost) : "-",
      },
      verdict,
    ];
    if (r.transferMonths !== null && !r.paysOffWithinIntro) {
      lines.push({
        label: "Note",
        value: `The balance isn't cleared within the ${fields.introMonths}-month intro window, so the post-intro APR kicks in. A bigger payment finishes inside the window.`,
      });
    }

    resultContainer.append(
      resultCard({
        label: "What a balance transfer saves you",
        value: r.interestSaved && !r.interestSaved.isNegative() ? r.interestSaved : Money.zero(),
        locale: ctx.locale,
        breakdown: lines,
        permalink: () => ctx.permalink(writeFields(fields)),
      }),
    );
  }

  function recompute(): void {
    fields = {
      balance: parseNonNegative(balInput.value, 0),
      currentAprPct: parseNonNegative(aprInput.value, 24),
      monthlyPayment: parseNonNegative(payInput.value, 0),
      transferFeePct: parseNonNegative(feeInput.value, 3),
      introAprPct: parseNonNegative(introInput.value, 0),
      introMonths: Math.max(0, Math.round(parseNonNegative(imInput.value, 12))),
      postIntroAprPct: parseNonNegative(postInput.value, 18),
    };
    ctx.setParams(writeFields(fields));
    compute();
  }

  for (const i of [balInput, aprInput, payInput, feeInput, introInput, imInput, postInput])
    i.addEventListener("input", recompute);

  const tryExample = tryExampleButton(() => {
    fields = { ...EXAMPLE };
    balInput.value = String(fields.balance);
    aprInput.value = String(fields.currentAprPct);
    payInput.value = String(fields.monthlyPayment);
    feeInput.value = String(fields.transferFeePct);
    introInput.value = String(fields.introAprPct);
    imInput.value = String(fields.introMonths);
    postInput.value = String(fields.postIntroAprPct);
    recompute();
  });

  const form = el(
    "form",
    { class: "tile-form", on: { submit: (e) => e.preventDefault() } },
    field("Balance to transfer", balInput),
    field("Current APR (%)", aprInput),
    field("Monthly payment", payInput),
    field("Transfer fee (%)", feeInput),
    field("Intro APR (%)", introInput),
    field("Intro months", imInput),
    field("Post-intro APR (%)", postInput),
    el("div", { class: "tile-form-actions" }, tryExample),
  );

  root.append(form, resultContainer);
  compute();
}

export const balanceTransferTile: TileDefinition = {
  id: "balance-transfer",
  title: "Balance Transfer Break-Even",
  pillar: "debt",
  description: "Does moving a balance beat the transfer fee?",
  keywords: ["balance transfer", "consolidation", "credit card", "0% apr", "break even", "debt"],
  status: "ready",
  how: "Moving a credit-card balance to a 0%-intro card can save real money, but the transfer fee (often 3%) is paid upfront, and if you don't clear the balance before the intro rate ends, the post-intro APR returns. This compares both paths at the same monthly payment: the interest you'd pay keeping your current card versus the fee plus any interest on the transferred balance.\n\nThe math is exact given the numbers you enter. The big lever is your monthly payment: the more you pay, the more likely you clear the balance inside the 0% window and capture the full saving. If a path 'never' pays off, your payment isn't covering the interest; raise it to see a real comparison. Information, not advice.",
  resources: [
    {
      label: "CFPB, balance transfer credit cards",
      url: "https://www.consumerfinance.gov/ask-cfpb/what-is-a-balance-transfer-en-1965/",
    },
  ],
  mount: mountBalanceTransfer,
};
