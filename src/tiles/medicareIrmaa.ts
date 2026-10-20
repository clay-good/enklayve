/**
 * Medicare Premiums & IRMAA (SPEC-5 Phase 29, later-life L1): the Part B
 * premium and the Part D surcharge for the tier a return from two years back
 * puts the reader in, and the distance to the next line. Harm tier 1: a figure
 * the reader checks against Social Security's notice.
 *
 * The definition is in the shell; the code, its shard and its "how" block load
 * when the tool is opened (SPEC-5 §7.5): the code from `medicareIrmaaView.ts`,
 * the explanation from `medicareIrmaaHow.ts`.
 */
import { lazyTile } from "./lazy";
import type { TileDefinition } from "./types";

export const medicareIrmaaTile: TileDefinition = lazyTile(
  {
    id: "medicare-irmaa",
    title: "Medicare Premiums & IRMAA",
    pillar: "retirement",
    harmTier: 1,
    description:
      "What Part B and the Part D surcharge cost at your income, and how close you are to the next tier.",
    keywords: [
      "irmaa",
      "medicare premium",
      "part b premium",
      "part d surcharge",
      "income related monthly adjustment",
      "medicare surcharge",
      "ssa-44",
    ],
    status: "ready",
    resources: [
      {
        label: "Medicare.gov: Part B costs",
        url: "https://www.medicare.gov/basics/costs/medicare-costs",
      },
      {
        label: "Social Security: Medicare premiums for higher-income beneficiaries",
        url: "https://www.ssa.gov/benefits/medicare/medicare-premiums.html",
      },
    ],
  },
  {
    view: () => import("./medicareIrmaaView").then((m) => m.mountMedicareIrmaa),
    shards: ["medicare-costs-2026"],
    how: () => import("./medicareIrmaaHow").then((m) => m.how),
  },
);
