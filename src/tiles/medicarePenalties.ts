/**
 * Medicare Enrollment Penalties (SPEC-5 Phase 29, later-life L2): the Part B,
 * Part D and bought-Part-A penalties for a late start, a month, a year and over
 * a horizon the reader sets. Harm tier 2: the figure shapes the choice to enroll
 * now or wait, so its consequence and its exceptions render beside it.
 *
 * The definition is in the shell; the code, its shard and its "how" block load
 * when the tool is opened (SPEC-5 §7.5): the code from `medicarePenaltiesView.ts`,
 * the explanation from `medicarePenaltiesHow.ts`.
 */
import { lazyTile } from "./lazy";
import type { TileDefinition } from "./types";

export const medicarePenaltiesTile: TileDefinition = lazyTile(
  {
    id: "medicare-penalties",
    title: "Medicare Enrollment Penalties",
    pillar: "retirement",
    harmTier: 2,
    description: "What signing up late for Part B, Part D or Part A costs, and for how long.",
    keywords: [
      "medicare late enrollment penalty",
      "part b penalty",
      "part d penalty",
      "creditable coverage",
      "missed medicare enrollment",
    ],
    status: "ready",
    resources: [
      {
        label: "Medicare.gov: avoid late enrollment penalties",
        url: "https://www.medicare.gov/basics/costs/medicare-costs/avoid-penalties",
      },
    ],
  },
  {
    view: () => import("./medicarePenaltiesView").then((m) => m.mountMedicarePenalties),
    shards: ["medicare-costs-2026"],
    how: () => import("./medicarePenaltiesHow").then((m) => m.how),
  },
);
