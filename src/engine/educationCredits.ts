/**
 * Education-credit comparison (SPEC-3 §4.6, IRC §25A, Form 8863). "Which education
 * credit saves more this year — the American Opportunity Tax Credit or the Lifetime
 * Learning Credit?" You can't claim both for the same student, so the answer is a
 * comparison, never advice.
 *
 * Pure function of the inputs and the cited shard. The AOTC is 100% of the first
 * $2,000 of qualified expenses plus 25% of the next $2,000 (max $2,500 per student,
 * 40% refundable) but only for the first four years of a degree, at least
 * half-time. The LLC is 20% of up to $10,000 (max $2,000 per return,
 * nonrefundable) with no year or enrollment limit. Both phase out across a MAGI
 * range by filing group.
 */
import { Money } from "./money";
import type { EducationCreditsData } from "../data/schemas";

export interface EducationCreditInput {
  /** Modified adjusted gross income. */
  magi: number;
  married: boolean;
  /** Qualified education expenses for the student/return. */
  qualifiedExpenses: number;
  /** Whether the student qualifies for the AOTC (first 4 years, ≥ half-time). */
  aotcEligible: boolean;
}

export interface CreditDetail {
  /** The tentative credit before the MAGI phase-out. */
  gross: Money;
  /** The credit after the phase-out. */
  afterPhaseout: Money;
}

export interface EducationCreditResult {
  aotc: CreditDetail & { refundable: Money; nonrefundable: Money; eligible: boolean };
  llc: CreditDetail;
  /** Fraction of the credit surviving the phase-out (1 = full, 0 = none). */
  phaseOutFraction: number;
  /** The phase-out range that applied. */
  phaseOut: { low: number; high: number };
  /** Which credit is larger this year (or "none" when both are zero). */
  better: "aotc" | "llc" | "none";
  /** The larger credit's amount. */
  recommendedCredit: Money;
}

export function educationCredits(
  input: EducationCreditInput,
  data: EducationCreditsData,
): EducationCreditResult {
  const magi = Math.max(0, input.magi);
  const expenses = Math.max(0, input.qualifiedExpenses);
  const range = input.married ? data.phaseOut.married : data.phaseOut.single;

  let phaseOutFraction: number;
  if (magi <= range.low) phaseOutFraction = 1;
  else if (magi >= range.high) phaseOutFraction = 0;
  else phaseOutFraction = (range.high - magi) / (range.high - range.low);

  // AOTC: 100% of the first tier, 25% of the second, capped.
  const a = data.aotc;
  const tier1 = Math.min(expenses, a.tier1Cap) * a.tier1Rate;
  const tier2 = Math.min(Math.max(0, expenses - a.tier1Cap), a.tier2Cap) * a.tier2Rate;
  const aotcGrossNum = input.aotcEligible ? Math.min(a.maxCredit, tier1 + tier2) : 0;
  const aotcAfter = Money.from(aotcGrossNum).multiply(phaseOutFraction);
  const aotcRefundable = aotcAfter.multiply(a.refundableRate);

  // LLC: a flat rate of capped expenses.
  const llcGrossNum = Math.min(
    data.llc.maxCredit,
    Math.min(expenses, data.llc.expenseCap) * data.llc.rate,
  );
  const llcAfter = Money.from(llcGrossNum).multiply(phaseOutFraction);

  let better: "aotc" | "llc" | "none";
  if (aotcAfter.lessThanOrEqual(0) && llcAfter.lessThanOrEqual(0)) better = "none";
  else better = aotcAfter.greaterThanOrEqual(llcAfter) ? "aotc" : "llc";

  return {
    aotc: {
      gross: Money.from(aotcGrossNum),
      afterPhaseout: aotcAfter,
      refundable: aotcRefundable,
      nonrefundable: aotcAfter.subtract(aotcRefundable),
      eligible: input.aotcEligible,
    },
    llc: { gross: Money.from(llcGrossNum), afterPhaseout: llcAfter },
    phaseOutFraction,
    phaseOut: range,
    better,
    recommendedCredit: better === "aotc" ? aotcAfter : better === "llc" ? llcAfter : Money.zero(),
  };
}
