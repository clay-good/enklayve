/**
 * The check registry — "what looks wrong" (SPEC-4-readout-v2 §4).
 *
 * This is where a document reader earns its keep and where it can most easily
 * do harm. Every check is a named, tested rule with a fixed shape, and they live
 * in a registry rather than as inline conditionals so the properties below are
 * testable in one place:
 *
 * - **A check that cannot state what a false positive looks like does not ship.**
 *   {@link validateRegistry} fails an empty `falsePositive`, and the failure mode
 *   it exists to prevent is a household disputing a *correct* bill because we
 *   flagged it confidently.
 * - A `rule` check always carries a citation and is always suppressed on OCR
 *   text — an OCR misread must never become a "this bill is wrong" claim (§6.4).
 * - A check never asserts an error. It states the arithmetic or the mismatch,
 *   phrases it as a question, and names who to ask.
 *
 * The module is pure: extractions in, outcomes out.
 */
import type { CitationData, NoSurprisesData } from "../data/schemas";
import { Money } from "../engine/money";
import { monthlyMortgagePayment } from "../engine/finance";
import { TIPPED_OCCUPATION_CITATION } from "../data/statutes";
import {
  DIRECT_ROLLOVER_REPORTING_CITATION,
  EARLY_DISTRIBUTION_WITHHOLDING_CITATION,
} from "./citations";
import type { CheckKind, CheckOutcome, DocKind, ExtractionResult } from "./types";

/**
 * Plan parameters the *user* supplied, for `plan-math` checks. Absent values
 * simply skip their checks — we never substitute a typical plan's deductible for
 * the one the household actually has.
 */
export interface PlanParameters {
  deductible?: number;
  oopMax?: number;
}

/** Everything a check may read. Nothing else is in scope — no network, no model. */
export interface CheckContext {
  /** The document this answer is being built for. */
  primary: ExtractionResult;
  /** Every extraction in the session, including `primary`. Enables §5 cross-checks. */
  documents: ExtractionResult[];
  plan?: PlanParameters;
  /** The No Surprises Act scope shard, for the balance-billing rule check.
   * Absent simply skips that check — a rule we cannot cite is a rule we do not
   * state (SPEC-4-readout-v2 §4). */
  noSurprises?: NoSurprisesData;
}

/** What a check returns when it fires. The registry stamps on the rest. */
export interface CheckFinding {
  /** The question to ask, in the user's words. Never a verdict. */
  question: string;
  /** The arithmetic or the mismatch, stated plainly. */
  detail: string;
  /** Who to raise it with. */
  askWho: string;
  /**
   * The citation for a rule check whose rule travels with a hashed dataset
   * rather than being hard-coded here. Overrides the definition's `citation`.
   */
  citation?: CitationData;
}

/** One check (SPEC-4-readout-v2 §4.1). */
export interface CheckDefinition {
  id: string;
  kind: CheckKind;
  /**
   * The kinds this check needs. A check runs only when *every* listed kind is
   * present in the session, which is what makes a cross-document check skip
   * silently when only one of the pair was read.
   */
  appliesTo: DocKind[];
  /** Required for kind "rule"; forbidden for kind "arithmetic". */
  citation?: CitationData;
  /**
   * Declares that this rule check's citation arrives with the dataset it reads,
   * so `citation` above is legitimately absent. The alternative — copying a
   * shard's citation into the code that reads it — is exactly the drift seam
   * where the hashed source and the cited source quietly diverge. The promise is
   * enforced at run time as well as declared: {@link runChecks} drops a rule
   * outcome that reaches it with no citation, so an uncited rule cannot render.
   */
  citationFromData?: boolean;
  /** What a false positive looks like, in one sentence. Required for every check. */
  falsePositive: string;
  /** Suppressed when the source text came from OCR (always true for "rule"). */
  suppressOnOcr: boolean;
  run(ctx: CheckContext): CheckFinding | null;
}

/** Cents of slack before an arithmetic mismatch is worth raising. Rounding on a
 * plan's own statement is routine; a dollar is not. */
const NOISE_FLOOR = 1;

/** Where an accumulator question goes, for the two checks that ask one. */
const ACCUMULATOR_ASK =
  "Your health plan's member services line — ask them to walk through the accumulator.";

function usd(n: number): string {
  return Money.from(n).format("en-US");
}

/**
 * The document of `kind` these checks are about, or null.
 *
 * The one being read wins: `ctx.primary` is the document the answer on screen
 * is for, and a check that computed on a different one would quote dollars the
 * reader is not looking at. This took the **first** match in the session, and
 * "Read another document" is an advertised flow — so a second EOB was restated
 * on screen ("What this says") while "What looks wrong" was still checking the
 * first, silent about a broken second bill because the first one reconciled.
 *
 * For the other side of a cross-check — the medical bill beside the EOB — the
 * most recent one is the answer for the same reason: it is the one the reader
 * has just handed over.
 */
function doc(ctx: CheckContext, kind: DocKind): ExtractionResult | null {
  if (ctx.primary.kind === kind) return ctx.primary;
  for (let i = ctx.documents.length - 1; i >= 0; i--) {
    const d = ctx.documents[i]!;
    if (d.kind === kind) return d;
  }
  return null;
}

/** A numeric extracted field by id, or null when it was not read. */
function amount(d: ExtractionResult | null, id: string): number | null {
  const f = d?.fields.find((x) => x.id === id);
  return typeof f?.value === "number" && Number.isFinite(f.value) ? f.value : null;
}

/** Every itemized charge line on a bill, in document order. */
function billLines(d: ExtractionResult | null): { label: string; value: number }[] {
  if (!d) return [];
  return d.fields
    .filter((f) => f.id.startsWith("bill-line-") && typeof f.value === "number")
    .map((f) => ({ label: f.label, value: f.value as number }));
}

/**
 * The shipped checks. Phase 22a ships the arithmetic, plan-math, and anomaly
 * families plus the EOB × medical-bill cross-check. `rule` checks (the No
 * Surprises Act balance-billing screen) arrive with the `no-surprises` shard
 * that cites them — the registry contract for them is enforced here and tested
 * against fixtures in the meantime, so a rule check cannot land uncited.
 */
export const CHECKS: CheckDefinition[] = [
  {
    // A code 1 distribution with 20% withheld is the shape of a cashed-out
    // 401(k): the payer withheld what §3405(c) requires, which prepays income
    // tax, and the 10% additional tax arrives in April on top of it.
    id: "1099r-early-withholding-short",
    kind: "rule",
    appliesTo: ["form1099r"],
    citation: EARLY_DISTRIBUTION_WITHHOLDING_CITATION,
    falsePositive:
      "An exception the payer did not know about (separation from service at 55 or later, disability, a series of equal payments, and others) removes the additional tax, and a low-income year can leave the 20% covering everything.",
    suppressOnOcr: true,
    run: (ctx) => {
      const d = doc(ctx, "form1099r");
      const code = d?.fields.find((f) => f.id === "1099r-code")?.value;
      const gross = amount(d, "1099r-box1");
      const taxable = amount(d, "1099r-box2a") ?? gross;
      const withheld = amount(d, "1099r-box4");
      if (code !== "1" || gross === null || taxable === null || withheld === null) return null;
      if (gross <= 0 || Math.abs(withheld - gross * 0.2) > NOISE_FLOOR) return null;
      return {
        question: "Will the 20% withheld cover what this distribution costs at tax time?",
        detail: `Code 1 means an early distribution with no known exception, so a 10% additional tax may be due on the ${usd(taxable)} taxable, about ${usd(taxable * 0.1)}, on top of the income tax. Box 4 shows ${usd(withheld)} withheld, which is the 20% a payer must withhold for income tax alone.`,
        askWho:
          "A free VITA tax site, or the Cashing Out a 401(k) tool here, before you file. If an exception applies, Form 5329 is where you claim it.",
      };
    },
  },
  {
    id: "1099r-rollover-taxable",
    kind: "rule",
    appliesTo: ["form1099r"],
    citation: DIRECT_ROLLOVER_REPORTING_CITATION,
    falsePositive:
      "A direct rollover into a designated Roth account in the same plan (an in-plan Roth rollover) is reported with code G and a taxable box 2a, correctly.",
    suppressOnOcr: true,
    run: (ctx) => {
      const d = doc(ctx, "form1099r");
      const code = d?.fields.find((f) => f.id === "1099r-code")?.value;
      const taxable = amount(d, "1099r-box2a");
      if (typeof code !== "string" || !code.includes("G") || taxable === null) return null;
      if (taxable <= NOISE_FLOOR) return null;
      return {
        question: "Was this rollover meant to be taxable?",
        detail: `Code G is a direct rollover, which the IRS instructions report with zero in box 2a. This form shows ${usd(taxable)} as taxable.`,
        askWho:
          "The plan administrator who issued this form. A rollover into a Roth account in the same plan is taxable; one into an IRA or another plan normally is not.",
      };
    },
  },
  {
    // The tips deduction is the one figure on a 2026 W-2 that the form itself
    // qualifies. Box 12 code TP is "total cash tips reported to the employer";
    // box 14b says which occupations they were received in, and a "000" there
    // means at least some of them are outside IRC §224. Without this the
    // Readout would hand the reader a tips figure their own W-2 says is too
    // high, and pre-fill a calculator with it.
    id: "w2-tips-nonqualifying-occupation",
    kind: "rule",
    appliesTo: ["w2"],
    citation: TIPPED_OCCUPATION_CITATION,
    falsePositive:
      "An employer who enters 000 alongside a qualifying code may have received only a small share of the tips in the nonqualifying occupation, so most of the figure can still be deductible.",
    // An OCR misread of three digits must never become a "your tips do not
    // qualify" claim — and a scan is exactly what turns 008 into 000.
    suppressOnOcr: true,
    run: (ctx) => {
      const d = doc(ctx, "w2");
      const tips = amount(d, "w2-box12tp");
      const codes = d?.fields.find((f) => f.id === "w2-box14b")?.value;
      if (tips === null || typeof codes !== "string") return null;
      if (!codes.split(/[^0-9]+/).includes("000")) return null;
      return {
        question: "Do all of these tips qualify for the deduction?",
        detail: `Box 12 code TP reports ${usd(tips)} of cash tips, and box 14b includes the code 000 — which the IRS instructions require when any of the tips were received in an occupation that does not qualify. The deductible figure may be smaller than ${usd(tips)}.`,
        askWho:
          "Your employer's payroll department, who entered the occupation codes and can say which tips they cover.",
      };
    },
  },
  {
    // SPEC-5-readout-v3 §3: the SSA-1099's net benefits belong on line 6a.
    // Only a shortfall is asked about: a joint return, a second SSA-1099 or
    // an RRB-1099 all add to line 6a legitimately.
    id: "ssa1099-on-1040",
    kind: "plan-math",
    appliesTo: ["ssa1099", "form1040"],
    falsePositive:
      "A return for a different year than the SSA-1099, or a benefit repaid in a later year and handled under the claim-of-right rules, can make line 6a differ.",
    suppressOnOcr: true,
    run: (ctx) => {
      const box5 = amount(doc(ctx, "ssa1099"), "ssa1099-box5");
      const line6a = amount(doc(ctx, "form1040"), "f1040-6a");
      if (box5 === null || line6a === null || box5 - line6a <= NOISE_FLOOR) return null;
      return {
        question: "Is all of your Social Security on your return?",
        detail: `The SSA-1099's net benefits in box 5 are ${usd(box5)}. Line 6a of the return shows ${usd(line6a)}, which is ${usd(box5 - line6a)} less.`,
        askWho:
          "Whoever prepared the return, or a free VITA site. If the return is already filed, an amended return (Form 1040-X) corrects it.",
      };
    },
  },
  {
    // The payment the form prints against the one its own amount, rate and
    // term produce, through the same formula Loan & Mortgage Amortization
    // uses. A mismatch is the first question to ask at the closing table.
    id: "cd-pi-reconciles",
    kind: "arithmetic",
    appliesTo: ["closingDisclosure"],
    falsePositive:
      "An adjustable, step-rate or interest-only loan, or one whose first payment period is irregular, has a payment this fixed-rate formula does not describe.",
    suppressOnOcr: true,
    run: (ctx) => {
      const d = doc(ctx, "closingDisclosure");
      const principal = amount(d, "cd-loan-amount");
      const rate = amount(d, "cd-rate");
      const years = amount(d, "cd-term-years");
      const pi = amount(d, "cd-pi");
      if (principal === null || rate === null || years === null || pi === null) return null;
      const expected = monthlyMortgagePayment(principal, rate, years).roundToCents().toNumber();
      if (Math.abs(expected - pi) <= NOISE_FLOOR) return null;
      return {
        question: "Does the monthly payment match the loan you are signing for?",
        detail: `A ${usd(principal)} loan at ${rate}% over ${years} years amortizes at ${usd(expected)} a month. This form shows ${usd(pi)}.`,
        askWho:
          "Your lender or the settlement agent, before you sign. Ask which figure is right and why.",
      };
    },
  },
  {
    // On an approved claim, what you may be billed is Medicare's approved
    // amount less what Medicare paid. A denied service adds its whole charge,
    // so this runs only when the notice reports none denied.
    id: "msn-max-over-share",
    kind: "arithmetic",
    appliesTo: ["medicareSummaryNotice"],
    falsePositive:
      "A provider who does not accept assignment may bill up to the limiting charge above the approved amount, and a claim with a denied service adds that service's full charge.",
    suppressOnOcr: true,
    run: (ctx) => {
      const d = doc(ctx, "medicareSummaryNotice");
      if (amount(d, "msn-services-denied") !== 0) return null;
      for (let n = 1; amount(d, `msn-claim-${n}-max`) !== null; n++) {
        const approved = amount(d, `msn-claim-${n}-approved`)!;
        const paid = amount(d, `msn-claim-${n}-paid`)!;
        const max = amount(d, `msn-claim-${n}-max`)!;
        if (max - (approved - paid) <= NOISE_FLOOR) continue;
        return {
          question:
            "Why can this provider bill you more than Medicare's approved amount less what Medicare paid?",
          detail: `Claim ${n} shows ${usd(approved)} approved and ${usd(paid)} paid by Medicare, a share of ${usd(approved - paid)}, but ${usd(max)} as the most you may be billed, with no service denied.`,
          askWho:
            "1-800-MEDICARE, or your State Health Insurance Assistance Program for free help reading the notice.",
        };
      }
      return null;
    },
  },
  {
    // The Medicare form of the EOB × bill cross-check (SPEC-5-readout-v3 §3):
    // the notice's own figure is the standard the bill is held to.
    id: "msn-bill-over-max",
    kind: "plan-math",
    appliesTo: ["medicareSummaryNotice", "medicalBill"],
    falsePositive:
      "A bill can cover services on more than one notice, or carry a balance from before, so its total can be higher without any one claim being overbilled.",
    suppressOnOcr: true,
    run: (ctx) => {
      const msn = doc(ctx, "medicareSummaryNotice");
      const bill = amount(doc(ctx, "medicalBill"), "bill-total");
      const max = amount(msn, "msn-total-may-be-billed");
      if (bill === null || max === null || bill - max <= NOISE_FLOOR) return null;
      return {
        question:
          "Is this bill asking for more than your Medicare Summary Notice says you may be billed?",
        detail: `The bill's total is ${usd(bill)}. The notice says the most you may be billed is ${usd(max)}, which is ${usd(bill - max)} less.`,
        askWho:
          "The provider's billing office, with the notice in hand. If the bill does not come down, 1-800-MEDICARE.",
      };
    },
  },
  {
    // Model Form B-1 prints its own arithmetic: the amount on the itemization
    // date, plus interest and fees, less payments, is the amount now
    // (§1006.34(c)(2)(vii)-(ix)). A notice that does not add up is the first
    // thing worth asking about, before anything else on it is relied on.
    id: "collections-itemization-sum",
    kind: "arithmetic",
    appliesTo: ["collectionsNotice"],
    falsePositive:
      "A notice that itemizes on a separate page, or that rounds each line, can differ from its total by the line it left off or by cents.",
    // Arithmetic, but on a debt: a misread digit in a photographed letter must
    // never become a question about whether the debt adds up (R8 is tier 3).
    suppressOnOcr: true,
    run: (ctx) => {
      const d = doc(ctx, "collectionsNotice");
      const owed = amount(d, "collections-owed");
      const current = amount(d, "collections-current");
      if (owed === null || current === null) return null;
      const interest = amount(d, "collections-interest") ?? 0;
      const fees = amount(d, "collections-fees") ?? 0;
      const paid = amount(d, "collections-paid") ?? 0;
      const expected = owed + interest + fees - paid;
      if (Math.abs(expected - current) <= NOISE_FLOOR) return null;
      return {
        question: "Does the amount this notice says you owe now follow from its own itemization?",
        detail: `It shows ${usd(owed)} on the itemization date, plus ${usd(interest)} interest and ${usd(fees)} fees, less ${usd(paid)} paid, which comes to ${usd(expected)}. It says the debt is now ${usd(current)}.`,
        askWho:
          "The debt collector, in writing and before the dispute date on the notice. Ask for the itemization and for verification of the debt.",
      };
    },
  },
  {
    id: "eob-allowed-splits",
    kind: "arithmetic",
    appliesTo: ["eobHealth"],
    falsePositive:
      "A second payer, a provider discount applied after the plan's math, or a prior balance rolled into this notice can make these legitimately differ.",
    suppressOnOcr: false,
    run: (ctx) => {
      const d = doc(ctx, "eobHealth");
      const allowed = amount(d, "eob-allowed");
      const paid = amount(d, "eob-plan-paid");
      const patient = amount(d, "eob-patient-responsibility");
      if (allowed === null || paid === null || patient === null) return null;
      const gap = allowed - (paid + patient);
      if (Math.abs(gap) <= NOISE_FLOOR) return null;
      return {
        question: "Does the plan's own math on this notice add up?",
        detail: `The allowed amount is ${usd(allowed)}, but plan paid ${usd(paid)} plus your responsibility ${usd(patient)} comes to ${usd(paid + patient)} — a difference of ${usd(Math.abs(gap))}.`,
        askWho: "Your health plan's member services line, using the claim number on the notice.",
      };
    },
  },
  {
    id: "eob-patient-exceeds-billed",
    kind: "arithmetic",
    appliesTo: ["eobHealth"],
    falsePositive:
      "An EOB that summarizes several claims can show a combined responsibility against a single line's billed amount.",
    suppressOnOcr: false,
    run: (ctx) => {
      const d = doc(ctx, "eobHealth");
      const billed = amount(d, "eob-billed");
      const patient = amount(d, "eob-patient-responsibility");
      if (billed === null || patient === null) return null;
      if (patient - billed <= NOISE_FLOOR) return null;
      return {
        question: "Why is your share larger than the amount billed?",
        detail: `The notice shows ${usd(billed)} billed and ${usd(patient)} as your responsibility — ${usd(patient - billed)} more than the charge itself.`,
        askWho: "Your health plan's member services line, using the claim number on the notice.",
      };
    },
  },
  {
    id: "eob-deductible-over-plan-deductible",
    kind: "plan-math",
    appliesTo: ["eobHealth"],
    falsePositive:
      "A family deductible, or a deductible that reset partway through the year, can legitimately exceed the individual figure you entered.",
    suppressOnOcr: false,
    run: (ctx) => {
      const d = doc(ctx, "eobHealth");
      const applied = amount(d, "eob-deductible-applied");
      const plan = ctx.plan?.deductible;
      if (applied === null || plan === undefined || !Number.isFinite(plan)) return null;
      if (applied - plan <= NOISE_FLOOR) return null;
      return {
        question: "Is this applying more to your deductible than your deductible is?",
        detail: `If your deductible is ${usd(plan)}, this notice applying ${usd(applied)} to it does not reconcile — ${usd(applied - plan)} more than the whole deductible.`,
        askWho: ACCUMULATOR_ASK,
      };
    },
  },
  {
    // The deductible check's twin, and the reason `PlanParameters.oopMax`
    // existed: it was declared, the figure was extracted from the notice, and
    // nothing read either of them. A cap is a cap — a notice applying more to
    // it than the whole of it is the same question as the deductible one, and
    // the out-of-pocket maximum is the number that decides when a household
    // stops paying at all.
    id: "eob-oop-over-plan-oop-max",
    kind: "plan-math",
    appliesTo: ["eobHealth"],
    falsePositive:
      "A family out-of-pocket maximum, or one that reset partway through the year, can legitimately exceed the individual figure you entered.",
    suppressOnOcr: false,
    run: (ctx) => {
      const applied = amount(doc(ctx, "eobHealth"), "eob-oop-applied");
      const plan = ctx.plan?.oopMax;
      if (applied === null || plan === undefined || !Number.isFinite(plan)) return null;
      if (applied - plan <= NOISE_FLOOR) return null;
      return {
        question: "Is this applying more to your out-of-pocket maximum than your maximum is?",
        detail: `If your out-of-pocket maximum is ${usd(plan)}, this notice applying ${usd(applied)} to it does not reconcile — ${usd(applied - plan)} past the cap.`,
        askWho: ACCUMULATOR_ASK,
      };
    },
  },
  {
    id: "bill-lines-sum-to-total",
    kind: "arithmetic",
    appliesTo: ["medicalBill"],
    falsePositive:
      "A bill that lists payments, insurance adjustments, or a prior balance alongside charges will not have its charge lines sum to the balance due.",
    suppressOnOcr: false,
    run: (ctx) => {
      const d = doc(ctx, "medicalBill");
      const lines = billLines(d);
      const total = amount(d, "bill-total");
      if (lines.length < 2 || total === null) return null;
      const sum = lines.reduce((a, l) => a + l.value, 0);
      const gap = sum - total;
      if (Math.abs(gap) <= NOISE_FLOOR) return null;
      return {
        question: "Do the line items on this bill add up to its total?",
        detail: `The ${lines.length} charge lines sum to ${usd(sum)}, and the bill's total reads ${usd(total)} — a difference of ${usd(Math.abs(gap))}.`,
        askWho: "The provider's billing office — ask for an itemized statement that reconciles.",
      };
    },
  },
  {
    id: "bill-duplicate-line",
    kind: "anomaly",
    appliesTo: ["medicalBill"],
    falsePositive:
      "Two identical services on one day are routine — a second injection, a repeat lab draw, or bilateral imaging.",
    // OCR is exactly what manufactures a spurious duplicate, by misreading one
    // line into the shape of another. An anomaly this soft is not worth running
    // against a scan.
    suppressOnOcr: true,
    run: (ctx) => {
      // Counted in full before anything is said. Returning on the second
      // sighting reported "appears 2 times" for a line that appears five —
      // understating a repeat on a medical bill, which is the direction that
      // costs the reader, and on the one figure the question is entirely about.
      const lines = billLines(doc(ctx, "medicalBill"));
      const counts = new Map<string, { label: string; value: number; n: number }>();
      for (const l of lines) {
        const key = `${l.label}|${l.value}`;
        const prev = counts.get(key);
        counts.set(key, { label: l.label, value: l.value, n: (prev?.n ?? 0) + 1 });
      }
      // The most-repeated line, and the first of them on a tie, so the question
      // is stable for a given bill rather than dependent on map ordering.
      let worst: { label: string; value: number; n: number } | null = null;
      for (const c of counts.values()) {
        if (c.n > (worst?.n ?? 1)) worst = c;
      }
      if (!worst) return null;
      return {
        question:
          worst.n === 2 ? "Is this line meant to appear twice?" : "Is this line meant to repeat?",
        detail: `"${worst.label}" at ${usd(worst.value)} appears ${worst.n} times on the same bill. This may well be intentional — worth confirming.`,
        askWho: "The provider's billing office.",
      };
    },
  },
  {
    /**
     * The balance-billing screen (SPEC-4-safety-net §B1, check 2). Tier 3
     * framing throughout: it states what the rule protects, says plainly that
     * whether *this* care falls inside it cannot be read off the notice, and
     * names the free federal channel. It never says "you don't owe this".
     */
    id: "eob-out-of-network-balance-bill",
    kind: "rule",
    appliesTo: ["eobHealth"],
    citationFromData: true,
    falsePositive:
      "Most out-of-network care is simply out-of-network care you chose and do owe — the protections cover specific settings, and signing a notice and consent form gives them up.",
    // An OCR misread must never become a balance-billing claim (§6.4).
    suppressOnOcr: true,
    run: (ctx) => {
      const ns = ctx.noSurprises;
      if (!ns) return null;
      const d = doc(ctx, "eobHealth");
      if (d?.fields.find((f) => f.id === "eob-network")?.value !== "out-of-network") return null;
      const patient = amount(d, "eob-patient-responsibility");
      if (patient === null || patient <= 0) return null;
      const ground = ns.exclusions.find((e) => e.id === "ground-ambulance");
      return {
        question: "Was this one of the situations the No Surprises Act protects?",
        detail: `This claim is marked out-of-network and puts ${usd(patient)} on you. Since ${ns.effectiveFrom}, federal law has barred a balance bill in ${ns.protections.length} situations: ${ns.protections.map((p) => p.label.toLowerCase()).join("; ")}. It does not reach every case${ground ? ` — ${ground.label.toLowerCase()} is one it does not` : ""}, and signing a notice and consent form gives the protection up. Which of those describes your care is not something this notice can tell us — it is the question to ask.`,
        askWho: ns.channels[0]?.label ?? "The federal No Surprises Help Desk.",
        citation: ns.citation,
      };
    },
  },
  {
    // The single most valuable cross-check on the list (§5): the provider's bill
    // against the responsibility the plan actually calculated.
    id: "eob-x-bill-responsibility",
    kind: "arithmetic",
    appliesTo: ["eobHealth", "medicalBill"],
    falsePositive:
      "The bill can legitimately be larger when it covers services from more than one claim, or smaller when a payment has already posted against it.",
    suppressOnOcr: false,
    run: (ctx) => {
      const patient = amount(doc(ctx, "eobHealth"), "eob-patient-responsibility");
      const total = amount(doc(ctx, "medicalBill"), "bill-total");
      if (patient === null || total === null) return null;
      const gap = total - patient;
      if (Math.abs(gap) <= NOISE_FLOOR) return null;
      return {
        question: "Is the provider billing you more than your plan says you owe?",
        detail: `The plan's notice puts your responsibility at ${usd(patient)}; the bill asks for ${usd(total)} — a difference of ${usd(Math.abs(gap))}.`,
        askWho:
          "The provider's billing office first, with the EOB in hand; then your plan if the two still disagree.",
      };
    },
  },
];

/** Problems with one check definition. Empty means it may ship. */
export function validateCheck(c: CheckDefinition): string[] {
  const problems: string[] = [];
  if (c.falsePositive.trim() === "") {
    problems.push(`${c.id}: every check must state what a false positive looks like`);
  }
  if (c.appliesTo.length === 0) problems.push(`${c.id}: appliesTo must name at least one kind`);
  if (c.kind === "rule") {
    if (!c.citation && !c.citationFromData) {
      problems.push(`${c.id}: a rule check must carry a citation`);
    }
    if (!c.suppressOnOcr) problems.push(`${c.id}: a rule check must set suppressOnOcr`);
  }
  if (c.kind === "arithmetic" && c.citation) {
    problems.push(`${c.id}: an arithmetic check cites nothing beyond the arithmetic itself`);
  }
  return problems;
}

/** Problems across a whole registry, including duplicate ids. */
export function validateRegistry(registry: CheckDefinition[] = CHECKS): string[] {
  const problems = registry.flatMap(validateCheck);
  const seen = new Set<string>();
  for (const c of registry) {
    if (seen.has(c.id)) problems.push(`${c.id}: duplicate check id`);
    seen.add(c.id);
  }
  return problems;
}

/**
 * Run every applicable check. A check runs only when its `appliesTo` kinds are
 * all present in the session *and* include the primary document — so a
 * cross-document check stays silent on a lone document rather than half-firing.
 * OCR-sourced text suppresses every check that declares `suppressOnOcr`, which
 * is all of them in the `rule` family.
 */
export function runChecks(ctx: CheckContext, registry: CheckDefinition[] = CHECKS): CheckOutcome[] {
  const outcomes: CheckOutcome[] = [];
  for (const check of registry) {
    if (!check.appliesTo.includes(ctx.primary.kind as DocKind)) continue;
    const relevant = check.appliesTo.map((k) => doc(ctx, k));
    if (relevant.some((d) => d === null)) continue;
    const fromOcr = relevant.some((d) => d?.source === "ocr");
    if (fromOcr && check.suppressOnOcr) continue;
    const finding = check.run(ctx);
    if (!finding) continue;
    const citation = finding.citation ?? check.citation;
    // A rule check states that a document may conflict with a published rule.
    // Without the rule in hand it is an accusation with no source, so it is
    // dropped rather than rendered — the run-time half of `citationFromData`.
    if (check.kind === "rule" && !citation) continue;
    outcomes.push({
      checkId: check.id,
      kind: check.kind,
      question: finding.question,
      detail: finding.detail,
      askWho: finding.askWho,
      citation,
      fromOcr,
    });
  }
  return outcomes;
}
