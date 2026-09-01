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

/**
 * Form revisions (tax years) each extractor is validated against. The IRS box
 * numbering and labels these extractors anchor on (W-2 boxes 1/2/12/16/17 —
 * including the codes TP and TT that tax year 2026 added to box 12 — the
 * 1040 line numbers, the 1099 series, 1095-A, 1098) are stable across these
 * years, so the same anchors read every one. We carry the two most recent filing
 * years plus the prior two: in 2026 a user reconciling a prior year still drops a
 * 2024 return, while the current filing season's forms are 2025, and 2026 forms
 * are already in hand for in-year pay stubs and 1095-As. An older or unlisted
 * revision is flagged (never guessed) per §2.2 — a renumbered future form must be
 * re-validated and added deliberately rather than silently trusted.
 */
const SUPPORTED_REVISIONS = ["2023", "2024", "2025", "2026"];

/**
 * Kinds with no standardized revision to pin. A pay stub, an EOB, an itemized
 * bill, and an agency determination are laid out by an employer, a plan, a
 * provider, or a state — there is no form designer and no revision number, so
 * the §2.2 revision check has nothing to check. Their extractors compensate by
 * anchoring only on captions and by flagging every varying value for review.
 */
const REVISIONLESS_KINDS: DocKind[] = ["paystub", "eobHealth", "medicalBill", "benefitsNotice"];

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

/**
 * Read `count` consecutive currency-like amounts after `anchor`. Used for the
 * single-row tables (e.g. the 1095-A "Annual Totals" line, whose three columns
 * are premium, benchmark, and advance credit in order). Returns an empty array
 * unless all `count` amounts are present, so we never pair a column with a
 * number that belongs to a different one.
 */
function amountsAfter(text: string, anchor: RegExp, count: number): number[] {
  const amount = String.raw`(\$?-?[0-9][0-9,]*(?:\.[0-9]{1,2})?)`;
  const gap = String.raw`[^0-9$()-]{0,40}`;
  const source = anchor.source + Array.from({ length: count }, () => gap + amount).join("");
  const m = new RegExp(source, "i").exec(text);
  if (!m) return [];
  return m.slice(1, count + 1).map(parseAmount);
}

/**
 * Read the first `capture` group that appears just after `anchor`. The
 * non-amount sibling of {@link amountAfter}, for the categorical values Readout
 * v2's documents carry (a network status, a claim number, a date of service).
 * `anchor` must contain no capturing group, so group 1 is always the capture.
 */
function tokenAfter(text: string, anchor: RegExp, capture: string): string | null {
  const m = new RegExp(anchor.source + String.raw`[^A-Za-z0-9$]{0,20}` + capture, "i").exec(text);
  return m?.[1]?.trim() ?? null;
}

/**
 * One itemized-bill charge line, anchored on the date-of-service column that
 * every itemized statement carries. Anchoring on the date (rather than trying
 * to guess where a description ends) is what keeps this rule-based: a run of
 * text only becomes a line item when a date introduces it and an amount closes
 * it. Descriptions are capped so a flattened PDF cannot swallow a whole page
 * into one "line".
 */
const BILL_LINE =
  /(\d{1,2}\/\d{1,2}\/\d{2,4})\s+([A-Za-z][^$]{2,60}?)\s+\$?(\d[\d,]*\.\d{2})(?![\d.])/g;

/** Filing-status phrases, longest/most-specific first so "single" can't shadow
 * "married filing separately". */
const FILING_STATUS_PHRASES: { re: RegExp; status: string }[] = [
  { re: /married filing jointly/i, status: "married_jointly" },
  { re: /married filing separately/i, status: "married_separately" },
  { re: /head of household/i, status: "head_of_household" },
  { re: /qualifying surviving spouse/i, status: "qualifying_surviving_spouse" },
  { re: /\bsingle\b/i, status: "single" },
];

/**
 * Benefits-notice decision words, worst-news first. A notice that both denies
 * one thing and approves another must read as a denial — that is the sentence
 * the household needs to act on.
 */
const NOTICE_DECISIONS: { re: RegExp; value: string }[] = [
  { re: /\b(?:denied|denial|ineligible|not eligible)\b/i, value: "denied" },
  { re: /\b(?:terminated|termination|closing your case|case closure)\b/i, value: "terminated" },
  { re: /\b(?:reduced|reduction|decreas(?:ed|e))\b/i, value: "reduced" },
  { re: /\b(?:approved|eligible|granted)\b/i, value: "approved" },
];

/** The programs a benefits notice can come from, most-specific first. */
const NOTICE_PROGRAMS: { re: RegExp; value: string }[] = [
  { re: /\b(?:snap|supplemental nutrition assistance)\b/i, value: "SNAP" },
  { re: /\bmedicaid\b/i, value: "Medicaid" },
  { re: /\b(?:premium tax credit|marketplace)\b/i, value: "Marketplace / premium tax credit" },
  { re: /\bunemployment\b/i, value: "Unemployment insurance" },
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

/**
 * Title markers, most-specific first. A document is the first kind whose `re`
 * matches and whose `also` (a second required marker that disambiguates, e.g.
 * "wage and tax statement" so a stray "W-2" mention can't win) also matches.
 */
const DOC_MARKERS: { kind: DocKind; re: RegExp; also?: RegExp }[] = [
  // The FAFSA Submission Summary's title is unmistakable; anchor it first so a
  // tax-return line it references can't be mistaken for a 1040.
  { kind: "fafsaSummary", re: /FAFSA Submission Summary/i },
  { kind: "w2", re: /\bW-?2\b/i, also: /wage and tax statement/i },
  { kind: "form1040", re: /\bform\s*1040\b/i, also: /individual income tax return/i },
  { kind: "form1099int", re: /\b1099-?INT\b/i },
  { kind: "form1099div", re: /\b1099-?DIV\b/i },
  { kind: "form1099nec", re: /\b1099-?NEC\b/i },
  { kind: "form1099b", re: /\b1099-?B\b/i },
  { kind: "form1095a", re: /\b1095-?A\b/i },
  // Anchored to "mortgage interest" so the 1098-T (tuition) and 1098-E (student
  // loan) variants don't masquerade as a mortgage statement.
  { kind: "form1098", re: /\b1098\b/, also: /mortgage interest/i },
  // Readout v2 kinds (SPEC-4-readout-v2 §3). "Explanation of Benefits" is an
  // unmistakable title, so it leads; the benefits notice needs both a decision
  // word and a named program so a 1095-A's "Marketplace" cannot claim it; the
  // itemized bill's markers are the broadest, so it goes last.
  {
    kind: "eobHealth",
    re: /explanation of benefits/i,
    also: /(this is not a bill|amount billed|allowed amount|patient responsibility)/i,
  },
  {
    kind: "benefitsNotice",
    re: /(notice of (?:action|decision|determination)|eligibility determination|determination notice|notice of eligibility)/i,
    also: /(medicaid|snap|supplemental nutrition|marketplace|premium tax credit|unemployment)/i,
  },
  {
    kind: "medicalBill",
    re: /(itemi[sz]ed (?:statement|bill|charges)|statement of (?:account|charges)|patient (?:statement|account) summary)/i,
  },
  { kind: "paystub", re: /(earnings statement|pay\s*stub|pay statement|payroll)/i },
];

/** Detect the document kind and revision by anchoring to title markers (§2.2). */
export function detectDocument(t: ExtractedText): Detection {
  const text = t.text;
  const year = detectYear(text);
  for (const { kind, re, also } of DOC_MARKERS) {
    if (re.test(text) && (!also || also.test(text))) {
      return { kind, revision: year };
    }
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

/** Citation for one 1099 variant (INT/DIV/NEC/B), pinned to the revision. */
function f1099Citation(variant: string): (rev: string) => CitationData {
  return (rev) =>
    formCitation(
      `IRS Form 1099-${variant}`,
      rev,
      `https://www.irs.gov/forms-pubs/about-form-1099-${variant.toLowerCase()}`,
    );
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
        // Box 12 codes TP and TT are new for tax year 2026 (IRS General
        // Instructions for Forms W-2 and W-3, Rev. 1-2026), and they exist
        // because of the One Big Beautiful Bill Act: an employer must now report
        // the figures IRC §§224 and 225 deduct. A W-2 from an earlier year has
        // neither code, and `field` drops what it cannot read, so nothing here
        // needs to know which year it is looking at.
        //
        // The anchors demand the code as a WORD (\b...\b) after a box-12
        // subscript. "TP" and "TT" are two letters that occur inside ordinary
        // words, and reading a dollar amount that follows a stray "tt" would be
        // exactly the inference this module refuses to make.
        field(
          "w2-box12tp",
          "Cash tips reported to employer (box 12, code TP)",
          amountAfter(text, /12[a-d]?\s*\bTP\b/i),
          "qualifiedTipsAnnual",
          "Box 12 code TP is the total cash tips you reported to your employer. The deduction" +
            " under IRC §224 counts only tips received in an occupation the Treasury lists —" +
            ' box 14b carries that occupation code, and a "000" there means at least some of' +
            " these tips do not qualify. Treat this as a ceiling.",
        ),
        field(
          "w2-box12tt",
          "Qualified overtime compensation (box 12, code TT)",
          amountAfter(text, /12[a-d]?\s*\bTT\b/i),
          "qualifiedOvertimeAnnual",
          "Box 12 code TT is the premium half of overtime required by section 7 of the Fair" +
            " Labor Standards Act — which is what IRC §225 deducts, so this box needs no" +
            " further narrowing.",
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
            note: "Pay frequency not detected, annualize manually before relying on it.",
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
  form1099int: {
    citation: f1099Citation("INT"),
    extract: (t) => {
      const text = t.text;
      return [
        field(
          "1099int-box1",
          "Interest income (box 1)",
          amountAfter(text, /1\s*interest income/i),
          undefined,
          "Feeds investment income on your return.",
        ),
        field(
          "1099int-box4",
          "Federal income tax withheld (box 4)",
          amountAfter(text, /4\s*federal income tax withheld/i),
          undefined,
        ),
      ].filter((f): f is ExtractedField => f !== null);
    },
  },
  form1099div: {
    citation: f1099Citation("DIV"),
    extract: (t) => {
      const text = t.text;
      return [
        field(
          "1099div-box1a",
          "Total ordinary dividends (box 1a)",
          amountAfter(text, /1a\s*total ordinary dividends/i),
          undefined,
        ),
        field(
          "1099div-box1b",
          "Qualified dividends (box 1b)",
          amountAfter(text, /1b\s*qualified dividends/i),
          undefined,
        ),
        field(
          "1099div-box2a",
          "Total capital gain distributions (box 2a)",
          amountAfter(text, /2a\s*total capital gain/i),
          undefined,
          "Feeds the Capital Gains tile.",
        ),
      ].filter((f): f is ExtractedField => f !== null);
    },
  },
  form1099nec: {
    citation: f1099Citation("NEC"),
    extract: (t) => {
      const nec = field(
        "1099nec-box1",
        "Nonemployee compensation (box 1)",
        amountAfter(t.text, /1\s*nonemployee compensation/i),
        "annualIncome",
        "Self-employment income: feeds Take-Home, Self-Employment Tax, and Quarterly Taxes.",
      );
      return nec ? [nec] : [];
    },
  },
  form1099b: {
    citation: f1099Citation("B"),
    extract: (t) => {
      const text = t.text;
      const proceeds = amountAfter(text, /1d\s*proceeds/i);
      const basis = amountAfter(text, /1e\s*cost or other basis/i);
      const fields: ExtractedField[] = [];
      const p = field("1099b-proceeds", "Proceeds (box 1d)", proceeds, undefined);
      if (p) fields.push(p);
      const b = field("1099b-basis", "Cost or other basis (box 1e)", basis, undefined);
      if (b) fields.push(b);
      // The realized gain feeds Capital Gains — computed, not inferred, only when
      // both legs were read by anchor.
      if (Number.isFinite(proceeds) && Number.isFinite(basis)) {
        fields.push({
          id: "1099b-gain",
          label: "Realized gain (proceeds − basis)",
          value: Math.round((proceeds - basis) * 100) / 100,
          confidence: "high",
          needsReview: false,
          note: "Feeds the Capital Gains tile (short- vs long-term per box 2).",
        });
      }
      return fields;
    },
  },
  form1095a: {
    citation: (rev) =>
      formCitation(
        "IRS Form 1095-A Health Insurance Marketplace Statement",
        rev,
        "https://www.irs.gov/forms-pubs/about-form-1095-a",
      ),
    extract: (t) => {
      // Part III line 33 "Annual Totals": columns A (premiums), B (benchmark
      // SLCSP premium), C (advance payment of the premium tax credit), in order.
      const [premium, slcsp, aptc] = amountsAfter(t.text, /annual total[s]?/i, 3);
      return [
        field("1095a-premium", "Annual enrollment premiums (column A)", premium ?? NaN, undefined),
        field(
          "1095a-slcsp",
          "Annual benchmark SLCSP premium (column B)",
          slcsp ?? NaN,
          undefined,
          "The benchmark figure the ACA Premium Tax Credit tile needs.",
        ),
        field(
          "1095a-aptc",
          "Advance payment of the premium tax credit (column C)",
          aptc ?? NaN,
          undefined,
        ),
      ].filter((f): f is ExtractedField => f !== null);
    },
  },
  form1098: {
    citation: (rev) =>
      formCitation(
        "IRS Form 1098 Mortgage Interest Statement",
        rev,
        "https://www.irs.gov/forms-pubs/about-form-1098",
      ),
    extract: (t) => {
      const text = t.text;
      return [
        field(
          "1098-box1",
          "Mortgage interest received (box 1)",
          amountAfter(text, /1\s*mortgage interest received/i),
          undefined,
          "Feeds Refinance Break-Even and Amortization.",
        ),
        field(
          "1098-box2",
          "Outstanding mortgage principal (box 2)",
          amountAfter(text, /2\s*outstanding mortgage principal/i),
          undefined,
          "Feeds Loan & Mortgage Amortization.",
        ),
      ].filter((f): f is ExtractedField => f !== null);
    },
  },
  fafsaSummary: {
    citation: (rev) =>
      formCitation(
        "Federal Student Aid FAFSA Submission Summary",
        rev,
        "https://studentaid.gov/help/fafsa-submission-summary",
      ),
    extract: (t) => {
      // The Student Aid Index is the one figure the Submission Summary exists to
      // confirm (§2.1). The anchor consumes an optional "(SAI)" parenthetical and
      // colon so the value (which can be negative, down to −$1,500) reads cleanly.
      const sai = field(
        "fafsa-sai",
        "Student Aid Index (SAI)",
        amountAfter(t.text, /student aid index(?:\s*\(sai\))?\s*:?/i),
        undefined,
        "The official SAI to check the FAFSA Student Aid Index and Pell Grant estimates against.",
      );
      return sai ? [sai] : [];
    },
  },
  /**
   * An Explanation of Benefits (SPEC-4-readout-v2 §3). Not a form — every plan
   * lays one out differently — so we anchor on the captions the federal
   * standard-notice conventions have made near-universal, and cite nothing: an
   * EOB is the plan's own document, like a pay stub.
   */
  eobHealth: {
    citation: () => null,
    extract: (t) => {
      const text = t.text;
      const fields: ExtractedField[] = [];
      const push = (f: ExtractedField | null): void => {
        if (f) fields.push(f);
      };

      push(
        field(
          "eob-billed",
          "Amount billed",
          amountAfter(text, /(?:(?:amount|total)\s+billed|billed\s+(?:amount|charges?))/i),
          undefined,
          "What the provider charged, before the plan's negotiated rate.",
        ),
      );
      push(
        field(
          "eob-allowed",
          "Allowed amount",
          amountAfter(text, /allowed\s+(?:amount|charges?)/i),
          undefined,
          "The most the plan's contract lets an in-network provider collect for this care.",
        ),
      );
      push(
        field(
          "eob-plan-paid",
          "Plan paid",
          amountAfter(
            text,
            /(?:plan\s+paid|(?:amount\s+)?paid\s+by\s+(?:the\s+)?(?:plan|insurer|insurance)|we\s+paid)/i,
          ),
          undefined,
        ),
      );
      push(
        field(
          "eob-patient-responsibility",
          "Patient responsibility",
          amountAfter(
            text,
            /(?:patient\s+responsibility|your\s+responsibility|what\s+you\s+(?:may\s+)?owe|you\s+may\s+owe)/i,
          ),
          undefined,
        ),
      );
      push(
        field(
          "eob-deductible-applied",
          "Applied to deductible",
          amountAfter(
            text,
            /(?:deductible\s+(?:applied|amount)|applied\s+to\s+(?:your\s+)?deductible)/i,
          ),
          undefined,
        ),
      );
      push(
        field(
          "eob-oop-applied",
          "Applied to out-of-pocket maximum",
          amountAfter(
            text,
            /(?:out[- ]of[- ]pocket(?:\s+(?:maximum|max))?\s+(?:applied|amount)|applied\s+to\s+(?:your\s+)?out[- ]of[- ]pocket(?:\s+(?:maximum|max))?)/i,
          ),
          undefined,
        ),
      );

      // Network status decides whether the balance-billing protections are even
      // in play, so it is read explicitly rather than inferred from the numbers.
      // Out-of-network is checked first: an EOB that mentions both is describing
      // an out-of-network claim against an in-network benefit.
      const network = /\bout[- ]of[- ]network\b/i.test(text)
        ? "out-of-network"
        : /\bin[- ]network\b/i.test(text)
          ? "in-network"
          : null;
      if (network) {
        fields.push({
          id: "eob-network",
          label: "Network status",
          value: network,
          confidence: "high",
          needsReview: false,
        });
      }

      const claim = tokenAfter(
        text,
        /claim\s*(?:number|no\.?|#)/i,
        String.raw`([A-Z0-9][A-Z0-9-]{3,24})`,
      );
      if (claim) {
        fields.push({
          id: "eob-claim",
          label: "Claim number",
          value: claim,
          confidence: "high",
          needsReview: false,
          note: "Used to match this EOB to the provider's bill for the same claim.",
        });
      }

      const dos = tokenAfter(
        text,
        /date[s]?\s+of\s+service/i,
        String.raw`(\d{1,2}\/\d{1,2}\/\d{2,4})`,
      );
      if (dos) {
        fields.push({
          id: "eob-date-of-service",
          label: "Date of service",
          value: dos,
          confidence: "high",
          needsReview: false,
        });
      }
      return fields;
    },
  },
  /**
   * An itemized provider or hospital bill. Charge lines are read only where a
   * date of service introduces them and an amount closes them (see
   * {@link BILL_LINE}) — a paragraph of text is never promoted to a line item.
   */
  medicalBill: {
    citation: () => null,
    extract: (t) => {
      const text = t.text;
      const fields: ExtractedField[] = [];

      BILL_LINE.lastIndex = 0;
      let m: RegExpExecArray | null;
      let n = 0;
      while ((m = BILL_LINE.exec(text)) !== null) {
        const [, date = "", description = "", raw] = m;
        const amount = parseAmount(raw);
        if (!Number.isFinite(amount)) continue;
        n += 1;
        fields.push({
          id: `bill-line-${n}`,
          // The date stays in the label: the duplicate screen compares whole
          // lines, and a reader needs to see which day a charge landed on.
          label: `${date} ${description.replace(/\s+/g, " ").trim()}`,
          value: amount,
          confidence: "high",
          needsReview: false,
        });
      }

      const total = field(
        "bill-total",
        "Total on the bill",
        amountAfter(text, /(?:total\s+charges?|amount\s+due|balance\s+due|total\s+due)/i),
        undefined,
      );
      if (total) fields.push(total);
      return fields;
    },
  },
  /**
   * A Medicaid / SNAP / Marketplace / UI determination or denial. The decision
   * word and the appeal clock are the two things a household most needs read
   * back to them, and the clock is read *off the notice* — the statutory windows
   * behind it are the Phase 23 `appeal-windows` shard's job, not a literal here.
   */
  benefitsNotice: {
    citation: () => null,
    extract: (t) => {
      const text = t.text;
      const fields: ExtractedField[] = [];

      const decision = NOTICE_DECISIONS.find((d) => d.re.test(text));
      if (decision) {
        fields.push({
          id: "notice-decision",
          label: "Decision",
          value: decision.value,
          // Notice wording varies by state and program far more than an IRS box
          // number does, so the decision is always shown for review.
          confidence: "needs-review",
          needsReview: true,
        });
      }

      const program = NOTICE_PROGRAMS.find((p) => p.re.test(text));
      if (program) {
        fields.push({
          id: "notice-program",
          label: "Program",
          value: program.value,
          confidence: "high",
          needsReview: false,
        });
      }

      const reason = tokenAfter(
        text,
        /reason\s*(?:code|for\s+(?:this\s+)?(?:decision|action))/i,
        String.raw`([A-Z0-9][A-Z0-9.\-]{1,19})`,
      );
      if (reason) {
        fields.push({
          id: "notice-reason",
          label: "Reason code",
          value: reason,
          confidence: "needs-review",
          needsReview: true,
          note: "Quote this code when you call — it is how the agency looks up the decision.",
        });
      }

      const effective = tokenAfter(
        text,
        /effective\s+(?:date|on)/i,
        String.raw`(\d{1,2}\/\d{1,2}\/\d{2,4})`,
      );
      if (effective) {
        fields.push({
          id: "notice-effective",
          label: "Effective date",
          value: effective,
          confidence: "high",
          needsReview: false,
        });
      }

      const appealBy = tokenAfter(
        text,
        /(?:appeal|request\s+a\s+(?:fair\s+)?hearing)[^.]{0,80}?\bby\b/i,
        String.raw`(\d{1,2}\/\d{1,2}\/\d{2,4})`,
      );
      if (appealBy) {
        fields.push({
          id: "notice-appeal-by",
          label: "Appeal by (as printed on the notice)",
          value: appealBy,
          confidence: "needs-review",
          needsReview: true,
          note: "This is the date your notice states. Confirm it against the notice itself before you rely on it.",
        });
      } else {
        const days = tokenAfter(
          text,
          /(?:appeal|request\s+a\s+(?:fair\s+)?hearing)[^.]{0,80}?within/i,
          String.raw`(\d{1,3})\s*(?:calendar\s*|business\s*)?days`,
        );
        if (days) {
          fields.push({
            id: "notice-appeal-window-days",
            label: "Appeal window in days (as printed on the notice)",
            value: Number(days),
            confidence: "needs-review",
            needsReview: true,
            note: "Counted from the date on the notice. Confirm it against the notice itself before you rely on it.",
          });
        }
      }
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
      "We couldn't recognize this document. Supported: typed W-2, Form 1040, pay stubs, 1099 (INT/DIV/NEC/B), 1095-A, 1098 mortgage statements, the FAFSA Submission Summary, health plan Explanations of Benefits, itemized medical bills, and benefits determination notices.",
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

  // Pin to a known form revision. The {@link REVISIONLESS_KINDS} carry no
  // standardized revision, so they are exempt from the revision check.
  const revisionOk =
    REVISIONLESS_KINDS.includes(kind) ||
    (revision !== null && SUPPORTED_REVISIONS.includes(revision));
  if (!revisionOk) {
    warnings.push(
      `This looks like a ${labelFor(kind)} but its form revision (${revision ?? "unknown"}) isn't one we've validated, enter the values manually rather than trust a guess.`,
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
      "We recognized the document but couldn't read its fields, please enter them by hand.",
    );
  }

  // OCR is a clearly-labeled, lower-confidence source: flag every field (§2.2).
  if (t.source === "ocr") {
    warnings.push(
      "Read by optical character recognition, every value is lower confidence; please review each one.",
    );
    fields = fields.map((f) => ({
      ...f,
      confidence: "low" as FieldConfidence,
      needsReview: true,
    }));
  }

  const revisionless = REVISIONLESS_KINDS.includes(kind);
  const citation = revisionless ? null : extractor.citation(revision as string);
  return {
    kind,
    revision: revisionless ? revision : (revision as string),
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
    case "form1099int":
      return "1099-INT";
    case "form1099div":
      return "1099-DIV";
    case "form1099nec":
      return "1099-NEC";
    case "form1099b":
      return "1099-B";
    case "form1095a":
      return "1095-A";
    case "form1098":
      return "1098 mortgage statement";
    case "fafsaSummary":
      return "FAFSA Submission Summary";
    case "eobHealth":
      return "health plan Explanation of Benefits";
    case "medicalBill":
      return "itemized medical bill";
    case "benefitsNotice":
      return "benefits determination notice";
    default:
      return "document";
  }
}
