/**
 * FAFSA Student Aid Index (SAI) and Pell Grant estimate (BUILD-SPEC.md §4.4).
 *
 * The federal need-analysis methodology is a published, fully deterministic
 * formula (Dept. of Education SAI Formula Guide). This implements the
 * **dependent-student** path of the 2026-27 methodology as a pure function of
 * the inputs and the bundled, cited tables — no inference, no prediction.
 *
 * It is an *estimate to verify*: the formula structure here is exact, but the
 * table values (the income protection allowances, the assessment schedule, the
 * Pell figures) are the reviewer's data-only step, exactly like a jurisdiction's
 * bracket table — so the tile points the user to the official SAI Formula Guide
 * and to their FAFSA Submission Summary to confirm the number (§2.1, §2.3).
 *
 * Scope (stated plainly, like SNAP's contiguous-only and Medicaid's
 * expansion-only): the dependent-student formula. The independent-student
 * variant, the simplified/asset-exempt paths, and the per-state aid are out of
 * scope and deferred — this never invents a figure it cannot compute.
 */
import { Money } from "./money";
import type { FafsaData } from "../data/schemas";

/** Employee-share FICA: 6.2% Social Security up to the wage base + 1.45% Medicare. */
function payrollAllowance(income: number, ssWageBase: number): number {
  const earned = Math.max(0, income);
  const socialSecurity = Math.min(earned, Math.max(0, ssWageBase)) * 0.062;
  const medicare = earned * 0.0145;
  return socialSecurity + medicare;
}

/** Parents' income protection allowance for a family size, extrapolating above
 * the largest tabulated size by the per-additional-person increment. */
function incomeProtectionAllowance(familySize: number, data: FafsaData): number {
  const size = Math.max(1, Math.floor(familySize));
  const table = data.saiIncomeProtectionAllowance;
  const exact = table[String(size)];
  if (exact !== undefined) return exact;
  const sizes = Object.keys(table)
    .map(Number)
    .sort((a, b) => a - b);
  const min = sizes[0];
  const max = sizes[sizes.length - 1];
  if (min !== undefined && size < min) return table[String(min)] ?? 0;
  if (max !== undefined && size > max) {
    return (table[String(max)] ?? 0) + (size - max) * data.ipaPerAdditionalPerson;
  }
  return 0;
}

/**
 * Progressive assessment of parents' adjusted available income. The lowest rate
 * also applies to negative AAI, so the contribution can be negative — the new
 * SAI allows a negative result, floored later at `saiFloor`.
 */
function assessAdjustedAvailableIncome(aai: number, data: FafsaData): number {
  const brackets = data.aaiAssessment;
  const first = brackets[0];
  if (!first) return 0;
  if (aai <= 0) return aai * first.rate;
  let contribution = 0;
  for (let i = 0; i < brackets.length; i++) {
    const bracket = brackets[i]!;
    const lower = bracket.lowerBound;
    if (aai <= lower) break;
    const upper = brackets[i + 1]?.lowerBound ?? Infinity;
    const taxable = Math.min(aai, upper) - lower;
    contribution += taxable * bracket.rate;
  }
  return contribution;
}

export interface SaiInput {
  /** Parents' total income: AGI plus untaxed income. */
  parentIncome: number;
  /** Federal income tax the parents paid (an allowance against income). */
  parentIncomeTax: number;
  /** Number of people in the parents' household (the IPA family size). */
  familySize: number;
  /** The lower-earning parent's earned income (0 for a single earner); drives
   * the employment expense allowance. */
  lowerEarnerIncome: number;
  /** Parents' reportable net worth (cash, investments; not retirement/home). */
  parentAssets: number;
  /** The student's own total income. */
  studentIncome: number;
  /** Federal income tax the student paid. */
  studentIncomeTax: number;
  /** The student's own reportable net worth. */
  studentAssets: number;
  /** Social Security wage base, for the payroll-tax allowance (from the FICA
   * dataset). */
  ssWageBase: number;
}

export interface SaiResult {
  /** The Student Aid Index (whole dollars, floored at the dataset's `saiFloor`). */
  sai: number;
  parentContribution: number;
  studentContribution: number;
  incomeProtectionAllowance: number;
  payrollAllowance: number;
  employmentExpenseAllowance: number;
  /** Parents' income less all allowances (may be negative). */
  availableIncome: number;
  /** Available income plus the assessed asset contribution. */
  adjustedAvailableIncome: number;
  assetContribution: number;
}

/** Estimate the dependent-student SAI from the 2026-27 methodology and tables. */
export function estimateSai(input: SaiInput, data: FafsaData): SaiResult {
  const ipa = incomeProtectionAllowance(input.familySize, data);
  const payroll = payrollAllowance(input.parentIncome, input.ssWageBase);
  const eea = Math.min(
    Math.max(0, input.lowerEarnerIncome) * data.employmentExpenseAllowance.rate,
    data.employmentExpenseAllowance.cap,
  );
  const totalAllowances = Math.max(0, input.parentIncomeTax) + payroll + ipa + eea;
  const availableIncome = input.parentIncome - totalAllowances;
  const assetContribution = Math.max(0, input.parentAssets) * data.parentAssetRate;
  const aai = availableIncome + assetContribution;
  const parentContribution = assessAdjustedAvailableIncome(aai, data);

  const studentAvailable =
    input.studentIncome -
    Math.max(0, input.studentIncomeTax) -
    data.studentIncomeProtectionAllowance;
  const studentIncomeContribution = Math.max(0, studentAvailable) * data.studentIncomeRate;
  const studentAssetContribution = Math.max(0, input.studentAssets) * data.studentAssetRate;
  const studentContribution = studentIncomeContribution + studentAssetContribution;

  const raw = parentContribution + studentContribution;
  const sai = Math.max(data.saiFloor, Math.round(raw));

  return {
    sai,
    parentContribution: Math.round(parentContribution),
    studentContribution: Math.round(studentContribution),
    incomeProtectionAllowance: Math.round(ipa),
    payrollAllowance: Math.round(payroll),
    employmentExpenseAllowance: Math.round(eea),
    availableIncome: Math.round(availableIncome),
    adjustedAvailableIncome: Math.round(aai),
    assetContribution: Math.round(assetContribution),
  };
}

export interface PellResult {
  /** Estimated Pell Grant award for the year. */
  award: Money;
  /** Whether the SAI is low enough for any Pell award. */
  eligible: boolean;
}

/**
 * Estimate the Pell Grant from the SAI: a student receives the maximum Pell less
 * their SAI (a positive SAI reduces the award dollar-for-dollar), with an
 * otherwise-eligible student floored at the minimum Pell, and no award once the
 * SAI reaches the maximum Pell. (The new methodology also guarantees the maximum
 * or minimum Pell directly from income relative to the poverty line for some
 * families; that income-based guarantee can only raise this estimate.)
 */
export function estimatePell(sai: number, data: FafsaData): PellResult {
  if (sai >= data.maxPellGrant) {
    return { award: Money.zero(), eligible: false };
  }
  const scheduled = data.maxPellGrant - Math.max(0, sai);
  const award = Math.max(data.minPellGrant, scheduled);
  return { award: Money.from(Math.round(award)), eligible: true };
}
