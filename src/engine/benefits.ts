/**
 * Pillar 2 — What You're Owed (BUILD-SPEC.md §4). Deterministic eligibility and
 * benefit math: the Federal Poverty Level (the foundation nearly every program
 * keys off), the Earned Income Tax Credit, and the Child Tax Credit. Each is a
 * pure function of the inputs and the bundled, cited dataset — no inference.
 */
import { Money } from "./money";
import type {
  AcaData,
  EitcCtcData,
  FederalPovertyLevelData,
  FilingStatus,
  MedicaidData,
  SaversCreditData,
  SnapData,
} from "../data/schemas";

/** The poverty line for a household of `size` in the dataset's region (§4.1). */
export function povertyLine(size: number, fpl: FederalPovertyLevelData): Money {
  const people = Math.max(1, Math.floor(size));
  return Money.from(fpl.base).add(Money.from(fpl.perAdditionalPerson).multiply(people - 1));
}

/** Income as a percentage of the poverty line (e.g. 200 for 200% FPL). */
export function fplPercent(income: number, size: number, fpl: FederalPovertyLevelData): number {
  const line = povertyLine(size, fpl).toNumber();
  return line > 0 ? (Math.max(0, income) / line) * 100 : 0;
}

export interface EitcResult {
  /** Estimated credit. */
  credit: Money;
  /** The EITC bracket used (qualifying children, capped at 3+). */
  qualifyingChildren: number;
  /** True when income is past the point the credit fully phases out. */
  phasedOut: boolean;
}

/**
 * Estimate the Earned Income Tax Credit (§4.2). Phases in at `phaseInRate` up to
 * `maxCredit`, holds on a plateau, then phases out at `phaseOutRate` above the
 * filing-status threshold. Uses earned income as the income measure (the common
 * case; the statute uses the greater of earned income or AGI).
 */
export function estimateEitc(
  input: { earnedIncome: number; qualifyingChildren: number; married: boolean },
  data: EitcCtcData,
): EitcResult {
  const qc = Math.max(0, Math.min(3, Math.floor(input.qualifyingChildren)));
  const params = data.eitc.find((e) => e.qualifyingChildren === qc) ?? data.eitc[0];
  if (!params) {
    return { credit: Money.zero(), qualifyingChildren: qc, phasedOut: false };
  }
  const income = Math.max(0, input.earnedIncome);
  const phaseIn = Math.min(params.maxCredit, income * params.phaseInRate);
  const threshold = input.married
    ? params.phaseOutThresholdMarried
    : params.phaseOutThresholdSingle;
  const reduction = Math.max(0, income - threshold) * params.phaseOutRate;
  const credit = Math.max(0, phaseIn - reduction);
  return {
    credit: Money.from(credit),
    qualifyingChildren: qc,
    phasedOut: income > 0 && credit === 0 && income > threshold,
  };
}

export interface CtcResult {
  /** Total Child Tax Credit after the high-income phaseout. */
  credit: Money;
  /** Refundable portion available even with no tax liability (the ACTC), capped. */
  refundable: Money;
}

/**
 * Estimate the Child Tax Credit and its refundable portion (§4.2). The credit is
 * `perChild` per qualifying child, reduced by `phaseOutPerThousand` for every
 * $1,000 (or fraction) of MAGI above the filing-status threshold.
 */
export function estimateCtc(
  input: { qualifyingChildren: number; magi: number; married: boolean },
  data: EitcCtcData,
): CtcResult {
  const kids = Math.max(0, Math.floor(input.qualifyingChildren));
  const ctc = data.childTaxCredit;
  const base = ctc.perChild * kids;
  const threshold = input.married ? ctc.phaseOutThresholdMarried : ctc.phaseOutThresholdSingle;
  const excess = Math.max(0, Math.max(0, input.magi) - threshold);
  const steps = Math.ceil(excess / 1000);
  const reduction = steps * ctc.phaseOutPerThousand;
  const credit = Math.max(0, base - reduction);
  const refundable = Math.min(credit, ctc.refundableCap * kids);
  return { credit: Money.from(credit), refundable: Money.from(refundable) };
}

export interface SaversCreditResult {
  /** Estimated non-refundable credit. */
  credit: Money;
  /** The credit rate that applied (0, 0.1, 0.2, or 0.5). */
  rate: number;
  /** Contributions actually counted, after the per-person cap. */
  eligibleContributions: Money;
}

/**
 * Estimate the Saver's Credit (§4.2). The credit rate steps down (50% → 20% →
 * 10% → 0) as AGI rises through the filing-status ceilings, applied to up to a
 * capped contribution amount. Non-refundable (it can only offset tax owed),
 * which the tile notes. Married-filing-jointly counts each spouse's cap; head of
 * household uses its own column; everyone else uses the single column (the
 * Form 8880 grouping).
 */
export function estimateSaversCredit(
  input: { agi: number; filingStatus: FilingStatus; contributions: number },
  data: SaversCreditData,
): SaversCreditResult {
  const agi = Math.max(0, input.agi);
  const married = input.filingStatus === "married_jointly";
  const capFor = (t: SaversCreditData["tiers"][number]): number =>
    married
      ? t.agiCapMarried
      : input.filingStatus === "head_of_household"
        ? t.agiCapHeadOfHousehold
        : t.agiCapSingle;

  // Tiers run highest-rate-first; take the best rate whose ceiling still covers
  // this AGI. Above the lowest tier's ceiling the rate is zero.
  let rate = 0;
  for (const tier of data.tiers) {
    if (agi <= capFor(tier)) {
      rate = tier.rate;
      break;
    }
  }

  const maxConsidered = data.maxContributionPerPerson * (married ? 2 : 1);
  const eligible = Math.min(Math.max(0, input.contributions), maxConsidered);
  return {
    credit: Money.from(eligible).multiply(rate),
    rate,
    eligibleContributions: Money.from(eligible),
  };
}

export interface SnapResult {
  /** True when the household passes both the gross and net income tests. */
  eligible: boolean;
  passedGrossTest: boolean;
  passedNetTest: boolean;
  /** Estimated monthly benefit (0 when ineligible). */
  monthlyBenefit: Money;
  grossMonthlyIncome: Money;
  netMonthlyIncome: Money;
  grossLimit: Money;
  netLimit: Money;
  maxAllotment: Money;
}

/** SNAP allotment / standard-deduction lookup, using the largest defined size
 *  for households beyond the table and adding the per-person amount past eight. */
function snapAllotment(size: number, data: SnapData): Money {
  const sizes = Object.keys(data.maxAllotmentByHouseholdSize)
    .map(Number)
    .sort((a, b) => a - b);
  const top = sizes[sizes.length - 1] ?? 1;
  if (size <= top) {
    return Money.from(data.maxAllotmentByHouseholdSize[String(size)] ?? 0);
  }
  const base = data.maxAllotmentByHouseholdSize[String(top)] ?? 0;
  return Money.from(base).add(Money.from(data.additionalPersonAllotment).multiply(size - top));
}

function snapStandardDeduction(size: number, data: SnapData): Money {
  const sizes = Object.keys(data.standardDeductionByHouseholdSize)
    .map(Number)
    .sort((a, b) => a - b);
  const top = sizes[sizes.length - 1] ?? 1;
  const key = String(Math.min(size, top));
  return Money.from(data.standardDeductionByHouseholdSize[key] ?? 0);
}

/**
 * Estimate SNAP eligibility and the monthly benefit (§4.3). Applies the gross
 * income test (income ≤ a percentage of the poverty line), then the net income
 * test after the standard deduction and the earned-income deduction. The benefit
 * is the maximum allotment less the household's expected contribution (a share
 * of net income), floored at zero or the minimum benefit for small households.
 *
 * This is a deterministic estimate: it models the standard and earned-income
 * deductions but not the shelter, dependent-care, or medical deductions (which
 * would only raise the benefit), and households with an elderly or disabled
 * member are exempt from the gross test. States vary; the agency decides.
 */
export function estimateSnap(
  input: { householdSize: number; monthlyGrossIncome: number; monthlyEarnedIncome?: number },
  data: SnapData,
  fpl: FederalPovertyLevelData,
): SnapResult {
  const size = Math.max(1, Math.floor(input.householdSize));
  const gross = Money.from(Math.max(0, input.monthlyGrossIncome));
  const earned = Money.from(Math.max(0, input.monthlyEarnedIncome ?? input.monthlyGrossIncome));

  const monthlyLine = povertyLine(size, fpl).divide(12);
  const grossLimit = monthlyLine.multiply(data.grossIncomeLimitPctFpl / 100);
  const netLimit = monthlyLine.multiply(data.netIncomeLimitPctFpl / 100);

  const standardDeduction = snapStandardDeduction(size, data);
  const earnedDeduction = earned.multiply(data.earnedIncomeDeductionRate);
  let net = gross.subtract(standardDeduction).subtract(earnedDeduction);
  if (net.isNegative()) net = Money.zero();

  const passedGrossTest = gross.lessThanOrEqual(grossLimit);
  const passedNetTest = net.lessThanOrEqual(netLimit);
  const eligible = passedGrossTest && passedNetTest;

  const maxAllotment = snapAllotment(size, data);
  let monthlyBenefit = Money.zero();
  if (eligible) {
    const contribution = net.multiply(data.expectedContributionRate);
    monthlyBenefit = maxAllotment.subtract(contribution);
    if (monthlyBenefit.isNegative()) monthlyBenefit = Money.zero();
    // Minimum benefit floors eligible one- and two-person households.
    if (size <= 2 && monthlyBenefit.lessThan(data.minBenefit)) {
      monthlyBenefit = Money.from(data.minBenefit);
    }
  }

  return {
    eligible,
    passedGrossTest,
    passedNetTest,
    monthlyBenefit,
    grossMonthlyIncome: gross,
    netMonthlyIncome: net,
    grossLimit,
    netLimit,
    maxAllotment,
  };
}

export interface MedicaidResult {
  /** Whether the state expanded Medicaid under the ACA. */
  expansionState: boolean;
  /** The MAGI eligibility ceiling as a % of FPL, or null in non-expansion states. */
  thresholdPctFpl: number | null;
  /** Likely eligible / not, or null when non-expansion (can't be determined simply). */
  eligible: boolean | null;
  /** Household income as a percentage of the poverty line. */
  fplPercent: number;
}

/**
 * Adult Medicaid eligibility by state (§4.3). In an expansion state, an adult at
 * or below the threshold (138% FPL, or a state override) is likely eligible. In a
 * non-expansion state, adult coverage is limited and category-specific (parents,
 * pregnancy, disability), so we return null eligibility and let the tile say so
 * rather than invent a precise number.
 */
export function medicaidEligibility(
  input: { stateCode: string; income: number; householdSize: number },
  data: MedicaidData,
  fpl: FederalPovertyLevelData,
): MedicaidResult {
  const code = input.stateCode.toUpperCase();
  const expanded = data.expansionByState[code] ?? false;
  const pct = fplPercent(input.income, input.householdSize, fpl);
  if (!expanded) {
    return { expansionState: false, thresholdPctFpl: null, eligible: null, fplPercent: pct };
  }
  const threshold = data.thresholdOverridesPctFpl?.[code] ?? data.expansionThresholdPctFpl;
  return {
    expansionState: true,
    thresholdPctFpl: threshold,
    eligible: pct <= threshold,
    fplPercent: pct,
  };
}

/** The applicable percentage for an exact FPL%, interpolated within its band. */
export function acaApplicablePercent(fplPct: number, data: AcaData): number {
  for (const band of data.applicablePercentage) {
    if (band.fplHigh === null) {
      if (fplPct >= band.fplLow) return band.percentageHigh;
      continue;
    }
    if (fplPct >= band.fplLow && fplPct < band.fplHigh) {
      const span = band.fplHigh - band.fplLow;
      const frac = span > 0 ? (fplPct - band.fplLow) / span : 0;
      return band.percentageLow + (band.percentageHigh - band.percentageLow) * frac;
    }
  }
  return 0;
}

/**
 * Whether an exact FPL% falls within a credit-eligible band. With the post-2025
 * table the top band ends at 400% FPL (the subsidy cliff returns), so income
 * above it is not covered and earns no credit; an open-ended top band (the
 * ARPA-enhanced schedule) instead covers everything above its floor.
 */
export function acaCovered(fplPct: number, data: AcaData): boolean {
  for (const band of data.applicablePercentage) {
    if (band.fplHigh === null) {
      if (fplPct >= band.fplLow) return true;
    } else if (fplPct >= band.fplLow && fplPct < band.fplHigh) {
      return true;
    }
  }
  return false;
}

export interface AcaResult {
  /** Household income as a percentage of the poverty line. */
  fplPercent: number;
  /** Applicable percentage of income expected toward the benchmark plan. */
  applicablePercent: number;
  /** Annual income expected to go toward the benchmark plan. */
  expectedAnnualContribution: Money;
  /** Monthly version of the expected contribution. */
  expectedMonthlyContribution: Money;
  /** Estimated monthly premium tax credit (≥ 0). */
  monthlyCredit: Money;
  /** Estimated annual premium tax credit (≥ 0). */
  annualCredit: Money;
  /** True when a credit is available (income ≥ 100% FPL and the benchmark exceeds the contribution). */
  eligible: boolean;
  /** True when income is below 100% FPL (Medicaid territory in expansion states). */
  belowMedicaidFloor: boolean;
  /** True when income is above the top subsidy band (the 400% FPL cliff, restored for 2026). */
  aboveSubsidyCap: boolean;
}

/**
 * Estimate the ACA premium tax credit (§4.2). The credit is the benchmark
 * (second-lowest-cost silver) plan premium minus the household's expected
 * contribution — income times the applicable percentage for its FPL band. For
 * plan year 2026 the ARPA/IRA-enhanced subsidies have expired, so the table
 * reverts to the higher applicable percentages and the 400%-FPL cliff returns:
 * above 400% FPL there is no credit. The benchmark premium is per-county, so the
 * user supplies it (from HealthCare.gov); we ship the cited applicable-percentage
 * table and compute the rest deterministically.
 */
export function estimatePremiumTaxCredit(
  input: { householdSize: number; annualIncome: number; benchmarkMonthlyPremium: number },
  aca: AcaData,
  fpl: FederalPovertyLevelData,
): AcaResult {
  const pct = fplPercent(input.annualIncome, input.householdSize, fpl);
  const belowMedicaidFloor = pct < 100;
  // Above the top band (the 400% FPL cliff, restored for plan year 2026 once the
  // enhanced subsidies expired) there is no premium tax credit at all.
  const aboveSubsidyCap = pct >= 100 && !acaCovered(pct, aca);
  const applicablePercent = acaApplicablePercent(pct, aca);
  const expectedAnnual = Money.from(Math.max(0, input.annualIncome)).multiply(
    applicablePercent / 100,
  );
  const benchmarkAnnual = Money.from(Math.max(0, input.benchmarkMonthlyPremium)).multiply(12);
  const rawCredit = benchmarkAnnual.subtract(expectedAnnual);
  const annualCredit = aboveSubsidyCap || rawCredit.isNegative() ? Money.zero() : rawCredit;
  return {
    fplPercent: pct,
    applicablePercent,
    expectedAnnualContribution: expectedAnnual,
    expectedMonthlyContribution: expectedAnnual.divide(12),
    monthlyCredit: annualCredit.divide(12),
    annualCredit,
    eligible: pct >= 100 && !aboveSubsidyCap && annualCredit.greaterThan(0),
    belowMedicaidFloor,
    aboveSubsidyCap,
  };
}
