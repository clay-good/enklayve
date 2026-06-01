/**
 * The tile catalog (BUILD-SPEC.md §3–5, BUILD-SPEC-2 §4/§6). The command palette
 * fuzzy-searches this list and the home grid groups it by pillar, so every
 * planned tool has a stable, linkable identity. Every catalog tile is now built
 * and "ready"; registering a tile never touches the shell.
 */
import type { Pillar, TileDefinition } from "./types";
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
import { rothLadderTile } from "./rothLadder";
import { backdoorRothTile } from "./backdoorRoth";
import { balanceTransferTile } from "./balanceTransfer";
import { paycheckOptimizerTile } from "./paycheckOptimizer";
import { w4WithholdingTile } from "./w4Withholding";
import { socialSecurityTile } from "./socialSecurity";
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
import { zeroBudgetTile } from "./zeroBudget";
import { cashFlowTile } from "./cashFlow";
import { budgetOverviewTile } from "./budgetOverview";
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
import { yourPlanTile } from "./yourPlan";

// The catalog is ordered by topic group (see `Pillar` in types.ts). The home and
// All Tools index render `tilesForPillar`, which preserves this order within each
// group, so the array order is the on-screen order. Reorganized 2026-05-29 from
// the original 4 pillars into 8 smaller money areas (BUILD-SPEC-2 §1.5).
export const TILES: TileDefinition[] = [
  // --- Paycheck & Taxes ---
  takeHomeTile,
  w4WithholdingTile,
  hourlySalaryTile,
  federalIncomeTaxTile,
  selfEmploymentTaxTile,
  quarterlyTaxesTile,
  freelanceRateTile,
  contractVsSalaryTile,
  marginalExplorerTile,
  paycheckOptimizerTile,

  // --- Investing ---
  capitalGainsTile,
  lotPickerTile,
  taxLossHarvestingTile,
  compoundGrowthTile,
  savingsBondTile,
  inflationTile,

  // --- Retirement ---
  retirementOptimizerTile,
  selfEmployedRetirementTile,
  rothLadderTile,
  backdoorRothTile,
  rmdTile,
  drawdownTile,
  socialSecurityTile,
  downshiftTile,

  // --- Borrowing & Debt ---
  loanAmortizationTile,
  refinanceTile,
  autoLoanTile,
  balanceTransferTile,
  freedomDateTile,
  debtFreedomTile,

  // --- Budgeting & Cash Flow ---
  budgetOverviewTile,
  spendingPlanTile,
  zeroBudgetTile,
  cashFlowTile,
  sinkingFundTile,

  // --- Home, Family & Protection ---
  homeAffordabilityTile,
  rentVsBuyTile,
  collegeCostTile,
  healthPlanTile,
  lifeInsuranceTile,
  disabilityTile,
  umbrellaTile,
  estateChecklistTile,

  // --- Benefits & Aid (What You're Owed, §4) ---
  fplTile,
  owedScreenerTile,
  eitcTile,
  childTaxCreditTile,
  acaPtcTile,
  saversCreditTile,
  snapTile,
  medicaidTile,
  fafsaSaiTile,
  pellTile,

  // --- Where You Stand (Safe Harbor calm overview + the guide, §5 / SPEC-2 §4) ---
  // Peace of Mind consolidates the rainy-day cushion, runway, net worth (war
  // chest), and My Enough Number into one calm overview (the math was the same:
  // savings ÷ monthly spend), so shared inputs are entered once, not four times.
  peaceOfMindTile,
  yourPlanTile,
  sabbaticalTile,
];

const BY_ID = new Map(TILES.map((t) => [t.id, t]));

export function getTile(id: string): TileDefinition | undefined {
  return BY_ID.get(id);
}

export function tilesForPillar(pillar: Pillar): TileDefinition[] {
  return TILES.filter((t) => t.pillar === pillar);
}
