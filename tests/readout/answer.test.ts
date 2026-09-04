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
import type { ExtractionResult } from "../../src/readout/types";
import { NoSurprisesSchema, type NoSurprisesData } from "../../src/data/schemas";
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
      sourceUrl: "https://www.cms.gov/medical-bill-rights",
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
      sourceUrl: "https://www.cms.gov/medical-bill-rights",
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
    expect(answer.owed).toHaveLength(1);
    expect(answer.owed[0]?.tileId).toBe("charity-care");
    expect(answer.owed[0]?.citation.sourceDocument).toContain("501(r)(4)");
    // An obligation on the hospital, never a determination about this household.
    expect(answer.owed[0]?.estimate).toBeUndefined();
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
