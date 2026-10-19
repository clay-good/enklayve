/**
 * When PMI ends (SPEC-5 Phase 28): the Homeowners Protection Act's three dates
 * read off the loan's own schedule — when you may ask to cancel, when it ends
 * on its own, and the final cutoff — with what extra principal moves and what
 * it does not. Harm tier 1: a figure the reader checks against a servicer's
 * statement.
 *
 * The definition is in the shell; the code and its shard load when the tool is
 * opened (SPEC-5 §7.5), from `pmiEndDateView.ts`.
 */
import { lazyMount } from "./lazy";
import type { TileDefinition } from "./types";

export const pmiEndDateTile: TileDefinition = {
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
  mount: lazyMount(
    () => import("./pmiEndDateView").then((m) => m.mountPmiEndDate),
    ["pmi-cancellation-2026"],
  ),
  how: "Private mortgage insurance protects the lender, not you, and federal law says when it has to stop. The Homeowners Protection Act sets three dates, and all three are read off your loan's original amortization schedule, measured against the home's original value: the lower of the price you paid and the appraisal at closing, not what it is worth today.\n\nThe first is the date you can ask. Once your balance is scheduled to fall to 80% of the original value, you can ask your servicer in writing to cancel, provided you are current, have a good payment history, and, if the servicer asks, can show the home has not lost value and has no second mortgage. Paying extra principal can get you there sooner, and the law counts that too.\n\nThe second is automatic. When the balance is scheduled to reach 78% of the original value, the insurance ends on its own if you are current, with no request needed. The third is a backstop: whatever the balance, it cannot be required past the month after the midpoint of the loan's term.\n\nThis covers borrower-paid private mortgage insurance on a fixed-rate loan for a single-family home you live in, taken out after July 1999. FHA and VA insurance follow their own rules, and a loan the lender classed as high-risk, or a policy the lender pays for, is treated differently. Your lender had to give you the schedule and both dates in writing at closing, and your servicer must remind you of these rights every year with a number to call. If their dates differ from these, ask them to show you their schedule.",
  resources: [
    {
      label: "CFPB: when can I remove private mortgage insurance?",
      url: "https://www.consumerfinance.gov/ask-cfpb/when-can-i-remove-private-mortgage-insurance-pmi-from-my-loan-en-202/",
    },
  ],
};
