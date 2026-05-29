import { Money } from "../money";
import type { FicaData, FilingStatus } from "../../data/schemas";
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

  const threshold = fica.additionalMedicareThresholdByFilingStatus[status] ?? 200000;
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
