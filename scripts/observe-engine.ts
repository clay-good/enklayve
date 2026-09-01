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
 */
import { Money } from "../src/engine/money";
import { amtScreen } from "../src/engine/amt";
import {
  acaApplicablePercent,
  acaCovered,
  estimatePremiumTaxCredit,
  estimateSnap,
  estimateSaversCredit,
  estimateEitc,
  fplPercent,
  medicaidEligibility,
  povertyLine,
} from "../src/engine/benefits";
import {
  findCliffs,
  planSweep,
  sweepResources,
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
import { iraDeductibility } from "../src/engine/iraDeduction";
import { evaluatePlan, DEFAULT_CONFIG, type PlanInput } from "../src/engine/plan";
import { requiredMinimumDistribution } from "../src/engine/rmd";
import { socialSecurityBenefit, fullRetirementAgeMonths } from "../src/engine/socialSecurity";
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
  "src/engine/iraDeduction.ts",
  "src/engine/plan.ts",
  "src/engine/rmd.ts",
  "src/engine/socialSecurity.ts",
  "src/engine/socialSecurityTax.ts",
  "src/engine/tax/brackets.ts",
  "src/engine/taxMoves.ts",
  "src/engine/trumpAccount.ts",
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

const point = (grossIncome: number, totalResources: number): ResourcePoint => ({
  grossIncome,
  netAfterTax: totalResources,
  credits: 0,
  acaPremiumCredit: 0,
  snapAllotment: 0,
  totalResources,
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
  for (const size of [1, 2, 3, 8, 9]) {
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
    snapProbe(size, 1_959, 0);
    snapProbe(size, 1_959, 1_959);
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
  for (const claim of [62, 67, 70]) {
    put(`ssBenefit(${claim})`, socialSecurityBenefit(2_000, 1960, claim, ss).monthlyBenefit);
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
