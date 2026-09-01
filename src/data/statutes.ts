/**
 * Hand-authored statutory citations — the ones that carry no numbers.
 *
 * A dataset shard exists to carry figures that change (a bracket, a limit, a
 * poverty line), and it is hashed and refreshed on a schedule because of that.
 * A statute that imposes an *obligation* has nothing to tabulate: §501(r)(4)
 * either requires a written financial assistance policy or it does not. The repo
 * already treats a hand-authored statutory citation without a `contentHash` as
 * correct (SPEC-3-hardening §C3); this module is where those live so a statute
 * cited from two places cannot drift into two versions of itself.
 */
import type { CitationData } from "./schemas";

/**
 * IRC §501(r)(4). Cited by the charity-care screener and by the Readout's
 * "what you may be owed" answer for an itemized medical bill.
 */
export const HOSPITAL_FAP_CITATION: CitationData = {
  sourceUrl:
    "https://www.irs.gov/charities-non-profits/financial-assistance-policy-and-emergency-medical-care-policy-section-501r4",
  sourceDocument: "IRS, Financial assistance policy — IRC §501(r)(4)",
  sourceNote:
    "Section 501(r)(4) requires every 501(c)(3) hospital facility to establish a written financial assistance policy covering all emergency and other medically necessary care, to state its eligibility criteria and whether assistance is free or discounted, and to widely publicize it — including making paper copies available on request, without charge, in the emergency room and admissions areas.",
  effectiveYear: 2026,
  dateRetrieved: "2026-08-28",
};

/**
 * The IRS instruction that gives W-2 box 14b its meaning.
 *
 * Cited rather than restated because the rule is one sentence and the whole
 * weight of the Readout check that uses it rests on that sentence: "If any tips
 * were received in a nonqualifying occupation, then '000' must be input as one
 * of the occupation code(s)." That is the document telling us, in the
 * employer's own hand, that some of the tips beside it fall outside IRC §224 —
 * the one thing about a tips figure that no amount can say.
 *
 * The occupation list itself (IRS.gov/TippedOccupations) is deliberately NOT
 * bundled: it is a Treasury list that changes by notice, and a stale copy would
 * let this site tell someone their occupation does not qualify when it does.
 * The check reads only the code the employer wrote, and only the one code whose
 * meaning the instructions state.
 */
export const TIPPED_OCCUPATION_CITATION: CitationData = {
  sourceUrl: "https://www.irs.gov/pub/irs-pdf/iw2w3.pdf",
  sourceDocument: "IRS, General Instructions for Forms W-2 and W-3 (Rev. 1-2026), box 14b",
  sourceNote:
    "Box 14b, new for tax year 2026, carries the Treasury Tipped Occupation Code(s) when cash tips are reported in box 12 with code TP. Up to two codes are entered, based on the occupations the tips were received in, and the instructions require that \"if any tips were received in a nonqualifying occupation, then '000' must be input as one of the occupation code(s).\" The deduction itself is IRC §224, which reaches only tips received in an occupation that customarily and regularly received tips before 2025, as published by the Secretary.",
  effectiveYear: 2026,
  dateRetrieved: "2026-09-01",
};
