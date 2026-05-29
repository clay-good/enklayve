/**
 * The tile catalog (BUILD-SPEC.md §3–5, BUILD-SPEC-2 §4/§6). The command palette
 * fuzzy-searches this list and the home grid groups it by pillar, so every
 * planned tool has a stable, linkable identity from Phase 4 onward. The
 * Take-Home Pay tile is fully built; the rest are registered as "coming soon"
 * and light up as their phases land — registering a tile never touches the shell.
 */
import type { Pillar, TileDefinition } from "./types";
import { takeHomeTile } from "./takeHome";
import { hourlySalaryTile } from "./hourlySalary";
import { federalIncomeTaxTile } from "./federalIncomeTax";
import { selfEmploymentTaxTile } from "./selfEmploymentTax";
import { marginalExplorerTile } from "./marginalExplorer";
import { loanAmortizationTile } from "./loanAmortization";
import { refinanceTile } from "./refinance";
import { autoLoanTile } from "./autoLoan";
import { compoundGrowthTile } from "./compoundGrowth";
import { retirementOptimizerTile } from "./retirementOptimizer";
import { capitalGainsTile } from "./capitalGains";
import { inflationTile } from "./inflation";
import { rmdTile } from "./rmd";
import { spendingPlanTile } from "./spendingPlan";
import { homeAffordabilityTile } from "./homeAffordability";
import { fplTile } from "./fpl";
import { eitcTile } from "./eitc";
import { childTaxCreditTile } from "./childTaxCredit";
import { owedScreenerTile } from "./owedScreener";
import { saversCreditTile } from "./saversCredit";
import { snapTile } from "./snap";
import { medicaidTile } from "./medicaid";
import { peaceOfMindTile } from "./peaceOfMind";
import { freedomDateTile } from "./freedomDate";
import { yourPlanTile } from "./yourPlan";

function soon(
  id: string,
  title: string,
  pillar: Pillar,
  description: string,
  keywords: string[],
): TileDefinition {
  return { id, title, pillar, description, keywords, status: "coming-soon" };
}

export const TILES: TileDefinition[] = [
  // --- Pillar 1: Take Home & Taxes (§3) ---
  takeHomeTile,
  soon(
    "w4",
    "W-4 Withholding Estimator",
    "take-home",
    "Tune your W-4 from the published withholding method.",
    ["w4", "withholding", "allowances"],
  ),
  hourlySalaryTile,
  federalIncomeTaxTile,
  selfEmploymentTaxTile,
  capitalGainsTile,
  marginalExplorerTile,
  loanAmortizationTile,
  refinanceTile,
  autoLoanTile,
  compoundGrowthTile,
  retirementOptimizerTile,
  rmdTile,
  inflationTile,
  // Expansion tools (BUILD-SPEC-2 §6), cash-flow + home, grouped under Take Home.
  spendingPlanTile,
  homeAffordabilityTile,

  // --- Pillar 2: What You're Owed (§4) ---
  fplTile,
  eitcTile,
  childTaxCreditTile,
  owedScreenerTile,
  soon(
    "aca-ptc",
    "ACA Premium Tax Credit",
    "owed",
    "Marketplace subsidy from the applicable-percentage table.",
    ["aca", "obamacare", "premium tax credit", "subsidy"],
  ),
  saversCreditTile,
  snapTile,
  medicaidTile,
  soon(
    "fafsa-sai",
    "FAFSA Student Aid Index",
    "owed",
    "The federal methodology Student Aid Index estimate.",
    ["fafsa", "sai", "financial aid", "college"],
  ),
  soon("pell", "Pell Grant", "owed", "Estimated award from the Student Aid Index.", [
    "pell",
    "grant",
    "college",
    "aid",
  ]),

  // --- Pillar 3: Safe Harbor (§5) ---
  // The Peace of Mind dashboard consolidates the rainy-day cushion, runway,
  // net worth (war chest), and My Enough Number into one calm overview, so the
  // user enters shared inputs once instead of re-typing them into four
  // near-identical calculators (the math was the same: savings ÷ monthly spend).
  peaceOfMindTile,
  freedomDateTile,
  soon("downshift", "Downshift Point", "safe-harbor", "When continued saving becomes optional.", [
    "coast fire",
    "downshift",
    "retirement",
  ]),
  soon(
    "sabbatical",
    "Sabbatical Planner",
    "safe-harbor",
    "Can I afford a break, and what does it cost?",
    ["sabbatical", "break", "big purchase"],
  ),

  // --- My Plan (BUILD-SPEC-2 §4) ---
  yourPlanTile,
];

const BY_ID = new Map(TILES.map((t) => [t.id, t]));

export function getTile(id: string): TileDefinition | undefined {
  return BY_ID.get(id);
}

export function tilesForPillar(pillar: Pillar): TileDefinition[] {
  return TILES.filter((t) => t.pillar === pillar);
}
