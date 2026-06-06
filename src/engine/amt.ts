/**
 * Alternative Minimum Tax quick screener (SPEC-3 §4.7, IRC §55). Deliberately
 * coarse: it answers "might I owe the AMT?" with a yes/maybe/no and a pointer to
 * Form 6251 — it does not attempt the full line-by-line AMT computation, which
 * would over-promise.
 *
 * The mechanism is real. AMT income (AMTI) is the user's regular taxable income
 * plus the big add-backs (the SALT deduction, etc.). The exemption shelters AMTI
 * and itself phases out above a filing-status threshold. The AMT base above the
 * exemption is taxed at 26%, then 28% past the filing-status breakpoint, giving a
 * tentative minimum tax (TMT). You owe AMT to the extent TMT exceeds your regular
 * tax. The coarseness is only in the AMTI estimate; the comparison is exact.
 */
import { Money } from "./money";
import type { AmtData, FilingStatus } from "../data/schemas";

export type AmtVerdict =
  /** AMTI is under the exemption, or the tentative minimum tax is comfortably below regular tax. */
  | "none"
  /** Close to the crossover — the estimate could tip either way; check Form 6251. */
  | "maybe"
  /** Tentative minimum tax exceeds regular tax — AMT likely applies. */
  | "likely";

export interface AmtScreenInput {
  filingStatus: FilingStatus;
  /** Estimated AMT income: regular taxable income plus the major add-backs. */
  amtIncome: number;
  /** Regular federal income tax, for the comparison (computed from the brackets). */
  regularTax: number;
}

export interface AmtScreenResult {
  /** The exemption before any phase-out. */
  fullExemption: Money;
  /** The exemption actually available after the high-income phase-out. */
  exemption: Money;
  /** How much of the exemption was lost to the phase-out. */
  exemptionPhaseout: Money;
  /** AMTI above the exemption — the amount the AMT rates apply to. */
  amtBase: Money;
  /** Tentative minimum tax: the 26%/28% schedule on the AMT base. */
  tentativeMinimumTax: Money;
  regularTax: Money;
  /** AMT actually owed: the excess of TMT over regular tax (≥ 0). */
  amtOwed: Money;
  verdict: AmtVerdict;
}

function byStatus(table: Record<string, number | undefined>, fs: FilingStatus): number {
  // Every shard defines all five statuses; fall back to single defensively.
  return table[fs] ?? table.single ?? 0;
}

export function amtScreen(input: AmtScreenInput, data: AmtData): AmtScreenResult {
  const amti = Math.max(0, input.amtIncome);
  const regularTax = Money.from(Math.max(0, input.regularTax));

  const fullExemptionNum = byStatus(data.exemptionByFilingStatus, input.filingStatus);
  const threshold = byStatus(data.phaseoutThresholdByFilingStatus, input.filingStatus);
  const phaseoutNum = Math.min(fullExemptionNum, Math.max(0, amti - threshold) * data.phaseoutRate);
  const exemptionNum = fullExemptionNum - phaseoutNum;

  const baseNum = Math.max(0, amti - exemptionNum);
  const breakpoint = byStatus(data.rate28ThresholdByFilingStatus, input.filingStatus);
  const tmtNum =
    baseNum <= breakpoint
      ? baseNum * data.rateLow
      : breakpoint * data.rateLow + (baseNum - breakpoint) * data.rateHigh;

  const tentativeMinimumTax = Money.from(tmtNum);
  const amtOwed = tentativeMinimumTax.subtract(regularTax);
  const owed = amtOwed.isNegative() ? Money.zero() : amtOwed;

  let verdict: AmtVerdict;
  if (baseNum <= 0) {
    verdict = "none";
  } else if (owed.greaterThan(0)) {
    verdict = "likely";
  } else if (tmtNum >= input.regularTax * 0.85) {
    // Within 15% below regular tax: a better AMTI estimate could flip it.
    verdict = "maybe";
  } else {
    verdict = "none";
  }

  return {
    fullExemption: Money.from(fullExemptionNum),
    exemption: Money.from(exemptionNum),
    exemptionPhaseout: Money.from(phaseoutNum),
    amtBase: Money.from(baseNum),
    tentativeMinimumTax,
    regularTax,
    amtOwed: owed,
    verdict,
  };
}
