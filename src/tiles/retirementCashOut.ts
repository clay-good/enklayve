/**
 * Cashing Out a 401(k) (SPEC-5 Phase 28, layoff-month J1): what arrives, what
 * is owed, the exceptions a reader ticks, and the balance due at filing. Harm
 * tier 2: it shapes a decision with a clock on it, so every consequence renders
 * beside the figure.
 *
 * The definition is in the shell; the code, its shard and its "how" block load
 * when the tool is opened (SPEC-5 §7.5): the code from `retirementCashOutView.ts`, the
 * explanation from `retirementCashOutHow.ts`.
 */
import { lazyTile } from "./lazy";
import type { TileDefinition } from "./types";

export const retirementCashOutTile: TileDefinition = lazyTile(
  {
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
  },
  {
    view: () => import("./retirementCashOutView").then((m) => m.mountRetirementCashOut),
    shards: ["early-distribution-2026"],
    how: () => import("./retirementCashOutHow").then((m) => m.how),
  },
);
