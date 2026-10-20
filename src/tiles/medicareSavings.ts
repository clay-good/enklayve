/**
 * Medicare Savings Programs & Extra Help (SPEC-5 Phase 30, later-life L5):
 * income and resources against the federal 2026 lines for QMB, SLMB, QI and
 * Extra Help. Harm tier 3: the state Medicaid agency and Social Security
 * decide, so the tool screens and names where to apply, and never says who
 * qualifies.
 *
 * The definition is in the shell; the code, its shard and its "how" block load
 * when the tool is opened (SPEC-5 §7.5): the code from `medicareSavingsView.ts`,
 * the explanation from `medicareSavingsHow.ts`.
 */
import { lazyTile } from "./lazy";
import type { TileDefinition } from "./types";

export const medicareSavingsTile: TileDefinition = lazyTile(
  {
    id: "medicare-savings",
    title: "Medicare Savings Programs & Extra Help",
    pillar: "retirement",
    harmTier: 3,
    description:
      "Whether your income and savings sit under the federal lines for help paying Medicare premiums and drug costs.",
    keywords: [
      "medicare savings program",
      "qmb",
      "slmb",
      "qualifying individual",
      "extra help",
      "low income subsidy",
      "part b premium help",
      "part d help",
    ],
    status: "ready",
    channels: [
      {
        label: "Find your State Health Insurance Assistance Program (SHIP)",
        url: "https://www.shiphelp.org/",
        note: "Free, one-on-one Medicare counseling, including help applying",
      },
      {
        label: "Contact your state Medicaid agency",
        url: "https://www.medicaid.gov/about-us/where-can-people-get-help-medicaid-chip",
        note: "Medicare Savings Programs are applied for through the state",
      },
      {
        label: "Apply for Extra Help with Social Security",
        url: "https://www.ssa.gov/medicare/part-d-extra-help",
        note: "Online, or by phone at 1-800-772-1213",
      },
    ],
    resources: [
      {
        label: "Medicare.gov: Medicare Savings Programs",
        url: "https://www.medicare.gov/basics/costs/help/medicare-savings-programs",
      },
      {
        label: "Medicare.gov: Help with drug costs",
        url: "https://www.medicare.gov/basics/costs/help/drug-costs",
      },
    ],
  },
  {
    view: () => import("./medicareSavingsView").then((m) => m.mountMedicareSavings),
    shards: ["medicare-savings-2026"],
    how: () => import("./medicareSavingsHow").then((m) => m.how),
  },
);
