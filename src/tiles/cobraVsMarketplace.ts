/**
 * COBRA or the Marketplace? (SPEC-5 Phase 28, layoff-month J2). The COBRA
 * premium from the notice against the benchmark Marketplace plan after the
 * premium tax credit at the year's projected income, with the clocks and the
 * one-way doors. Harm tier 2: the comparison shapes a coverage decision, so its
 * consequences render beside it.
 *
 * The definition is in the shell; the code, its shard and its "how" block load
 * when the tool is opened (SPEC-5 §7.5): the code from `cobraVsMarketplaceView.ts`, the
 * explanation from `cobraVsMarketplaceHow.ts`.
 */
import { lazyTile } from "./lazy";
import type { TileDefinition } from "./types";

export const cobraVsMarketplaceTile: TileDefinition = lazyTile(
  {
    id: "cobra-vs-marketplace",
    title: "COBRA or the Marketplace?",
    pillar: "protect",
    harmTier: 2,
    description:
      "Whether keeping your job's plan or buying on the Marketplace costs less, once the credit is applied.",
    keywords: [
      "cobra",
      "cobra or marketplace",
      "lost my job health insurance",
      "cobra cost",
      "healthcare.gov after layoff",
      "premium tax credit",
      "special enrollment",
    ],
    status: "ready",
    resources: [
      {
        label: "HealthCare.gov: see plans and prices",
        url: "https://www.healthcare.gov/see-plans/",
      },
      {
        label: "U.S. Department of Labor: COBRA continuation coverage",
        url: "https://www.dol.gov/general/topic/health-plans/cobra",
      },
    ],
    related: [
      {
        hubId: "protection",
        tool: "health-plan",
        label: "Health Plan Chooser",
        note: "Compare the two plans' terms once the premiums are known",
      },
    ],
  },
  {
    view: () => import("./cobraVsMarketplaceView").then((m) => m.mountCobraVsMarketplace),
    shards: ["separation-rules-2026"],
    how: () => import("./cobraVsMarketplaceHow").then((m) => m.how),
  },
);
