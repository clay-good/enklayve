/**
 * Rent vs Buy tile (BUILD-SPEC-2 §6.3): a deterministic net-cost comparison over
 * a chosen horizon. Buying's net cost is the cash out (down payment, closing,
 * principal & interest, ownership costs) minus the sale proceeds; renting's is
 * the rent paid (growing) minus the investment gain on the cash a renter doesn't
 * tie up. Appreciation, rent growth, and the investment return are the user's
 * assumptions, clearly labeled — never forecasts (§2.1).
 */
import { Money } from "../engine/money";
import { rentVsBuy } from "../engine/finance";
import { el } from "../ui/dom";
import { assumptionHint, field, parseNonNegative, parseNumber, tryExampleButton } from "../ui/form";
import { resultCard, type BreakdownLine } from "../ui/resultCard";
import { sensitivityTable, sensitivityToggle } from "../ui/sensitivity";
import type { TileContext, TileDefinition } from "./types";

/** How far the opt-in range flexes the appreciation assumption, in percentage points. */
const APPR_DELTA = 2;

/** Defensible band for the home-appreciation assumption; outside it, a calm
 *  hint signposts a stress scenario (SPEC-3 §2.4). Never a clamp. */
const APPR_BAND = { low: -20, high: 20, label: "Home appreciation" };

interface Fields {
  homePrice: number;
  downPayment: number;
  ratePct: number;
  termYears: number;
  ownershipMonthly: number;
  closingCost: number;
  sellingCostPct: number;
  appreciationPct: number;
  monthlyRent: number;
  rentGrowthPct: number;
  investReturnPct: number;
  years: number;
  /** Show the opt-in low/base/high range on the appreciation assumption. */
  band: boolean;
}

const EXAMPLE: Fields = {
  homePrice: 400000,
  downPayment: 80000,
  ratePct: 6.5,
  termYears: 30,
  ownershipMonthly: 700,
  closingCost: 8000,
  sellingCostPct: 6,
  appreciationPct: 3,
  monthlyRent: 2200,
  rentGrowthPct: 3,
  investReturnPct: 6,
  years: 7,
  band: false,
};

function readFields(p: URLSearchParams): Fields {
  return {
    homePrice: parseNonNegative(p.get("price"), 0),
    downPayment: parseNonNegative(p.get("dp"), 0),
    ratePct: parseNumber(p.get("rate"), 6.5),
    termYears: Math.max(1, parseNonNegative(p.get("term"), 30)),
    ownershipMonthly: parseNonNegative(p.get("own"), 0),
    closingCost: parseNonNegative(p.get("cc"), 0),
    sellingCostPct: parseNonNegative(p.get("sell"), 6),
    appreciationPct: parseNumber(p.get("appr"), 3),
    monthlyRent: parseNonNegative(p.get("rent"), 0),
    rentGrowthPct: parseNumber(p.get("rg"), 3),
    investReturnPct: parseNumber(p.get("ir"), 6),
    years: Math.max(1, parseNonNegative(p.get("y"), 7)),
    band: p.get("band") === "1",
  };
}

/** The signed outcome at a given appreciation rate — the same evaluation. */
function outcomeAt(fields: Fields, apprPct: number, fmt: (m: Money) => string): string {
  const r = rentVsBuy({
    homePrice: fields.homePrice,
    downPayment: fields.downPayment,
    mortgageRatePct: fields.ratePct,
    termYears: fields.termYears,
    monthlyOwnershipCosts: fields.ownershipMonthly,
    closingCostBuy: fields.closingCost,
    sellingCostPct: fields.sellingCostPct,
    homeAppreciationPct: apprPct,
    monthlyRent: fields.monthlyRent,
    rentGrowthPct: fields.rentGrowthPct,
    investmentReturnPct: fields.investReturnPct,
    years: fields.years,
  });
  if (r.cheaper === "tie") return "About even";
  return `${r.cheaper === "buy" ? "Buy" : "Rent"} by ${fmt(r.difference)}`;
}

function writeFields(f: Fields): URLSearchParams {
  const p = new URLSearchParams();
  p.set("price", String(f.homePrice));
  p.set("dp", String(f.downPayment));
  p.set("rate", String(f.ratePct));
  if (f.termYears !== 30) p.set("term", String(f.termYears));
  if (f.ownershipMonthly > 0) p.set("own", String(f.ownershipMonthly));
  if (f.closingCost > 0) p.set("cc", String(f.closingCost));
  if (f.sellingCostPct !== 6) p.set("sell", String(f.sellingCostPct));
  if (f.appreciationPct !== 3) p.set("appr", String(f.appreciationPct));
  p.set("rent", String(f.monthlyRent));
  if (f.rentGrowthPct !== 3) p.set("rg", String(f.rentGrowthPct));
  if (f.investReturnPct !== 6) p.set("ir", String(f.investReturnPct));
  if (f.years !== 7) p.set("y", String(f.years));
  if (f.band) p.set("band", "1");
  return p;
}

export function mountRentVsBuy(ctx: TileContext): void {
  const { root } = ctx;
  root.replaceChildren();
  let fields = readFields(ctx.params);

  const mkNum = (name: string, label: string, value: number, step: number): HTMLInputElement =>
    el("input", {
      type: "number",
      name,
      min: 0,
      step,
      value,
      attrs: { "aria-label": label, inputmode: "decimal" },
    });
  const priceInput = mkNum("price", "Home price", fields.homePrice, 5000);
  const dpInput = mkNum("dp", "Down payment", fields.downPayment, 1000);
  const rateInput = mkNum("rate", "Mortgage rate (percent)", fields.ratePct, 0.125);
  const termInput = mkNum("term", "Loan term in years", fields.termYears, 1);
  const ownInput = mkNum("own", "Monthly ownership costs", fields.ownershipMonthly, 50);
  const ccInput = mkNum("cc", "Closing costs to buy", fields.closingCost, 500);
  const sellInput = mkNum("sell", "Selling cost (percent)", fields.sellingCostPct, 0.5);
  const apprInput = mkNum("appr", "Home appreciation (percent/yr)", fields.appreciationPct, 0.25);
  const rentInput = mkNum("rent", "Monthly rent", fields.monthlyRent, 50);
  const rgInput = mkNum("rg", "Rent growth (percent/yr)", fields.rentGrowthPct, 0.25);
  const irInput = mkNum("ir", "Investment return (percent/yr)", fields.investReturnPct, 0.25);
  const yearsInput = mkNum("y", "Horizon in years", fields.years, 1);

  const resultContainer = el("div", { class: "tile-result", attrs: { "aria-live": "polite" } });

  function compute(): void {
    resultContainer.replaceChildren();
    if (fields.homePrice <= 0 || fields.monthlyRent <= 0) {
      resultContainer.append(
        el("p", {
          class: "ph-empty",
          text: "Enter a home price and a monthly rent to compare the two paths.",
        }),
      );
      return;
    }
    const r = rentVsBuy({
      homePrice: fields.homePrice,
      downPayment: fields.downPayment,
      mortgageRatePct: fields.ratePct,
      termYears: fields.termYears,
      monthlyOwnershipCosts: fields.ownershipMonthly,
      closingCostBuy: fields.closingCost,
      sellingCostPct: fields.sellingCostPct,
      homeAppreciationPct: fields.appreciationPct,
      monthlyRent: fields.monthlyRent,
      rentGrowthPct: fields.rentGrowthPct,
      investmentReturnPct: fields.investReturnPct,
      years: fields.years,
    });
    const fmt = (m: Money): string => m.format(ctx.locale);

    const verdict =
      r.cheaper === "tie"
        ? "It's a wash over this horizon: the two cost about the same."
        : `${r.cheaper === "buy" ? "Buying" : "Renting"} is cheaper by ${fmt(r.difference)} over ${fields.years} years.`;

    const lines: BreakdownLine[] = [
      { label: "Monthly principal & interest", value: fmt(r.monthlyPayment) },
      { label: "Net cost of buying", value: fmt(r.netCostBuy) },
      { label: "Net cost of renting", value: fmt(r.netCostRent) },
      { label: "Verdict", value: verdict, emphasis: true },
      {
        label: "Assumptions",
        value: `${fields.appreciationPct}% appreciation, ${fields.rentGrowthPct}% rent growth, ${fields.investReturnPct}% investment return, all yours to change.`,
      },
    ];

    resultContainer.append(
      resultCard({
        label: `Rent vs buy over ${fields.years} years`,
        value: r.difference,
        locale: ctx.locale,
        breakdown: lines,
        permalink: () => ctx.permalink(writeFields(fields)),
      }),
    );

    const hint = assumptionHint(fields.appreciationPct, APPR_BAND);
    if (hint) resultContainer.append(hint);

    if (fields.band) {
      const low = fields.appreciationPct - APPR_DELTA;
      const high = fields.appreciationPct + APPR_DELTA;
      resultContainer.append(
        sensitivityTable(
          `If home appreciation runs ${APPR_DELTA} points either side of your ${fields.appreciationPct}% assumption (it can flip the answer):`,
          [
            {
              label: "Lower appreciation",
              assumption: `${low}%`,
              result: outcomeAt(fields, low, fmt),
            },
            {
              label: "Your assumption",
              assumption: `${fields.appreciationPct}%`,
              result: outcomeAt(fields, fields.appreciationPct, fmt),
              base: true,
            },
            {
              label: "Higher appreciation",
              assumption: `${high}%`,
              result: outcomeAt(fields, high, fmt),
            },
          ],
        ),
      );
    }
  }

  function recompute(): void {
    fields = {
      homePrice: parseNonNegative(priceInput.value, 0),
      downPayment: parseNonNegative(dpInput.value, 0),
      ratePct: parseNumber(rateInput.value, 6.5),
      termYears: Math.max(1, parseNonNegative(termInput.value, 30)),
      ownershipMonthly: parseNonNegative(ownInput.value, 0),
      closingCost: parseNonNegative(ccInput.value, 0),
      sellingCostPct: parseNonNegative(sellInput.value, 6),
      appreciationPct: parseNumber(apprInput.value, 3),
      monthlyRent: parseNonNegative(rentInput.value, 0),
      rentGrowthPct: parseNumber(rgInput.value, 3),
      investReturnPct: parseNumber(irInput.value, 6),
      years: Math.max(1, parseNonNegative(yearsInput.value, 7)),
      band: bandToggle.querySelector("input")!.checked,
    };
    ctx.setParams(writeFields(fields));
    compute();
  }

  const bandToggle = sensitivityToggle(
    "Show a range (±2 points on appreciation)",
    fields.band,
    (on) => {
      fields = { ...fields, band: on };
      ctx.setParams(writeFields(fields));
      compute();
    },
  );

  for (const i of [
    priceInput,
    dpInput,
    rateInput,
    termInput,
    ownInput,
    ccInput,
    sellInput,
    apprInput,
    rentInput,
    rgInput,
    irInput,
    yearsInput,
  ]) {
    i.addEventListener("input", recompute);
  }

  const tryExample = tryExampleButton(() => {
    fields = { ...EXAMPLE };
    priceInput.value = String(fields.homePrice);
    dpInput.value = String(fields.downPayment);
    rateInput.value = String(fields.ratePct);
    termInput.value = String(fields.termYears);
    ownInput.value = String(fields.ownershipMonthly);
    ccInput.value = String(fields.closingCost);
    sellInput.value = String(fields.sellingCostPct);
    apprInput.value = String(fields.appreciationPct);
    rentInput.value = String(fields.monthlyRent);
    rgInput.value = String(fields.rentGrowthPct);
    irInput.value = String(fields.investReturnPct);
    yearsInput.value = String(fields.years);
    bandToggle.querySelector("input")!.checked = fields.band;
    recompute();
  });

  const form = el(
    "form",
    { class: "tile-form", on: { submit: (e) => e.preventDefault() } },
    el("div", { class: "field-group-label", text: "Buying" }),
    field("Home price", priceInput),
    field("Down payment", dpInput),
    field("Mortgage rate (%)", rateInput),
    field("Term (years)", termInput),
    field("Monthly ownership costs (tax, insurance, upkeep)", ownInput),
    field("Closing costs", ccInput),
    field("Selling cost (% of price)", sellInput),
    field("Home appreciation (%/yr)", apprInput),
    el("div", { class: "field-group-label", text: "Renting" }),
    field("Monthly rent", rentInput),
    field("Rent growth (%/yr)", rgInput),
    field("Investment return on freed cash (%/yr)", irInput),
    el("div", { class: "field-group-label", text: "Horizon" }),
    field("Years", yearsInput),
    bandToggle,
    el("div", { class: "tile-form-actions" }, tryExample),
  );

  root.append(form, resultContainer);
  compute();
}

export const rentVsBuyTile: TileDefinition = {
  id: "rent-vs-buy",
  title: "Rent vs Buy",
  pillar: "protect",
  description: "Compare renting and buying over a horizon you choose.",
  keywords: ["rent vs buy", "buy vs rent", "renting", "homeownership", "break even"],
  status: "ready",
  how: "We compare the net cost of each path over your horizon. Buying adds up the down payment, closing costs, principal & interest, and ownership costs, then subtracts what you'd net selling the home (its appreciated value, less selling costs and the remaining loan). Renting adds up the rent you'd pay (growing each year) and subtracts the investment gain on the cash you didn't tie up in a down payment. The lower net cost wins.\n\nAppreciation, rent growth, and the investment return are your assumptions, clearly labeled, not forecasts. Two simplifications: ownership costs are held flat, and we don't separately invest the month-to-month cash-flow difference. Move the horizon and the rates to see how the answer flips.",
  resources: [
    { label: "CFPB, buying a house", url: "https://www.consumerfinance.gov/owning-a-home/" },
    {
      label: "Investor.gov, compound interest",
      url: "https://www.investor.gov/financial-tools-calculators/calculators/compound-interest-calculator",
    },
  ],
  mount: mountRentVsBuy,
};
