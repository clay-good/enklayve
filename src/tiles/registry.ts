/**
 * The tile catalog (BUILD-SPEC.md §3–5, BUILD-SPEC-2 §4/§6). Consolidated
 * 2026-06-02: the 59 individual calculators are now grouped into 10 topic
 * "hubs" (see hub.ts), so the home grid and All
 * Tools index show a handful of calm areas. Each hub reuses the existing
 * calculators' `mount` functions unchanged behind a segmented control. The
 * command palette and home search query SEARCH_ENTRIES (hubs + every sub-tool),
 * so searching "EITC" or "refinance" still jumps straight to that calculator.
 */
import type { HubConfig } from "./hub";
import { defineHub } from "./hub";
import type { TileDefinition } from "./types";
import { takeHomeTile } from "./takeHome";
import { hourlySalaryTile } from "./hourlySalary";
import { federalIncomeTaxTile } from "./federalIncomeTax";
import { selfEmploymentTaxTile } from "./selfEmploymentTax";
import { quarterlyTaxesTile } from "./quarterlyTaxes";
import { freelanceRateTile } from "./freelanceRate";
import { contractVsSalaryTile } from "./contractVsSalary";
import { selfEmployedRetirementTile } from "./selfEmployedRetirement";
import { marginalExplorerTile } from "./marginalExplorer";
import { loanAmortizationTile } from "./loanAmortization";
import { refinanceTile } from "./refinance";
import { autoLoanTile } from "./autoLoan";
import { compoundGrowthTile } from "./compoundGrowth";
import { retirementOptimizerTile } from "./retirementOptimizer";
import { capitalGainsTile } from "./capitalGains";
import { savingsBondTile } from "./savingsBond";
import { inflationTile } from "./inflation";
import { rmdTile } from "./rmd";
import { taxLossHarvestingTile } from "./taxLossHarvesting";
import { lotPickerTile } from "./lotPicker";
import { childTaxTile } from "./childTax";
import { educationCreditsTile } from "./educationCredits";
import { rothLadderTile } from "./rothLadder";
import { backdoorRothTile } from "./backdoorRoth";
import { iraDeductionTile } from "./iraDeduction";
import { balanceTransferTile } from "./balanceTransfer";
import { giftTaxTile } from "./giftTax";
import { amtScreenerTile } from "./amtScreener";
import { paycheckOptimizerTile } from "./paycheckOptimizer";
import { w4WithholdingTile } from "./w4Withholding";
import { socialSecurityTile } from "./socialSecurity";
import { socialSecurityTaxTile } from "./socialSecurityTax";
import { drawdownTile } from "./drawdown";
import { collegeCostTile } from "./collegeCost";
import { disabilityTile } from "./disability";
import { umbrellaTile } from "./umbrella";
import { estateChecklistTile } from "./estateChecklist";
import { spendingPlanTile } from "./spendingPlan";
import { homeAffordabilityTile } from "./homeAffordability";
import { sinkingFundTile } from "./sinkingFund";
import { rentVsBuyTile } from "./rentVsBuy";
import { healthPlanTile } from "./healthPlan";
import { cashFlowTile } from "./cashFlow";
import { lifeInsuranceTile } from "./lifeInsurance";
import { fplTile } from "./fpl";
import { eitcTile } from "./eitc";
import { childTaxCreditTile } from "./childTaxCredit";
import { owedScreenerTile } from "./owedScreener";
import { acaPtcTile } from "./acaPtc";
import { saversCreditTile } from "./saversCredit";
import { snapTile } from "./snap";
import { medicaidTile } from "./medicaid";
import { fafsaSaiTile } from "./fafsaSai";
import { pellTile } from "./pell";
import { peaceOfMindTile } from "./peaceOfMind";
import { freedomDateTile } from "./freedomDate";
import { debtFreedomTile } from "./debtFreedom";
import { downshiftTile } from "./downshift";
import { sabbaticalTile } from "./sabbatical";

// The 10 topic hubs, ordered by pillar so the home grid preserves the
// on-screen order. Each hub's first tool is its default (the one a bare hub
// link opens); the plan engine deep-links rely on those defaults (retirement →
// retirement-optimizer, debt → debt-freedom, where-you-stand → peace-of-mind)
// and on `?tool=` for the rest.
const HUB_CONFIGS: HubConfig[] = [
  {
    id: "paycheck-taxes",
    title: "Paycheck & Taxes",
    pillar: "paycheck",
    description: "Your real take-home pay, withholding, and what you owe, across every state.",
    tools: [
      takeHomeTile,
      w4WithholdingTile,
      hourlySalaryTile,
      federalIncomeTaxTile,
      marginalExplorerTile,
      paycheckOptimizerTile,
      amtScreenerTile,
      giftTaxTile,
    ],
  },
  {
    id: "self-employed",
    title: "Self-Employed & 1099",
    pillar: "paycheck",
    description:
      "Self-employment tax, quarterly estimates, freelance rates, and the W-2 vs 1099 call.",
    tools: [
      selfEmploymentTaxTile,
      quarterlyTaxesTile,
      freelanceRateTile,
      contractVsSalaryTile,
      selfEmployedRetirementTile,
    ],
  },
  {
    id: "investing",
    title: "Investing",
    pillar: "investing",
    description:
      "Capital gains, cost basis, tax-loss harvesting, growth, and the dollar over time.",
    tools: [
      capitalGainsTile,
      lotPickerTile,
      taxLossHarvestingTile,
      childTaxTile,
      compoundGrowthTile,
      savingsBondTile,
      inflationTile,
    ],
  },
  {
    id: "retirement",
    title: "Retirement",
    pillar: "retirement",
    description: "Contributions and the match, Roth moves, Social Security, RMDs, and drawdown.",
    tools: [
      retirementOptimizerTile,
      rothLadderTile,
      backdoorRothTile,
      iraDeductionTile,
      rmdTile,
      drawdownTile,
      socialSecurityTile,
      socialSecurityTaxTile,
      downshiftTile,
    ],
  },
  {
    id: "debt",
    title: "Borrowing & Debt",
    pillar: "debt",
    description: "Loans, mortgages, refinancing, payoff order, and a clear debt-free date.",
    tools: [
      debtFreedomTile,
      loanAmortizationTile,
      refinanceTile,
      autoLoanTile,
      balanceTransferTile,
      freedomDateTile,
    ],
  },
  {
    id: "budget-cashflow",
    title: "Budgeting & Cash Flow",
    pillar: "budget",
    description: "The 50/30/20 split, your month's cash-flow timeline, and sinking funds.",
    tools: [spendingPlanTile, cashFlowTile, sinkingFundTile],
  },
  {
    id: "home-purchases",
    title: "Home & Big Purchases",
    pillar: "protect",
    description: "What home you can afford, rent vs buy, and saving for college.",
    tools: [homeAffordabilityTile, rentVsBuyTile, collegeCostTile],
  },
  {
    id: "protection",
    title: "Insurance & Protection",
    pillar: "protect",
    description:
      "Health plan choice, life and disability cover, umbrella liability, and estate basics.",
    tools: [healthPlanTile, lifeInsuranceTile, disabilityTile, umbrellaTile, estateChecklistTile],
  },
  {
    id: "benefits",
    title: "Benefits & Aid",
    pillar: "owed",
    description: "Benefits, credits, and aid you may be owed, screened in one place.",
    tools: [
      owedScreenerTile,
      fplTile,
      eitcTile,
      childTaxCreditTile,
      acaPtcTile,
      saversCreditTile,
      snapTile,
      medicaidTile,
      fafsaSaiTile,
      pellTile,
      educationCreditsTile,
    ],
  },
  {
    id: "where-you-stand",
    title: "Where You Stand",
    pillar: "stand",
    description: "Your calm overview, your runway and net worth, and a sabbatical you can fund.",
    tools: [peaceOfMindTile, sabbaticalTile],
  },
];

export const TILES: TileDefinition[] = HUB_CONFIGS.map(defineHub);

/**
 * Every calculator hosted inside a hub, paired with its hub id. Used to emit a
 * crawlable SEO landing page per sub-tool (deep-linking into `?tool=`), so the
 * consolidation doesn't drop the 59 individual tool pages search engines index.
 */
export const SUB_TOOLS: { tile: TileDefinition; hubId: string }[] = HUB_CONFIGS.flatMap((h) =>
  h.tools.map((tile) => ({ tile, hubId: h.id })),
);

const BY_ID = new Map(TILES.map((t) => [t.id, t]));

export function getTile(id: string): TileDefinition | undefined {
  return BY_ID.get(id);
}

/**
 * A searchable entry for the home search and command palette. Hubs and every
 * sub-tool both appear, so searching "EITC"/"refinance" surfaces the familiar
 * calculator name and deep-links into its hub already switched to it.
 */
export interface SearchEntry {
  title: string;
  description: string;
  keywords: string[];
  /** Registry tile id to navigate to (a hub). */
  hubId: string;
  /** Sub-tool id to pre-select inside the hub (the `?tool=` value). */
  tool?: string;
}

/**
 * The text the fuzzy search matches for a {@link SearchEntry}: the title and the
 * curated keywords only — never the free-text description. Subsequence-matching
 * a long prose description produced confusing false positives (typing
 * "refinance" surfaced "Life Insurance Needs", "roth" surfaced "Home Buying
 * Readiness"), so the description is shown in the result but not searched, the
 * way a command palette matches a label and its tags rather than its blurb.
 */
export function searchEntryText(e: SearchEntry): string {
  return `${e.title} ${e.keywords.join(" ")}`;
}

export const SEARCH_ENTRIES: SearchEntry[] = [
  // Each hub as a whole (matches its topic words).
  ...HUB_CONFIGS.map((h) => ({
    title: h.title,
    description: h.description,
    keywords: [],
    hubId: h.id,
  })),
  // Every sub-tool, carrying its own name/keywords and a deep link into its hub.
  ...HUB_CONFIGS.flatMap((h) =>
    h.tools.map((t) => ({
      title: t.title,
      description: t.description,
      keywords: t.keywords,
      hubId: h.id,
      tool: t.id,
    })),
  ),
];
