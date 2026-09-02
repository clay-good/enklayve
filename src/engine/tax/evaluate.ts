import { Money } from "../money";
import type { FicaData, Jurisdiction } from "../../data/schemas";
import {
  bracketStartForRate,
  bracketTax,
  bracketsFor,
  federalTaxDeductionFor,
  incomeRecaptureFor,
  personalCreditRateFor,
  personalExemptionFor,
  standardDeductionFor,
  standardDeductionPhaseOutFor,
  taxpayerCreditBaseFor,
} from "./brackets";
import {
  chooseFederalDeduction,
  itemizedLimitationFor,
  nonItemizerCharitableFor,
  saltCapFor,
  seniorDeductionFor,
  steppedIncomeDeductionFor,
} from "./deductions";
import { computeFica } from "./fica";
import type {
  DeductionResult,
  FicaResult,
  JurisdictionTaxResult,
  LocalTaxLine,
  TaxInput,
  TaxResult,
} from "./types";

/** The datasets the evaluator composes. State is optional (federal-only is valid). */
export interface TaxContext {
  federal: Jurisdiction;
  state?: Jurisdiction;
  fica: FicaData;
}

/** Probe amount (in wages) used to measure the combined marginal rate. */
const MARGINAL_PROBE = 100;

function clampZero(m: Money): Money {
  return m.isNegative() ? Money.zero() : m;
}

function round(value: number, places: number): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

/** Income-tax for one jurisdiction, plus its deduction and taxable income. */
interface JurisdictionComputation {
  taxableIncome: Money;
  deduction: DeductionResult;
  incomeTax: Money;
}

function computeFederal(
  input: TaxInput,
  agi: Money,
  federal: Jurisdiction,
): JurisdictionComputation {
  const standard = Money.from(standardDeductionFor(federal, input.filingStatus));
  const deduction = chooseFederalDeduction(
    input.deductionMode ?? "auto",
    standard,
    input.itemized ?? {},
    agi,
    saltCapFor(federal.saltLimitation, input.filingStatus, agi),
    nonItemizerCharitableFor(
      federal.nonItemizerCharitable,
      input.filingStatus,
      input.itemized ?? {},
    ),
    // §170(b)(1)(I) reaches the itemized side only. §170(p) says so itself,
    // computing its figure "without regard to ... (b)(1)(I)", which is why the
    // floor is passed here and not into `nonItemizerCharitableFor`.
    federal.charitableFloor?.rate ?? 0,
  );
  // §63(b)(4): a non-itemizer subtracts the standard deduction AND §170(p).
  // §151(d)(5)(C) comes off either way — §63(a) for an itemizer, §63(b)(2) for
  // one who is not — so it is subtracted outside that choice.
  const senior = seniorDeductionFor(
    federal.seniorDeduction,
    input.filingStatus,
    input.seniorsAge65Plus ?? 0,
    agi,
  );
  // §63(b)(5)-(6) list §224 and §225 for a filer who does not itemize, and
  // §63(a) reaches them for one who does, so like §151 they come off either way.
  const qualifiedTips = steppedIncomeDeductionFor(
    federal.qualifiedTipsDeduction,
    input.filingStatus,
    input.qualifiedTips ?? 0,
    agi,
  );
  const qualifiedOvertime = steppedIncomeDeductionFor(
    federal.qualifiedOvertimeDeduction,
    input.filingStatus,
    input.qualifiedOvertime ?? 0,
    agi,
  );
  // §163(h)(4)(A) takes qualified car loan interest out of the personal interest
  // §163(h)(1) disallows, so an itemizer deducts it under §163(a); §63(b)(7)
  // reaches it for a filer who does not itemize. Either way, outside the choice.
  const vehicleLoanInterest = steppedIncomeDeductionFor(
    federal.vehicleLoanInterestDeduction,
    input.filingStatus,
    input.vehicleLoanInterest ?? 0,
    agi,
  );
  // §68, applied last because §68(b) says so: "after the application of any
  // other limitation on the allowance of any itemized deduction". Clause (2)'s
  // subject is taxable income without this section and with the deductions added
  // back, which is the income remaining after everything §63(b) takes off OTHER
  // than the itemized total itself. A filer taking the standard deduction has no
  // itemized deductions for it to reduce.
  const itemizedLimitation =
    deduction.kind === "itemized"
      ? itemizedLimitationFor(
          federal.itemizedLimitation,
          federal.itemizedLimitation
            ? bracketStartForRate(
                federal,
                input.filingStatus,
                federal.itemizedLimitation.thresholdRate,
              )
            : undefined,
          deduction.amount,
          clampZero(
            agi
              .subtract(senior)
              .subtract(qualifiedTips)
              .subtract(qualifiedOvertime)
              .subtract(vehicleLoanInterest),
          ),
        )
      : Money.zero();
  const deductionAfterLimitation = clampZero(deduction.amount.subtract(itemizedLimitation));

  const taxableIncome = clampZero(
    agi
      .subtract(deductionAfterLimitation)
      .subtract(deduction.nonItemizedCharitable)
      .subtract(senior)
      .subtract(qualifiedTips)
      .subtract(qualifiedOvertime)
      .subtract(vehicleLoanInterest),
  );
  const incomeTax = bracketTax(taxableIncome, bracketsFor(federal, input.filingStatus));
  return {
    taxableIncome,
    deduction: {
      ...deduction,
      // The reported deduction is what actually came off, so the result card's
      // arithmetic adds up: AGI minus these lines is the taxable income beside
      // them. What §68 took back is reported alongside it, because otherwise a
      // filer who entered $60,000 of mortgage interest sees $56,756.76 with
      // nothing on screen accounting for the difference.
      amount: deductionAfterLimitation,
      itemizedLimitation,
      senior,
      qualifiedTips,
      qualifiedOvertime,
      vehicleLoanInterest,
    },
    incomeTax,
  };
}

/**
 * The federal deductions a state inherits because it starts from federal
 * taxable income (see FederalDeductionConformitySchema). Zero for every state
 * that starts from AGI, which is the answer for all but a handful.
 *
 * The amounts are the FEDERAL ones, unchanged: the state is not applying the
 * rule, it is starting from a figure the rule has already been applied to.
 */
function conformedFederalDeductions(
  state: Jurisdiction,
  federal: DeductionResult,
): Pick<
  DeductionResult,
  "nonItemizedCharitable" | "senior" | "qualifiedTips" | "qualifiedOvertime" | "vehicleLoanInterest"
> {
  const c = state.federalDeductionConformity;
  const take = (allowed: boolean | undefined, amount: Money): Money =>
    allowed ? amount : Money.zero();
  return {
    nonItemizedCharitable: take(c?.nonItemizerCharitable, federal.nonItemizedCharitable),
    senior: take(c?.senior, federal.senior),
    qualifiedTips: take(c?.qualifiedTips, federal.qualifiedTips),
    qualifiedOvertime: take(c?.qualifiedOvertime, federal.qualifiedOvertime),
    vehicleLoanInterest: take(c?.vehicleLoanInterest, federal.vehicleLoanInterest),
  };
}

function computeState(
  input: TaxInput,
  agi: Money,
  state: Jurisdiction,
  federalDeductionResult: DeductionResult,
  federalIncomeTax: Money,
): { computation: JurisdictionComputation; localLines: LocalTaxLine[] } {
  const federalDeduction = federalDeductionResult.amount;
  const conformed = conformedFederalDeductions(state, federalDeductionResult);
  if (!state.hasIncomeTax) {
    return {
      computation: {
        taxableIncome: Money.zero(),
        deduction: {
          kind: "standard",
          amount: Money.zero(),
          itemizedLimitation: Money.zero(),
          nonItemizedCharitable: Money.zero(),
          senior: Money.zero(),
          qualifiedTips: Money.zero(),
          qualifiedOvertime: Money.zero(),
          vehicleLoanInterest: Money.zero(),
        },
        incomeTax: Money.zero(),
      },
      localLines: [],
    };
  }

  let standard = Money.from(standardDeductionFor(state, input.filingStatus));
  // Sliding standard deduction: the deduction phases down linearly with AGI in
  // one of two equivalent forms (see StandardDeductionPhaseOutSchema):
  //  • divisor (South Carolina's SCIAD, S.C. Code §12-6-1140(15)): reduce by
  //    `standard × (AGI − threshold) / divisor`, proportional to the deduction.
  //  • reductionRate (Wisconsin, Wis. Stat. §71.05(23)(a)): reduce by
  //    `rate × (AGI − threshold)`, a flat percentage of income above the
  //    threshold (single 12%, joint 19.778%), independent of the deduction.
  // Both are full at/below the threshold; above it the deduction slides toward
  // the status `floor` (zero unless set — Alabama floors at $5,000 joint /
  // $2,500 otherwise, Ala. Code §40-18-15(b)). The reduction rounds down to the
  // nearest `roundReductionDownTo` dollars where the statute requires it (SC: $10).
  // A `secondSegment` adds Wisconsin's two-line head-of-household schedule: a higher
  // base sliding faster until it meets the flatter single line, which then carries it
  // to zero. Both lines run from the same threshold, so "whichever gives more" is the
  // schedule exactly (Wis. Stat. §71.05(23)(a)3.).
  const phaseOut = standardDeductionPhaseOutFor(state, input.filingStatus);
  if (phaseOut) {
    const over = agi.toNumber() - phaseOut.agiThreshold;
    if (over > 0) {
      const rawReduction =
        phaseOut.divisor !== undefined
          ? standard.multiply(over).divide(phaseOut.divisor).toNumber()
          : over * phaseOut.reductionRate!;
      const step = state.standardDeductionPhaseOut?.roundReductionDownTo;
      const reduction = step ? Math.floor(rawReduction / step) * step : rawReduction;
      standard = clampZero(standard.subtract(reduction));
      if (phaseOut.secondSegment) {
        const second = clampZero(
          Money.from(phaseOut.secondSegment.base).subtract(
            over * phaseOut.secondSegment.reductionRate,
          ),
        );
        if (second.greaterThan(standard)) standard = second;
      }
      if (phaseOut.floor !== undefined && standard.lessThan(phaseOut.floor)) {
        standard = Money.from(phaseOut.floor);
      }
    }
  }
  const exemption = Money.from(personalExemptionFor(state, input.filingStatus));
  // Federal income tax paid is deductible against state taxable income in a few
  // states — uncapped (Alabama, Ala. Code §40-18-15(a)(1)) or capped and
  // AGI-phased (Oregon, ORS §316.680/§316.695). Zero where the state has no such
  // deduction. Subtracted before the brackets, like the standard deduction.
  const fedTaxDeduction = federalTaxDeductionFor(state, input.filingStatus, federalIncomeTax, agi);
  // A federal-taxable-income state starts below the federal §63(b) deductions,
  // so they come off here too — as the federal figures, not recomputed.
  const conformedTotal = conformed.nonItemizedCharitable
    .add(conformed.senior)
    .add(conformed.qualifiedTips)
    .add(conformed.qualifiedOvertime)
    .add(conformed.vehicleLoanInterest);
  const taxableIncome = clampZero(
    agi.subtract(standard).subtract(exemption).subtract(fedTaxDeduction).subtract(conformedTotal),
  );

  let incomeTax = bracketTax(taxableIncome, bracketsFor(state, input.filingStatus));

  // Special rules, e.g. the California 1% mental-health-services surtax.
  for (const rule of state.specialRules ?? []) {
    if (rule.surtaxRate !== undefined && rule.incomeThreshold !== undefined) {
      if (taxableIncome.greaterThan(rule.incomeThreshold)) {
        incomeTax = incomeTax.add(
          taxableIncome.subtract(rule.incomeThreshold).multiply(rule.surtaxRate),
        );
      }
    }
  }

  // High-income benefit recapture (Arkansas's bracket adjustment; Connecticut's
  // 2% phase-out add-back + tax recapture): one or more ramps, each adding a flat
  // amount that phases in over an income band and holds above, so a high earner
  // forfeits the benefit of the lower brackets. Exact below/above each ramp; a
  // small linear-vs-step residual only inside a ramp's band.
  const recapture = incomeRecaptureFor(state, input.filingStatus, taxableIncome.toNumber());
  if (recapture > 0) incomeTax = incomeTax.add(recapture);

  // Personal tax credit as a fraction of the tax that slides down with AGI
  // (Connecticut's Table E): the Connecticut income tax is `tax × (1 − rate)`,
  // applied AFTER the recapture (the worksheet credits the recapture-inclusive
  // total). The rate is 0 — no change — for jurisdictions without this credit.
  const creditRate = personalCreditRateFor(state, input.filingStatus, agi.toNumber());
  if (creditRate > 0) incomeTax = incomeTax.multiply(1 - creditRate);

  // Taxpayer tax credit (the Utah pattern): a nonrefundable credit standing in
  // for a standard deduction. The state taxes AGI directly (its standard
  // deduction is 0 above), then credits back `creditRate` of the *federal*
  // deduction, phased out at `phaseOutRate` of taxable income over a
  // filing-status base, floored at zero — so it never refunds (Utah Code
  // §59-10-1018; TC-40 worksheet). The phase-out naturally raises the effective
  // marginal rate in its band, which the $100 wage probe measures correctly.
  const credit = state.taxpayerCredit;
  if (credit) {
    const initial = federalDeduction.multiply(credit.creditRate);
    const base = taxpayerCreditBaseFor(state, input.filingStatus);
    const overBase = clampZero(taxableIncome.subtract(base));
    const reduced = clampZero(initial.subtract(overBase.multiply(credit.phaseOutRate)));
    incomeTax = clampZero(incomeTax.subtract(reduced));
  }

  // Local add-ons apply only when the caller opts in by id (a NYC resident, say).
  const selected = new Set(input.localJurisdictionIds ?? []);
  const localLines: LocalTaxLine[] = [];
  for (const addOn of state.localAddOns ?? []) {
    if (!selected.has(addOn.id)) continue;
    let tax = Money.zero();
    if (addOn.brackets && addOn.brackets.length > 0) {
      tax = bracketTax(taxableIncome, addOn.brackets);
    } else if (addOn.flatRate !== undefined) {
      tax = taxableIncome.multiply(addOn.flatRate);
    }
    localLines.push({ id: addOn.id, name: addOn.name, tax });
  }

  return {
    computation: {
      taxableIncome,
      deduction: {
        kind: "standard",
        amount: standard.add(exemption).add(fedTaxDeduction),
        // §68 is federal: no state applies its own cap on itemized value here.
        itemizedLimitation: Money.zero(),
        // No state legislates §170(p), §151(d)(5)(C), §§224/225 or §163(h)(4).
        // A state that starts from federal taxable income inherits them anyway,
        // and reports the inherited amounts here; every other state reports zero.
        ...conformed,
      },
      incomeTax,
    },
    localLines,
  };
}

/** All money pieces for a given input — reused to measure the marginal rate. */
interface Breakdown {
  grossIncome: Money;
  agi: Money;
  federal: JurisdictionComputation;
  fica: FicaResult;
  state: JurisdictionComputation | null;
  localLines: LocalTaxLine[];
  localTotal: Money;
  totalTax: Money;
}

function computeBreakdown(input: TaxInput, ctx: TaxContext): Breakdown {
  const wages = Money.from(input.wages);
  const grossIncome = wages.add(input.otherIncome ?? 0);
  const agi = clampZero(grossIncome.subtract(input.adjustments ?? 0));

  const federal = computeFederal(input, agi, ctx.federal);
  const fica = computeFica(wages, input.filingStatus, ctx.fica);

  let state: JurisdictionComputation | null = null;
  let localLines: LocalTaxLine[] = [];
  if (ctx.state) {
    const s = computeState(input, agi, ctx.state, federal.deduction, federal.incomeTax);
    state = s.computation;
    localLines = s.localLines;
  }
  const localTotal = localLines.reduce((sum, l) => sum.add(l.tax), Money.zero());

  const totalTax = federal.incomeTax
    .add(fica.total)
    .add(state ? state.incomeTax : Money.zero())
    .add(localTotal);

  return { grossIncome, agi, federal, fica, state, localLines, localTotal, totalTax };
}

/**
 * Evaluate federal, FICA, state, and local taxes for one filer, composing them
 * into a single {@link TaxResult} with a citation on every line (BUILD-SPEC.md
 * §3, §8, §9). Deterministic: a pure function of the input and the datasets.
 *
 * The combined marginal rate is measured by re-running the computation with a
 * small wage probe, so it correctly reflects bracket boundaries, the Social
 * Security wage base, and the Additional Medicare threshold all at once.
 */
export function evaluateTaxes(input: TaxInput, ctx: TaxContext): TaxResult {
  const b = computeBreakdown(input, ctx);

  const bumped = computeBreakdown({ ...input, wages: input.wages + MARGINAL_PROBE }, ctx);
  const marginalRate = round(
    bumped.totalTax.subtract(b.totalTax).divide(MARGINAL_PROBE).toNumber(),
    6,
  );
  const effectiveRate = b.grossIncome.isZero()
    ? 0
    : round(b.totalTax.divide(b.grossIncome.toNumber()).toNumber(), 6);

  const federalResult: JurisdictionTaxResult = {
    jurisdictionId: ctx.federal.id,
    jurisdictionName: ctx.federal.name,
    taxableIncome: b.federal.taxableIncome,
    deduction: b.federal.deduction,
    incomeTax: b.federal.incomeTax,
    citation: ctx.federal.citation,
  };

  const stateResult: JurisdictionTaxResult | null =
    ctx.state && b.state
      ? {
          jurisdictionId: ctx.state.id,
          jurisdictionName: ctx.state.name,
          taxableIncome: b.state.taxableIncome,
          deduction: b.state.deduction,
          incomeTax: b.state.incomeTax,
          citation: ctx.state.citation,
        }
      : null;

  return {
    filingStatus: input.filingStatus,
    grossIncome: b.grossIncome,
    agi: b.agi,
    federal: federalResult,
    fica: b.fica,
    state: stateResult,
    local: {
      lines: b.localLines,
      total: b.localTotal,
      citation: b.localLines.length > 0 && ctx.state ? ctx.state.citation : null,
    },
    totals: {
      totalTax: b.totalTax,
      takeHome: b.grossIncome.subtract(b.totalTax),
      marginalRate,
      effectiveRate,
    },
  };
}
