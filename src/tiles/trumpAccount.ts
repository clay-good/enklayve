/**
 * Trump Account (IRC §530A): what a child's account is worth at 18, and how much
 * of that belongs to a future tax bill.
 *
 * The One Big Beautiful Bill Act's savings account for a child under 18, open
 * for contributions since July 4, 2026. Descriptive, like the gift-tax tile: it
 * says what the rules do with the numbers a family gives it, never whether to
 * open one or what to hold inside it.
 *
 * The tax line is the reason this is a tile rather than a preset on the
 * compound-growth calculator. §530A(a) treats the account as an individual
 * retirement account under §408(a), so this is tax-DEFERRED and not tax-free —
 * and §530A(d)(2) leaves the $1,000 government contribution out of the
 * investment in the contract, so the seed has no basis and comes out fully
 * taxable. A projection that shows only a balance would be showing a family a
 * number that is partly the IRS's.
 */
import { Money } from "../engine/money";
import { projectTrumpAccount } from "../engine/trumpAccount";
import { el } from "../ui/dom";
import { field, parseNonNegative, parseNumber, tryExampleButton } from "../ui/form";
import { resultCard, type BreakdownLine } from "../ui/resultCard";
import type { TileContext, TileDefinition } from "./types";

interface Fields {
  age: number;
  birthYear: number;
  annual: number;
  balance: number;
  returnPct: number;
}

const EXAMPLE: Fields = { age: 0, birthYear: 2026, annual: 1000, balance: 0, returnPct: 7 };

/**
 * An assumption this site chose, not a figure anyone legislates: the long-run
 * return a reader may edit. Named so the numeric-constant sweep can see it.
 */
const DEFAULT_RETURN_PCT = 7;
/** A child's age is 0–17 for this account; a hostile deep link can say anything. */
const MAX_AGE = 18;

function readFields(p: URLSearchParams): Fields {
  return {
    age: Math.min(MAX_AGE, parseNonNegative(p.get("age"), 0)),
    birthYear: Math.round(parseNonNegative(p.get("by"), EXAMPLE.birthYear)),
    annual: parseNonNegative(p.get("c"), 0),
    balance: parseNonNegative(p.get("b"), 0),
    returnPct: parseNumber(p.get("r"), DEFAULT_RETURN_PCT),
  };
}

function writeFields(f: Fields): URLSearchParams {
  const p = new URLSearchParams();
  p.set("age", String(f.age));
  p.set("by", String(f.birthYear));
  p.set("c", String(f.annual));
  if (f.balance > 0) p.set("b", String(f.balance));
  p.set("r", String(f.returnPct));
  return p;
}

export function mountTrumpAccount(ctx: TileContext): void {
  const { root, data } = ctx;
  root.replaceChildren();
  const accountData = data?.trumpAccounts();
  if (!accountData) {
    root.append(
      el("div", {
        class: "verify-banner",
        attrs: { role: "alert" },
        text: "Trump account data is unavailable, verify before relying on any figure.",
      }),
    );
    return;
  }
  let fields = readFields(ctx.params);

  const num = (name: string, value: number, label: string, step: number): HTMLInputElement =>
    el("input", {
      type: "number",
      name,
      min: 0,
      step,
      value,
      attrs: { "aria-label": label, inputmode: "decimal" },
    });
  const ageInput = num("age", fields.age, "Child's age today", 1);
  const byInput = num("by", fields.birthYear, "Year the child was born", 1);
  const cInput = num("c", fields.annual, "Contribution each year", 500);
  const bInput = num("b", fields.balance, "Already in the account", 500);
  const rInput = num("r", fields.returnPct, "Expected annual return, percent", 0.5);

  const resultContainer = el("div", { class: "tile-result", attrs: { "aria-live": "polite" } });

  function compute(): void {
    const r = projectTrumpAccount(
      {
        currentAge: fields.age,
        birthYear: fields.birthYear,
        annualContribution: fields.annual,
        currentBalance: fields.balance,
        annualReturnRate: fields.returnPct / 100,
      },
      accountData!,
    );
    const fmt = (m: Money): string => m.format(ctx.locale);
    const cite = accountData!.citation;

    const lines: BreakdownLine[] = [
      { label: "Years until they can touch it", value: String(r.yearsToDistribution) },
      {
        label: "Government contribution (§6434)",
        value: r.pilotEligible
          ? `${fmt(r.pilotContribution)} — born inside the ${accountData!.pilotBirthYearFirst}–${accountData!.pilotBirthYearLast} window`
          : `None — the $1,000 goes to children born ${accountData!.pilotBirthYearFirst} through ${accountData!.pilotBirthYearLast}`,
        citation: cite,
      },
      {
        label: "Your contribution each year",
        value: r.contributionWasCapped
          ? `${fmt(r.contributionApplied)} — the yearly limit, so we used that`
          : fmt(r.contributionApplied),
        citation: cite,
      },
      { label: "Everything put in", value: fmt(r.totalContributed) },
      {
        label: `Balance at ${accountData!.distributionAge}`,
        value: fmt(r.balanceAtDistribution),
        emphasis: true,
      },
      {
        label: "Taxable when withdrawn (ordinary income)",
        value: fmt(r.taxableAtDistribution),
        citation: cite,
      },
      {
        label: "Note",
        value:
          // No figure in this sentence: it renders for a child outside the
          // §6434 birth window too, where there is no seed at all, and a
          // hardcoded amount would be wrong for them and stale for everyone
          // else the day the statute moves.
          "A projection at the return you entered, not a promise. The account is treated as a traditional IRA, so nothing comes out before the year they turn 18 and what does is ordinary income — the government contribution and every dollar of growth included.",
      },
    ];

    resultContainer.replaceChildren(
      resultCard({
        label: `Balance at ${accountData!.distributionAge}`,
        value: r.balanceAtDistribution,
        locale: ctx.locale,
        breakdown: lines,
        permalink: () => ctx.permalink(writeFields(fields)),
      }),
    );
  }

  function recompute(): void {
    fields = {
      age: Math.min(MAX_AGE, parseNonNegative(ageInput.value, 0)),
      birthYear: Math.round(parseNonNegative(byInput.value, EXAMPLE.birthYear)),
      annual: parseNonNegative(cInput.value, 0),
      balance: parseNonNegative(bInput.value, 0),
      returnPct: parseNumber(rInput.value, DEFAULT_RETURN_PCT),
    };
    ctx.setParams(writeFields(fields));
    compute();
  }

  for (const i of [ageInput, byInput, cInput, bInput, rInput]) {
    i.addEventListener("input", recompute);
  }

  const tryExample = tryExampleButton(() => {
    fields = { ...EXAMPLE };
    ageInput.value = String(fields.age);
    byInput.value = String(fields.birthYear);
    cInput.value = String(fields.annual);
    bInput.value = String(fields.balance);
    rInput.value = String(fields.returnPct);
    recompute();
  });

  const form = el(
    "form",
    { class: "tile-form", on: { submit: (e) => e.preventDefault() } },
    field("Child's age today", ageInput),
    field("Year they were born", byInput),
    field("You contribute each year", cInput),
    field("Already in the account (optional)", bInput),
    field("Expected annual return (%)", rInput),
    el("div", { class: "tile-form-actions" }, tryExample),
  );

  root.append(form, resultContainer);
  compute();
}

export const trumpAccountTile: TileDefinition = {
  id: "trump-account",
  title: "Trump Account (child savings)",
  pillar: "investing",
  description: "What a child's §530A account holds at 18, and what of it is taxable.",
  keywords: [
    "trump account",
    "530A",
    "child savings",
    "baby bonus",
    "newborn",
    "1000",
    "6434",
    "kids",
  ],
  status: "ready",
  how: "A Trump account is a savings account for a child under 18, created by the One Big Beautiful Bill Act as IRC §530A. Anyone may put money in — a parent, a grandparent, the child — up to $5,000 a year, and a child born from 2025 through 2028 gets a one-time $1,000 paid in by the Treasury under §6434, claimed by election rather than arriving on its own. Contributions could not begin before July 4, 2026.\n\nWe project the balance in the year they turn 18, which is the first year anything can be taken out.\n\nThe part worth reading twice: this is a tax-deferred account, not a tax-free one. §530A(a) treats it in the same way as a traditional IRA, so a withdrawal is ordinary income — and §530A(d)(2) leaves the $1,000 out of your basis, so the seed and all of the growth are taxable while only the money your family put in is not. What the account may hold is restricted too: funds tracking a qualified index, such as one following the S&P 500.\n\nThe return is your assumption and the projection is only as good as it. This is descriptive: it tells you what the rules do with your numbers, never whether to open one.",
  resources: [
    { label: "26 U.S.C. §530A", url: "https://www.law.cornell.edu/uscode/text/26/530A" },
    {
      label: "26 U.S.C. §6434, the $1,000 contribution",
      url: "https://www.law.cornell.edu/uscode/text/26/6434",
    },
    {
      label: "IRS, guidance on Trump accounts",
      url: "https://www.irs.gov/newsroom/treasury-irs-issue-guidance-on-trump-accounts-established-under-the-working-families-tax-cuts-notice-announces-upcoming-regulations",
    },
  ],
  related: [
    {
      hubId: "home-purchases",
      tool: "college-cost",
      label: "College Cost & 529 Planner",
      note: "the other account with a child's name on it, and a different tax deal",
    },
    {
      hubId: "investing",
      tool: "compound-growth",
      label: "Compound Growth",
      note: "the same arithmetic without §530A's cap or its distribution age",
    },
  ],
  mount: mountTrumpAccount,
};
