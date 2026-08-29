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
