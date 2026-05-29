import { describe, it, expect } from "vitest";
import { extractDocument, detectDocument } from "../../src/readout/extract";
import type { ExtractedText } from "../../src/readout/extractText";

/**
 * Golden cases for the Readout extraction engine (BUILD-SPEC-2 §2.2). Extraction
 * is deterministic and anchored to known labels/box numbers — never inferred.
 * These fixtures represent the text pdf.js yields from a typed form; the engine
 * must pull the right fields, flag OCR and unrecognized revisions, and never
 * guess.
 */
function typed(text: string): ExtractedText {
  return { text, pages: [text], source: "typed" };
}

const W2_2024 = typed(
  "Form W-2 Wage and Tax Statement 2024 Employer ABC Inc " +
    "1 Wages, tips, other compensation 75000.00 " +
    "2 Federal income tax withheld 9200.00 " +
    "12a D 8000.00 " +
    "16 State wages 75000.00 17 State income tax 3100.00",
);

const FORM_1040_2024 = typed(
  "Form 1040 U.S. Individual Income Tax Return 2024 " +
    "Filing Status: Married filing jointly " +
    "11 Adjusted gross income 95000.00 " +
    "15 Taxable income 80000.00 " +
    "22 Total tax 12000.00",
);

const PAYSTUB = typed(
  "ABC Payroll Earnings Statement Pay Period 06/01/2024 Bi-Weekly " +
    "Gross Pay 2884.62 Net Pay 2100.00",
);

function value(
  result: ReturnType<typeof extractDocument>,
  id: string,
): number | string | undefined {
  return result.fields.find((f) => f.id === id)?.value;
}

describe("Readout, W-2 extraction", () => {
  const result = extractDocument(W2_2024);

  it("recognizes a typed W-2 and its revision", () => {
    expect(detectDocument(W2_2024)).toEqual({ kind: "w2", revision: "2024" });
    expect(result.kind).toBe("w2");
    expect(result.revision).toBe("2024");
    expect(result.source).toBe("typed");
  });

  it("reads box 1 wages and targets income", () => {
    expect(value(result, "w2-box1")).toBe(75000);
    expect(result.fields.find((f) => f.id === "w2-box1")?.target).toBe("annualIncome");
  });

  it("reads federal withholding and the 401(k) elective deferral", () => {
    expect(value(result, "w2-box2")).toBe(9200);
    expect(value(result, "w2-box12d")).toBe(8000);
    expect(result.fields.find((f) => f.id === "w2-box12d")?.target).toBe(
      "retirementContributionsAnnual",
    );
  });

  it("cites the IRS form revision it was read against", () => {
    expect(result.citation?.sourceUrl).toMatch(/irs\.gov/);
    expect(result.citation?.effectiveYear).toBe(2024);
  });
});

describe("Readout, Form 1040 extraction", () => {
  const result = extractDocument(FORM_1040_2024);

  it("recognizes a typed 1040 and reads AGI + filing status", () => {
    expect(result.kind).toBe("form1040");
    expect(value(result, "f1040-agi")).toBe(95000);
    expect(value(result, "f1040-filing-status")).toBe("married_jointly");
    expect(result.fields.find((f) => f.id === "f1040-filing-status")?.target).toBe("filingStatus");
  });

  it("reads taxable income and total tax", () => {
    expect(value(result, "f1040-taxable")).toBe(80000);
    expect(value(result, "f1040-tax")).toBe(12000);
  });
});

describe("Readout, pay stub extraction", () => {
  const result = extractDocument(PAYSTUB);

  it("annualizes bi-weekly gross pay and flags it for review", () => {
    expect(result.kind).toBe("paystub");
    // 2884.62 × 26 = 75,000.12 → 75,000 (bi-weekly must beat the "weekly" substring).
    expect(value(result, "paystub-annual-gross")).toBe(75000);
    const gross = result.fields.find((f) => f.id === "paystub-annual-gross");
    expect(gross?.needsReview).toBe(true);
    expect(gross?.target).toBe("annualIncome");
  });

  it("carries no citation, a pay stub is the employer's own document", () => {
    expect(result.citation).toBeNull();
  });
});

describe("Readout, flagging, not guessing (§2.2)", () => {
  it("flags an unrecognized form revision instead of extracting", () => {
    const oldW2 = typed(
      "Form W-2 Wage and Tax Statement 2009 1 Wages, tips, other compensation 40000.00",
    );
    const result = extractDocument(oldW2);
    expect(result.kind).toBe("w2");
    expect(result.recognized).toBe(true);
    expect(result.revision).toBeNull();
    expect(result.fields).toHaveLength(0);
    expect(result.warnings.join(" ")).toMatch(/revision/i);
  });

  it("flags every OCR-read value as lower confidence", () => {
    const ocr: ExtractedText = { ...W2_2024, source: "ocr" };
    const result = extractDocument(ocr);
    expect(result.fields.length).toBeGreaterThan(0);
    expect(result.fields.every((f) => f.confidence === "low" && f.needsReview)).toBe(true);
    expect(result.warnings.join(" ")).toMatch(/optical character recognition/i);
  });

  it("reports an unrecognized document without inventing fields", () => {
    const result = extractDocument(typed("A grocery receipt. Milk 3.99 Eggs 2.49 Total 6.48"));
    expect(result.kind).toBe("unknown");
    expect(result.recognized).toBe(false);
    expect(result.fields).toHaveLength(0);
  });

  it("is deterministic: the same text yields the same result", () => {
    expect(extractDocument(W2_2024)).toEqual(extractDocument(W2_2024));
  });
});
