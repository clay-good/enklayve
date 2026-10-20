/**
 * Is the second income worth it? (SPEC-5 young-family F3.)
 *
 * The cliff engine's `marginalReality`, evaluated from the household without
 * the second earner to the household with them, gives the change in what the
 * household has after tax and benefits. From that come the childcare the job
 * requires and the reader's own costs of working, and back comes the better of
 * the dependent care credit and the FSA on that childcare, each priced inside
 * the same model rather than beside it:
 *
 * - the credit takes the federal income tax first (Form 2441 comes before the
 *   Child Tax Credit's limit on Schedule 8812), so what it is worth is the
 *   credit less the Child Tax Credit it crowds out of that tax;
 * - the FSA lowers the wages the tax and credit engines see, so what it is
 *   worth is the household's resources at the lower wages, plus the care the
 *   FSA paid, less its resources at the full wages, with SNAP held where the
 *   full wages put it.
 *
 * Kept out of
 * `cliffs.ts` so that the composition loads with the tool rather than with
 * the shell, which the Cliff Explorer is part of.
 */
import { Money } from "./money";
import { estimateCtc } from "./benefits";
import {
  marginalReality,
  resourcesAt,
  sweepResources,
  type CliffData,
  type CliffInput,
  type MarginalReality,
} from "./cliffs";
import { compareDependentCare } from "./dependentCare";
import type { DependentCareData } from "../data/schemas";

export interface SecondIncomeInput {
  /** The household's wages without the second earner. */
  firstIncome: number;
  secondIncome: number;
  /** A year of the childcare the second job requires. */
  careAnnual: number;
  /** Commuting, a second car, and the like, a month. */
  workCostsMonthly: number;
}

export interface SecondIncomeResult {
  reality: MarginalReality;
  /** The better of the credit and the FSA on the childcare, or zero. */
  careRelief: number;
  careRoute: "credit" | "fsa" | null;
  /** What the household keeps from the second income, a year. */
  netGain: number;
  /** The share of the second income that does not reach the household; may pass 100%. */
  effectiveRate: number;
  /** What the cliff engine leaves out, childcare subsidies first. */
  unmodeled: string[];
}

/** The Child Tax Credit a return keeps against `tax`: what it offsets, then the refundable part. */
function ctcKept(credit: number, refundable: number, tax: number): number {
  const allowed = Math.min(credit, Math.max(0, tax));
  return allowed + Math.min(credit - allowed, refundable);
}

export function secondIncome(
  input: SecondIncomeInput,
  household: CliffInput,
  data: CliffData,
  care: DependentCareData | null,
): SecondIncomeResult {
  const first = Math.max(0, input.firstIncome);
  const second = Math.max(1, input.secondIncome);
  const careAnnual = Math.max(0, input.careAnnual);
  const reality = marginalReality(first, second, household, data);

  let careRelief = 0;
  let careRoute: SecondIncomeResult["careRoute"] = null;
  if (care && careAnnual > 0 && household.qualifyingChildren > 0) {
    const dc = compareDependentCare(
      {
        filingStatus: household.filingStatus,
        wages: first + second,
        lowerEarnerWages: Math.min(first, second),
        spouseDeemedEarner: false,
        qualifyingIndividuals: household.qualifyingChildren,
        expenses: careAnnual,
      },
      data.tax,
      care,
    );
    const wages = first + second;
    const tax = dc.creditOnly.liability.toNumber();
    const credit = dc.creditOnly.credit.toNumber();
    let crowded = 0;
    if (data.eitcCtc) {
      const ctc = estimateCtc(
        {
          qualifyingChildren: household.qualifyingChildren,
          magi: wages,
          married: household.filingStatus === "married_jointly",
          earnedIncome: wages,
        },
        data.eitcCtc,
      );
      const c = ctc.credit.toNumber();
      const r = ctc.refundable.toNumber();
      crowded = ctcKept(c, r, tax) - ctcKept(c, r, tax - credit);
    }
    const viaCredit = credit - crowded;
    const excluded = dc.fsa.excluded.toNumber();
    // SNAP is held at the full wages: whether it counts pay an FSA takes out
    // first is not something this repo has read, so the FSA is not allowed to
    // buy SNAP back. That can only understate the FSA.
    const full = resourcesAt(wages, household, data);
    const reduced = resourcesAt(wages - excluded, household, data);
    const viaFsa =
      reduced.totalResources -
      reduced.snapAllotment +
      full.snapAllotment +
      excluded -
      full.totalResources;
    careRoute = viaCredit > viaFsa ? "credit" : "fsa";
    careRelief = Math.max(viaCredit, viaFsa, 0);
  }

  const netGain = Money.from(
    reality.netDelta - careAnnual + careRelief - 12 * Math.max(0, input.workCostsMonthly),
  )
    .roundToCents()
    .toNumber();
  const unmodeled = sweepResources(household, data, {
    from: first,
    to: first + second,
    step: second,
  }).unmodeled;
  const ccdf = unmodeled.findIndex((u) => u.startsWith("Childcare subsidies"));
  if (ccdf > 0) unmodeled.unshift(...unmodeled.splice(ccdf, 1));
  return {
    reality,
    careRelief,
    careRoute,
    netGain,
    effectiveRate: (second - netGain) / second,
    unmodeled,
  };
}
