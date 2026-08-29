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
import type { Deadline } from "../engine/deadline";
import type { Money } from "../engine/money";
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
  | "fafsaSummary"
  // Readout v2 (SPEC-4-readout-v2 §3). Unlike the IRS forms above, these three
  // carry no standardized revision — an EOB, an itemized bill, and an agency
  // determination are laid out by the plan, provider, or state, not by a form
  // designer. They are anchored on captions every issuer uses and are exempt
  // from the revision pin, exactly as a pay stub is.
  | "eobHealth"
  | "medicalBill"
  | "benefitsNotice";

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

/**
 * The four families of check (SPEC-4-readout-v2 §4), ordered by how much we can
 * stand behind them: arithmetic is the document disagreeing with itself,
 * plan-math is the document disagreeing with what the *user* told us, rule is
 * the document appearing to conflict with a published rule, and anomaly is
 * merely unusual. The kind drives the framing, not just the label.
 */
export type CheckKind = "arithmetic" | "plan-math" | "rule" | "anomaly";

/**
 * One check that fired. Phrased as a question to ask, never a verdict — the
 * failure mode this shape exists to prevent is a household disputing a correct
 * bill because we flagged it confidently.
 */
export interface CheckOutcome {
  /** The {@link CheckKind} registry id that produced this. */
  checkId: string;
  kind: CheckKind;
  /** The question to ask, in the user's words. Never "this is wrong". */
  question: string;
  /** The arithmetic or rule mismatch, stated plainly. */
  detail: string;
  /** Who to raise it with. */
  askWho: string;
  /** Required for a "rule" check; absent for pure arithmetic. */
  citation?: CitationData;
  /** True when the text this ran against came from OCR, so the UI can say so. */
  fromOcr: boolean;
}

/** A section of {@link ReadoutAnswer} that can legitimately be empty. */
export type AnswerSection = "says" | "flags" | "owed" | "next";

/**
 * The four-part answer (SPEC-4-readout-v2 §2). Every document, every kind,
 * renders the same four sections in the same order — the shape is the product.
 * It sits *on top of* {@link ExtractionResult} rather than replacing it, so the
 * anchoring and confirmation rules of BUILD-SPEC-2 §2.2 are untouched.
 */
export interface ReadoutAnswer {
  /** The extraction this answer was built from — unchanged, still user-confirmed. */
  source: ExtractionResult;
  /** "What this says": the document restated. Every figure traces to a field. */
  says: { label: string; value: string; fieldId: string }[];
  /** "What looks wrong": checks that fired. Empty is valid and common. */
  flags: CheckOutcome[];
  /** "What you may be owed": an estimate with a citation, never a determination. */
  owed: { label: string; estimate?: Money; citation: CitationData; tileId: string }[];
  /** "What to do next, by when": ordered. A statutory clock is a {@link Deadline}. */
  next: { label: string; channel?: { label: string; url: string }; deadline?: Deadline }[];
  /** Why a section is empty, when it is. Empty is honest; filler is not. */
  emptyReasons: Partial<Record<AnswerSection, string>>;
}
