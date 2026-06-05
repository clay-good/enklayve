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

  it("recognizes the current filing season's W-2 (2025), not just prior years", () => {
    // Same stable box layout, a newer tax year. Before the revision list was
    // brought current, a 2025 W-2 — the form a user files in early 2026 — was
    // recognized but had every field dropped as an "unvalidated revision."
    const w2_2025 = typed(
      "Form W-2 Wage and Tax Statement 2025 Employer ABC Inc " +
        "1 Wages, tips, other compensation 75000.00 " +
        "2 Federal income tax withheld 9200.00 " +
        "12a D 8000.00 " +
        "16 State wages 75000.00 17 State income tax 3100.00",
    );
    const r = extractDocument(w2_2025);
    expect(r.kind).toBe("w2");
    expect(r.revision).toBe("2025");
    expect(value(r, "w2-box1")).toBe(75000);
    expect(value(r, "w2-box2")).toBe(9200);
    expect(r.citation?.effectiveYear).toBe(2025);
    expect(r.warnings.join(" ")).not.toMatch(/revision/i);
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

const FORM_1099INT = typed(
  "Form 1099-INT 2024 Interest Income Payer Big Bank " +
    "1 Interest income 1250.00 4 Federal income tax withheld 0.00",
);

const FORM_1099DIV = typed(
  "Form 1099-DIV 2024 Dividends and Distributions " +
    "1a Total ordinary dividends 3200.00 1b Qualified dividends 2800.00 " +
    "2a Total capital gain distr 540.00",
);

const FORM_1099NEC = typed(
  "Form 1099-NEC 2024 Nonemployee Compensation Payer Acme LLC " +
    "1 Nonemployee compensation 48000.00",
);

const FORM_1099B = typed(
  "Form 1099-B 2024 Proceeds From Broker and Barter Exchange Transactions " +
    "1d Proceeds 12000.00 1e Cost or other basis 9000.00",
);

const FORM_1095A = typed(
  "Form 1095-A Health Insurance Marketplace Statement 2024 " +
    "Part III Coverage Information Annual Totals 9600.00 9000.00 3600.00",
);

const FORM_1098 = typed(
  "Form 1098 Mortgage Interest Statement 2024 Recipient Big Lender " +
    "1 Mortgage interest received from payer 14200.00 " +
    "2 Outstanding mortgage principal 312000.00",
);

describe("Readout, 1099 extraction", () => {
  it("reads 1099-INT interest income, cited to the form revision", () => {
    const r = extractDocument(FORM_1099INT);
    expect(r.kind).toBe("form1099int");
    expect(value(r, "1099int-box1")).toBe(1250);
    expect(r.citation?.sourceUrl).toMatch(/about-form-1099-int/);
    expect(r.citation?.effectiveYear).toBe(2024);
  });

  it("reads 1099-DIV ordinary, qualified, and capital-gain distributions", () => {
    const r = extractDocument(FORM_1099DIV);
    expect(r.kind).toBe("form1099div");
    expect(value(r, "1099div-box1a")).toBe(3200);
    expect(value(r, "1099div-box1b")).toBe(2800);
    expect(value(r, "1099div-box2a")).toBe(540);
  });

  it("reads 1099-NEC nonemployee compensation and targets income", () => {
    const r = extractDocument(FORM_1099NEC);
    expect(r.kind).toBe("form1099nec");
    expect(value(r, "1099nec-box1")).toBe(48000);
    expect(r.fields.find((f) => f.id === "1099nec-box1")?.target).toBe("annualIncome");
  });

  it("reads 1099-B proceeds and basis and computes the realized gain", () => {
    const r = extractDocument(FORM_1099B);
    expect(r.kind).toBe("form1099b");
    expect(value(r, "1099b-proceeds")).toBe(12000);
    expect(value(r, "1099b-basis")).toBe(9000);
    expect(value(r, "1099b-gain")).toBe(3000);
  });
});

describe("Readout, 1095-A and 1098 extraction", () => {
  it("reads the 1095-A annual totals: premium, benchmark, and advance credit", () => {
    const r = extractDocument(FORM_1095A);
    expect(r.kind).toBe("form1095a");
    expect(value(r, "1095a-premium")).toBe(9600);
    expect(value(r, "1095a-slcsp")).toBe(9000);
    expect(value(r, "1095a-aptc")).toBe(3600);
    expect(r.citation?.sourceUrl).toMatch(/about-form-1095-a/);
  });

  it("reads 1098 mortgage interest and outstanding principal", () => {
    const r = extractDocument(FORM_1098);
    expect(r.kind).toBe("form1098");
    expect(value(r, "1098-box1")).toBe(14200);
    expect(value(r, "1098-box2")).toBe(312000);
    expect(r.citation?.sourceUrl).toMatch(/about-form-1098/);
  });

  it("does not mistake a 1098-T tuition statement for a mortgage statement", () => {
    const r = extractDocument(
      typed("Form 1098-T Tuition Statement 2024 1 Payments received 12000.00"),
    );
    expect(r.kind).toBe("unknown");
  });
});

const FAFSA_SUMMARY = typed(
  "2024-25 FAFSA Submission Summary Federal Student Aid " +
    "Eligibility Overview Student Aid Index (SAI): 4500 " +
    "You may be eligible for a Federal Pell Grant.",
);

describe("Readout, FAFSA Submission Summary extraction", () => {
  it("recognizes the summary and reads the official Student Aid Index", () => {
    const r = extractDocument(FAFSA_SUMMARY);
    expect(detectDocument(FAFSA_SUMMARY)).toEqual({ kind: "fafsaSummary", revision: "2024" });
    expect(r.kind).toBe("fafsaSummary");
    expect(value(r, "fafsa-sai")).toBe(4500);
    expect(r.citation?.sourceUrl).toMatch(/studentaid\.gov/);
    expect(r.citation?.effectiveYear).toBe(2024);
  });

  it("reads a negative SAI (the new methodology floors at −$1,500)", () => {
    const r = extractDocument(
      typed("2024-25 FAFSA Submission Summary Student Aid Index (SAI): -1500"),
    );
    expect(r.kind).toBe("fafsaSummary");
    expect(value(r, "fafsa-sai")).toBe(-1500);
  });

  it("reads the SAI without the parenthetical and with no target (informational)", () => {
    const r = extractDocument(typed("2024-25 FAFSA Submission Summary Student Aid Index 0"));
    expect(value(r, "fafsa-sai")).toBe(0);
    expect(r.fields.find((f) => f.id === "fafsa-sai")?.target).toBeUndefined();
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
