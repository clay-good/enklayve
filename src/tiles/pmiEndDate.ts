/**
 * When PMI ends (SPEC-5 Phase 28): the Homeowners Protection Act's three dates
 * read off the loan's own schedule — when you may ask to cancel, when it ends
 * on its own, and the final cutoff — with what extra principal moves and what
 * it does not. Harm tier 1: a figure the reader checks against a servicer's
 * statement.
 *
 * The definition is in the shell; the code, its shard and its "how" block load
 * when the tool is opened (SPEC-5 §7.5): the code from `pmiEndDateView.ts`, the
 * explanation from `pmiEndDateHow.ts`.
 */
import { lazyTile } from "./lazy";
import type { TileDefinition } from "./types";

export const pmiEndDateTile: TileDefinition = lazyTile(
  {
    id: "pmi-end-date",
    title: "When PMI Ends",
    pillar: "protect",
    harmTier: 1,
    description:
      "The dates your private mortgage insurance can be canceled, and when it ends on its own.",
    keywords: [
      "pmi",
      "private mortgage insurance",
      "cancel pmi",
      "remove pmi",
      "homeowners protection act",
      "mortgage insurance",
      "78 percent",
      "80 percent",
    ],
    status: "ready",
    resources: [
      {
        label: "CFPB: when can I remove private mortgage insurance?",
        url: "https://www.consumerfinance.gov/ask-cfpb/when-can-i-remove-private-mortgage-insurance-pmi-from-my-loan-en-202/",
      },
    ],
  },
  {
    view: () => import("./pmiEndDateView").then((m) => m.mountPmiEndDate),
    shards: ["pmi-cancellation-2026"],
    how: () => import("./pmiEndDateHow").then((m) => m.how),
  },
);
