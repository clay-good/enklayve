/**
 * Spousal and Survivor Benefits (SPEC-5 Phase 29, later-life L4): a spouse's
 * benefit on the worker's record at the age claimed, set against the reader's
 * own, and the survivor benefit at 60, at the chosen age and at full
 * retirement age. Harm tier 1: a figure the reader checks against Social
 * Security's.
 *
 * The definition is in the shell; the code, its shard and its "how" block load
 * when the tool is opened (SPEC-5 §7.5): the code from `ssSpousalSurvivorView.ts`,
 * the explanation from `ssSpousalSurvivorHow.ts`.
 */
import { lazyTile } from "./lazy";
import type { TileDefinition } from "./types";

export const ssSpousalSurvivorTile: TileDefinition = lazyTile(
  {
    id: "ss-spousal-survivor",
    title: "Spousal and Survivor Benefits",
    pillar: "retirement",
    harmTier: 1,
    description:
      "What a spouse gets on the other's Social Security record, and what a survivor gets.",
    keywords: [
      "spousal benefit",
      "survivor benefit",
      "widow social security",
      "widower benefit",
      "social security for spouse",
      "half of my spouse's benefit",
    ],
    status: "ready",
    resources: [
      {
        label: "Social Security: benefits for spouses",
        url: "https://www.ssa.gov/benefits/retirement/planner/applying7.html",
      },
      {
        label: "Social Security: survivors benefits",
        url: "https://www.ssa.gov/survivors/",
      },
    ],
    related: [
      {
        hubId: "retirement",
        tool: "social-security",
        label: "Social Security Claiming Age",
        note: "Your own benefit at 62, full retirement age and 70",
      },
    ],
  },
  {
    view: () => import("./ssSpousalSurvivorView").then((m) => m.mountSsSpousalSurvivor),
    shards: ["ss-family-benefits-2026"],
    how: () => import("./ssSpousalSurvivorHow").then((m) => m.how),
  },
);
