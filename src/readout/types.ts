/**
 * The Readout — deterministic document ingestion types (BUILD-SPEC-2 §2).
 *
 * Everything here describes the *result* of anchored, rule-based extraction:
 * which document we recognized, which form revision, and the fields we pulled
 * by anchoring to known labels and box numbers — never by inference. Each field
 * carries a confidence state and a needs-review flag, and the user always
 * confirms before any value flows into My Situation (§2.2).
 */
import type { CitationData } from "../data/schemas";
import type { TextSource } from "./extractText";

/** The personal-finance documents the Readout knows how to read (§2.1). */
export type DocKind =
  | "w2"
  | "form1040"
  | "paystub"
  | "form1099int"
  | "form1099div"
  | "form1099nec"
  | "form1099b"
  | "form1095a"
  | "form1098"
  | "fafsaSummary";

/** The My Situation fields the Readout can populate on confirmation. Kept
 * narrow (not all of {@link SituationKey}) so the mapping stays type-safe. */
export type ReadoutTarget = "annualIncome" | "retirementContributionsAnnual" | "filingStatus";

/** How sure we are about an extracted value. */
export type FieldConfidence = "high" | "needs-review" | "low";

/**
 * One extracted field. `target` names the My Situation field it populates on
 * confirmation (omitted for informational-only fields like withholding). The
 * value is always shown to the user for confirmation before it is used.
 */
export interface ExtractedField {
  /** Stable id within the document (e.g. "w2-box1"). */
  id: string;
  /** Human label shown next to the value. */
  label: string;
  /** The value read from the document. Numeric for amounts; a string for
   * categorical fields like filing status. */
  value: number | string;
  confidence: FieldConfidence;
  /** True when the user should double-check before relying on it. */
  needsReview: boolean;
  /** The My Situation field this populates, when applicable. */
  target?: ReadoutTarget;
  /** Optional note (e.g. how an annualized figure was derived). */
  note?: string;
}

/** The outcome of reading one document. */
export interface ExtractionResult {
  /** The recognized document kind, or "unknown" when no extractor matched. */
  kind: DocKind | "unknown";
  /** The form revision (typically the tax year), or null when unrecognized. */
  revision: string | null;
  /** True when we recognized the document kind (even if the revision is unknown). */
  recognized: boolean;
  /** The fields read by anchoring to labels/box numbers. Empty when the revision
   * is unrecognized — we flag rather than guess (§2.2). */
  fields: ExtractedField[];
  /** Where the text came from; OCR results are flagged lower confidence. */
  source: TextSource;
  /** The form revision this was read against, for provenance (null for pay stubs). */
  citation: CitationData | null;
  /** Human-readable flags (unrecognized revision, OCR caveat, missing fields). */
  warnings: string[];
}
