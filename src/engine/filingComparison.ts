/**
 * Married filing jointly against married filing separately (SPEC-5 Phase 28).
 *
 * The same two incomes run through the tax engine three times: once on a
 * joint return, once on each spouse's separate return. Credits follow the
 * Code's rules for a separate return rather than a figure of this module's own:
 * the EITC needs a joint return (§32(d)(1)), the Child Tax Credit goes to the
 * spouse who claims the children and phases out from the other-than-joint
 * threshold (§24(b)(2)), and its nonrefundable part counts only up to the
 * federal tax it offsets, as the cliff engine nets it.
 */
import { Money } from "./money";
import { estimateCtc, estimateEitc } from "./benefits";
import { evaluateTaxes, type TaxContext } from "./tax";
import type { EitcCtcData, FilingStatus } from "../data/schemas";

export interface FilingComparisonInput {
  wagesA: number;
  wagesB: number;
  qualifyingChildren: number;
  /** On separate returns, the spouse who claims the children. */
  childrenClaimedBy: "a" | "b";
}

export interface ReturnFigures {
  federalIncomeTax: Money;
  stateIncomeTax: Money;
  eitc: Money;
  /** The Child Tax Credit the return can use: refundable, plus the rest up to its tax. */
  childTaxCredit: Money;
  /** Income tax less the credits, federal and state together. */
  net: Money;
}

export interface FilingComparison {
  joint: ReturnFigures;
  separateA: ReturnFigures;
  separateB: ReturnFigures;
  separateTotal: Money;
  /** Positive when separate returns cost more than a joint one. */
  separateCostsMore: Money;
}

function figures(
  status: FilingStatus,
  wages: number,
  children: number,
  ctx: TaxContext,
  credits: EitcCtcData,
): ReturnFigures {
  const tax = evaluateTaxes({ filingStatus: status, wages: Math.max(0, wages) }, ctx);
  const joint = status === "married_jointly";
  // §32(d)(1): a married individual gets the EITC only on a joint return.
  const eitc = joint
    ? estimateEitc(
        { earnedIncome: Math.max(0, wages), qualifyingChildren: children, married: true },
        credits,
      ).credit
    : Money.zero();
  const ctc = estimateCtc(
    {
      qualifyingChildren: children,
      magi: Math.max(0, wages),
      married: joint,
      earnedIncome: Math.max(0, wages),
    },
    credits,
  );
  const nonRefundable = ctc.credit.subtract(ctc.refundable);
  const federal = tax.federal.incomeTax;
  const usedAgainstTax = nonRefundable.greaterThan(federal) ? federal : nonRefundable;
  const childTaxCredit = ctc.refundable.add(usedAgainstTax);
  const state = tax.state?.incomeTax ?? Money.zero();
  return {
    federalIncomeTax: federal,
    stateIncomeTax: state,
    eitc,
    childTaxCredit,
    net: federal.add(state).subtract(eitc).subtract(childTaxCredit),
  };
}

export function compareFilingStatus(
  input: FilingComparisonInput,
  ctx: TaxContext,
  credits: EitcCtcData,
): FilingComparison {
  const kids = Math.max(0, Math.floor(input.qualifyingChildren));
  const joint = figures(
    "married_jointly",
    Math.max(0, input.wagesA) + Math.max(0, input.wagesB),
    kids,
    ctx,
    credits,
  );
  const separateA = figures(
    "married_separately",
    input.wagesA,
    input.childrenClaimedBy === "a" ? kids : 0,
    ctx,
    credits,
  );
  const separateB = figures(
    "married_separately",
    input.wagesB,
    input.childrenClaimedBy === "b" ? kids : 0,
    ctx,
    credits,
  );
  const separateTotal = separateA.net.add(separateB.net);
  return {
    joint,
    separateA,
    separateB,
    separateTotal,
    separateCostsMore: separateTotal.subtract(joint.net),
  };
}
