/**
 * HSA and Medicare Timing (SPEC-5 Phase 29, later-life L7): when HSA
 * contributions must stop, read from when Part A actually starts rather than
 * from when the reader applies. Harm tier 2: the decision is whether to keep
 * contributing, so the excess and its correction render beside the date.
 *
 * The definition is in the shell; the code, its shard and its "how" block load
 * when the tool is opened (SPEC-5 §7.5): the code from `hsaMedicareTimingView.ts`,
 * the explanation from `hsaMedicareTimingHow.ts`.
 */
import { lazyTile } from "./lazy";
import type { TileDefinition } from "./types";

export const hsaMedicareTimingTile: TileDefinition = lazyTile(
  {
    id: "hsa-medicare-timing",
    title: "HSA and Medicare Timing",
    pillar: "retirement",
    harmTier: 2,
    description:
      "The last month you can put money in an HSA once Medicare starts, and that year's limit.",
    keywords: [
      "hsa medicare",
      "stop hsa contributions",
      "part a retroactive",
      "hsa at 65",
      "working past 65 hsa",
      "six month lookback",
    ],
    status: "ready",
    resources: [
      {
        label: "IRS Publication 969, Health Savings Accounts",
        url: "https://www.irs.gov/publications/p969",
      },
    ],
  },
  {
    view: () => import("./hsaMedicareTimingView").then((m) => m.mountHsaMedicareTiming),
    shards: ["medicare-costs-2026"],
    how: () => import("./hsaMedicareTimingHow").then((m) => m.how),
  },
);
