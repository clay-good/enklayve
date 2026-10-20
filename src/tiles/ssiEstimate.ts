/**
 * SSI Estimate (SPEC-5 Phase 30, later-life L6): the federal SSI payment less
 * countable income, by the regulations' own exclusions, and the resource
 * limit. Harm tier 3: eligibility is Social Security's to decide, so the tool
 * screens and estimates and names where to apply.
 *
 * The definition is in the shell; the code, its shard and its "how" block load
 * when the tool is opened (SPEC-5 §7.5): the code from `ssiEstimateView.ts`,
 * the explanation from `ssiEstimateHow.ts`.
 */
import { lazyTile } from "./lazy";
import type { TileDefinition } from "./types";

export const ssiEstimateTile: TileDefinition = lazyTile(
  {
    id: "ssi-estimate",
    title: "SSI Estimate",
    pillar: "retirement",
    harmTier: 3,
    description:
      "Roughly what Supplemental Security Income could pay at your income and resources.",
    keywords: [
      "ssi",
      "supplemental security income",
      "ssi payment",
      "ssi income limit",
      "ssi resource limit",
      "disability ssi",
    ],
    status: "ready",
    channels: [
      {
        label: "Apply for SSI with Social Security",
        url: "https://www.ssa.gov/apply/ssi",
        note: "Online, by phone at 1-800-772-1213, or at a local office",
      },
      {
        label: "Find free legal help near you",
        url: "https://www.lsc.gov/about-lsc/what-legal-aid/i-need-legal-help",
        note: "If an application is denied and you want to appeal",
      },
    ],
    resources: [
      {
        label: "Social Security: Understanding SSI",
        url: "https://www.ssa.gov/ssi/text-understanding-ssi.htm",
      },
    ],
  },
  {
    view: () => import("./ssiEstimateView").then((m) => m.mountSsiEstimate),
    shards: ["ssi-2026"],
    how: () => import("./ssiEstimateHow").then((m) => m.how),
  },
);
