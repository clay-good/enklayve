import { Money } from "../money";
import type { CitationData, FicaData, FilingStatus } from "../../data/schemas";
import type { FicaResult } from "./types";

/**
 * Employee-side FICA (BUILD-SPEC.md §3.1): Social Security on wages up to the
 * annual wage base, Medicare on all wages, and the Additional Medicare surtax
 * on wages above the filing-status threshold. Self-employment tax is built on
 * top of this in Phase 5.
 */
export function computeFica(wages: Money, status: FilingStatus, fica: FicaData): FicaResult {
  const wageBase = Money.from(fica.socialSecurityWageBase);
  const ssTaxable = wages.greaterThan(wageBase) ? wageBase : wages;
  const socialSecurity = ssTaxable.multiply(fica.socialSecurityRate);

  const medicare = wages.multiply(fica.medicareRate);

  const threshold = fica.additionalMedicareThresholdByFilingStatus[status];
  const over = wages.greaterThan(threshold) ? wages.subtract(threshold) : Money.zero();
  const additionalMedicare = over.multiply(fica.additionalMedicareRate);

  return {
    socialSecurity,
    medicare,
    additionalMedicare,
    total: socialSecurity.add(medicare).add(additionalMedicare),
    citation: fica.citation,
  };
}

/** Self-employment tax, computed deterministically from the FICA dataset. */
export interface SelfEmploymentTaxResult {
  /** Net profit the user entered (Schedule C net earnings). */
  netEarnings: Money;
  /** The 92.35% of net earnings actually subject to SE tax. */
  taxableBase: Money;
  /** Social Security portion (12.4%) up to the wage base. */
  socialSecurity: Money;
  /** Medicare portion (2.9%) on the whole base. */
  medicare: Money;
  /** Additional Medicare surtax (0.9%) on earnings over the threshold. */
  additionalMedicare: Money;
  /** Total self-employment tax. */
  total: Money;
  /** The deductible half (the employer-equivalent portion), an adjustment to income. */
  deductibleHalf: Money;
  citation: CitationData;
}

/**
 * The share of net earnings that is the SE-tax base: IRC §1402(a)(12) subtracts
 * the employer-equivalent half, leaving 92.35% (IRS Schedule SE). Statutory and
 * never indexed — it is 100% − 7.65%, the arithmetic of the FICA rates rather
 * than an amount anybody sets each year.
 *
 * It was an inline `0.9235` for as long as this function has existed, invisible
 * to the sweep that names statutory figures because that one only fires on a
 * bare number of 100 or more, and a rate is never that.
 */
export const SE_TAX_BASE_RATE = 0.9235;

/**
 * Self-employment tax (BUILD-SPEC.md §3.2), built on the same FICA dataset as
 * the employee-side computation. A self-employed person pays both halves of
 * Social Security and Medicare, so the rates are doubled: SE tax is the 15.3%
 * combined rate applied to 92.35% of net earnings (the factor that excludes the
 * employer-equivalent share from the base), with Social Security capped at the
 * wage base and the 0.9% Additional Medicare surtax on earnings over the
 * filing-status threshold. Half of the total is deductible above the line.
 *
 * @param netEarnings net profit from self-employment (Schedule C)
 */
export function selfEmploymentTax(
  netEarnings: Money,
  status: FilingStatus,
  fica: FicaData,
): SelfEmploymentTaxResult {
  const net = netEarnings.greaterThan(0) ? netEarnings : Money.zero();
  const taxableBase = net.multiply(SE_TAX_BASE_RATE);

  const wageBase = Money.from(fica.socialSecurityWageBase);
  const ssBase = taxableBase.greaterThan(wageBase) ? wageBase : taxableBase;
  const socialSecurity = ssBase.multiply(fica.socialSecurityRate * 2);

  const medicare = taxableBase.multiply(fica.medicareRate * 2);

  // The 0.9% surtax applies to the 92.35% base, not the full profit: Form 8959
  // line 8 ("self-employment income") is the Schedule SE figure, already × 0.9235.
  // Using the un-reduced profit here would overstate the tax (see SPEC-3-hardening §C1).
  const threshold = fica.additionalMedicareThresholdByFilingStatus[status];
  const over = taxableBase.greaterThan(threshold) ? taxableBase.subtract(threshold) : Money.zero();
  const additionalMedicare = over.multiply(fica.additionalMedicareRate);

  const total = socialSecurity.add(medicare).add(additionalMedicare);
  return {
    netEarnings: net,
    taxableBase,
    socialSecurity,
    medicare,
    additionalMedicare,
    total,
    deductibleHalf: total.divide(2),
    citation: fica.citation,
  };
}
