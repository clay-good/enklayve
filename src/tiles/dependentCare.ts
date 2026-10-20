/**
 * Child & Dependent Care: Credit or FSA? (SPEC-5 Phase 31, young-family F1):
 * the 2026 credit and the dependent care FSA for the same care bill, side by
 * side, each priced through the tax engine.
 *
 * The definition is in the shell; the code, its shard and its "how" block load
 * when the tool is opened (SPEC-5 §7.5): the code from `dependentCareView.ts`,
 * the explanation from `dependentCareHow.ts`.
 */
import { lazyTile } from "./lazy";
import type { TileDefinition } from "./types";

export const dependentCareTile: TileDefinition = lazyTile(
  {
    id: "dependent-care",
    title: "Child & Dependent Care: Credit or FSA?",
    pillar: "owed",
    harmTier: 1,
    description:
      "How much of what you pay for childcare comes back, through the tax credit or a dependent care FSA at work.",
    keywords: [
      "child and dependent care credit",
      "dependent care fsa",
      "childcare tax credit",
      "daycare tax credit",
      "form 2441",
      "dcap",
      "section 129",
    ],
    status: "ready",
    resources: [
      {
        label: "IRS Publication 503, Child and Dependent Care Expenses",
        url: "https://www.irs.gov/publications/p503",
      },
    ],
  },
  {
    view: () => import("./dependentCareView").then((m) => m.mountDependentCare),
    shards: ["dependent-care-2026"],
    how: () => import("./dependentCareHow").then((m) => m.how),
  },
);
