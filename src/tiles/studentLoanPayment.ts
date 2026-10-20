/**
 * Federal Student Loan Payment (SPEC-5 Phase 33, S1): each repayment plan the
 * reader can choose under Pub. L. 119-21, side by side, under a stated income
 * assumption. Harm tier 2: a plan choice can be hard to undo, so each plan's
 * consequences render beside its payment, and no plan is named as the choice.
 *
 * The definition is in the shell; the code, its shard and its "how" block load
 * when the tool is opened (SPEC-5 §7.5).
 */
import { lazyTile } from "./lazy";
import type { TileDefinition } from "./types";

export const studentLoanPaymentTile: TileDefinition = lazyTile(
  {
    id: "student-loan-payment",
    title: "Federal Student Loan Payment",
    pillar: "debt",
    harmTier: 2,
    description: "Your payment and total cost on each federal student loan plan you can choose.",
    keywords: [
      "student loan payment",
      "repayment assistance plan",
      "rap",
      "income based repayment",
      "ibr",
      "student loan forgiveness",
      "save plan ending",
      "federal student loans",
    ],
    status: "ready",
    resources: [
      {
        label: "Federal Student Aid: Loan Simulator",
        url: "https://studentaid.gov/repayment-calculator/",
      },
    ],
  },
  {
    view: () => import("./studentLoanPaymentView").then((m) => m.mountStudentLoanPayment),
    shards: ["student-loans-2026"],
    how: () => import("./studentLoanPaymentHow").then((m) => m.how),
  },
);
