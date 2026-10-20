/**
 * Is the Second Income Worth It? (SPEC-5 Phase 31, young-family F3): what a
 * household keeps from a second earner's pay after tax, lost benefits,
 * childcare and the costs of working, with the care credit or FSA added back.
 *
 * The definition is in the shell; the code, the dependent care shard and its
 * "how" block load when the tool is opened (SPEC-5 §7.5): the code from
 * `secondIncomeView.ts`, the explanation from `secondIncomeHow.ts`.
 */
import { lazyTile } from "./lazy";
import type { TileDefinition } from "./types";

export const secondIncomeTile: TileDefinition = lazyTile(
  {
    id: "second-income",
    title: "Is the Second Income Worth It?",
    pillar: "rough",
    harmTier: 1,
    description:
      "What going back to work actually adds, after tax, lost benefits, childcare and the costs of working.",
    keywords: [
      "second income",
      "going back to work",
      "is it worth working",
      "childcare cost vs income",
      "two income household",
      "stay at home parent",
    ],
    status: "ready",
    related: [
      {
        hubId: "benefits",
        tool: "dependent-care",
        label: "Child & Dependent Care: Credit or FSA?",
        note: "The credit and the FSA on the childcare, in detail",
      },
      {
        hubId: "benefit-cliffs",
        tool: "cliff-explorer",
        label: "Benefit Cliff Explorer",
        note: "Where the edges are across a whole range of incomes",
      },
    ],
    resources: [
      { label: "HealthCare.gov, find your benchmark premium", url: "https://www.healthcare.gov/" },
    ],
  },
  {
    view: () => import("./secondIncomeView").then((m) => m.mountSecondIncome),
    shards: ["dependent-care-2026"],
    how: () => import("./secondIncomeHow").then((m) => m.how),
  },
);
