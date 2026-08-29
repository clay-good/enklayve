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
import type { CitationData } from "../data/schemas";
import { Money } from "../engine/money";
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
}

/** What a check returns when it fires. The registry stamps on the rest. */
export interface CheckFinding {
  /** The question to ask, in the user's words. Never a verdict. */
  question: string;
  /** The arithmetic or the mismatch, stated plainly. */
  detail: string;
  /** Who to raise it with. */
  askWho: string;
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
  /** What a false positive looks like, in one sentence. Required for every check. */
  falsePositive: string;
  /** Suppressed when the source text came from OCR (always true for "rule"). */
  suppressOnOcr: boolean;
  run(ctx: CheckContext): CheckFinding | null;
}

/** Cents of slack before an arithmetic mismatch is worth raising. Rounding on a
 * plan's own statement is routine; a dollar is not. */
const NOISE_FLOOR = 1;

function usd(n: number): string {
  return Money.from(n).format("en-US");
}

/** The first document of `kind` in the session, or null. */
function doc(ctx: CheckContext, kind: DocKind): ExtractionResult | null {
  return ctx.documents.find((d) => d.kind === kind) ?? null;
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
        askWho:
          "Your health plan's member services line — ask them to walk through the accumulator.",
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
      const lines = billLines(doc(ctx, "medicalBill"));
      const seen = new Map<string, number>();
      for (const l of lines) {
        const key = `${l.label}|${l.value}`;
        const n = (seen.get(key) ?? 0) + 1;
        if (n > 1) {
          return {
            question: "Is this line meant to appear twice?",
            detail: `"${l.label}" at ${usd(l.value)} appears ${n} times on the same bill. This may well be intentional — worth confirming.`,
            askWho: "The provider's billing office.",
          };
        }
        seen.set(key, n);
      }
      return null;
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
    if (!c.citation) problems.push(`${c.id}: a rule check must carry a citation`);
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
    outcomes.push({
      checkId: check.id,
      kind: check.kind,
      question: finding.question,
      detail: finding.detail,
      askWho: finding.askWho,
      citation: check.citation,
      fromOcr,
    });
  }
  return outcomes;
}
