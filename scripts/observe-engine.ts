/**
 * The observation harness.
 *
 * `check-boundaries` can tell you that flipping a `<=` to a `<` fails no test.
 * It cannot tell you *why*, and the two reasons are opposites. Either a real
 * decision is untested — somebody must go and write the case — or the branch
 * and its `else` compute the same answer at that point, in which case no test
 * can ever hold it and asking for one is asking for a fixture that manufactures
 * a difference. On 2026-08-31 roughly two thirds of the surviving backlog turned
 * out to be the second kind, and telling them apart took a person reading each
 * line. A list whose entries all mean "look at this" but where most mean
 * "nothing to see" is the report people stop reading.
 *
 * So this runs the engine. It calls every function that contains an
 * inclusive/exclusive comparison, at and immediately around the exact values
 * those comparisons test, and returns everything it computed. Run it once
 * against the original source and once against a mutation: if any observed
 * value moved, the mutation is *observable* and a test could hold it. If none
 * did, the two readings agree everywhere this probe looked.
 *
 * That second sentence is the honest one, and it is deliberately weaker than
 * "the branch is redundant". Absence of a difference over a finite probe is
 * evidence, not proof — a mutation could differ only at an input nobody thought
 * to include. The report says "no observed difference", never "redundant", and
 * the probe is calibrated against the boundaries that ARE held: every one of
 * those must show a difference here, because a test distinguishes them by
 * definition. When one does not, this file is too weak and the report says so
 * rather than quietly mislabelling a real gap.
 *
 * Deterministic by construction: fixed inputs, no clock, no randomness. The
 * values come from the shipped shards, so a data refresh moves the probe with
 * the thresholds rather than leaving it pointed at last year's numbers.
 *
 * The grain of "reaches" is the FUNCTION, not the file. `PROBED_FILES` said
 * `contributionLimits.ts` was covered while `selfEmployedPlanCeilings` in it was
 * called by nothing here, and the classifier's own calibration only caught that
 * because the comparison inside it happens to be held by a test -- a boundary
 * nobody holds, in a function nobody calls, would have been reported as "no
 * observed difference" for the sole reason that nothing looked. So
 * `observeEngine.test.ts` walks src/engine's call graph from the entry points
 * named below and fails on a function holding a comparison that none of them
 * can reach.
 */
import { Money } from "../src/engine/money";
import { amtScreen } from "../src/engine/amt";
import {
  acaApplicablePercent,
  acaCovered,
  acaCreditEligible,
  estimatePremiumTaxCredit,
  estimateSnap,
  estimateSaversCredit,
  estimateEitc,
  fplKeyedRows,
  fplPercent,
  medicaidEligibility,
  povertyLine,
} from "../src/engine/benefits";
import {
  findCliffs,
  planSweep,
  sweepResources,
  findTaxSteps,
  type CliffData,
  type CliffInput,
  type ResourcePoint,
} from "../src/engine/cliffs";
import { fifoSelect, costBasisGain } from "../src/engine/costBasis";
import { estimatedTaxDueDates } from "../src/engine/dueDates";
import { deadlineStatus, type Deadline } from "../src/engine/deadline";
import { educationCredits } from "../src/engine/educationCredits";
import { estimateSai, estimatePell } from "../src/engine/fafsa";
import {
  balanceTransferBreakEven,
  cashFlowTimeline,
  coastFireProjection,
  debtPayoff,
  healthPlanAnnualCost,
  loanPrincipalFromPayment,
  monthlyMortgagePayment,
  rentVsBuy,
  retirementDrawdown,
} from "../src/engine/finance";
import { garnishmentCeiling } from "../src/engine/garnishment";
import { estimateUi } from "../src/engine/stateUi";
import {
  electiveDeferralCatchUp,
  electiveDeferralLimit,
  inEnhancedCatchUpWindow,
  selfEmployedPlanCeilings,
} from "../src/engine/contributionLimits";
import { iraDeductibility } from "../src/engine/iraDeduction";
import { evaluatePlan, DEFAULT_CONFIG, type PlanInput } from "../src/engine/plan";
import { requiredMinimumDistribution } from "../src/engine/rmd";
import { projectIBond } from "../src/engine/savingsBond";
import { socialSecurityBenefit, fullRetirementAgeMonths } from "../src/engine/socialSecurity";
import { spousalBenefit, survivorBenefit, survivorFraMonths } from "../src/engine/ssFamily";
import { medicareSavingsScreen } from "../src/engine/medicareSavings";
import { applicablePercentage, compareDependentCare } from "../src/engine/dependentCare";
import {
  interestDeduction,
  rapOutcome,
  standardOutcome,
  standardYears,
} from "../src/engine/studentLoans";
import { socialSecurityBenefitTaxation } from "../src/engine/socialSecurityTax";
import {
  bracketTax,
  marginalBracketRate,
  federalTaxDeductionFor,
  incomeRecaptureFor,
  personalCreditRateFor,
  standardDeductionPhaseOutFor,
} from "../src/engine/tax/brackets";
import { taxLossHarvest } from "../src/engine/taxMoves";
import { projectTrumpAccount } from "../src/engine/trumpAccount";
import { pmiEndDates } from "../src/engine/pmi";
import { homeSaleGain } from "../src/engine/homeSale";
import { earlyDistributionCost, incomeTaxOnDistribution } from "../src/engine/earlyDistribution";
import type { BundledData } from "../src/data/browser";
import type { CitationData, FilingStatus, Jurisdiction } from "../src/data/schemas";

/** The engine files this probe claims to reach. A boundary in a file absent
 *  from this list cannot be classified, and the report must say so. */
export const PROBED_FILES = [
  "src/engine/amt.ts",
  "src/engine/benefits.ts",
  "src/engine/cliffs.ts",
  "src/engine/costBasis.ts",
  "src/engine/deadline.ts",
  "src/engine/dueDates.ts",
  "src/engine/educationCredits.ts",
  "src/engine/fafsa.ts",
  "src/engine/finance.ts",
  "src/engine/garnishment.ts",
  "src/engine/stateUi.ts",
  "src/engine/contributionLimits.ts",
  "src/engine/iraDeduction.ts",
  "src/engine/plan.ts",
  "src/engine/rmd.ts",
  "src/engine/savingsBond.ts",
  "src/engine/socialSecurity.ts",
  "src/engine/ssFamily.ts",
  "src/engine/medicareSavings.ts",
  "src/engine/dependentCare.ts",
  "src/engine/studentLoans.ts",
  "src/engine/socialSecurityTax.ts",
  "src/engine/tax/brackets.ts",
  "src/engine/taxMoves.ts",
  "src/engine/trumpAccount.ts",
  "src/engine/pmi.ts",
  "src/engine/homeSale.ts",
  "src/engine/earlyDistribution.ts",
];

const citation: CitationData = {
  sourceUrl: "https://example.invalid/probe",
  sourceDocument: "probe fixture",
  effectiveYear: 2026,
  dateRetrieved: "2026-08-31",
};

/** A bracket schedule with a threshold to sit exactly on. */
const SCHEDULE = [
  { lowerBound: 0, rate: 0 },
  { lowerBound: 26_050, rate: 0.0275, baseTax: 332 },
  { lowerBound: 100_000, rate: 0.035, baseTax: 2_366 },
];

/** A jurisdiction carrying every optional capability that holds a comparison. */
const RAMPED: Jurisdiction = {
  federalTaxDeduction: {
    capByFilingStatus: { single: 8_250 },
    phaseOut: { byFilingStatus: { single: { agiThreshold: 125_000, agiZero: 145_000 } } },
  },
  incomeRecapture: {
    stages: [{ thresholdLow: 84_500, thresholdHigh: 104_500, amount: 450 }],
  },
  personalCreditRate: {
    byFilingStatus: {
      single: [
        { agiUpTo: 25_000, rate: 0.75 },
        { agiUpTo: 50_000, rate: 0.5 },
      ],
    },
  },
  standardDeductionPhaseOut: {
    byFilingStatus: { single: { maximum: 13_960, threshold: 20_120, reductionRate: 0.12 } },
  },
} as unknown as Jurisdiction;

const planInput: PlanInput = {
  liquidSavings: 1_000,
  essentialMonthlyExpenses: 3_000,
  employerMatchAnnual: 4_000,
  employerMatchCaptured: 4_000,
  debts: [{ name: "Card", balance: 4_000, ratePct: 8 }],
  retirementContributionsAnnual: 24_500,
  retirementLimitAnnual: 24_500,
  retirementLimitCitation: citation,
  sinkingGoals: [{ name: "Roof", target: 5_000, saved: 5_000 }],
  netWorth: 900_000,
};

const point = (
  grossIncome: number,
  totalResources: number,
  stateTaxableIncome: number | null = null,
): ResourcePoint => ({
  grossIncome,
  netAfterTax: totalResources,
  credits: 0,
  acaPremiumCredit: 0,
  snapAllotment: 0,
  totalResources,
  stateTaxableIncome,
  medicaidEligible: null,
});

/**
 * Run every probe and return what each computed.
 *
 * Keys are stable and name the boundary they are aimed at, so a difference
 * between two runs reads as a sentence rather than an index.
 */
export function observeEngine(data: BundledData): Record<string, unknown> {
  const o: Record<string, unknown> = {};
  const put = (key: string, value: unknown): void => {
    o[key] = value instanceof Money ? value.toNumber() : value;
  };

  // --- tax/brackets: on a threshold, and either side of it ------------------
  for (const n of [0, 26_049.99, 26_050, 26_050.01, 99_999.99, 100_000, 100_000.01]) {
    put(`bracketTax(${n})`, bracketTax(Money.from(n), SCHEDULE));
    put(`marginalBracketRate(${n})`, marginalBracketRate(Money.from(n), SCHEDULE));
  }
  for (const agi of [124_999, 125_000, 144_999, 145_000, 145_001]) {
    put(
      `federalTaxDeductionFor(${agi})`,
      federalTaxDeductionFor(RAMPED, "single", Money.from(20_000), Money.from(agi)),
    );
  }
  for (const t of [84_499, 84_500, 104_499, 104_500, 104_501]) {
    put(`incomeRecaptureFor(${t})`, incomeRecaptureFor(RAMPED, "single", t));
  }
  for (const agi of [24_999, 25_000, 25_001, 50_000, 50_001]) {
    put(`personalCreditRateFor(${agi})`, personalCreditRateFor(RAMPED, "single", agi));
  }
  put("standardDeductionPhaseOutFor", standardDeductionPhaseOutFor(RAMPED, "single"));

  // --- benefits -------------------------------------------------------------
  const fpl = data.fpl("contiguous")!;
  const snap = data.snap()!;
  const aca = data.aca()!;
  const line1 = povertyLine(1, fpl).toNumber();
  const snapProbe = (size: number, gross: number, earned: number): void => {
    const r = estimateSnap(
      { householdSize: size, monthlyGrossIncome: gross, monthlyEarnedIncome: earned },
      snap,
      fpl,
    );
    put(`snap(${size},${gross},${earned})`, {
      eligible: r.eligible,
      gross: r.passedGrossTest,
      net: r.passedNetTest,
      benefit: r.monthlyBenefit.toNumber(),
    });
  };
  // 17, 18 and 19 stand either side of the flat large-household allotment, so
  // a mutated `>=` there changes an answer.
  for (const size of [1, 2, 3, 8, 9, 17, 18, 19]) {
    // The two income tests are the point: derive each limit from the shard and
    // stand exactly on it, a cent either side. An arbitrary income never does.
    const monthlyLine = povertyLine(size, fpl).toNumber() / 12;
    const grossLimit = monthlyLine * (snap.grossIncomeLimitPctFpl / 100);
    const netLimit = monthlyLine * (snap.netIncomeLimitPctFpl / 100);
    const stdDed = Number(
      snap.standardDeductionByHouseholdSize[
        String(
          Math.min(
            size,
            Math.max(...Object.keys(snap.standardDeductionByHouseholdSize).map(Number)),
          ),
        )
      ] ?? 0,
    );
    for (const d of [-0.01, 0, 0.01]) snapProbe(size, grossLimit + d, 0);
    // Unearned income only, so net is gross less the standard deduction: this
    // puts the NET test exactly on its limit rather than near it.
    for (const d of [-0.01, 0, 0.01]) snapProbe(size, netLimit + stdDed + d, 0);
    snapProbe(size, 2_012, 0);
    snapProbe(size, 2_012, 2_012);
  }
  for (const income of [line1 - 1, line1, line1 * 4 - 1, line1 * 4, line1 * 4 + 1]) {
    const r = estimatePremiumTaxCredit(
      { householdSize: 1, annualIncome: income, benchmarkMonthlyPremium: 800 },
      aca,
      fpl,
    );
    put(`ptc(${income})`, {
      eligible: r.eligible,
      aboveCap: r.aboveSubsidyCap,
      below: r.belowMedicaidFloor,
      credit: r.annualCredit.toNumber(),
      pct: r.applicablePercent,
    });
  }
  const OPEN = {
    ...aca,
    applicablePercentage: [
      { fplLow: 0, fplHigh: 400, percentageLow: 0, percentageHigh: 8.5 },
      { fplLow: 400, fplHigh: null, percentageLow: 8.5, percentageHigh: 8.5 },
    ],
  };
  for (const pct of [399.99, 400, 500]) {
    put(`acaCoveredOpen(${pct})`, acaCovered(pct, OPEN));
    put(`acaApplicableOpen(${pct})`, acaApplicablePercent(pct, OPEN));
  }
  for (const band of aca.applicablePercentage) {
    for (const d of [-0.01, 0, 0.01]) {
      const pct = band.fplLow + d;
      put(`acaCovered(${pct})`, acaCovered(pct, aca));
      put(`acaApplicable(${pct})`, acaApplicablePercent(pct, aca));
    }
    if (band.fplHigh !== null) {
      for (const d of [-0.01, 0, 0.01]) {
        const pct = band.fplHigh + d;
        put(`acaCovered(${pct})`, acaCovered(pct, aca));
        put(`acaApplicable(${pct})`, acaApplicablePercent(pct, aca));
      }
    }
  }
  // The whole §36B(c)(1)(A) band, which `acaCovered` does not answer on its own:
  // the applicable-percentage table starts at 0% FPL and says yes at 50, where
  // the credit says no. Its `>= 100` is held by a test and was invisible to this
  // probe, which made the calibration refuse the report.
  for (const pct of [99.99, 100, 100.01, 400, 400.01]) {
    put(`acaCreditEligible(${pct})`, acaCreditEligible(pct, aca));
  }
  const medicaid = data.medicaid()!;
  for (const income of [line1 * 1.38, line1 * 1.39]) {
    put(
      `medicaid(${Math.round(income)})`,
      medicaidEligibility({ stateCode: "OH", income, householdSize: 1 }, medicaid, fpl).eligible,
    );
  }
  // Sit exactly on each tier ceiling the shard names -- the saver's credit is a
  // CLIFF, in its own shard's words, so a dollar decides a rate.
  const savers = data.saversCredit()!;
  for (const tier of savers.tiers) {
    for (const agi of [tier.agiCapSingle - 1, tier.agiCapSingle, tier.agiCapSingle + 1]) {
      put(
        `savers(${agi})`,
        estimateSaversCredit({ agi, filingStatus: "single", contributions: 2_000 }, savers).rate,
      );
    }
  }
  const eitcCtc = data.eitcCtc()!;
  for (const income of [0, 10_000, 20_000, 50_000]) {
    put(
      `eitc(${income})`,
      estimateEitc({ earnedIncome: income, qualifyingChildren: 1, married: false }, eitcCtc).credit,
    );
  }
  put("fplPercent(exact)", fplPercent(line1, 1, fpl));

  // --- socialSecurityTax: the statutory bases -------------------------------
  const sst = data.socialSecurityTaxation()!;
  const params = (s: FilingStatus) => ({
    base1: sst.base1ByFilingStatus[s]!,
    base2: sst.base2ByFilingStatus[s]!,
    tier1InclusionRate: sst.tier1InclusionRate,
    tier2InclusionRate: sst.tier2InclusionRate,
  });
  for (const status of ["single", "married_jointly"] as FilingStatus[]) {
    const p = params(status);
    for (const provisional of [p.base1 - 1, p.base1, p.base1 + 1, p.base2, p.base2 + 1]) {
      const r = socialSecurityBenefitTaxation(
        { socialSecurityBenefits: 20_000, otherIncome: provisional - 10_000, taxExemptInterest: 0 },
        p,
      );
      put(`ssTax(${status},${provisional})`, {
        tier: r.tier,
        taxable: r.taxableBenefits.toNumber(),
      });
    }
  }

  // --- contributionLimits: the 50 and 60-63 catch-up edges ------------------
  // 63 and 64 are the pair that matters: §414(v)(2)(E)(i) reaches a participant
  // who attains 60 but not 64, so the window closes rather than running on.
  const deferralLimits = data.retirementLimits()!.limits;
  for (const age of [49, 50, 59, 60, 63, 64]) {
    put(`deferral(${age})`, {
      catchUp: electiveDeferralCatchUp(age, deferralLimits),
      limit: electiveDeferralLimit(age, deferralLimits),
      // The window predicate is its own comparison and needs its own reading:
      // `catchUp` alone cannot see `age >= 60` when the shard's enhanced amount
      // is what makes the two differ, so the probe reported a boundary a test
      // holds as invisible, and the calibration refused the whole report.
      inWindow: inEnhancedCatchUpWindow(age, deferralLimits),
    });
  }

  // The solo 401(k) changeover, which this probe could not see until 2026-09-07.
  //
  // `selfEmployedPlanCeilings` was imported by nothing here, so its `additions
  // >= compensation` was invisible — and because that comparison IS held by a
  // test, the calibration caught it and the whole report said so: "the probe is
  // too weak", which invalidates every *no observed difference* verdict beside
  // it. A probe that cannot see a boundary a test holds cannot be trusted about
  // one no test holds.
  //
  // The line is where compensation equals the additions the two §415(c) limbs
  // would otherwise allow, and net earnings equal to the §402(g) deferral is
  // exactly that point: the deferral alone reaches compensation, so limb (B)
  // binds and there is no employer share worth making. Either side of it is a
  // different sentence on the tile.
  const deferral = deferralLimits.elective_deferral_401k;
  for (const net of [deferral - 1, deferral, deferral + 1, 9_294, 83_642]) {
    const c = selfEmployedPlanCeilings(net, 45, deferralLimits);
    put(`soloCeilings(${net})`, {
      sep: c.sep,
      solo: c.solo,
      employerShare: c.employerShare,
      employeeDeferral: c.employeeDeferral,
      cappedByCompensation: c.cappedByCompensation,
    });
  }

  // --- iraDeduction / educationCredits: phase-out endpoints -----------------
  const ira = data.iraDeduction()!;
  const limits = { ira_contribution: 7_500, ira_catch_up_50plus: 1_100 };
  for (const magi of [80_999, 81_000, 81_001, 90_999, 91_000, 91_001]) {
    const r = iraDeductibility(
      {
        filingStatus: "single",
        magi,
        contribution: 7_500,
        coveredByPlan: true,
        spouseCoveredByPlan: false,
        age50Plus: false,
      },
      limits,
      ira,
    );
    put(`ira(${magi})`, { status: r.status, deductible: r.deductible.toNumber() });
  }
  const edu = data.educationCredits()!;
  for (const magi of [79_999, 80_000, 80_001, 89_999, 90_000, 90_001]) {
    for (const expenses of [0, 1, 2_000, 4_000, 12_000]) {
      const r = educationCredits(
        { magi, qualifiedExpenses: expenses, married: false, aotcEligible: true },
        edu,
      );
      put(`edu(${magi},${expenses})`, {
        fraction: r.phaseOutFraction,
        better: r.better,
        aotc: r.aotc.afterPhaseout.toNumber(),
        llc: r.llc.afterPhaseout.toNumber(),
      });
    }
  }
  put(
    "eduNoAotc",
    educationCredits(
      { magi: 0, qualifiedExpenses: 4_000, married: false, aotcEligible: false },
      edu,
    ).better,
  );

  // --- amt: the exemption, the 28% breakpoint, the verdict band -------------
  const amt = data.amt()!;
  const exempt = amt.exemptionByFilingStatus.single!;
  const brk = amt.rate28ThresholdByFilingStatus.single!;
  for (const [amti, regularTax] of [
    [50_000, 0],
    [exempt, 0],
    [exempt + brk, 0],
    [exempt + brk + 100, 0],
    [175_100, 26_000],
    [175_100, 26_001],
    [175_100, 20_000],
    [600_000, 0],
  ] as [number, number][]) {
    const r = amtScreen({ filingStatus: "single", amtIncome: amti, regularTax }, amt);
    put(`amt(${amti},${regularTax})`, {
      verdict: r.verdict,
      tmt: r.tentativeMinimumTax.toNumber(),
      exemption: r.exemption.toNumber(),
    });
  }

  // --- unemployment insurance: every line a state's rule draws --------------
  // Each probe stands on a threshold and a cent either side: California's
  // schedule-to-divisor seam and its 1.25x path, Florida's 1.5x and $3,400,
  // Texas's 37x and its weekly maximum.
  // The rules load on demand, so the caller loads them first (`loadStateUi`); a
  // probe against a state that was not loaded fails loudly rather than skipping.
  const uiProbe = (code: string, q: [number, number, number, number], creditWeeks = 26): void => {
    const rules = data.loadedStateUi(code)?.data;
    if (!rules) throw new Error(`load the ${code} unemployment rules before observing them`);
    const r = estimateUi({ quarterlyWages: q, creditWeeks, hours: 2080 }, rules);
    put(`ui(${code},${q.join("/")})`, {
      eligible: r.eligible,
      weekly: r.weeklyTotal,
      total: r.maxBenefit,
      basis: r.maxBenefitBasis,
    });
  };
  for (const hq of [899.99, 900, 1832.99, 1833, 11674, 11674.01]) uiProbe("ca", [hq, hq, 0, 0]);
  for (const other of [299.99, 300, 300.01]) uiProbe("ca", [1200, other, 0, 0]);
  for (const other of [1499.99, 1500, 1500.01]) uiProbe("fl", [3000, other, 0, 0]);
  for (const other of [399.99, 400, 400.01]) uiProbe("fl", [3000, other, 0, 0]);
  for (const hq of [7149.99, 7150, 7176]) uiProbe("fl", [hq, hq, hq, hq]);
  for (const other of [811.99, 812, 812.01]) uiProbe("tx", [2000, other, 0, 0]);
  for (const hq of [15474.99, 15475, 15500.01]) uiProbe("tx", [hq, hq, 0, 0]);
  // New York: the $3,575 low-earner line, the $4,000 averaging line, the $3,500
  // wage test, and the $19,118 cap in the 1.5x test.
  for (const hq of [3574.99, 3575, 3575.01]) uiProbe("ny", [hq, hq, hq, hq]);
  for (const hq of [3999.99, 4000, 4000.01]) uiProbe("ny", [hq, 3000, 0, 0]);
  for (const hq of [3499.99, 3500, 3500.01]) uiProbe("ny", [hq, 3000, 0, 0]);
  for (const other of [9558.99, 9559, 9559.01]) uiProbe("ny", [30000, other, 0, 0]);
  // Pennsylvania: the first row, a row's qualifying total, the 37% share, the
  // maximum row, and 18 credit weeks.
  for (const hq of [1687.99, 1688, 1712, 1713]) uiProbe("pa", [hq, 1100, 0, 0]);
  for (const last of [922.99, 923, 924]) uiProbe("pa", [7500, 2000, 1500, last]);
  for (const hq of [15387.99, 15388]) uiProbe("pa", [hq, 5000, 5000, 5000]);
  for (const cw of [17, 18, 26, 27]) uiProbe("pa", [7500, 2000, 1500, 924], cw);
  // Illinois: $440 outside the high quarter, $1,600 in all. Ohio: 20 weeks and
  // the $352 average wage. Michigan: the high-quarter floor and both paths.
  for (const other of [439.99, 440, 440.01]) uiProbe("il", [5000, other, 0, 0]);
  for (const total of [1599.99, 1600, 1600.01]) uiProbe("il", [total - 800, 800, 0, 0]);
  for (const cw of [19, 20, 21]) uiProbe("oh", [5000, 5000, 0, 0], cw);
  for (const pay of [7039.99, 7040, 7059.99]) uiProbe("oh", [pay, 0, 0, 0], 20);
  for (const hq of [5327.99, 5328, 5328.01]) uiProbe("mi", [hq, hq, 0, 0]);
  for (const other of [6677.59, 6677.6, 6677.61]) uiProbe("mi", [20000, other, 0, 0]);
  // NJ's 20 base weeks; VA's first band, a duration column and the cap row;
  // WA's minimum against the weekly-wage cap; AZ's half-dollar; MA's $6,300.
  for (const cw of [19, 20, 52, 53]) uiProbe("nj", [10000, 10000, 10000, 10000], cw);
  for (const two of [2999.99, 3000, 3000.01, 3050, 3050.01])
    uiProbe("va", [two / 2, two / 2, 0, 0]);
  for (const last of [1349.99, 1350]) uiProbe("va", [10000, 8900.01, last, 0]);
  for (const hq of [18900, 18900.01, 18950.01]) uiProbe("va", [hq, 1, 0, 0]);
  for (const avg of [4979, 4979.01, 5098]) uiProbe("wa", [avg, avg, 0, 0]);
  for (const hq of [6012.49, 6012.5, 7987.49, 7987.5]) uiProbe("az", [hq, hq / 2, 0, 0]);
  for (const second of [3149.99, 3150]) uiProbe("ma", [3150, second, 0, 0]);
  // TN's first row and its $4,420 seam; IN's last-two-quarters test; MD's top
  // line and its qualifying wages; MO's two routes; CO's consecutive pair.
  for (const a of [780, 780.01, 4420, 4420.01]) uiProbe("tn", [a, a, a, a]);
  for (const late of [1249.99, 1250]) uiProbe("in", [3000, 1500, late, late]);
  for (const total of [15479, 15480]) uiProbe("md", [12000, total - 12000, 0, 0]);
  for (const other of [3499.99, 3500]) uiProbe("mo", [10000, other, 0, 0]);
  for (const first of [7999.99, 8000]) uiProbe("co", [first, 8000, 1000, 1000]);
  for (const hq of [1349.99, 1350, 9249.99, 9250]) uiProbe("wi", [hq, 3700, 0, 0]);
  for (const other of [1479.99, 1480]) uiProbe("wi", [20000, other, 0, 0]);
  for (const last of [1178.99, 1179]) uiProbe("sc", [1092, 1092, 1092, last]);
  // Alabama's $44.50 line, its even fifty cents dropped, and its $274.50 line.
  for (const [a, b] of [
    [1157, 1157],
    [1157, 1157.01],
    [1183, 1183],
    [7137, 7137],
    [7137, 7137.01],
  ] as const)
    uiProbe("al", [a, b, 600, 0]);

  // --- garnishment: the crossover -------------------------------------------
  const garn = data.garnishmentLimits()!;
  for (const d of [217.5, 289, 290, 291, 1_000]) {
    const r = garnishmentCeiling(
      { disposableEarnings: d, payPeriod: "weekly", kind: "ordinary" },
      garn,
    );
    put(`garnish(${d})`, { binding: r.binding, max: r.federalMaximum?.toNumber() ?? null });
  }

  // --- dueDates / deadline / rmd / socialSecurity ---------------------------
  for (const year of [2017, 2023, 2025, 2028, 2034]) {
    put(
      `dueDates(${year})`,
      estimatedTaxDueDates(year).map((d) => `${d.due.toISOString().slice(0, 10)}:${d.adjusted}`),
    );
  }
  // Typed, not cast: the first version of this fixture said `{ kind: "fixed",
  // date: ... }`, which `DeadlineDue` does not have. A cast let it compile, the
  // due date resolved to null, every probe read "unresolved", and the classifier
  // reported a held boundary as invisible. The cast was the bug.
  const deadline: Deadline = {
    label: "File the return",
    due: { on: "2026-04-15" },
    citation,
  };
  // "soon" begins exactly SOON_DAYS out, so 2026-03-16 is the edge of the band.
  for (const asOf of [
    "2026-03-15",
    "2026-03-16",
    "2026-03-17",
    "2026-04-14",
    "2026-04-15",
    "2026-04-16",
  ]) {
    put(`deadline(${asOf})`, deadlineStatus(deadline, asOf));
  }
  const rmd = data.rmd()!;
  for (const age of [71, 72, 73, 74, 100]) {
    const r = requiredMinimumDistribution(age, 500_000, rmd);
    put(`rmd(${age})`, { required: r.required, amount: r.amount.toNumber() });
  }
  const ss = data.socialSecurity()!;
  for (const born of [1937, 1954, 1955, 1960, 1961])
    put(`fra(${born})`, fullRetirementAgeMonths(born, ss));
  // 61 and 71 are outside the claiming window, so they read as the clamp.
  for (const claim of [61, 62, 67, 70, 71]) {
    const r = socialSecurityBenefit(2_000, 1960, claim, ss);
    put(`ssBenefit(${claim})`, r.monthlyBenefit);
    put(`ssClaimAgeMonths(${claim})`, r.claimAgeMonths);
  }

  // --- savingsBond: the holding period and the five-year penalty ------------
  const bonds = data.treasuryBonds();
  if (bonds) {
    const periods = bonds.rates.map((r) => r.period);
    // Newest first: 1 period held (locked), 2 (just redeemable), 3, and 10 (no
    // penalty) — the two boundaries this file owns, from either side.
    for (const back of [1, 2, 3, 10]) {
      const period = periods[periods.length - back];
      if (!period) continue;
      const r = projectIBond(10_000, period, bonds);
      put(`iBond(${back})`, {
        periodsHeld: r?.periodsHeld ?? null,
        redeemable: r?.redeemable ?? null,
        penalty: r?.earlyRedemptionPenalty.toNumber() ?? null,
        redemptionValue: r?.redemptionValue.toNumber() ?? null,
      });
    }
  }

  // --- fafsa ----------------------------------------------------------------
  const fafsa = data.fafsa()!;
  for (const income of [0, 30_000, 60_000, 120_000]) {
    const sai = estimateSai(
      {
        parentIncome: income,
        parentIncomeTax: 0,
        familySize: 3,
        lowerEarnerIncome: 0,
        parentAssets: 0,
        studentIncome: 0,
        studentIncomeTax: 0,
        studentAssets: 0,
        ssWageBase: 184_500,
      },
      fafsa,
    );
    put(`sai(${income})`, sai.sai);
    put(`pell(${income})`, estimatePell(sai.sai, fafsa).award);
  }
  for (const sai of [fafsa.maxPellGrant - 1, fafsa.maxPellGrant, fafsa.maxPellGrant + 1]) {
    const r = estimatePell(sai, fafsa);
    put(`pellAt(${sai})`, { eligible: r.eligible, award: r.award.toNumber() });
  }

  // --- costBasis / taxMoves -------------------------------------------------
  const lots = [
    { shares: 10, costPerShare: 100, longTerm: true },
    { shares: 10, costPerShare: 200, longTerm: false },
  ];
  for (const sell of [0, 10, 15, 20, 25]) {
    const sales = fifoSelect(lots, sell);
    put(
      `fifo(${sell})`,
      sales.map((s) => `${s.lot.costPerShare}x${s.sharesSold}`),
    );
    put(`basis(${sell})`, costBasisGain(250, sales).totalGain.toNumber());
  }
  // §530A: the contribution cap, the §6434 birth window at both of its edges,
  // and the ages either side of the distribution age — the values that section's
  // comparisons actually test.
  const trumpData = {
    taxYear: 2026,
    annualContributionLimit: 5_000,
    pilotContribution: 1_000,
    pilotBirthYearFirst: 2025,
    pilotBirthYearLast: 2028,
    contributionsOpenFrom: "2026-07-04",
    distributionAge: 18,
    citation,
  };
  for (const birthYear of [2024, 2025, 2028, 2029]) {
    for (const age of [0, 17, 18, 19]) {
      for (const contribution of [4_999, 5_000, 5_001]) {
        const r = projectTrumpAccount(
          {
            currentAge: age,
            birthYear,
            annualContribution: contribution,
            currentBalance: 0,
            annualReturnRate: 0.07,
          },
          trumpData,
        );
        put(`trump(${birthYear},${age},${contribution})`, {
          years: r.yearsToDistribution,
          pilot: r.pilotContribution.toNumber(),
          applied: r.contributionApplied.toNumber(),
          balance: Math.round(r.balanceAtDistribution.toNumber()),
          taxable: Math.round(r.taxableAtDistribution.toNumber()),
        });
      }
    }
  }
  for (const loss of [2_999, 3_000, 3_001]) {
    const r = taxLossHarvest({
      shortTermGain: 0,
      shortTermLoss: loss,
      longTermGain: 0,
      longTermLoss: 0,
      ordinaryRatePct: 22,
      longTermRatePct: 15,
      ordinaryOffsetLimit: 3_000,
    });
    put(`harvest(${loss})`, {
      deducted: r.deductibleAgainstOrdinary.toNumber(),
      carry: r.lossCarryforward.toNumber(),
    });
  }

  // --- finance --------------------------------------------------------------
  put("debtPayoff(interest-exactly)", debtPayoff(10_000, 12, 100));
  put("debtPayoff(one-cent-more)", debtPayoff(10_000, 12, 100.01)?.months ?? null);
  for (const years of [0, 1 / 12, 30]) {
    put(`mortgage(${years})`, monthlyMortgagePayment(300_000, 6, years));
    put(`principal(${years})`, loanPrincipalFromPayment(2_000, 6, years));
    put(`mortgage0(${years})`, monthlyMortgagePayment(300_000, 0, years));
    put(`principal0(${years})`, loanPrincipalFromPayment(2_000, 0, years));
  }
  // `remainingLoanBalance` is module-private; rent-vs-buy is the public path
  // that reaches it, and `years` walks the loan to and past its full term.
  for (const years of [1, 29, 30, 31]) {
    const r = rentVsBuy({
      homePrice: 400_000,
      downPayment: 80_000,
      mortgageRatePct: 6,
      termYears: 30,
      monthlyOwnershipCosts: 600,
      closingCostBuy: 8_000,
      sellingCostPct: 6,
      homeAppreciationPct: 3,
      monthlyRent: 2_200,
      rentGrowthPct: 3,
      investmentReturnPct: 5,
      years,
    });
    put(`rentVsBuy(${years})`, JSON.parse(JSON.stringify(r)));
  }
  put(
    "cashFlow(31st)",
    cashFlowTimeline(2_000, [
      { day: 1, amount: -1_400 },
      { day: 15, amount: 1_800 },
      { day: 31, amount: -900 },
    ]),
  );
  for (const balance of [899_999, 900_000, 900_001]) {
    const r = coastFireProjection({
      currentBalance: balance,
      annualRealReturnPct: 0,
      years: 20,
      targetNumber: 900_000,
    });
    put(`coast(${balance})`, { reached: r.reached, gap: r.gap.toNumber() });
  }
  for (const maxAge of [70, 90]) {
    const r = retirementDrawdown(
      {
        currentBalance: 1_000_000,
        currentAge: 65,
        annualWithdrawal: 30_000,
        realReturnPct: 3,
        maxAge,
      },
      rmd,
    );
    put(`drawdown(${maxAge})`, {
      ages: r.timeline.map((y) => y.age),
      lasts: r.lastsToMaxAge,
      depleted: r.depletedAtAge,
    });
  }
  for (const [introMonths, introApr] of [
    [12, 0],
    [11, 0],
    [18, 12],
  ] as [number, number][]) {
    const r = balanceTransferBreakEven({
      balance: introApr === 0 ? 1_200 : 10_000,
      currentAprPct: 24,
      monthlyPayment: 100,
      transferFeePct: 0,
      introAprPct: introApr,
      introMonths,
      postIntroAprPct: 24,
    });
    put(`transfer(${introMonths},${introApr})`, {
      months: r.transferMonths,
      within: r.paysOffWithinIntro,
    });
  }
  for (const spend of [1_999, 2_000, 2_001]) {
    put(
      `healthPlan(${spend})`,
      healthPlanAnnualCost({
        monthlyPremium: 300,
        deductible: 2_000,
        coinsuranceRate: 0.2,
        outOfPocketMax: 8_000,
        expectedAnnualSpend: spend,
      }).memberCost.toNumber(),
    );
  }

  // --- cliffs ---------------------------------------------------------------
  const cliffInput: CliffInput = {
    filingStatus: "single",
    householdSize: 2,
    qualifyingChildren: 0,
    stateCode: "OH",
    benchmarkMonthlyPremium: 500,
  };
  const cliffData: CliffData = {
    tax: { federal: data.federal()!, fica: data.fica()!, state: data.state("OH")! },
    fpl,
    eitcCtc,
    aca,
    snap,
    medicaid,
    snapRegionSupported: true,
  };
  for (const to of [250 * 399, 250 * 400]) {
    put(`planSweep(${to})`, planSweep(cliffInput, cliffData, { from: 0, to, step: 250 }));
  }
  const swept = sweepResources(cliffInput, cliffData, { from: 0, to: 1_000, step: 250 });
  put(
    "sweepPoints",
    swept.points.map((p) => p.grossIncome),
  );
  put("sweepWidened", swept.stepWidened);
  // A benchmark premium of exactly zero opts the ACA term out and says so; the
  // list of unmodeled programs is the observable half of that decision.
  for (const benchmarkMonthlyPremium of [0, 1]) {
    put(
      `sweepUnmodeled(${benchmarkMonthlyPremium})`,
      sweepResources({ ...cliffInput, benchmarkMonthlyPremium }, cliffData, {
        from: 0,
        to: 500,
        step: 250,
      }).unmodeled,
    );
  }
  for (const drop of [0.99, 1, 1.01, 0]) {
    put(`findCliffs(${drop})`, findCliffs([point(30_000, 20_000), point(30_250, 20_000 - drop)]));
  }
  put("findCliffs(rising)", findCliffs([point(30_000, 20_000), point(30_250, 20_100)]));
  // findTaxSteps at and around a point landing exactly on the notch. This probe
  // exists because the classifier could not see `cliffs.ts:443` at all: the
  // sweep above stops at $1,000 and never reaches Ohio's $26,050 step, so a
  // boundary that decides whether a $332 statutory step is named or lost
  // entirely had nothing observing it. A held boundary the probe cannot see is
  // reported as a miscalibration, and it is one — the hole was here.
  for (const prevTaxable of [26_049, 26_050, 26_051]) {
    put(
      `findTaxSteps(${prevTaxable})`,
      findTaxSteps([point(26_000, 0, prevTaxable), point(26_250, 0, 26_300)], "Ohio", [
        { taxableIncome: 26_050, amount: 332 },
      ]),
    );
  }

  // --- plan -----------------------------------------------------------------
  for (const [savings, netWorth, essential, rate] of [
    [1_000, 900_000, 3_000, 8],
    [999.99, 899_999, 3_000, 7.9],
    [9_000, 900_001, 3_000, 8.01],
    [0, 0, 0, 8],
  ] as [number, number, number, number][]) {
    const r = evaluatePlan(
      {
        ...planInput,
        liquidSavings: savings,
        netWorth,
        essentialMonthlyExpenses: essential,
        debts: [{ name: "Card", balance: 4_000, ratePct: rate }],
      },
      DEFAULT_CONFIG,
    );
    put(`plan(${savings},${netWorth},${essential},${rate})`, {
      current: r.current?.id ?? null,
      steps: r.steps.map((s) => `${s.id}:${s.satisfied}:${s.amount?.toNumber() ?? "-"}`),
    });
  }

  // --- PMI: a balance landing exactly on the 80% line, a cent over it, and
  // a loan that starts on it. At 0% the balance falls $1,250 a payment, so
  // $225,000 reaches $200,000 at payment 20 exactly.
  for (const loan of [200_000, 200_000.01, 225_000, 225_000.01])
    for (const extra of [0, 1]) {
      const r = pmiEndDates({
        originalValue: 250_000,
        loanAmount: loan,
        annualRatePct: 0,
        termYears: 15,
        extraMonthly: extra,
        requestShare: 0.8,
        automaticShare: 0.78,
      });
      put(`pmi(${loan},${extra})`, {
        under: r.atOrUnderRequestLine,
        request: r.request?.payment ?? null,
        extra: r.requestWithExtra?.payment ?? null,
        automatic: r.automatic?.payment ?? null,
        final: r.final.payment,
      });
    }

  // --- §121: the 24-month lines for ownership, use and a prior sale, the
  // one-year line for a long-term gain, and a gain landing on the limit.
  const homeRules = {
    maxExclusion: 250_000,
    maxExclusionJoint: 500_000,
    ownershipAndUseMonths: 24,
    lookbackMonths: 60,
    citation,
  };
  for (const [owned, lived, prior, reason, price] of [
    [23, 60, null, false, 600_000],
    [24, 60, null, false, 600_000],
    [60, 23, null, true, 600_000],
    [60, 60, 23, false, 600_000],
    [60, 60, 24, false, 600_000],
    [12, 12, null, true, 600_000],
    [13, 13, null, true, 600_000],
    [60, 60, null, false, 550_000],
    [60, 60, null, false, 550_000.01],
  ] as const) {
    const r = homeSaleGain(
      {
        joint: false,
        salePrice: price,
        sellingCosts: 0,
        basis: 300_000,
        monthsOwned: owned,
        monthsLived: lived,
        monthsSincePriorExclusion: prior,
        qualifyingReason: reason,
      },
      homeRules,
    );
    put(`homeSale(${owned},${lived},${prior},${reason},${price})`, {
      basis: r.basis,
      share: r.share,
      taxable: r.taxableGain.toNumber(),
      longTerm: r.longTerm,
    });
  }

  // --- an early distribution: the 59½ line, the separation and emergency
  // exceptions, and an excepted amount landing exactly on the distribution.
  const early = {
    additionalTaxRate: 0.1,
    mandatoryWithholdingRate: 0.2,
    penaltyFreeAge: 59.5,
    separationAge: 55,
    publicSafetySeparationAge: 50,
    emergencyExpenseLimit: 1_000,
    citation,
  };
  const fedJ = data.federal();
  const ficaD = data.fica();
  for (const [age, sep, emergency, excepted] of [
    [59.4, false, false, 0],
    [59.5, false, false, 0],
    [40, true, false, 0],
    [40, false, true, 0],
    [40, false, true, 19_000],
    [40, false, false, 20_000],
    [40, false, false, 19_999.99],
  ] as const) {
    const tax =
      fedJ && ficaD
        ? incomeTaxOnDistribution(
            20_000,
            { filingStatus: "single", wages: 60_000 },
            { federal: fedJ, fica: ficaD },
          )
        : { federal: Money.zero(), state: Money.zero() };
    const r = earlyDistributionCost(
      {
        amount: 20_000,
        age,
        separatedAtSeparationAge: sep,
        publicSafetySeparation: false,
        wholeException: false,
        emergency,
        otherExcepted: excepted,
        federalTax: tax.federal,
        stateTax: tax.state,
      },
      early,
    );
    put(`early(${age},${sep},${emergency},${excepted})`, {
      additional: r.additionalTax.toNumber(),
      because: r.noAdditionalTaxBecause,
      due: r.federalDueAtFiling.toNumber(),
    });
  }

  // --- spousal and survivor: the birth-year lines of the survivor FRA table,
  // the 36th month of a spouse's reduction, and a survivor at 60 and at FRA.
  const family = {
    spousalShare: 0.5,
    spousalReductionFirst36Numer: 25,
    spousalReductionFirst36Denom: 36,
    spousalReductionBeyondNumer: 5,
    spousalReductionBeyondDenom: 12,
    earliestSpousalAge: 62,
    earliestSurvivorAge: 60,
    survivorMaxReduction: 0.285,
    reductionRoundedUpTo: 0.1,
    survivorFullRetirementAge: [
      { bornThrough: 1956, months: 792 },
      { bornThrough: 1961, months: 802 },
      { bornThrough: null, months: 804 },
    ],
    citation,
  };
  for (const born of [1956, 1957, 1961, 1962])
    put(`survivorFra(${born})`, survivorFraMonths(born, family));
  for (const early of [35, 36, 37])
    put(
      `spousal(1600,${early})`,
      spousalBenefit(1600, 804, 804 - early, family).monthly.toNumber(),
    );
  for (const claim of [720, 803, 804])
    put(`survivor(2000,${claim})`, survivorBenefit(2000, 804, claim, family).monthly.toNumber());

  // --- Medicare Savings and Extra Help: each income line and each savings
  // limit, at it and a cent over, for one person and for a couple.
  const pair = (individual: number, couple: number) => ({ individual, couple });
  const savings = {
    year: 2026,
    programs: [
      { id: "qmb", name: "QMB", pays: "-", monthlyIncomeLine: pair(1350, 1824) },
      { id: "qi", name: "QI", pays: "-", monthlyIncomeLine: pair(1816, 2455) },
    ],
    savingsResourceLimit: pair(9950, 14910),
    extraHelp: {
      annualIncomeLine: pair(23940, 32460),
      resourceLimit: pair(16590, 33100),
      resourceLimitWithBurial: pair(18090, 36100),
      maxCopayPerDrug: 12.65,
    },
    citation,
  };
  for (const couple of [false, true])
    for (const monthlyIncome of [1350, 1350.01, 1995, 1995.01])
      for (const resources of [9950, 9950.01, 16590, 16590.01, 18090, 18090.01]) {
        const r = medicareSavingsScreen({ couple, monthlyIncome, resources }, savings);
        put(`msp(${couple},${monthlyIncome},${resources})`, {
          programs: r.programs.map((p) => p.underIncomeLine),
          savings: r.underSavingsResourceLimit,
          extraHelp: [r.extraHelp.underIncomeLine, r.extraHelp.resources],
        });
      }

  // --- the programs keyed to the poverty line: each line, at it and just
  // over, with and without children and a child under five.
  const rule = {
    sourceUrl: "https://example.org/",
    sourceDocument: "rule",
    effectiveYear: 2026,
    dateRetrieved: "2026-10-19",
  };
  const keyed = {
    year: 2026,
    programs: [
      {
        id: "meals",
        name: "m",
        pctFpl: 130,
        reducedPctFpl: 185,
        requires: "children" as const,
        worth: "-",
        categorical: "-",
        agencyUrl: "https://example.org/",
        rule,
      },
      {
        id: "wic",
        name: "w",
        pctFpl: 185,
        requires: "youngChild" as const,
        worth: "-",
        categorical: "-",
        agencyUrl: "https://example.org/",
        rule,
      },
      {
        id: "life",
        name: "l",
        pctFpl: 135,
        requires: null,
        worth: "-",
        categorical: "-",
        agencyUrl: "https://example.org/",
        rule,
      },
      {
        id: "heat",
        name: "h",
        pctFpl: null,
        ceilingPctFpl: 150,
        requires: null,
        worth: "-",
        categorical: "-",
        agencyUrl: "https://example.org/",
        rule,
      },
    ],
    citation,
  };
  for (const pct of [130, 130.01, 135, 135.01, 150, 150.01, 185, 185.01])
    for (const [children, youngChild] of [
      [0, false],
      [1, false],
      [1, true],
    ] as const)
      put(
        `keyed(${pct},${children},${youngChild})`,
        fplKeyedRows(pct, { children, youngChild }, keyed).map((r) => [
          r.id,
          r.linePct,
          r.reducedPrice,
        ]),
      );

  // --- student loans: §221's phase-out at each end, a RAP payment below and
  // above the month's interest, and the Standard term at each breakpoint.
  // Deferred, so the caller loads it first, as for the unemployment rules: a
  // probe that skipped quietly would report "no observed difference" because
  // nothing looked.
  const loans = data.studentLoans();
  if (!loans) throw new Error("load student-loans-2026 before observing it");
  {
    for (const magi of [85000, 85000.01, 99999.99, 100000])
      for (const joint of [false, true])
        put(`sl221(${magi},${joint})`, interestDeduction(2500, magi, joint, loans));
    for (const agi of [30000, 90000])
      for (const balance of [20000, 50000]) {
        const s = {
          balance,
          ratePct: 7,
          agi,
          dependents: 0,
          familySize: 1,
          incomeGrowth: 0,
          newBorrower2014: true,
        };
        put(`rap(${agi},${balance})`, rapOutcome(s, loans));
        put(`std(${agi},${balance})`, standardOutcome(s, loans));
      }
    for (const p of [24999.99, 25000, 99999.99, 100000])
      put(`stdYears(${p})`, standardYears(p, loans));
  }

  // --- dependent care: §21(a)(2)'s thresholds on each side, a cent over, both
  // floors, one child against two, and the earned-income limit at the cap.
  const care = {
    year: 2026,
    expenseCap: { one: 3000, twoOrMore: 6000 },
    deemedMonthlyEarnedIncome: { one: 250, twoOrMore: 500 },
    applicablePercentage: {
      start: 50,
      firstFloor: 35,
      firstThreshold: 15000,
      firstStep: 2000,
      secondFloor: 20,
      secondThreshold: { other: 75000, joint: 150000 },
      secondStep: { other: 2000, joint: 4000 },
    },
    fsaExclusionLimit: { other: 7500, separate: 3750 },
    citation,
  };
  for (const joint of [false, true])
    for (const agi of [15000, 15000.01, 17000, 75000, 75000.01, 150000, 150000.01, 400000])
      put(`dcPct(${joint},${agi})`, applicablePercentage(agi, joint, care));
  if (fedJ && ficaD)
    for (const [kids, lower, deemed, expenses] of [
      [1, 40000, false, 3000],
      [2, 40000, false, 3000],
      [2, 6000, false, 9000],
      [2, 5999, false, 9000],
      [2, 0, true, 6000],
      [1, 0, true, 6000],
      [2, 40000, false, 7500],
      [2, 40000, false, 7500.01],
    ] as const)
      for (const filingStatus of ["married_jointly", "married_separately"] as const) {
        const r = compareDependentCare(
          {
            filingStatus,
            wages: 90000,
            lowerEarnerWages: lower,
            spouseDeemedEarner: deemed,
            qualifyingIndividuals: kids,
            expenses,
          },
          { federal: fedJ, fica: ficaD },
          care,
        );
        put(`dc(${filingStatus},${kids},${lower},${deemed},${expenses})`, {
          credit: r.creditOnly.credit.toNumber(),
          creditable: r.creditOnly.creditable.toNumber(),
          excluded: r.fsa.excluded.toNumber(),
          fsa: r.fsa.total.toNumber(),
          better: r.better,
        });
      }

  return o;
}

/** A stable string for two runs to be compared by. */
export function observationDigest(data: BundledData): string {
  const o = observeEngine(data);
  return JSON.stringify(
    Object.keys(o)
      .sort()
      .map((k) => [k, o[k]]),
  );
}
