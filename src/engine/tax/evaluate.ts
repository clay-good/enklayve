import { Money } from "../money";
import type { FicaData, Jurisdiction } from "../../data/schemas";
import {
  bracketTax,
  bracketsFor,
  personalExemptionFor,
  standardDeductionFor,
  standardDeductionPhaseOutFor,
  taxpayerCreditBaseFor,
} from "./brackets";
import { chooseFederalDeduction } from "./deductions";
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
  );
  const taxableIncome = clampZero(agi.subtract(deduction.amount));
  const incomeTax = bracketTax(taxableIncome, bracketsFor(federal, input.filingStatus));
  return { taxableIncome, deduction, incomeTax };
}

function computeState(
  input: TaxInput,
  agi: Money,
  state: Jurisdiction,
  federalDeduction: Money,
): { computation: JurisdictionComputation; localLines: LocalTaxLine[] } {
  if (!state.hasIncomeTax) {
    return {
      computation: {
        taxableIncome: Money.zero(),
        deduction: { kind: "standard", amount: Money.zero() },
        incomeTax: Money.zero(),
      },
      localLines: [],
    };
  }

  let standard = Money.from(standardDeductionFor(state, input.filingStatus));
  // Sliding standard deduction (South Carolina's SCIAD, S.C. Code §12-6-1140(15)):
  // the deduction phases down linearly with AGI, reduced by `standard ×
  // (AGI − threshold) / divisor`, full at/below the threshold and zero once AGI
  // exceeds it by `divisor`. The reduction rounds down to the nearest
  // `roundReductionDownTo` dollars where the statute requires it (SC: $10).
  const phaseOut = standardDeductionPhaseOutFor(state, input.filingStatus);
  if (phaseOut) {
    const over = agi.toNumber() - phaseOut.agiThreshold;
    if (over >= phaseOut.divisor) {
      standard = Money.zero();
    } else if (over > 0) {
      const rawReduction = standard.multiply(over).divide(phaseOut.divisor);
      const step = state.standardDeductionPhaseOut?.roundReductionDownTo;
      const reduction = step
        ? Math.floor(rawReduction.toNumber() / step) * step
        : rawReduction.toNumber();
      standard = clampZero(standard.subtract(reduction));
    }
  }
  const exemption = Money.from(personalExemptionFor(state, input.filingStatus));
  const taxableIncome = clampZero(agi.subtract(standard).subtract(exemption));

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
      deduction: { kind: "standard", amount: standard.add(exemption) },
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
    const s = computeState(input, agi, ctx.state, federal.deduction.amount);
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
