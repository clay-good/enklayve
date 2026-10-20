/**
 * Selling a Home: the Taxable Gain (SPEC-5 Phase 28). IRC §121's exclusion,
 * the partial exclusion for a move someone had to make, and the federal tax on
 * what is left through the capital-gains engine. Harm tier 1: a figure the
 * reader checks against their return.
 *
 * The definition is in the shell; the code, its shard and its "how" block load
 * when the tool is opened (SPEC-5 §7.5): the code from `homeSaleGainView.ts`, the
 * explanation from `homeSaleGainHow.ts`.
 */
import { lazyTile } from "./lazy";
import type { TileDefinition } from "./types";

export const homeSaleGainTile: TileDefinition = lazyTile(
  {
    id: "home-sale-gain",
    title: "Selling a Home: the Taxable Gain",
    pillar: "protect",
    harmTier: 1,
    description:
      "How much of the profit on selling your home is tax-free, and the tax on the rest.",
    keywords: [
      "sell my house",
      "home sale",
      "capital gains on home",
      "section 121",
      "home sale exclusion",
      "two out of five years",
      "selling a house taxes",
    ],
    status: "ready",
    resources: [
      {
        label: "IRS Publication 523, Selling Your Home",
        url: "https://www.irs.gov/publications/p523",
      },
    ],
    related: [
      {
        hubId: "investing",
        tool: "capital-gains",
        label: "Capital Gains",
        note: "The same tax, for any other asset",
      },
    ],
  },
  {
    view: () => import("./homeSaleGainView").then((m) => m.mountHomeSaleGain),
    shards: ["home-sale-exclusion-2026"],
    how: () => import("./homeSaleGainHow").then((m) => m.how),
  },
);
