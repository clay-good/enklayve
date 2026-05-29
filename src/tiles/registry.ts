/**
 * The tile catalog (BUILD-SPEC.md §3–5, BUILD-SPEC-2 §4/§6). The command palette
 * fuzzy-searches this list and the home grid groups it by pillar, so every
 * planned tool has a stable, linkable identity from Phase 4 onward. The
 * Take-Home Pay tile is fully built; the rest are registered as "coming soon"
 * and light up as their phases land — registering a tile never touches the shell.
 */
import type { Pillar, TileDefinition } from "./types";
import { takeHomeTile } from "./takeHome";

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
  soon(
    "hourly-salary",
    "Hourly ↔ Salary",
    "take-home",
    "Convert pay rates with overtime and multiple jobs.",
    ["hourly", "salary", "overtime", "wage"],
  ),
  soon(
    "federal-income-tax",
    "Federal Income Tax",
    "take-home",
    "Marginal and effective breakdown, standard vs itemized.",
    ["federal", "tax", "marginal", "effective"],
  ),
  soon(
    "self-employment-tax",
    "Self-Employment Tax",
    "take-home",
    "SE tax plus the quarterly estimated payment schedule.",
    ["1099", "se tax", "quarterly", "estimated"],
  ),
  soon(
    "capital-gains",
    "Capital Gains",
    "take-home",
    "Short- and long-term gains with a cost-basis helper.",
    ["capital gains", "niit", "cost basis", "investments"],
  ),
  soon(
    "marginal-explorer",
    "Marginal Rate Explorer",
    "take-home",
    "What does my next $1,000 of income actually cost?",
    ["marginal", "next dollar", "bracket"],
  ),
  soon(
    "loan-amortization",
    "Loan & Mortgage Amortization",
    "take-home",
    "Full schedule with extra-payment what-ifs.",
    ["loan", "mortgage", "amortization", "schedule"],
  ),
  soon("refinance", "Refinance Break-Even", "take-home", "When refinancing pays for itself.", [
    "refinance",
    "break even",
    "mortgage",
  ]),
  soon(
    "auto-loan",
    "Auto Loan & True Cost of Credit",
    "take-home",
    "APR to nominal rate and the real cost of borrowing.",
    ["auto loan", "car", "apr", "credit"],
  ),
  soon(
    "compound-growth",
    "Compound Growth",
    "take-home",
    "Contribution growth at a rate you choose.",
    ["compound", "interest", "growth", "savings"],
  ),
  soon(
    "retirement-optimizer",
    "Retirement Contribution Optimizer",
    "take-home",
    "401(k), IRA, and Roth against the current IRS limits.",
    ["401k", "ira", "roth", "retirement", "catch up"],
  ),
  soon("rmd", "Required Minimum Distribution", "take-home", "Your RMD schedule.", [
    "rmd",
    "required minimum distribution",
    "retirement",
  ]),
  soon(
    "inflation",
    "CPI Inflation Adjuster",
    "take-home",
    "What a past dollar is worth today, from BLS data.",
    ["inflation", "cpi", "purchasing power"],
  ),

  // --- Pillar 2: What You're Owed (§4) ---
  soon(
    "fpl",
    "Federal Poverty Level",
    "owed",
    "Poverty guidelines with the contiguous, Alaska, and Hawaii variants.",
    ["fpl", "poverty", "guidelines"],
  ),
  soon(
    "aca-ptc",
    "ACA Premium Tax Credit",
    "owed",
    "Marketplace subsidy from the applicable-percentage table.",
    ["aca", "obamacare", "premium tax credit", "subsidy"],
  ),
  soon(
    "eitc",
    "Earned Income Tax Credit",
    "owed",
    "EITC from the published phase-in and phase-out.",
    ["eitc", "earned income", "credit"],
  ),
  soon("ctc", "Child Tax Credit", "owed", "Child Tax Credit and the refundable Additional CTC.", [
    "ctc",
    "child tax credit",
    "actc",
  ]),
  soon("savers-credit", "Saver's Credit", "owed", "Eligibility and amount for retirement savers.", [
    "savers credit",
    "retirement",
    "credit",
  ]),
  soon("snap", "SNAP Eligibility", "owed", "Gross and net income tests against the poverty line.", [
    "snap",
    "food stamps",
    "benefits",
  ]),
  soon(
    "medicaid",
    "Medicaid Threshold",
    "owed",
    "MAGI thresholds by state, expansion vs non-expansion.",
    ["medicaid", "magi", "health"],
  ),
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
  soon(
    "screener",
    "What Am I Owed Screener",
    "owed",
    "Enter your situation once; see every program you likely qualify for.",
    ["screener", "benefits", "eligibility"],
  ),

  // --- Pillar 3: Safe Harbor (§5) ---
  soon(
    "rainy-day",
    "Rainy Day Fund",
    "safe-harbor",
    "How many months of essentials your savings cover.",
    ["emergency fund", "rainy day", "cushion"],
  ),
  soon("runway", "Runway", "safe-harbor", "How long your savings last at your burn rate.", [
    "runway",
    "burn rate",
    "savings",
  ]),
  soon(
    "war-chest",
    "War Chest",
    "safe-harbor",
    "Your liquid safety net and net worth, tracked privately.",
    ["net worth", "war chest", "assets"],
  ),
  soon(
    "enough-number",
    "Your Enough Number",
    "safe-harbor",
    "The amount that buys you choices, inflation aware.",
    ["enough", "fire", "financial independence"],
  ),
  soon("downshift", "Downshift Point", "safe-harbor", "When continued saving becomes optional.", [
    "coast fire",
    "downshift",
    "retirement",
  ]),
  soon("freedom-date", "Freedom Date", "safe-harbor", "The date your debts are gone.", [
    "debt payoff",
    "freedom",
    "debt free",
  ]),
  soon(
    "peace-of-mind",
    "Peace of Mind Dashboard",
    "safe-harbor",
    "Cushion, runway, and progress toward enough, at a glance.",
    ["dashboard", "overview", "calm"],
  ),
  soon(
    "sabbatical",
    "Sabbatical Planner",
    "safe-harbor",
    "Can I afford a break, and what does it cost?",
    ["sabbatical", "break", "big purchase"],
  ),

  // --- Your Plan (BUILD-SPEC-2 §4) ---
  soon(
    "your-plan",
    "Your Plan",
    "plan",
    "The deterministic next right step, with the math shown.",
    ["plan", "next step", "guidance"],
  ),
];

const BY_ID = new Map(TILES.map((t) => [t.id, t]));

export function getTile(id: string): TileDefinition | undefined {
  return BY_ID.get(id);
}

export function tilesForPillar(pillar: Pillar): TileDefinition[] {
  return TILES.filter((t) => t.pillar === pillar);
}
