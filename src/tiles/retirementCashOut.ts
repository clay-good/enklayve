/**
 * Cashing Out a 401(k) (SPEC-5 Phase 28, layoff-month J1): what arrives, what
 * is owed, the exceptions a reader ticks, and the balance due at filing. Harm
 * tier 2: it shapes a decision with a clock on it, so every consequence renders
 * beside the figure.
 *
 * The definition is in the shell; the code and its shard load when the tool is
 * opened (SPEC-5 §7.5), from `retirementCashOutView.ts`.
 */
import { lazyMount } from "./lazy";
import type { TileDefinition } from "./types";

export const retirementCashOutTile: TileDefinition = {
  id: "retirement-cash-out",
  title: "Cashing Out a 401(k)",
  pillar: "retirement",
  harmTier: 2,
  description:
    "What you get, what you owe in April, and what it costs, if you take the money out now.",
  keywords: [
    "cash out 401k",
    "401k withdrawal",
    "early withdrawal penalty",
    "rule of 55",
    "10 percent penalty",
    "rollover",
    "lost my job 401k",
    "hardship withdrawal",
  ],
  status: "ready",
  mount: lazyMount(
    () => import("./retirementCashOutView").then((m) => m.mountRetirementCashOut),
    ["early-distribution-2026"],
  ),
  how: "Taking money out of a 401(k) before 59½ costs three things, and the check you receive shows only the first. Your plan must withhold 20% for federal tax when it pays you, so the check is 80% of what you asked for.\n\nThe whole amount is then income for the year, added on top of your other income, so it is taxed at your own rates, federal and state, which can be more or less than the 20% that was held back. And unless an exception applies, there is an additional 10% tax on it. The difference between what you owe and what was withheld is the bill, or the refund, when you file.\n\nThe exceptions are ones you tick, because only you know whether they apply. The most overlooked is leaving your job in or after the year you turn 55 (50 for police, firefighters and other public-safety workers): money taken from that employer's plan owes no additional tax. Others cover the whole amount, or a part of it, such as one emergency withdrawal a year or medical costs; you report them on Form 5329.\n\nIf you change your mind, you can roll the money into an IRA or a new plan within 60 days of receiving it and owe nothing, but to roll over all of it you must replace the 20% that was withheld from your own pocket. A direct rollover skips both the withholding and the clock.\n\nThe last line shows what the same money would grow to if left alone, at a rate you choose. It is an assumption, not a forecast. This is information about published tax rules applied to the figures you enter, not tax or financial advice; your plan's rollover notice and a tax professional can confirm an exception this checklist does not cover.",
  resources: [
    {
      label: "IRS: exceptions to tax on early distributions",
      url: "https://www.irs.gov/retirement-plans/plan-participant-employee/retirement-topics-exceptions-to-tax-on-early-distributions",
    },
    {
      label: "IRS Publication 575, Pension and Annuity Income",
      url: "https://www.irs.gov/publications/p575",
    },
  ],
  related: [
    {
      hubId: "when-money-is-tight",
      tool: "enrollment-windows",
      label: "Enrollment & Appeal Windows",
      note: "The 60-day rollover clock, with the others a job loss starts",
    },
  ],
};
