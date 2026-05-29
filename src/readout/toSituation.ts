/**
 * Flow confirmed Readout fields into Your Situation (BUILD-SPEC-2 §2.3).
 *
 * Only fields the user has confirmed and that carry a `target` are written, and
 * they are recorded with provenance "extracted" so the profile (and the Readout
 * Report) can show that the value came from a document, not a typed entry or a
 * default. Nothing is written automatically — the caller invokes this only after
 * the user confirms.
 */
import type { FilingStatus } from "../data/schemas";
import type { SituationStore } from "../profile/situation";
import type { ExtractedField } from "./types";

/** Write every targeted field to the profile, marked as extracted. Returns the
 * number of fields applied. */
export function applyToSituation(store: SituationStore, fields: ExtractedField[]): number {
  let applied = 0;
  for (const f of fields) {
    if (!f.target) continue;
    if (f.target === "filingStatus") {
      if (typeof f.value === "string") {
        store.set("filingStatus", f.value as FilingStatus, "extracted");
        applied += 1;
      }
      continue;
    }
    // The remaining targets are numeric (income, retirement contributions).
    const n = typeof f.value === "number" ? f.value : Number(f.value);
    if (Number.isFinite(n)) {
      store.set(f.target, n, "extracted");
      applied += 1;
    }
  }
  return applied;
}
