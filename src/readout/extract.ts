/**
 * The deterministic, anchored extraction engine (BUILD-SPEC-2 §2.2).
 *
 * Given the text of a document (from {@link extractTextFromFile}), we detect the
 * document kind and form revision by anchoring to known markers, then read each
 * field by anchoring to its label or box number — never by inference. Extractors
 * are versioned and pinned to a form revision; an unrecognized revision is
 * flagged rather than guessed. OCR-sourced text marks every field lower
 * confidence and needs-review. The whole module is pure: text in, result out.
 */
import type { CitationData } from "../data/schemas";
import type { ExtractedText } from "./extractText";
import type { DocKind, ExtractedField, ExtractionResult, FieldConfidence } from "./types";

/** Form revisions (tax years) each extractor is validated against. */
const SUPPORTED_REVISIONS = ["2023", "2024"];

/** Pay frequencies, most-specific first so "bi-weekly" isn't shadowed by
 * "weekly" (nor "semi-monthly" by "monthly"). */
const PAY_FREQUENCIES: { re: RegExp; periods: number; label: string }[] = [
  { re: /bi-?weekly/i, periods: 26, label: "bi-weekly" },
  { re: /semi-?monthly/i, periods: 24, label: "semi-monthly" },
  { re: /weekly/i, periods: 52, label: "weekly" },
  { re: /monthly/i, periods: 12, label: "monthly" },
];

/** IRS form citations, pinned per revision (the contentHash is N/A for forms). */
function formCitation(doc: string, revision: string, url: string): CitationData {
  return {
    sourceUrl: url,
    sourceDocument: `${doc} (${revision})`,
    effectiveYear: Number(revision),
    dateRetrieved: "2024-02-01",
  };
}

/** Parse a currency-like token ("$75,000.00") into a number; NaN when absent. */
function parseAmount(raw: string | undefined): number {
  if (raw === undefined) return NaN;
  return Number(raw.replace(/[$,\s]/g, ""));
}

/**
 * Find the first currency-like amount that appears immediately after `anchor`.
 * Anchoring to the label (or box number) is the whole point: we read the number
 * the form places next to a known caption, not a number we inferred.
 */
function amountAfter(text: string, anchor: RegExp): number {
  const source = anchor.source + String.raw`[^0-9$()-]{0,40}(\$?-?[0-9][0-9,]*(?:\.[0-9]{1,2})?)`;
  const m = new RegExp(source, "i").exec(text);
  return m ? parseAmount(m[1]) : NaN;
}

/** Filing-status phrases, longest/most-specific first so "single" can't shadow
 * "married filing separately". */
const FILING_STATUS_PHRASES: { re: RegExp; status: string }[] = [
  { re: /married filing jointly/i, status: "married_jointly" },
  { re: /married filing separately/i, status: "married_separately" },
  { re: /head of household/i, status: "head_of_household" },
  { re: /qualifying surviving spouse/i, status: "qualifying_surviving_spouse" },
  { re: /\bsingle\b/i, status: "single" },
];

/** Read the filing status from the window just after the "filing status" label. */
function detectFilingStatus(text: string): string | null {
  const idx = text.search(/filing status/i);
  if (idx < 0) return null;
  const window = text.slice(idx, idx + 80);
  for (const { re, status } of FILING_STATUS_PHRASES) {
    if (re.test(window)) return status;
  }
  return null;
}

/** The detected document kind and revision. */
interface Detection {
  kind: DocKind | "unknown";
  revision: string | null;
}

/** First four-digit year (2000–2099) found in the text. */
function detectYear(text: string): string | null {
  const m = /\b(20[0-9]{2})\b/.exec(text);
  return m?.[1] ?? null;
}

/** Detect the document kind and revision by anchoring to title markers (§2.2). */
export function detectDocument(t: ExtractedText): Detection {
  const text = t.text;
  const year = detectYear(text);
  if (/\bW-?2\b/i.test(text) && /wage and tax statement/i.test(text)) {
    return { kind: "w2", revision: year };
  }
  if (/\bform\s*1040\b/i.test(text) && /individual income tax return/i.test(text)) {
    return { kind: "form1040", revision: year };
  }
  if (/(earnings statement|pay\s*stub|pay statement|payroll)/i.test(text)) {
    return { kind: "paystub", revision: year };
  }
  return { kind: "unknown", revision: null };
}

interface Extractor {
  citation: (revision: string) => CitationData | null;
  extract: (t: ExtractedText) => ExtractedField[];
}

function field(
  id: string,
  label: string,
  value: number,
  target: ExtractedField["target"],
  note?: string,
): ExtractedField | null {
  // A field we could not read is omitted entirely — we never ship a guessed 0.
  if (!Number.isFinite(value)) return null;
  return { id, label, value, confidence: "high", needsReview: false, target, note };
}

const EXTRACTORS: Record<DocKind, Extractor> = {
  w2: {
    citation: (rev) =>
      formCitation(
        "IRS Form W-2 Wage and Tax Statement",
        rev,
        "https://www.irs.gov/forms-pubs/about-form-w-2",
      ),
    extract: (t) => {
      const text = t.text;
      return [
        field(
          "w2-box1",
          "Wages (box 1)",
          amountAfter(text, /1\s*wages,?\s*tips,?\s*other compensation/i),
          "annualIncome",
        ),
        field(
          "w2-box2",
          "Federal income tax withheld (box 2)",
          amountAfter(text, /2\s*federal income tax withheld/i),
          undefined,
        ),
        field(
          "w2-box12d",
          "401(k) elective deferral (box 12, code D)",
          amountAfter(text, /12[a-d]?\s*D\b/i),
          "retirementContributionsAnnual",
        ),
        field(
          "w2-box17",
          "State income tax (box 17)",
          amountAfter(text, /17\s*state income tax/i),
          undefined,
        ),
      ].filter((f): f is ExtractedField => f !== null);
    },
  },
  form1040: {
    citation: (rev) =>
      formCitation(
        "IRS Form 1040 U.S. Individual Income Tax Return",
        rev,
        "https://www.irs.gov/forms-pubs/about-form-1040",
      ),
    extract: (t) => {
      const text = t.text;
      const fields: ExtractedField[] = [];
      const agi = field(
        "f1040-agi",
        "Adjusted gross income",
        amountAfter(text, /adjusted gross income/i),
        "annualIncome",
      );
      if (agi) fields.push(agi);
      const taxable = field(
        "f1040-taxable",
        "Taxable income",
        amountAfter(text, /taxable income/i),
        undefined,
      );
      if (taxable) fields.push(taxable);
      const totalTax = field("f1040-tax", "Total tax", amountAfter(text, /total tax/i), undefined);
      if (totalTax) fields.push(totalTax);

      // Filing status is a labeled checkbox/word, not a number — read it directly.
      const status = detectFilingStatus(text);
      if (status) {
        fields.push({
          id: "f1040-filing-status",
          label: "Filing status",
          value: status,
          confidence: "high",
          needsReview: false,
          target: "filingStatus",
        });
      }
      return fields;
    },
  },
  paystub: {
    // A pay stub is the employer's own document, not a public form — nothing to cite.
    citation: () => null,
    extract: (t) => {
      const text = t.text;
      const fields: ExtractedField[] = [];

      // Detect pay frequency so we can annualize gross deterministically.
      const freq = PAY_FREQUENCIES.find((f) => f.re.test(text));

      const gross = amountAfter(text, /gross pay(?! year)/i);
      if (Number.isFinite(gross)) {
        if (freq) {
          fields.push({
            id: "paystub-annual-gross",
            label: "Annualized gross pay",
            value: Math.round(gross * freq.periods),
            confidence: "needs-review",
            needsReview: true,
            target: "annualIncome",
            note: `${gross.toLocaleString("en-US")} × ${freq.periods} ${freq.label} periods`,
          });
        } else {
          fields.push({
            id: "paystub-gross",
            label: "Gross pay (this period)",
            value: gross,
            confidence: "needs-review",
            needsReview: true,
            note: "Pay frequency not detected — annualize manually before relying on it.",
          });
        }
      }

      const net = field(
        "paystub-net",
        "Net pay (this period)",
        amountAfter(text, /net pay/i),
        undefined,
      );
      if (net) fields.push(net);
      return fields;
    },
  },
};

/**
 * Read one document deterministically. Detects the kind/revision, runs the
 * pinned extractor, and applies the confidence rules: an unrecognized revision
 * yields no fields (flagged, not guessed), and OCR text flags every field
 * lower confidence and needs-review (§2.2).
 */
export function extractDocument(t: ExtractedText): ExtractionResult {
  const { kind, revision } = detectDocument(t);
  const warnings: string[] = [];

  if (kind === "unknown") {
    warnings.push(
      "We couldn't recognize this document. Supported: typed W-2, Form 1040, and pay stubs.",
    );
    return {
      kind,
      revision: null,
      recognized: false,
      fields: [],
      source: t.source,
      citation: null,
      warnings,
    };
  }

  const extractor = EXTRACTORS[kind];

  // Pin to a known form revision. Pay stubs carry no standardized revision, so
  // they are exempt from the revision check.
  const revisionOk =
    kind === "paystub" || (revision !== null && SUPPORTED_REVISIONS.includes(revision));
  if (!revisionOk) {
    warnings.push(
      `This looks like a ${labelFor(kind)} but its form revision (${revision ?? "unknown"}) isn't one we've validated — enter the values manually rather than trust a guess.`,
    );
    return {
      kind,
      revision: null,
      recognized: true,
      fields: [],
      source: t.source,
      citation: null,
      warnings,
    };
  }

  let fields = extractor.extract(t);
  if (fields.length === 0) {
    warnings.push(
      "We recognized the document but couldn't read its fields — please enter them by hand.",
    );
  }

  // OCR is a clearly-labeled, lower-confidence source: flag every field (§2.2).
  if (t.source === "ocr") {
    warnings.push(
      "Read by optical character recognition — every value is lower confidence; please review each one.",
    );
    fields = fields.map((f) => ({
      ...f,
      confidence: "low" as FieldConfidence,
      needsReview: true,
    }));
  }

  const citation = kind === "paystub" ? null : extractor.citation(revision as string);
  return {
    kind,
    revision: kind === "paystub" ? revision : (revision as string),
    recognized: true,
    fields,
    source: t.source,
    citation,
    warnings,
  };
}

/** A friendly name for a document kind. */
export function labelFor(kind: DocKind | "unknown"): string {
  switch (kind) {
    case "w2":
      return "W-2";
    case "form1040":
      return "Form 1040";
    case "paystub":
      return "pay stub";
    default:
      return "document";
  }
}
