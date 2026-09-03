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

/**
 * IRC §32(d). Cited by the EITC tile and by the What Am I Owed screener.
 *
 * The earned income credit's schedule has two columns, joint and everyone else,
 * and both tools ask which with a *married filing jointly* checkbox. Unchecked
 * puts a filer on the "everyone else" column, which is right for a single filer
 * and a head of household and **wrong for married filing separately**: §32(d)(1)
 * says the section applies only if a joint return is filed. There is no third
 * column to move them to, because the answer is not a smaller credit — it is
 * usually no credit at all.
 *
 * Usually, not always, which is why this is a disclosure rather than a rule the
 * engine applies. §32(d)(2)(B) treats a separated spouse as not married, and it
 * turns on facts no figure on this site carries: whether a qualifying child
 * lived with them more than half the year, and whether they shared a home with
 * their spouse in the last six months or hold a §121(d)(3)(C) decree. Computing
 * a $0 for someone who meets that test would be its own wrong answer, in the
 * direction this project cares about most.
 */
export const EITC_JOINT_RETURN_CITATION: CitationData = {
  sourceUrl: "https://www.law.cornell.edu/uscode/text/26/32",
  sourceDocument: "26 U.S.C. §32(d) — earned income credit, married individuals",
  sourceNote:
    "Section 32(d)(1): \"In the case of an individual who is married, this section shall apply only if a joint return is filed for the taxable year under section 6013.\" Section 32(d)(2)(B) is the exception, made permanent by ARPA: an individual is not treated as married if they do not file a joint return, reside with a qualifying child for more than half the year, and either do not share a principal place of abode with their spouse during the last six months of the year, or hold a decree, instrument, or agreement described in section 121(d)(3)(C) and are not a member of the same household by year end. Whether that test is met turns on facts this site does not hold, so the credit is neither computed nor denied for a separated spouse — the condition is named and the reader answers it.",
  effectiveYear: 2026,
  dateRetrieved: "2026-09-03",
};

/**
 * IRC §1091, the wash-sale rule. Cited by the Tax-Loss Harvesting tile and by
 * the Cost-Basis Lot Picker.
 *
 * It lived privately in `taxLossHarvesting.ts`, which was the only tile that
 * named the rule — while the lot picker, whose own "How this works" recommends
 * specific identification "often to harvest losses", showed a realized loss
 * with nothing beside it. That is the tile where a person chooses which shares
 * to sell, so it is the tile where the rule that can disallow the loss belongs.
 *
 * Here rather than in a second private constant, for the reason this module
 * exists: a statute cited from two places must not drift into two versions of
 * itself.
 */
export const WASH_SALE_CITATION: CitationData = {
  sourceUrl: "https://www.irs.gov/publications/p550",
  sourceDocument: "IRS Publication 550, Wash Sales (IRC §1091)",
  effectiveYear: 2026,
  dateRetrieved: "2026-05-29",
};
