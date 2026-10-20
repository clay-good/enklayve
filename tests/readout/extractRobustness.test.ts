import { describe, it, expect } from "vitest";
import { SUPPORTED_KINDS, extractDocument, detectDocument } from "../../src/readout/extract";
import type { ExtractedText } from "../../src/readout/extractText";

/**
 * The one component fed text nobody wrote for it.
 *
 * Every engine function has the §2.9 boundary sweep and every tile has the
 * Playwright no-hang sweep. The extractor had neither, and it is the module with
 * the least control over its input: a PDF's text layer is whatever the producer
 * embedded, a `.docx` is whatever Word wrote, and OCR output is noise by
 * construction — which is why `source: "ocr"` already downgrades every field it
 * touches. Thirty-four golden cases said what it reads from four documents it
 * recognizes; nothing said what it does with a document it does not.
 *
 * **It shipped `Infinity`.** `field()` states the rule — "a field we could not
 * read is omitted entirely — we never ship a guessed 0" — and enforces it by
 * returning null for a non-finite value. Fifteen fields are built as object
 * literals instead and bypass it, so the rule held everywhere except where a
 * value is *computed*. The pay stub's annualized gross checks that the figure it
 * read is finite and then multiplies it by the period count: `Bi-Weekly Gross
 * Pay 1e307` is finite, and `1e307 × 26` is not. The reader was offered a
 * confirmable field reading `Infinity` under a note three hundred digits long.
 *
 * The properties below are the extractor's contract rather than its output, so
 * they hold for documents nobody has thought of yet.
 */
const REAL = [
  "Form W-2 Wage and Tax Statement 2024 Employer ABC Inc 1 Wages, tips, other compensation 75000.00 " +
    "2 Federal income tax withheld 9200.00 12a D 8000.00 16 State wages 75000.00 17 State income tax 3100.00",
  "Form 1040 U.S. Individual Income Tax Return 2024 Filing Status: Married filing jointly " +
    "11 Adjusted gross income 95000.00 15 Taxable income 80000.00 22 Total tax 12000.00",
  "ABC Payroll Earnings Statement Pay Period 06/01/2024 Bi-Weekly Gross Pay 2884.62 Net Pay 2100.00",
  "Explanation of Benefits Amount billed 4200.00 Plan paid 3000.00 You may owe 1200.00 out of network",
  "Form 1099-INT 2025 1 Interest income 412.55 4 Federal income tax withheld 0.00",
  "Form 1099-DIV 2025 1a Total ordinary dividends 980.00 1b Qualified dividends 760.00 2a Total capital gain distr. 120.00",
  "Form 1099-NEC 2025 Nonemployee Compensation 1 Nonemployee compensation 18500.00",
  "Form 1099-B 2025 1d Proceeds 12000.00 1e Cost or other basis 9000.00",
  "Form 1095-A Health Insurance Marketplace Statement 2025 Annual Totals 7200.00 7800.00 5100.00",
  "Form 1098 Mortgage Interest Statement 2025 1 Mortgage interest received from payer(s)/borrower(s) 6200.00 2 Outstanding mortgage principal 240000.00",
  "2025-26 FAFSA Submission Summary Federal Student Aid Student Aid Index (SAI): 4500",
  "Itemized Statement 01/21/2026 Office visit $143.00 01/21/2026 Lab panel $68.56 Total charges $211.56",
  "Notice of Action Your SNAP benefits have been reduced. Effective date 10/01/2026. Reason code R-14. You may request a fair hearing within 90 days.",
  "FORM SSA-1099 - SOCIAL SECURITY BENEFIT STATEMENT 2025 Box 3. Benefits Paid in 2025 $24,000.00 Box 4. Benefits Repaid to SSA in 2025 $500.00 Box 5. Net Benefits for 2025 (Box 3 minus Box 4) $23,500.00",
  "Form 1099-R 2026 1 Gross distribution $40,000.00 2a Taxable amount $40,000.00 4 Federal income tax withheld $8,000.00 7a Dist. code(s) 1 7b IRA/SEP/",
  "Form 1099-G 2025 1 Unemployment compensation $8,000.00 4 Federal income tax withheld $800.00 12 State income tax withheld $0.00",
  "Form 1098-T Tuition Statement 2025 1 Payments received for qualified tuition and related expenses $9,800.00 5 Scholarships or grants $2,000.00",
  "Form 1098-E Student Loan Interest Statement 2025 1 Student loan interest received by lender $1,840.22",
  "North South Group is a debt collector. We are trying to collect a debt that you owe to Bank of Rockville. As of January 2, 2017, you owed: $ 2,234.56 You were charged this amount in interest: + $ 75.00 Total amount of the debt now: $ 2,309.56 Call or write to us by August 28, 2020, to dispute all or part of the debt.",
  "Medicare Summary Notice for Part B Date of This Notice March 1, 2020 Number of Services Medicare Denied 0 Total You May Be Billed $21.59 Total for Claim #02-10195-592-390 $143.00 $107.97 $86.38 $21.59 We must receive your appeal by: July 13, 2020",
  "This form is a statement of final loan terms and closing costs. Closing Disclosure Loan Term 30 years Loan Amount $162,000 Interest Rate 3.875% Monthly Principal & Interest $761.78 Closing Costs $9,712.10 Cash to Close $14,147.26 A. Origination Charges $1,802.00 B. Services Borrower Did Not Shop For $236.55",
  "Save this Loan Estimate to compare with your Closing Disclosure. Loan Estimate LOAN TERM 30 years Loan Amount $162,000 Interest Rate 3.875% Monthly Principal & Interest $761.78 Estimated Cash to Close $16,054 A. Origination Charges $1,802 B. Services You Cannot Shop For $672",
];

/** A seeded generator, so a failure names an input somebody can reproduce. */
let seed = 12345;
const rnd = (): number => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
const pick = <T>(a: readonly T[]): T => a[Math.floor(rnd() * a.length)]!;

/** Shapes a text layer really produces: truncation, noise, and overflow. */
const HOSTILE = [
  "",
  " ",
  "\n\n\n",
  "0".repeat(5000),
  "9".repeat(400),
  // Finite on its own and not after the extractor multiplies it — the bug above.
  `ABC Payroll Earnings Statement Bi-Weekly Gross Pay 1${"0".repeat(307)}`,
  `ABC Payroll Earnings Statement Monthly Gross Pay ${"9".repeat(308)}`,
  "Form 1099-B proceeds 1" + "0".repeat(307) + " cost or other basis 1",
  "Wages -99999999999999999999999999",
  "Gross Pay NaN",
  "Gross Pay Infinity",
  "1 Wages, tips, other compensation",
  "Total tax 1e309",
  "Adjusted gross income 1,,,,000",
  "12a D",
  "Net Pay -0",
  "16 State wages .",
];

function mutate(s: string): string {
  const k = Math.floor(rnd() * 6);
  if (k === 0) return s.slice(0, Math.floor(rnd() * s.length));
  if (k === 1) return `${s} ${pick(HOSTILE)}`;
  if (k === 2) return `${pick(HOSTILE)} ${s}`;
  if (k === 3) return s.replace(/\d/g, () => String(Math.floor(rnd() * 10)));
  if (k === 4) return s.split(" ").reverse().join(" ");
  return s.repeat(2);
}

function corpus(): string[] {
  const out = [...HOSTILE, ...REAL];
  for (const base of REAL) for (let i = 0; i < 200; i++) out.push(mutate(base));
  return out;
}

describe("what the extractor does with a document nobody wrote for it", () => {
  it("fuzzes every kind the extractor knows, not a list kept by hand", () => {
    // The corpus was four documents for as long as the Readout read thirteen
    // kinds, then twenty-one: every kind added after it was never fuzzed.
    const covered = new Set(
      REAL.map((text) => detectDocument({ text, pages: [text], source: "typed" }).kind),
    );
    expect(SUPPORTED_KINDS.filter((k) => !covered.has(k))).toEqual([]);
  });

  it("sweeps a corpus that reaches the extractors, not just the unknown branch", () => {
    // A sweep where every document is unrecognized asserts nothing: the unknown
    // branch returns no fields at all and every property below holds vacuously.
    const recognized = corpus().filter(
      (text) => extractDocument({ text, pages: [text], source: "typed" }).fields.length > 0,
    );
    expect(recognized.length).toBeGreaterThan(100);
  });

  it("never throws, never ships a value it cannot state, and says the same thing twice", () => {
    const failures: string[] = [];
    const show = (t: string): string => JSON.stringify(t.slice(0, 60));

    for (const text of corpus()) {
      const t: ExtractedText = { text, pages: [text], source: pick(["typed", "ocr"] as const) };
      let result;
      try {
        detectDocument(t);
        result = extractDocument(t);
      } catch (e) {
        failures.push(`THREW ${(e as Error).message} on ${show(text)}`);
        continue;
      }

      // Deterministic: the same document read twice is the same reading. The
      // whole product rests on this — a figure that moves between reads is one
      // nobody can reproduce from the repo.
      if (JSON.stringify(extractDocument(t)) !== JSON.stringify(result)) {
        failures.push(`NOT DETERMINISTIC on ${show(text)}`);
      }

      const ids = result.fields.map((f) => f.id);
      if (new Set(ids).size !== ids.length) {
        failures.push(`DUPLICATE id in [${ids.join(", ")}] on ${show(text)}`);
      }

      for (const f of result.fields) {
        if (typeof f.value === "number" && !Number.isFinite(f.value)) {
          failures.push(`NON-FINITE ${f.id} = ${f.value} on ${show(text)}`);
        }
        // A field the confirm view will render must have something to render.
        if (f.label.trim() === "") failures.push(`EMPTY LABEL for ${f.id} on ${show(text)}`);
      }
    }
    expect([...new Set(failures)].slice(0, 10)).toEqual([]);
  });

  it("drops the annualized gross it cannot state, and still says why the document is empty", () => {
    // The bug itself, pinned as behaviour rather than as an absence from the
    // sweep. `1e307` is finite; annualized over 26 bi-weekly periods it is not.
    const text = `ABC Payroll Earnings Statement Bi-Weekly Gross Pay 1${"0".repeat(307)}`;
    const r = extractDocument({ text, pages: [text], source: "typed" });
    expect(r.recognized).toBe(true);
    expect(r.fields.map((f) => f.id)).not.toContain("paystub-annual-gross");
    // Nothing readable is left, and the reader is told so rather than shown a
    // recognized document with an empty field list.
    expect(r.warnings.join(" ")).toContain("couldn't read its fields");
  });
});
