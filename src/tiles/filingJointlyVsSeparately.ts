/**
 * Married: Jointly or Separately? (SPEC-5 Phase 28): one couple's tax and
 * credits on a joint return and on two separate ones. Harm tier 1: a figure
 * the reader checks against a return.
 *
 * The definition is in the shell; the code and its "how" block load when the
 * tool is opened (SPEC-5 §7.5): the code from `filingJointlyVsSeparatelyView.ts`,
 * the explanation from `filingJointlyVsSeparatelyHow.ts`.
 */
import { lazyTile } from "./lazy";
import type { TileDefinition } from "./types";

export const filingJointlyVsSeparatelyTile: TileDefinition = lazyTile(
  {
    id: "filing-jointly-vs-separately",
    title: "Married: Jointly or Separately?",
    pillar: "paycheck",
    harmTier: 1,
    description:
      "Whether one joint return or two separate ones costs less, with the credits each way.",
    keywords: [
      "married filing separately",
      "married filing jointly",
      "mfs vs mfj",
      "file separately",
      "joint return",
      "marriage penalty",
    ],
    status: "ready",
    resources: [
      {
        label: "IRS Publication 501, Filing Status",
        url: "https://www.irs.gov/publications/p501",
      },
    ],
  },
  {
    view: () =>
      import("./filingJointlyVsSeparatelyView").then((m) => m.mountFilingJointlyVsSeparately),
    how: () => import("./filingJointlyVsSeparatelyHow").then((m) => m.how),
  },
);
