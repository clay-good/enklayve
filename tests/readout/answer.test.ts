import { describe, it, expect } from "vitest";
import { extractDocument, detectDocument } from "../../src/readout/extract";
import { buildAnswer } from "../../src/readout/answer";
import {
  CHECKS,
  runChecks,
  validateCheck,
  validateRegistry,
  type CheckDefinition,
} from "../../src/readout/checks";
import type { ExtractedText } from "../../src/readout/extractText";
import { READOUT_TARGETS, type ExtractionResult } from "../../src/readout/types";
import {
  EnrollmentWindowsSchema,
  NoSurprisesSchema,
  type NoSurprisesData,
} from "../../src/data/schemas";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/** The real bundled shard, parsed through its own schema — so these tests fail
 * if the shard drifts out of shape, not just if the code does. */
const NO_SURPRISES: NoSurprisesData = NoSurprisesSchema.parse(
  JSON.parse(
    readFileSync(resolve(__dirname, "..", "..", "data", "no-surprises-2026.json"), "utf8"),
  ),
);

/**
 * Readout v2 (SPEC-4-readout-v2): the four-part answer and the check registry.
 *
 * These fixtures stand in for the text pdf.js yields from a plan's Explanation
 * of Benefits, a provider's itemized statement, and a state agency's
 * determination notice. None of the three is a standardized form, so the
 * extractors anchor on captions and the tests pin what they may and may not
 * conclude — above all that a check is a question, never a verdict.
 */
function typed(text: string): ExtractedText {
  return { text, pages: [text], source: "typed" };
}
function scanned(text: string): ExtractedText {
  return { text, pages: [text], source: "ocr" };
}

/** A clean EOB: allowed = plan paid + patient responsibility, in-network. */
const EOB_CLEAN =
  "Explanation of Benefits — This is not a bill. Claim Number: CLM-88213 " +
  "Date of Service 09/12/2026 Provider: Riverside Clinic In-Network " +
  "Amount Billed 1,200.00 Allowed Amount 640.00 Plan Paid 512.00 " +
  "Patient Responsibility 128.00 Applied to deductible 0.00 " +
  "Applied to out-of-pocket maximum 128.00";

/** The same claim, out-of-network, where the plan's own split does not close. */
const EOB_MISMATCH =
  "Explanation of Benefits — This is not a bill. Claim Number: CLM-90114 " +
  "Date of Service 09/12/2026 Out-of-Network " +
  "Amount Billed 4,000.00 Allowed Amount 2,000.00 Plan Paid 1,200.00 " +
  "Patient Responsibility 950.00 Applied to deductible 3,500.00";

/** A notice applying more to the out-of-pocket maximum than the cap itself. */
const EOB_OOP_OVER =
  "Explanation of Benefits — This is not a bill. Claim Number: CLM-90115 " +
  "Date of Service 09/12/2026 In-Network " +
  "Amount Billed 9,000.00 Allowed Amount 7,200.00 Plan Paid 0.00 " +
  "Patient Responsibility 7,200.00 Applied to out-of-pocket maximum 7,200.00";

/** An itemized bill whose charge lines sum to its total. */
const BILL_CLEAN =
  "Riverside Clinic Itemized Statement Patient Account 44120 " +
  "09/12/2026 Office visit level 3 400.00 " +
  "09/12/2026 Metabolic panel 140.00 " +
  "09/12/2026 Chest radiograph 100.00 " +
  "Total Charges 640.00";

/** The same bill with a duplicated line and a total that no longer reconciles. */
const BILL_DUPLICATE =
  "Riverside Clinic Itemized Statement Patient Account 44120 " +
  "09/12/2026 Metabolic panel 140.00 " +
  "09/12/2026 Metabolic panel 140.00 " +
  "09/12/2026 Office visit level 3 400.00 " +
  "Total Charges 640.00";

/** The same clinic, with the panel charged four times rather than twice. */
const BILL_TRIPLICATE =
  "Riverside Clinic Itemized Statement Patient Account 44120 " +
  "09/12/2026 Metabolic panel 140.00 " +
  "09/12/2026 Metabolic panel 140.00 " +
  "09/12/2026 Metabolic panel 140.00 " +
  "09/12/2026 Metabolic panel 140.00 " +
  "09/12/2026 Office visit level 3 400.00 " +
  "Total Charges 960.00";

const NOTICE_DENIAL =
  "State Department of Human Services Notice of Action — Medicaid " +
  "Your application has been denied. Reason code: MA-217 " +
  "Effective date 10/01/2026 " +
  "You may appeal this decision or request a fair hearing by 12/30/2026.";

const NOTICE_SNAP_WINDOW =
  "Notice of Decision — Supplemental Nutrition Assistance Program (SNAP) " +
  "Your benefits have been reduced. Reason code: SN-04 Effective date 11/01/2026 " +
  "You may request a fair hearing within 90 days of the date on this notice.";

describe("the fields a document may write into My Situation", () => {
  it("is exactly this set, so widening it is a deliberate edit", () => {
    // SPEC-4-readout-v2 §2.1. SPEC-5 §7.2 adds socialSecurityPia (the Social
    // Security Statement) and unemploymentCompensationAnnual (1099-G box 1)
    // with the extractors that write them, and this list grows by those two.
    // The 1099-G's has landed; the Statement's waits on its template.
    expect([...READOUT_TARGETS]).toEqual([
      "annualIncome",
      "selfEmploymentProfitAnnual",
      "retirementContributionsAnnual",
      "filingStatus",
      "qualifiedTipsAnnual",
      "qualifiedOvertimeAnnual",
      "unemploymentCompensationAnnual",
    ]);
  });
});

describe("Readout v2, Explanation of Benefits extraction", () => {
  const result = extractDocument(typed(EOB_CLEAN));

  it("recognizes an EOB and exempts it from the form-revision pin", () => {
    expect(detectDocument(typed(EOB_CLEAN)).kind).toBe("eobHealth");
    expect(result.recognized).toBe(true);
    // No form designer, no revision to pin — and so no form citation either.
    expect(result.citation).toBeNull();
    expect(result.fields.length).toBeGreaterThan(0);
  });

  it("reads the plan's four figures, the network status, and the claim number", () => {
    const v = (id: string) => result.fields.find((f) => f.id === id)?.value;
    expect(v("eob-billed")).toBe(1200);
    expect(v("eob-allowed")).toBe(640);
    expect(v("eob-plan-paid")).toBe(512);
    expect(v("eob-patient-responsibility")).toBe(128);
    expect(v("eob-network")).toBe("in-network");
    expect(v("eob-claim")).toBe("CLM-88213");
    expect(v("eob-date-of-service")).toBe("09/12/2026");
  });

  it("never writes an EOB figure into My Situation", () => {
    // The Readout may only populate income, retirement contributions, and
    // filing status. Nothing on a health claim is one of those.
    expect(result.fields.every((f) => f.target === undefined)).toBe(true);
  });
});

describe("Readout v2, itemized medical bill extraction", () => {
  const result = extractDocument(typed(BILL_CLEAN));

  it("reads charge lines only where a date of service introduces them", () => {
    const lines = result.fields.filter((f) => f.id.startsWith("bill-line-"));
    expect(lines.map((l) => l.value)).toEqual([400, 140, 100]);
    expect(lines[0]?.label).toBe("09/12/2026 Office visit level 3");
    expect(result.fields.find((f) => f.id === "bill-total")?.value).toBe(640);
  });

  it("reads no line items from prose with no date column", () => {
    const prose = extractDocument(
      typed("Itemized Statement. Please remit the balance shown below. Total Charges 640.00"),
    );
    expect(prose.fields.filter((f) => f.id.startsWith("bill-line-"))).toHaveLength(0);
  });
});

describe("Readout v2, benefits determination notice extraction", () => {
  it("reads the decision, the program, the reason code, and the printed clock", () => {
    const r = extractDocument(typed(NOTICE_DENIAL));
    const v = (id: string) => r.fields.find((f) => f.id === id)?.value;
    expect(r.kind).toBe("benefitsNotice");
    expect(v("notice-decision")).toBe("denied");
    expect(v("notice-program")).toBe("Medicaid");
    expect(v("notice-reason")).toBe("MA-217");
    expect(v("notice-effective")).toBe("10/01/2026");
    expect(v("notice-appeal-by")).toBe("12/30/2026");
  });

  it("always flags the decision for review, since notice wording varies by state", () => {
    const r = extractDocument(typed(NOTICE_DENIAL));
    expect(r.fields.find((f) => f.id === "notice-decision")?.needsReview).toBe(true);
  });

  it("reads a window in days when the notice states one instead of a date", () => {
    const r = extractDocument(typed(NOTICE_SNAP_WINDOW));
    expect(r.fields.find((f) => f.id === "notice-program")?.value).toBe("SNAP");
    expect(r.fields.find((f) => f.id === "notice-decision")?.value).toBe("reduced");
    expect(r.fields.find((f) => f.id === "notice-appeal-window-days")?.value).toBe(90);
    expect(r.fields.find((f) => f.id === "notice-appeal-by")).toBeUndefined();
  });
});

describe("Readout v2, the check registry contract (§4.1)", () => {
  it("ships no check that cannot state what a false positive looks like", () => {
    expect(validateRegistry(CHECKS)).toEqual([]);
    expect(CHECKS.every((c) => c.falsePositive.trim().length > 0)).toBe(true);
  });

  const base: CheckDefinition = {
    id: "fixture",
    kind: "rule",
    appliesTo: ["eobHealth"],
    falsePositive: "The provider may have an in-network agreement we cannot see.",
    suppressOnOcr: true,
    citation: {
      sourceUrl: "https://www.cms.gov/initiatives/your-patient-rights/medical-bill-rights",
      sourceDocument: "CMS, protections against surprise medical bills",
      effectiveYear: 2026,
      dateRetrieved: "2026-08-29",
    },
    run: () => ({ question: "q", detail: "d", askWho: "w" }),
  };

  it("fails a check with an empty false-positive statement", () => {
    expect(validateCheck({ ...base, falsePositive: "   " })).toContain(
      "fixture: every check must state what a false positive looks like",
    );
  });

  it("fails a rule check with no citation, and one that would survive OCR", () => {
    expect(validateCheck({ ...base, citation: undefined })).toContain(
      "fixture: a rule check must carry a citation",
    );
    expect(validateCheck({ ...base, suppressOnOcr: false })).toContain(
      "fixture: a rule check must set suppressOnOcr",
    );
  });

  it("fails an arithmetic check that reaches for a citation it does not need", () => {
    expect(validateCheck({ ...base, kind: "arithmetic" })).toContain(
      "fixture: an arithmetic check cites nothing beyond the arithmetic itself",
    );
  });

  it("fails a registry with a duplicate id", () => {
    expect(validateRegistry([base, { ...base }])).toContain("fixture: duplicate check id");
  });
});

describe("Readout v2, what the checks do and do not say", () => {
  const eob = extractDocument(typed(EOB_MISMATCH));
  const bill = extractDocument(typed(BILL_DUPLICATE));

  it("asks whether the plan's own math adds up, and never asserts it is wrong", () => {
    const flags = runChecks({ primary: eob, documents: [eob] });
    const split = flags.find((f) => f.checkId === "eob-allowed-splits");
    expect(split).toBeDefined();
    expect(split?.question.endsWith("?")).toBe(true);
    // $2,000 allowed against $1,200 + $950 = $2,150.
    expect(split?.detail).toContain("$150.00");
    for (const f of flags) {
      expect(f.detail.toLowerCase()).not.toContain("is wrong");
      expect(f.detail.toLowerCase()).not.toContain("overcharged");
      expect(f.askWho.length).toBeGreaterThan(0);
    }
  });

  it("stays silent when the plan's split reconciles", () => {
    const clean = extractDocument(typed(EOB_CLEAN));
    const flags = runChecks({ primary: clean, documents: [clean] });
    expect(flags.find((f) => f.checkId === "eob-allowed-splits")).toBeUndefined();
  });

  it("checks the document being read, not the first one of its kind", () => {
    // "Read another document" is an advertised flow, and a session keeps every
    // extraction. The checks took the FIRST document of a kind, so a second EOB
    // was restated on screen while the findings below it were still about the
    // first: silence on a broken second notice because the first reconciled,
    // and dollars quoted from a page the reader had moved on from.
    const clean = extractDocument(typed(EOB_CLEAN));
    const second = runChecks({ primary: eob, documents: [clean, eob] });
    const split = second.find((f) => f.checkId === "eob-allowed-splits");
    expect(split).toBeDefined();
    expect(split?.detail).toContain("$150.00");

    // And the other way round: the clean one read second says nothing.
    const back = runChecks({ primary: clean, documents: [eob, clean] });
    expect(back.find((f) => f.checkId === "eob-allowed-splits")).toBeUndefined();
  });

  it("runs a plan-math check only against a deductible the user supplied", () => {
    const withoutPlan = runChecks({ primary: eob, documents: [eob] });
    expect(
      withoutPlan.find((f) => f.checkId === "eob-deductible-over-plan-deductible"),
    ).toBeUndefined();
    const withPlan = runChecks({ primary: eob, documents: [eob], plan: { deductible: 1500 } });
    const flag = withPlan.find((f) => f.checkId === "eob-deductible-over-plan-deductible");
    expect(flag?.kind).toBe("plan-math");
    expect(flag?.detail).toContain("If your deductible is $1,500.00");
  });

  it("asks the same question about the out-of-pocket maximum", () => {
    // `PlanParameters.oopMax` was declared, the figure was extracted from the
    // notice, and nothing read either of them — the deductible had a plan-math
    // check and its twin did not exist. A cap is a cap.
    const notice = extractDocument(typed(EOB_OOP_OVER));
    const withPlan = runChecks({
      primary: notice,
      documents: [notice],
      plan: { oopMax: 6000 },
    });
    const flag = withPlan.find((f) => f.checkId === "eob-oop-over-plan-oop-max");
    expect(flag?.kind).toBe("plan-math");
    expect(flag?.question.endsWith("?")).toBe(true);
    expect(flag?.detail).toContain("$6,000.00");
    expect(flag?.detail).toContain("$1,200.00");

    // No figure from the reader, no question.
    const withoutPlan = runChecks({ primary: notice, documents: [notice] });
    expect(withoutPlan.find((f) => f.checkId === "eob-oop-over-plan-oop-max")).toBeUndefined();

    // At or under the cap it says nothing either.
    const under = runChecks({ primary: notice, documents: [notice], plan: { oopMax: 9000 } });
    expect(under.find((f) => f.checkId === "eob-oop-over-plan-oop-max")).toBeUndefined();
  });

  it("counts every repeat, rather than stopping at the second one", () => {
    // The check returned on the second sighting and reported the count it had
    // reached, so a line appearing four times read "appears 2 times" — a figure
    // understated on a medical bill, on the one number the question is about.
    const four = extractDocument(typed(BILL_TRIPLICATE));
    const dup = runChecks({ primary: four, documents: [four] }).find(
      (f) => f.checkId === "bill-duplicate-line",
    );
    expect(dup?.detail).toContain("appears 4 times");
    expect(dup?.detail).not.toContain("appears 2 times");
    // Two is still two, and still reads naturally.
    const twice = runChecks({ primary: bill, documents: [bill] }).find(
      (f) => f.checkId === "bill-duplicate-line",
    );
    expect(twice?.detail).toContain("appears 2 times");
    expect(twice?.question).toContain("twice");
    expect(dup?.question).not.toContain("twice");
  });

  it("stays silent on a bill whose lines are all distinct", () => {
    const clean = extractDocument(typed(BILL_CLEAN));
    expect(
      runChecks({ primary: clean, documents: [clean] }).find(
        (f) => f.checkId === "bill-duplicate-line",
      ),
    ).toBeUndefined();
  });

  it("screens a bill for a duplicated line and for lines that do not sum", () => {
    const flags = runChecks({ primary: bill, documents: [bill] });
    const dup = flags.find((f) => f.checkId === "bill-duplicate-line");
    expect(dup?.kind).toBe("anomaly");
    expect(dup?.detail).toContain("may well be intentional");
    const sum = flags.find((f) => f.checkId === "bill-lines-sum-to-total");
    // $140 + $140 + $400 = $680 against a $640 total.
    expect(sum?.detail).toContain("$40.00");
  });
});

describe("Readout v2, the W-2 tips occupation check", () => {
  /** A 2026 W-2 with tips, and the box 14b codes an employer entered. */
  const w2WithTips = (codes: string): string =>
    "Form W-2 Wage and Tax Statement 2026 Employer Diner Inc " +
    "1 Wages, tips, other compensation 48000.00 " +
    "2 Federal income tax withheld 3100.00 " +
    "12b TP 14000.00 12c TT 3200.00 " +
    `14b ${codes} ` +
    "16 State wages 48000.00 17 State income tax 1400.00";

  const runOn = (text: string, source: "typed" | "ocr" = "typed") => {
    const d = extractDocument(source === "typed" ? typed(text) : scanned(text));
    return { d, outcomes: runChecks({ primary: d, documents: [d] }, CHECKS) };
  };

  it("asks about the tips when box 14b carries the 000 code", () => {
    // The instructions require 000 when ANY of the tips were received in a
    // nonqualifying occupation, so the W-2 is telling us the §224 figure is
    // smaller than box 12 code TP — the one thing an amount cannot say.
    const { outcomes } = runOn(w2WithTips("000 101"));
    const fired = outcomes.filter((o) => o.checkId === "w2-tips-nonqualifying-occupation");
    expect(fired).toHaveLength(1);
    expect(fired[0]?.question).toMatch(/\?$/);
    expect(fired[0]?.detail).toContain("$14,000");
    // A rule check renders only with a citation, and this one's is the IRS
    // instruction that gives the box its meaning.
    expect(fired[0]?.citation?.sourceDocument).toMatch(/Forms W-2 and W-3/);
  });

  it("stays quiet when every occupation code qualifies", () => {
    const { outcomes } = runOn(w2WithTips("101 102"));
    expect(outcomes.filter((o) => o.checkId === "w2-tips-nonqualifying-occupation")).toHaveLength(
      0,
    );
  });

  it("stays quiet on a W-2 with no tips at all", () => {
    const noTips =
      "Form W-2 Wage and Tax Statement 2026 Employer ABC Inc " +
      "1 Wages, tips, other compensation 75000.00 2 Federal income tax withheld 9200.00 " +
      "17 State income tax 3100.00";
    expect(runOn(noTips).outcomes).toHaveLength(0);
  });

  it("says nothing about a scanned W-2, where 008 reads as 000", () => {
    // The whole reason rule checks are suppressed on OCR: three digits are
    // exactly what a scan gets wrong, and the claim here is about a person's
    // occupation.
    const { d, outcomes } = runOn(w2WithTips("000 101"), "ocr");
    expect(d.source).toBe("ocr");
    expect(outcomes.filter((o) => o.checkId === "w2-tips-nonqualifying-occupation")).toHaveLength(
      0,
    );
  });

  it("reads the codes as written, and notes the 000", () => {
    const { d } = runOn(w2WithTips("000 101"));
    const box14b = d.fields.find((f) => f.id === "w2-box14b");
    expect(box14b?.value).toBe("000, 101");
    expect(box14b?.note).toMatch(/do not qualify|does not qualify/);
    // Not a profile field: there is nowhere for an occupation code to go, and
    // it exists here as evidence for the check rather than as a value.
    expect(box14b?.target).toBeUndefined();
  });
});

describe("Readout v2, the EOB × medical-bill cross-check (§5)", () => {
  const eob = extractDocument(typed(EOB_CLEAN));
  const bill = extractDocument(typed(BILL_CLEAN));

  it("fires on a matched pair where the bill exceeds what the plan calculated", () => {
    // The plan put the patient's share at $128; the provider is billing $640.
    const flags = runChecks({ primary: bill, documents: [eob, bill] });
    const cross = flags.find((f) => f.checkId === "eob-x-bill-responsibility");
    expect(cross?.detail).toContain("$512.00");
    expect(cross?.question).toContain("?");
  });

  it("appears on both documents of the pair", () => {
    const onEob = runChecks({ primary: eob, documents: [eob, bill] });
    expect(onEob.find((f) => f.checkId === "eob-x-bill-responsibility")).toBeDefined();
  });

  it("stays silent when only one of the pair is present", () => {
    expect(
      runChecks({ primary: bill, documents: [bill] }).find(
        (f) => f.checkId === "eob-x-bill-responsibility",
      ),
    ).toBeUndefined();
  });
});

describe("Readout v2, OCR suppresses rule checks entirely (§6.4)", () => {
  const ruleCheck: CheckDefinition = {
    id: "fixture-rule",
    kind: "rule",
    appliesTo: ["eobHealth"],
    falsePositive: "The provider may hold an in-network agreement this notice does not show.",
    suppressOnOcr: true,
    citation: {
      sourceUrl: "https://www.cms.gov/initiatives/your-patient-rights/medical-bill-rights",
      sourceDocument: "CMS, protections against surprise medical bills",
      effectiveYear: 2026,
      dateRetrieved: "2026-08-29",
    },
    run: () => ({ question: "q?", detail: "d", askWho: "w" }),
  };

  it("runs a rule check on typed text", () => {
    const typedEob = extractDocument(typed(EOB_MISMATCH));
    expect(runChecks({ primary: typedEob, documents: [typedEob] }, [ruleCheck])).toHaveLength(1);
  });

  it("runs zero rule checks on a document read by OCR", () => {
    const ocrEob = extractDocument(scanned(EOB_MISMATCH));
    expect(ocrEob.source).toBe("ocr");
    expect(runChecks({ primary: ocrEob, documents: [ocrEob] }, [ruleCheck])).toHaveLength(0);
  });

  it("still runs arithmetic on a scan, and labels the outcome as read from one", () => {
    const ocrEob = extractDocument(scanned(EOB_MISMATCH));
    const flags = runChecks({ primary: ocrEob, documents: [ocrEob] });
    const split = flags.find((f) => f.checkId === "eob-allowed-splits");
    expect(split?.fromOcr).toBe(true);
    // ...but the soft anomaly, which OCR is exactly what manufactures, does not run.
    const ocrBill = extractDocument(scanned(BILL_DUPLICATE));
    expect(
      runChecks({ primary: ocrBill, documents: [ocrBill] }).find(
        (f) => f.checkId === "bill-duplicate-line",
      ),
    ).toBeUndefined();
  });
});

describe("Readout v2, the four-part answer (§2)", () => {
  it("restates an EOB, flags nothing when it reconciles, and says why each empty section is empty", () => {
    const answer = buildAnswer(extractDocument(typed(EOB_CLEAN)));
    expect(answer.says.map((s) => s.label)).toEqual([
      "Amount billed",
      "Allowed amount",
      "Plan paid",
      "Patient responsibility",
      "Network status",
    ]);
    expect(answer.flags).toHaveLength(0);
    expect(answer.emptyReasons.flags).toContain("Nothing flagged");
    // An in-network claim: the surprise-billing rule covers out-of-network
    // charges, so it is not the rule in play, and the section says so.
    expect(answer.owed).toHaveLength(0);
    expect(answer.emptyReasons.owed).toContain("not the rule in play");
    expect(answer.next[0]?.label).toContain("An EOB is not a bill");
  });

  it("every figure it says traces back to an extracted field", () => {
    const result = extractDocument(typed(EOB_MISMATCH));
    const ids = new Set(result.fields.map((f) => f.id));
    const answer = buildAnswer(result);
    for (const s of answer.says) expect(ids.has(s.fieldId)).toBe(true);
  });

  it("adds the surprise-billing channel only when the claim is out-of-network", () => {
    const outOfNetwork = buildAnswer(extractDocument(typed(EOB_MISMATCH)));
    expect(outOfNetwork.next.some((n) => n.channel?.url.includes("medical-bill-rights"))).toBe(
      true,
    );
    const inNetwork = buildAnswer(extractDocument(typed(EOB_CLEAN)));
    expect(inNetwork.next.some((n) => n.channel?.url.includes("medical-bill-rights"))).toBe(false);
  });

  it("points an itemized bill at the hospital financial-assistance obligation, with its citation", () => {
    const answer = buildAnswer(extractDocument(typed(BILL_CLEAN)));
    expect(answer.owed).toHaveLength(2);
    for (const o of answer.owed) {
      expect(o.tileId).toBe("charity-care");
      // An obligation on the hospital, never a determination about this household.
      expect(o.estimate).toBeUndefined();
    }
    expect(answer.owed[0]?.citation.sourceDocument).toContain("501(r)(4)");
    // §501(r)(4) says help exists; §1.501(r)-6 says how long you have to ask
    // and what the hospital may not do meanwhile. The charity-care tile gained
    // that today, and a document generated beside a tile must not know less
    // than the tile — a person reading a bill is being told to pay it now.
    expect(answer.owed[1]?.citation.sourceDocument).toContain("501(r)-6");
    expect(answer.owed[1]?.label).toContain("240th day");
    expect(answer.owed[1]?.label).toContain("120 days");
    expect(answer.owed[1]?.label).toContain("already gone to collections");
    const said = answer.owed.map((o) => o.label.toLowerCase()).join(" ");
    expect(said).not.toContain("you qualify");
    expect(said).not.toContain("you are eligible");
  });

  it("routes a benefits notice to its program's appeal channel and states no clock of its own", () => {
    const snap = buildAnswer(extractDocument(typed(NOTICE_SNAP_WINDOW)));
    expect(snap.next.some((n) => n.channel?.url.includes("snap/state-directory"))).toBe(true);
    // Phase 22a states no statutory window: every `next` here is undated, and
    // the only clock shown is the one printed on the notice itself.
    expect(snap.next.every((n) => n.deadline === undefined)).toBe(true);
    expect(snap.says.map((s) => s.label)).toContain(
      "Appeal window in days (as printed on the notice)",
    );

    const medicaid = buildAnswer(extractDocument(typed(NOTICE_DENIAL)));
    expect(medicaid.next.some((n) => n.channel?.url.includes("lsc.gov"))).toBe(true);
  });

  it("gives an unrecognized document an answer that admits it read nothing", () => {
    const unknown = extractDocument(typed("A birthday card."));
    const answer = buildAnswer(unknown);
    expect(answer.says).toHaveLength(0);
    expect(answer.emptyReasons.says).toContain("enter them by hand");
    expect(answer.flags).toHaveLength(0);
  });

  it("wraps the existing document kinds in the same shape without changing extraction", () => {
    const w2: ExtractionResult = extractDocument(
      typed(
        "Form W-2 Wage and Tax Statement 2026 1 Wages, tips, other compensation 75000.00 " +
          "2 Federal income tax withheld 9200.00",
      ),
    );
    const answer = buildAnswer(w2);
    expect(answer.source).toBe(w2);
    expect(answer.says.map((s) => s.value)).toContain("$75,000.00");
    expect(answer.next[0]?.label).toContain("Nothing is used until you confirm");
  });
});

/**
 * The balance-billing screen (SPEC-4-safety-net §B1 check 2, Phase 22b). Tier 3
 * throughout: it states the rule, says plainly that whether *this* care falls
 * inside it cannot be read off the notice, and names the free federal channel.
 */
describe("Readout v2, the No Surprises balance-billing screen", () => {
  const outOfNetwork = extractDocument(typed(EOB_MISMATCH));
  const inNetwork = extractDocument(typed(EOB_CLEAN));

  it("does not run at all without the shard that cites it", () => {
    const flags = runChecks({ primary: outOfNetwork, documents: [outOfNetwork] });
    expect(flags.find((f) => f.checkId === "eob-out-of-network-balance-bill")).toBeUndefined();
  });

  /**
   * Through `buildAnswer`, which is the only way the app ever reaches it.
   *
   * Every other case in this block calls `runChecks` directly with a context it
   * builds itself, so the check was fully covered and had never once fired in
   * the product: `buildAnswer` handed `options.noSurprises` to the "what you
   * may be owed" section and left it out of the `CheckContext`, so `ctx.
   * noSurprises` was undefined on every real document and the check returned
   * null before looking at anything. A reader who dropped an out-of-network EOB
   * got the pointer and never the flag — the one that names the dollar amount
   * on them and the free federal Help Desk to ask about it.
   */
  it("reaches a real document through buildAnswer, not only through runChecks", () => {
    const answer = buildAnswer(outOfNetwork, { noSurprises: NO_SURPRISES });
    const flag = answer.flags.find((f) => f.checkId === "eob-out-of-network-balance-bill");
    expect(flag, "the balance-billing check does not fire on the path the app uses").toBeTruthy();
    expect(flag?.citation).toBe(NO_SURPRISES.citation);
    expect(flag?.askWho).toContain("Help Desk");

    // And without the shard it stays silent rather than claiming a protection
    // it cannot cite, which is the behaviour the `if (!ns)` guard is for.
    expect(
      buildAnswer(outOfNetwork).flags.find((f) => f.checkId === "eob-out-of-network-balance-bill"),
    ).toBeUndefined();
  });

  it("fires on an out-of-network claim and carries the shard's own citation", () => {
    const flags = runChecks({
      primary: outOfNetwork,
      documents: [outOfNetwork],
      noSurprises: NO_SURPRISES,
    });
    const flag = flags.find((f) => f.checkId === "eob-out-of-network-balance-bill");
    expect(flag?.kind).toBe("rule");
    // The citation travels with the hashed shard, not a copy in the code.
    expect(flag?.citation).toBe(NO_SURPRISES.citation);
    expect(flag?.citation?.sourceUrl).toContain("cms.gov");
    expect(flag?.askWho).toContain("Help Desk");
  });

  it("stays silent on an in-network claim", () => {
    const flags = runChecks({
      primary: inNetwork,
      documents: [inNetwork],
      noSurprises: NO_SURPRISES,
    });
    expect(flags.find((f) => f.checkId === "eob-out-of-network-balance-bill")).toBeUndefined();
  });

  it("is suppressed entirely on a scan — an OCR misread is never a balance-billing claim", () => {
    const scan = extractDocument(scanned(EOB_MISMATCH));
    const flags = runChecks({ primary: scan, documents: [scan], noSurprises: NO_SURPRISES });
    expect(flags.find((f) => f.checkId === "eob-out-of-network-balance-bill")).toBeUndefined();
  });

  it("never tells the household it does not owe the bill", () => {
    const flags = runChecks({
      primary: outOfNetwork,
      documents: [outOfNetwork],
      noSurprises: NO_SURPRISES,
    });
    const flag = flags.find((f) => f.checkId === "eob-out-of-network-balance-bill");
    const copy = `${flag?.question} ${flag?.detail}`.toLowerCase();
    for (const forbidden of [
      "you do not owe",
      "you don't owe",
      "you are protected",
      "this is illegal",
      "you were overcharged",
    ]) {
      expect(copy).not.toContain(forbidden);
    }
    // It names the limits of its own scope in the same breath as the rule.
    expect(copy).toContain("ground ambulance");
    expect(copy).toContain("notice and consent");
    expect(copy).toContain("not something this notice can tell us");
  });

  it("drops a rule outcome that reaches the renderer with no citation", () => {
    // `citationFromData` is a promise enforced at run time, not only declared.
    const uncited: CheckDefinition = {
      id: "fixture-uncited-rule",
      kind: "rule",
      appliesTo: ["eobHealth"],
      citationFromData: true,
      falsePositive: "The provider may hold an agreement this notice does not show.",
      suppressOnOcr: true,
      run: () => ({ question: "q?", detail: "d", askWho: "w" }),
    };
    expect(validateCheck(uncited)).toEqual([]);
    expect(runChecks({ primary: outOfNetwork, documents: [outOfNetwork] }, [uncited])).toEqual([]);
  });

  it("fills the EOB's 'what you may be owed' only for an out-of-network claim", () => {
    const answer = buildAnswer(outOfNetwork, { noSurprises: NO_SURPRISES });
    expect(answer.owed).toHaveLength(1);
    expect(answer.owed[0]?.tileId).toBe("eob-checker");
    expect(answer.owed[0]?.citation).toBe(NO_SURPRISES.citation);
    // An obligation on the plan and provider, never a determination, and never
    // an amount: the Act sets who may bill you, not what care costs.
    expect(answer.owed[0]?.estimate).toBeUndefined();

    expect(buildAnswer(inNetwork, { noSurprises: NO_SURPRISES }).owed).toHaveLength(0);
  });

  it("names every exclusion the shard carries, so the scope is never overstated", () => {
    expect(NO_SURPRISES.exclusions.map((e) => e.id)).toContain("ground-ambulance");
    expect(NO_SURPRISES.protections.length).toBeGreaterThanOrEqual(3);
    // No price anywhere: the Act governs who may bill you, not what care costs.
    // The one dollar figure it carries is the dispute threshold, which is a
    // procedural door, not a benchmark.
    expect(NO_SURPRISES.uninsured.disputeThresholdDollars).toBe(400);
  });
});

describe("Readout v3, the 1099-R's questions (SPEC-5-readout-v3 R2)", () => {
  const CASH_OUT =
    "Form 1099-R 2026 1 Gross distribution $40,000.00 2a Taxable amount $40,000.00 " +
    "4 Federal income tax withheld $8,000.00 7a Dist. code(s) 1 7b IRA/SEP/";
  const ROLLOVER =
    "Form 1099-R 2026 1 Gross distribution $60,000.00 2a Taxable amount $60,000.00 " +
    "4 Federal income tax withheld $0.00 7a Dist. code(s) G 7b IRA/SEP/";

  it("asks whether 20% withheld covers a code 1 distribution, citing §72(t)", () => {
    const a = buildAnswer(extractDocument(typed(CASH_OUT)));
    const flag = a.flags.find((f) => f.checkId === "1099r-early-withholding-short")!;
    expect(flag.kind).toBe("rule");
    expect(flag.question).toMatch(/\?$/);
    expect(flag.detail).toContain("$4,000.00");
    expect(flag.citation?.sourceUrl).toContain("/26/72");
    expect(a.next.some((n) => n.label.includes("60 days"))).toBe(true);
  });

  it("asks why a direct rollover shows a taxable amount", () => {
    const a = buildAnswer(extractDocument(typed(ROLLOVER)));
    expect(a.flags.map((f) => f.checkId)).toContain("1099r-rollover-taxable");
    const clean = buildAnswer(
      extractDocument(
        typed(ROLLOVER.replace("2a Taxable amount $60,000.00", "2a Taxable amount $0.00")),
      ),
    );
    expect(clean.flags.map((f) => f.checkId)).not.toContain("1099r-rollover-taxable");
  });

  it("runs neither question on a scan", () => {
    for (const text of [CASH_OUT, ROLLOVER]) {
      expect(buildAnswer(extractDocument(scanned(text))).flags).toEqual([]);
    }
  });

  it("points an SSA-1099 and a 1098-T at the tools that use them", () => {
    const ssa = buildAnswer(
      extractDocument(
        typed(
          "FORM SSA-1099 - SOCIAL SECURITY BENEFIT STATEMENT 2025 Box 5. Net Benefits for 2025 (Box 3 minus Box 4) $23,500.00",
        ),
      ),
    );
    expect(ssa.owed.map((o) => o.tileId)).toEqual(["social-security-tax"]);
    const t = buildAnswer(
      extractDocument(
        typed(
          "Form 1098-T Tuition Statement 2025 1 Payments received for qualified tuition and related expenses $9,800.00",
        ),
      ),
    );
    expect(t.owed.map((o) => o.tileId)).toEqual(["education-credits"]);
  });
});

/**
 * Regulation F's validation notice (SPEC-5-readout-v3 R8), in the words of
 * CFPB's Model Form B-1. Tier 3: every check is a question, the clock is the
 * notice's own, and nothing says whether the debt is owed.
 */
describe("Readout v3, the debt collection validation notice", () => {
  const NOTICE =
    "North South Group P.O. Box 123456 Pasadena, CA 91111-2222 To: Person A 2323 Park Street " +
    "Reference: 584-345 North South Group is a debt collector. We are trying to collect a debt " +
    "that you owe to Bank of Rockville. We will use any information you give us to help collect the debt. " +
    "Our information shows: You had a Main Street Department Store credit card from Bank of Rockville " +
    "with account number 123-456-789. As of January 2, 2017, you owed: $ 2,234.56 " +
    "Between January 2, 2017 and today: You were charged this amount in interest: + $ 75.00 " +
    "You were charged this amount in fees: + $ 25.00 You paid or were credited this amount " +
    "– $ 50.00 toward the debt: Total amount of the debt now: $ 2,284.56 " +
    "How can you dispute the debt? Call or write to us by August 28, 2020, to dispute all or part of the debt.";
  const windows = EnrollmentWindowsSchema.parse(
    JSON.parse(
      readFileSync(resolve(__dirname, "..", "..", "data", "enrollment-windows-2026.json"), "utf8"),
    ),
  );

  it("reads who claims what, as of when, and the date to dispute by", () => {
    const r = extractDocument(typed(NOTICE));
    expect(r.kind).toBe("collectionsNotice");
    const v = (id: string) => r.fields.find((f) => f.id === id)?.value;
    expect(v("collections-creditor")).toBe("Bank of Rockville");
    expect(v("collections-itemization-date")).toBe("2017-01-02");
    expect(v("collections-owed")).toBe(2234.56);
    expect(v("collections-interest")).toBe(75);
    expect(v("collections-fees")).toBe(25);
    expect(v("collections-paid")).toBe(50);
    expect(v("collections-current")).toBe(2284.56);
    expect(v("collections-dispute-by")).toBe("2020-08-28");
  });

  it("never reads the account number, or anyone's name or address", () => {
    const r = extractDocument(typed(NOTICE));
    const everything = JSON.stringify(r.fields);
    for (const secret of ["123-456-789", "584-345", "Person A", "2323 Park", "P.O. Box"]) {
      expect(everything).not.toContain(secret);
    }
    expect(r.fields.every((f) => f.target === undefined)).toBe(true);
  });

  it("asks whether the amount now follows from the itemization, and stays silent when it does", () => {
    expect(buildAnswer(extractDocument(typed(NOTICE))).flags).toEqual([]);
    const off = buildAnswer(extractDocument(typed(NOTICE.replace("$ 2,284.56", "$ 2,484.56"))));
    const flag = off.flags.find((f) => f.checkId === "collections-itemization-sum")!;
    expect(flag.question).toMatch(/\?$/);
    expect(flag.detail).toContain("$2,284.56");
  });

  it("shows the notice's date as a cited Deadline, with the site's thirty days beside it", () => {
    const a = buildAnswer(extractDocument(typed(NOTICE)), { windows, asOf: "2020-08-01" });
    const first = a.next[0]!;
    expect(first.deadline?.due).toEqual({ on: "2020-08-28" });
    expect(first.deadline?.citation.sourceDocument).toContain("1006.34");
    expect(first.label).toContain("would be 2020-08-31");
    const text = a.next
      .map((n) => n.label)
      .join(" ")
      .toLowerCase();
    expect(text).not.toMatch(/not owed|don't owe|do not owe|is invalid/);
  });

  it("states no clock without the windows that cite it", () => {
    const a = buildAnswer(extractDocument(typed(NOTICE)));
    expect(a.next.some((n) => n.deadline)).toBe(false);
  });

  it("runs no check on a scan, and still gives the clock for review", () => {
    const a = buildAnswer(extractDocument(scanned(NOTICE.replace("$ 2,284.56", "$ 2,484.56"))), {
      windows,
    });
    expect(a.flags).toEqual([]);
    expect(a.next[0]!.deadline).toBeDefined();
  });
});

/**
 * The Part B Medicare Summary Notice (SPEC-5-readout-v3 R6), in the words and
 * figures of CMS's own sample notice.
 */
describe("Readout v3, the Medicare Summary Notice", () => {
  const MSN =
    "Medicare Summary Notice for Part B (Medical Insurance) THIS IS NOT A BILL JENNIFER WASHINGTON " +
    "STREET ADDRESS CITY, ST 12345-6789 Notice for Jennifer Washington Medicare Number 1A23BC4DE56 " +
    "Date of This Notice March 1, 2020 Did Medicare Approve All Services? NO " +
    "Number of Services Medicare Denied 1 Total You May Be Billed $90.15 " +
    "Service Provided & Billing Code Service Approved? Amount Provider Charged Medicare-Approved Amount " +
    "Amount Medicare Paid Maximum You May Be Billed " +
    "Eye and medical examination (92014) Yes $143.00 $107.97 $86.38 $21.59 " +
    "Destruction of skin growth (17000) NO 68.56 0.00 0.00 68.56 A " +
    "Total for Claim #02-10195-592-390 $211.56 $107.97 $86.38 $90.15 B " +
    "We must receive your appeal by: July 13, 2020";
  const windows = EnrollmentWindowsSchema.parse(
    JSON.parse(
      readFileSync(resolve(__dirname, "..", "..", "data", "enrollment-windows-2026.json"), "utf8"),
    ),
  );
  const v = (r: ExtractionResult, id: string) => r.fields.find((f) => f.id === id)?.value;

  it("reads the dashboard, the claim's totals and the appeal date, and nothing that identifies", () => {
    const r = extractDocument(typed(MSN));
    expect(r.kind).toBe("medicareSummaryNotice");
    expect(v(r, "msn-notice-date")).toBe("2020-03-01");
    expect(v(r, "msn-total-may-be-billed")).toBe(90.15);
    expect(v(r, "msn-services-denied")).toBe(1);
    expect(v(r, "msn-claim-1-charged")).toBe(211.56);
    expect(v(r, "msn-claim-1-approved")).toBe(107.97);
    expect(v(r, "msn-claim-1-paid")).toBe(86.38);
    expect(v(r, "msn-claim-1-max")).toBe(90.15);
    expect(v(r, "msn-appeal-by")).toBe("2020-07-13");
    const everything = JSON.stringify(r.fields);
    for (const secret of ["1A23BC4DE56", "WASHINGTON", "Washington", "12345-6789"]) {
      expect(everything).not.toContain(secret);
    }
  });

  it("does not question a maximum that a denied service explains", () => {
    expect(buildAnswer(extractDocument(typed(MSN))).flags).toEqual([]);
  });

  it("asks when nothing was denied and the maximum is above the share", () => {
    const text = MSN.replace(
      "Number of Services Medicare Denied 1",
      "Number of Services Medicare Denied 0",
    );
    const flag = buildAnswer(extractDocument(typed(text))).flags.find(
      (f) => f.checkId === "msn-max-over-share",
    )!;
    expect(flag.detail).toContain("$21.59");
    expect(buildAnswer(extractDocument(scanned(text))).flags).toEqual([]);
  });

  it("holds a provider's bill to the notice's maximum", () => {
    const msn = extractDocument(typed(MSN));
    const bill = extractDocument(
      typed(
        "Itemized Statement 01/21/2020 Eye examination $143.00 01/21/2020 Skin growth $68.56 Total charges $211.56",
      ),
    );
    const flags = buildAnswer(msn, { documents: [msn, bill] }).flags.map((f) => f.checkId);
    expect(flags).toContain("msn-bill-over-max");
    expect(buildAnswer(msn, { documents: [msn] }).flags.map((f) => f.checkId)).not.toContain(
      "msn-bill-over-max",
    );
  });

  it("renders the appeal date as a cited Deadline, checked against 120 days from receipt", () => {
    const a = buildAnswer(extractDocument(typed(MSN)), { windows });
    const step = a.next.find((n) => n.deadline)!;
    expect(step.deadline!.due).toEqual({ on: "2020-07-13" });
    expect(step.deadline!.citation.sourceDocument).toContain("405.942");
    // March 1 + 5 days presumed receipt + 120 days = July 4.
    expect(step.label).toContain("is 2020-07-04");
  });
});

/**
 * The Closing Disclosure (SPEC-5-readout-v3 R7), in the words and figures of
 * CFPB's H-25(B) fixed-rate sample.
 */
describe("Readout v3, the Closing Disclosure", () => {
  const CD =
    "This form is a statement of final loan terms and closing costs. Compare this document with your Loan Estimate. " +
    "Closing Disclosure Closing Information Date Issued 4/15/2013 Closing Date 4/15/2013 " +
    "Settlement Agent Epsilon Title Co. File # 12-3456 Property 456 Somewhere Ave Anytown, ST 12345 " +
    "Sale Price $180,000 Transaction Information Borrower Michael Jones and Mary Stone 123 Anywhere Street " +
    "Seller Steve Cole and Amy Doe Lender Ficus Bank Loan Information Loan Term 30 years Purpose Purchase " +
    "Product Fixed Rate Loan ID # 123456789 MIC # 000654321 Loan Terms Loan Amount $162,000 NO " +
    "Interest Rate 3.875% NO Monthly Principal & Interest $761.78 NO " +
    "Costs at Closing Closing Costs $9,712.10 Includes $4,694.05 in Loan Costs " +
    "Cash to Close $14,147.26 Includes Closing Costs.";
  const v = (r: ExtractionResult, id: string) => r.fields.find((f) => f.id === id)?.value;

  it("reads page 1's loan terms and costs", () => {
    const r = extractDocument(typed(CD));
    expect(r.kind).toBe("closingDisclosure");
    expect(v(r, "cd-loan-amount")).toBe(162000);
    expect(v(r, "cd-rate")).toBe(3.875);
    expect(v(r, "cd-term-years")).toBe(30);
    expect(v(r, "cd-pi")).toBe(761.78);
    expect(v(r, "cd-closing-costs")).toBe(9712.1);
    expect(v(r, "cd-cash-to-close")).toBe(14147.26);
  });

  it("never reads the borrower, seller, property, file number, loan ID or MIC number", () => {
    const everything = JSON.stringify(extractDocument(typed(CD)).fields);
    for (const secret of [
      "Michael",
      "Stone",
      "Steve Cole",
      "Anywhere",
      "Somewhere",
      "12-3456",
      "123456789",
      "000654321",
    ]) {
      expect(everything).not.toContain(secret);
    }
  });

  it("reconciles the sample's payment, and asks when a payment does not", () => {
    // The CFPB's own sample: $162,000 at 3.875% over 30 years is $761.78.
    expect(buildAnswer(extractDocument(typed(CD))).flags).toEqual([]);
    const off = buildAnswer(extractDocument(typed(CD.replace("$761.78", "$811.78"))));
    const flag = off.flags.find((f) => f.checkId === "cd-pi-reconciles")!;
    expect(flag.detail).toContain("$761.78");
    expect(buildAnswer(extractDocument(scanned(CD.replace("$761.78", "$811.78")))).flags).toEqual(
      [],
    );
  });

  it("states the three-business-day rule, as a rule and not a Deadline", () => {
    const a = buildAnswer(extractDocument(typed(CD)));
    expect(a.next.some((n) => n.label.includes("three business days"))).toBe(true);
    expect(a.next.some((n) => n.deadline)).toBe(false);
  });
});

describe("Readout v3, the SSA-1099 against the 1040 (SPEC-5-readout-v3 §3)", () => {
  const SSA =
    "FORM SSA-1099 - SOCIAL SECURITY BENEFIT STATEMENT 2025 Box 5. Net Benefits for 2025 (Box 3 minus Box 4) $23,500.00";
  const RETURN = (line6a: string) =>
    "Form 1040 U.S. Individual Income Tax Return 2025 " +
    `6a Social security benefits . . 6a ${line6a} b Taxable amount . . . . . . 6b 9,800.00 ` +
    "11 Adjusted gross income 52000.00";

  it("reads lines 6a and 6b without taking the box marker for the amount", () => {
    const r = extractDocument(typed(RETURN("23,500.00")));
    expect(r.fields.find((f) => f.id === "f1040-6a")?.value).toBe(23500);
    expect(r.fields.find((f) => f.id === "f1040-6b")?.value).toBe(9800);
  });

  it("asks only when line 6a is short of box 5, and only with both in the session", () => {
    const ssa = extractDocument(typed(SSA));
    const short = extractDocument(typed(RETURN("20,000.00")));
    const ids = (docs: ReturnType<typeof extractDocument>[]) =>
      buildAnswer(docs[0]!, { documents: docs }).flags.map((f) => f.checkId);
    expect(ids([ssa, short])).toContain("ssa1099-on-1040");
    expect(ids([ssa, extractDocument(typed(RETURN("23,500.00")))])).not.toContain(
      "ssa1099-on-1040",
    );
    // A joint return can report more.
    expect(ids([ssa, extractDocument(typed(RETURN("41,000.00")))])).not.toContain(
      "ssa1099-on-1040",
    );
    expect(ids([ssa])).not.toContain("ssa1099-on-1040");
  });
});

/**
 * The Loan Estimate and its zero-tolerance comparison with the Closing
 * Disclosure (SPEC-5-readout-v3 §3), on CFPB's paired samples H-24(B) and
 * H-25(B).
 */
describe("Readout v3, the Loan Estimate against the Closing Disclosure", () => {
  const LE =
    "FICUS BANK Save this Loan Estimate to compare with your Closing Disclosure. Loan Estimate " +
    "LOAN TERM 30 years DATE ISSUED 2/15/2013 APPLICANTS Michael Jones and Mary Stone 123 Anywhere Street " +
    "LOAN ID # 1234567891330172608 PROPERTY 456 Somewhere Avenue Loan Terms Loan Amount $162,000 NO " +
    "Interest Rate 3.875% NO Monthly Principal & Interest $761.78 NO Estimated Cash to Close $16,054 " +
    "A. Origination Charges $1,802 B. Services You Cannot Shop For $672";
  const CD = (a: string, b: string) =>
    "This form is a statement of final loan terms and closing costs. Closing Disclosure " +
    "Loan Term 30 years Loan Amount $162,000 Interest Rate 3.875% Monthly Principal & Interest $761.78 " +
    `Closing Costs $9,712.10 Cash to Close $14,147.26 A. Origination Charges ${a} ` +
    `B. Services Borrower Did Not Shop For ${b}`;
  const v = (r: ExtractionResult, id: string) => r.fields.find((f) => f.id === id)?.value;
  const flags = (cd: string) => {
    const le = extractDocument(typed(LE));
    const c = extractDocument(typed(cd));
    return buildAnswer(c, { documents: [le, c] }).flags.map((f) => f.checkId);
  };

  it("reads the estimate's terms and its sections A and B, and nothing that identifies", () => {
    const r = extractDocument(typed(LE));
    expect(r.kind).toBe("loanEstimate");
    expect(v(r, "le-loan-amount")).toBe(162000);
    expect(v(r, "le-rate")).toBe(3.875);
    expect(v(r, "le-pi")).toBe(761.78);
    expect(v(r, "le-cash-to-close")).toBe(16054);
    expect(v(r, "le-section-a")).toBe(1802);
    expect(v(r, "le-section-b")).toBe(672);
    const everything = JSON.stringify(r.fields);
    for (const secret of ["Michael", "Anywhere", "Somewhere", "1234567891330172608"]) {
      expect(everything).not.toContain(secret);
    }
  });

  it("is silent on the CFPB's own pair, where nothing in A or B rose", () => {
    expect(flags(CD("$1,802.00", "$236.55"))).not.toContain("le-cd-zero-tolerance");
  });

  it("asks, citing §1026.19(e)(3), when A or B rose", () => {
    const le = extractDocument(typed(LE));
    const cd = extractDocument(typed(CD("$2,102.00", "$236.55")));
    const flag = buildAnswer(cd, { documents: [le, cd] }).flags.find(
      (f) => f.checkId === "le-cd-zero-tolerance",
    )!;
    expect(flag.detail).toContain("$1,802.00 on the Loan Estimate, $2,102.00");
    expect(flag.citation?.sourceDocument).toContain("1026.19(e)(3)");
    expect(flags(CD("$1,802.00", "$900.00"))).toContain("le-cd-zero-tolerance");
  });

  it("stays silent with only one of the pair, or on a scan", () => {
    const cd = extractDocument(typed(CD("$2,102.00", "$236.55")));
    expect(buildAnswer(cd).flags.map((f) => f.checkId)).not.toContain("le-cd-zero-tolerance");
    const le = extractDocument(scanned(LE));
    const scannedCd = extractDocument(scanned(CD("$2,102.00", "$236.55")));
    expect(
      buildAnswer(scannedCd, { documents: [le, scannedCd] }).flags.map((f) => f.checkId),
    ).not.toContain("le-cd-zero-tolerance");
  });
});
