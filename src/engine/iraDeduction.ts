/**
 * Traditional-IRA deductibility (SPEC-3 §4.3, IRC §219(g)). Answers "can I deduct
 * my traditional-IRA contribution, or is it nondeductible because I (or my spouse)
 * have a workplace plan?" — a genuinely common confusion that sets up the pro-rata
 * rule the Backdoor Roth tile then handles.
 *
 * Pure function of the inputs and two cited shards: the contribution limit (from
 * the IRS retirement-limits notice) and the MAGI phase-out ranges (same notice,
 * IRC §219(g)). The deduction is the full limit at or below a range's low end,
 * zero at or above its high end, and a pro-rated partial inside the band —
 * following the Pub 590-A worksheet's $10 round-up and $200 floor.
 */
import { Money } from "./money";
import type { FilingStatus, IraDeductionData } from "../data/schemas";

export type IraDeductionStatus =
  /** No workplace-plan coverage applies, so income never limits the deduction. */
  | "no-limit"
  /** MAGI is at or below the range — the full contribution is deductible. */
  | "full"
  /** MAGI is inside the phase-out band — a partial deduction. */
  | "partial"
  /** MAGI is at or above the range — none of it is deductible. */
  | "none";

export interface IraDeductionInput {
  filingStatus: FilingStatus;
  /** Modified adjusted gross income. */
  magi: number;
  /** The amount contributed (or planned) to a traditional IRA this year. */
  contribution: number;
  /** Whether you are an active participant in a workplace retirement plan. */
  coveredByPlan: boolean;
  /** Whether your spouse is (only relevant when filing jointly). */
  spouseCoveredByPlan: boolean;
  /** Eligible for the age-50+ catch-up (raises the contribution limit). */
  age50Plus: boolean;
}

export interface IraDeductionResult {
  /** The applicable contribution limit (base + catch-up if 50+). */
  contributionLimit: Money;
  /** The contribution after the limit cap (what could be deductible). */
  cappedContribution: Money;
  /** The deductible portion. */
  deductible: Money;
  /** The nondeductible portion (becomes Form 8606 basis). */
  nondeductibleBasis: Money;
  status: IraDeductionStatus;
  /** The phase-out band that applied, when income was the limiting factor. */
  phaseOut: { low: number; high: number } | null;
}

type Range = { low: number; high: number };

/**
 * Which phase-out range governs, or null when none does (no coverage → no income
 * limit). The IRC §219(g) cases: if you're covered, your own filing-status range;
 * if you're not but a joint-filing spouse is, the higher spouse range; married
 * filing separately uses the $0–$10,000 range whenever either spouse is covered.
 */
function applicableRange(input: IraDeductionInput, data: IraDeductionData): Range | null {
  const { filingStatus, coveredByPlan, spouseCoveredByPlan } = input;
  const p = data.phaseOuts;
  if (filingStatus === "married_separately") {
    return coveredByPlan || spouseCoveredByPlan ? p.marriedSeparatelyCovered : null;
  }
  if (coveredByPlan) {
    return filingStatus === "married_jointly" || filingStatus === "qualifying_surviving_spouse"
      ? p.marriedJointlyCovered
      : p.singleCovered;
  }
  // You are not covered. Only a joint-filing spouse's coverage can still limit you.
  if (
    spouseCoveredByPlan &&
    (filingStatus === "married_jointly" || filingStatus === "qualifying_surviving_spouse")
  ) {
    return p.marriedJointlySpouseCovered;
  }
  return null;
}

/** Pub 590-A partial-deduction rule: round the result up to the next $10, and if
 *  it is positive but under $200, raise it to the $200 minimum. */
function roundPartial(amount: number): number {
  if (amount <= 0) return 0;
  const roundedUp = Math.ceil(amount / 10) * 10;
  return Math.max(200, roundedUp);
}

export function iraDeductibility(
  input: IraDeductionInput,
  limits: { ira_contribution: number; ira_catch_up_50plus: number },
  data: IraDeductionData,
): IraDeductionResult {
  const limitNum = limits.ira_contribution + (input.age50Plus ? limits.ira_catch_up_50plus : 0);
  const contributionLimit = Money.from(limitNum);
  const cappedNum = Math.min(Math.max(0, input.contribution), limitNum);
  const cappedContribution = Money.from(cappedNum);
  const magi = Math.max(0, input.magi);

  const range = applicableRange(input, data);
  let deductibleNum: number;
  let status: IraDeductionStatus;

  if (range === null) {
    deductibleNum = cappedNum;
    status = "no-limit";
  } else if (magi <= range.low) {
    deductibleNum = cappedNum;
    status = "full";
  } else if (magi >= range.high) {
    deductibleNum = 0;
    status = "none";
  } else {
    const span = range.high - range.low;
    const fraction = span > 0 ? (range.high - magi) / span : 0;
    // The worksheet applies the fraction to the limit, then caps at what you put in.
    deductibleNum = Math.min(cappedNum, roundPartial(limitNum * fraction));
    status = "partial";
  }

  const deductible = Money.from(deductibleNum);
  return {
    contributionLimit,
    cappedContribution,
    deductible,
    nondeductibleBasis: cappedContribution.subtract(deductible),
    status,
    phaseOut: range,
  };
}
