/**
 * Flow confirmed Readout fields into My Situation (BUILD-SPEC-2 §2.3).
 *
 * Only fields the user has confirmed and that carry a `target` are written, and
 * they are recorded with provenance "extracted" so the profile (and the Readout
 * Report) can show that the value came from a document, not a typed entry or a
 * default. Nothing is written automatically — the caller invokes this only after
 * the user confirms.
 */
import type { FilingStatus } from "../data/schemas";
import type { FieldSource, SituationStore } from "../profile/situation";
import type { ExtractedField, ReadoutTarget } from "./types";

/** A confirmed field landing on a slot the profile already had a value in. */
export interface ReplacedField {
  target: ReadoutTarget;
  previous: number | string;
  previousSource: FieldSource;
  next: number | string;
}

export interface SituationUpdate {
  /** How many fields were written. */
  applied: number;
  /** Those that overwrote a different value that was already there. */
  replaced: ReplacedField[];
}

/**
 * Write every targeted field to the profile, marked as extracted.
 *
 * The profile holds **one value per field**, and the Readout is a session: the
 * summary offers "Read another document", so a second W-2, a 1099-NEC beside a
 * W-2, or a 1040 after either one all land on `annualIncome` in the same
 * session. Last write wins, which is the only rule that can be right — summing
 * would double-count a 1040's AGI against the W-2 it was computed from, and
 * this module's whole premise is that it never infers. What it must not do is
 * win *quietly*: a freelancer who confirms a $75,000 W-2 and then a $30,000
 * 1099-NEC ends the session with $30,000 as their annual income, and every tax,
 * subsidy and affordability tile downstream computes on it.
 *
 * So the replacements are returned alongside the count, and the view says which
 * figure moved and what it was. The decision stays the reader's.
 */
export function applyToSituation(store: SituationStore, fields: ExtractedField[]): SituationUpdate {
  const update: SituationUpdate = { applied: 0, replaced: [] };
  for (const f of fields) {
    if (!f.target) continue;
    const target = f.target;
    const before = store.get(target);
    const beforeSource = store.sourceOf(target);
    const note = (next: number | string): void => {
      if (before === undefined || before === next) return;
      update.replaced.push({
        target,
        previous: before as number | string,
        previousSource: beforeSource ?? "typed",
        next,
      });
    };
    if (target === "filingStatus") {
      if (typeof f.value === "string") {
        note(f.value);
        store.set("filingStatus", f.value as FilingStatus, "extracted");
        update.applied += 1;
      }
      continue;
    }
    // A blank value is a field the reader cleared, which is how someone says
    // "leave this one out" — never a zero. `Number("")` is 0 and finite, so
    // without this the gesture wrote $0 into the slot it was trying to skip.
    if (typeof f.value === "string" && f.value.trim() === "") continue;
    // The remaining targets are numeric (income, retirement contributions).
    const n = typeof f.value === "number" ? f.value : Number(f.value);
    if (Number.isFinite(n)) {
      note(n);
      store.set(target, n, "extracted");
      update.applied += 1;
    }
  }
  return update;
}

/** What each replaceable slot is called in a sentence a reader reads. */
const TARGET_NAMES: Record<ReadoutTarget, string> = {
  annualIncome: "Annual income",
  retirementContributionsAnnual: "Retirement contributions",
  filingStatus: "Filing status",
  qualifiedTipsAnnual: "Qualified tips",
  qualifiedOvertimeAnnual: "Qualified overtime",
};

const SOURCE_NAMES: Record<FieldSource, string> = {
  extracted: "from a document read earlier",
  typed: "as you entered it",
  assumed: "as a default",
};

/**
 * One calm sentence per replaced field, plus the rule that produced it.
 *
 * Deliberately states what happened and stops. "If both are yours, add them"
 * would be advice, and it is wrong for the most common pair: a 1040's AGI and
 * the W-2 box 1 it was computed from are not two incomes.
 */
export function replacementNote(replaced: readonly ReplacedField[], locale: string): string {
  if (replaced.length === 0) return "";
  const show = (v: number | string): string =>
    typeof v === "number"
      ? v.toLocaleString(locale, { style: "currency", currency: "USD", maximumFractionDigits: 0 })
      : v;
  const lines = replaced.map(
    (r) =>
      `${TARGET_NAMES[r.target]} was ${show(r.previous)} ${SOURCE_NAMES[r.previousSource]}, and is now ${show(r.next)}.`,
  );
  return `${lines.join(" ")} My Situation keeps one value per field, so the newer one is what the tools will use — change it in any tool that asks if that is not the figure you want.`;
}
