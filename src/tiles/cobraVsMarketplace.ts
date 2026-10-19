/**
 * COBRA or the Marketplace? (SPEC-5 Phase 28, layoff-month J2). The COBRA
 * premium from the notice against the benchmark Marketplace plan after the
 * premium tax credit at the year's projected income, with the clocks and the
 * one-way doors. Harm tier 2: the comparison shapes a coverage decision, so its
 * consequences render beside it.
 *
 * The definition is in the shell; the code and its shard load when the tool is
 * opened (SPEC-5 §7.5), from `cobraVsMarketplaceView.ts`.
 */
import { lazyMount } from "./lazy";
import type { TileDefinition } from "./types";

export const cobraVsMarketplaceTile: TileDefinition = {
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
  mount: lazyMount(
    () => import("./cobraVsMarketplaceView").then((m) => m.mountCobraVsMarketplace),
    ["separation-rules-2026"],
  ),
  how: "When a job ends, you can usually keep its health plan through COBRA, at up to the plan's full cost plus a small administrative charge, or buy a plan on the Marketplace. The COBRA letter states a price. The Marketplace price that matters is the one after the premium tax credit, and the credit is set by the household income you expect for this whole year, which after a layoff is often lower than last year's.\n\nSo enter the COBRA premium from your election notice, the benchmark silver premium for your county from HealthCare.gov, and the income you expect this year. We apply the same credit calculation as the premium tax credit calculator, from the same cited tables, and show both monthly prices side by side. If your notice also states the plan's full cost, we check the COBRA price against the most the law lets a plan charge.\n\nThe choice has clocks and one door that is hard to reopen. You have a window to elect COBRA, and separately a 60-day window to enroll on the Marketplace after your coverage ends. Dropping COBRA early on purpose does not reopen that window, though running it to its end does, and so does open enrollment.\n\nThis compares premiums, not plans: deductibles you have already met, doctors in the network and drug coverage differ, so compare the plans' terms before you choose. The credit is reconciled on your tax return against your real income. This is information about published rules. It is not tax or insurance advice.",
  resources: [
    { label: "HealthCare.gov: see plans and prices", url: "https://www.healthcare.gov/see-plans/" },
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
};
