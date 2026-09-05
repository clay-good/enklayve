import { describe, it, expect } from "vitest";
import { extractDocument, detectDocument } from "../../src/readout/extract";
import { SituationStore } from "../../src/profile/situation";
import { applyToSituation, replacementNote } from "../../src/readout/toSituation";
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

  it("reads the 2026 box 12 codes TP and TT, and calls TP a ceiling", () => {
    // New for tax year 2026 (IRS General Instructions for Forms W-2 and W-3,
    // Rev. 1-2026): the employer reports the figures IRC §§224 and 225 deduct.
    // TP is "total amount of cash tips reported to the employer" — NOT the
    // qualified figure, since §224 counts only Treasury-listed occupations and
    // box 14b carries the code that says whether this was one. TT is already
    // narrow: "only the 'half' portion of 'time-and-a-half'".
    const w2_2026 = typed(
      "Form W-2 Wage and Tax Statement 2026 Employer Diner Inc " +
        "1 Wages, tips, other compensation 48000.00 " +
        "2 Federal income tax withheld 3100.00 " +
        "12a D 2000.00 12b TP 14000.00 12c TT 3200.00 " +
        "14b 101 " +
        "16 State wages 48000.00 17 State income tax 1400.00",
    );
    const r = extractDocument(w2_2026);
    expect(r.revision).toBe("2026");
    expect(value(r, "w2-box12tp")).toBe(14000);
    expect(value(r, "w2-box12tt")).toBe(3200);
    expect(r.fields.find((f) => f.id === "w2-box12tp")?.target).toBe("qualifiedTipsAnnual");
    expect(r.fields.find((f) => f.id === "w2-box12tt")?.target).toBe("qualifiedOvertimeAnnual");
    expect(r.fields.find((f) => f.id === "w2-box12tp")?.note).toMatch(/ceiling/i);
    // The 401(k) deferral beside them still reads as itself.
    expect(value(r, "w2-box12d")).toBe(2000);
  });

  it("drops the new codes on a W-2 that has none, rather than guessing a zero", () => {
    // A 2024 or 2025 W-2 has no TP or TT box at all, and `field` omits what it
    // cannot read — so a prior-year document does not arrive claiming the
    // reader had no tips.
    expect(value(result, "w2-box12tp")).toBeUndefined();
    expect(value(result, "w2-box12tt")).toBeUndefined();
  });

  it("does not read TP or TT out of an ordinary word", () => {
    // Two letters that occur inside English words, next to dollar amounts, on a
    // document this module refuses to read by inference. The anchors require a
    // box-12 subscript and a word boundary.
    const decoy = typed(
      "Form W-2 Wage and Tax Statement 2026 Employer ABC Inc " +
        "1 Wages, tips, other compensation 75000.00 " +
        "2 Federal income tax withheld 9200.00 " +
        "12a D 8000.00 " +
        "Attn: Ttip Support 4400.00 " +
        "16 State wages 75000.00 17 State income tax 3100.00",
    );
    const r = extractDocument(decoy);
    expect(value(r, "w2-box12tp")).toBeUndefined();
    expect(value(r, "w2-box12tt")).toBeUndefined();
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

  it("refuses to read the option list as the answer", () => {
    // A real Form 1040 PRINTS all five statuses — "Check only one box. Single /
    // Married filing jointly (MFJ) / ..." — and a checked box is a glyph, not
    // text, so the option list is what reaches the extractor. The detector
    // walked its own priority order and returned the first match, which is
    // married filing jointly, at HIGH confidence with needsReview false. Every
    // filer who dropped in a real 1040 was recorded as filing jointly, and then
    // charged joint brackets and a joint standard deduction in Take-Home, the
    // plan, and the Readout Report — silently, because nothing asked them to
    // check it.
    const real = typed(
      "Form 1040 U.S. Individual Income Tax Return 2024 " +
        "Filing Status Check only one box. Single Married filing jointly (MFJ) " +
        "Married filing separately (MFS) Head of household (HOH) " +
        "Qualifying surviving spouse (QSS) " +
        "11 Adjusted gross income 52000.00 15 Taxable income 38000.00 22 Total tax 4300.00",
    );
    const r = extractDocument(real);
    const status = r.fields.find((f) => f.id === "f1040-filing-status");
    expect(status?.value).toBe("Not read");
    expect(status?.confidence).toBe("needs-review");
    expect(status?.needsReview).toBe(true);
    // No target is the part that matters: confirming this field must not be
    // able to write a guess into My Situation.
    expect(status?.target).toBeUndefined();
    expect(status?.note).toContain("Head of household");
    // The rest of the form still reads.
    expect(value(r, "f1040-agi")).toBe(52000);
  });

  it("a confirmed 1040 with an unreadable status writes nothing to My Situation", () => {
    const real = typed(
      "Form 1040 U.S. Individual Income Tax Return 2024 " +
        "Filing Status Check only one box. Single Married filing jointly (MFJ) " +
        "Married filing separately (MFS) Head of household (HOH) " +
        "Qualifying surviving spouse (QSS) 11 Adjusted gross income 52000.00",
    );
    const store = new SituationStore();
    applyToSituation(store, extractDocument(real).fields);
    expect(store.get("filingStatus")).toBeUndefined();
    expect(store.get("annualIncome")).toBe(52000);
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

/**
 * The third door into My Situation (SPEC-3 §2.3, the one the other two hid).
 *
 * A typed field and a deep link are clamped by `parseNonNegative` before they
 * reach the profile, and a restored file is clamped by the snapshot schema. A
 * **document** is neither: the Readout writes every confirmed field straight
 * through `SituationStore.set`, and the only check on the way was
 * `Number.isFinite` — which a 300-digit figure passes, because 1e300 is a
 * perfectly finite number.
 *
 * It is also the door where the value was never typed by the person it is
 * about, which is the argument for putting the ceiling on the write rather than
 * repeating it at each entrance.
 */
describe("a document cannot put an absurd figure into the profile", () => {
  const HUGE = "9".repeat(300) + ".00";

  it("clamps a wage box that would overflow the tiles reading it", () => {
    const result = extractDocument(
      typed(
        "Form W-2 Wage and Tax Statement 2024 Employer ABC Inc " +
          `1 Wages, tips, other compensation ${HUGE} ` +
          "2 Federal income tax withheld 9200.00 ",
      ),
    );
    // The extractor reports what the document says — that is its job, and the
    // confirm screen shows it to the reader before anything is applied.
    expect(value(result, "w2-box1")).toBe(1e300);

    const store = new SituationStore();
    applyToSituation(store, result.fields);
    expect(store.get("annualIncome")).toBe(1e15);
  });

  it("leaves a real wage exactly as the document stated it", () => {
    const store = new SituationStore();
    applyToSituation(store, extractDocument(W2_2024).fields);
    expect(store.get("annualIncome")).toBe(75_000);
  });
});

/**
 * Two documents, one slot (SPEC-2 §2.3).
 *
 * The Readout is a session — its summary offers "Read another document" — and
 * four of the five fields it can populate are single slots the profile holds
 * one value in. A freelancer with a job confirms a W-2 and then a 1099-NEC, and
 * both target `annualIncome`.
 *
 * Last write wins, and that is the only rule that can be right here: summing
 * would double-count a 1040's AGI against the W-2 box 1 it was computed from,
 * and this module's premise is that it never infers. What it must not do is win
 * quietly. It used to: `applyToSituation` returned a count, the summary said
 * "Added 1 value to My Situation", and the $75,000 the reader had confirmed
 * ten seconds earlier was gone with nothing on the screen about it — while
 * every tax, subsidy and affordability tile downstream computed on $30,000.
 */
describe("a second document landing on a field the first one filled", () => {
  const W2 =
    "Form W-2 Wage and Tax Statement 2024 1 Wages, tips, other compensation 75000.00 " +
    "2 Federal income tax withheld 9200.00";
  const NEC = "Form 1099-NEC Nonemployee Compensation 2024 1 Nonemployee compensation 30000.00";

  function confirm(store: SituationStore, text: string) {
    return applyToSituation(
      store,
      extractDocument({ text, pages: [text], source: "typed" }).fields,
    );
  }

  it("reports what it replaced, and with what", () => {
    const store = new SituationStore();
    expect(confirm(store, W2).replaced).toEqual([]);
    const second = confirm(store, NEC);
    expect(store.get("annualIncome")).toBe(30000);
    expect(second.replaced).toEqual([
      { target: "annualIncome", previous: 75000, previousSource: "extracted", next: 30000 },
    ]);
  });

  it("says nothing when the second document agrees with the first", () => {
    const store = new SituationStore();
    confirm(store, W2);
    expect(confirm(store, W2).replaced).toEqual([]);
  });

  it("names a value the reader typed as theirs, not as a document's", () => {
    const store = new SituationStore();
    store.set("annualIncome", 90000, "typed");
    const note = replacementNote(confirm(store, W2).replaced, "en-US");
    expect(note).toContain("Annual income was $90,000 as you entered it, and is now $75,000.");
    // States what happened and stops. "If both are yours, add them" would be
    // advice, and it is wrong for the commonest pair: a 1040's AGI and the W-2
    // box 1 it was computed from are not two incomes.
    expect(note).not.toMatch(/\badd\b|\btotal\b/i);
    expect(replacementNote([], "en-US")).toBe("");
  });
});
