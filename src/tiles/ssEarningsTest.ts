/**
 * Social Security Earnings Test (SPEC-5 Phase 29, later-life L3): what working
 * while claiming early holds back, in whole months, and that it is credited
 * back at full retirement age. Harm tier 1: a figure the reader checks against
 * Social Security's notice.
 *
 * The definition is in the shell; the code, its shard and its "how" block load
 * when the tool is opened (SPEC-5 §7.5): the code from `ssEarningsTestView.ts`,
 * the explanation from `ssEarningsTestHow.ts`.
 */
import { lazyTile } from "./lazy";
import type { TileDefinition } from "./types";

export const ssEarningsTestTile: TileDefinition = lazyTile(
  {
    id: "ss-earnings-test",
    title: "Social Security Earnings Test",
    pillar: "retirement",
    harmTier: 1,
    description:
      "How much of your benefit working holds back before full retirement age, and when you get it back.",
    keywords: [
      "earnings test",
      "working while collecting social security",
      "social security earnings limit",
      "benefits withheld",
      "retirement earnings test",
    ],
    status: "ready",
    resources: [
      {
        label: "Social Security: receiving benefits while working",
        url: "https://www.ssa.gov/benefits/retirement/planner/whileworking.html",
      },
    ],
  },
  {
    view: () => import("./ssEarningsTestView").then((m) => m.mountSsEarningsTest),
    shards: ["ss-earnings-test-2026"],
    how: () => import("./ssEarningsTestHow").then((m) => m.how),
  },
);
