/**
 * Citations only the Readout's checks use. Here rather than in
 * `data/statutes.ts`, which the shell loads, so they travel in the Readout's
 * own chunk.
 */
import type { CitationData } from "../data/schemas";

/**
 * IRC §72(t) and §3405(c), for the Readout's 1099-R (SPEC-5-readout-v3 R2): a
 * code 1 distribution owes a 10% additional tax that the 20% the payer must
 * withhold was never sized to cover.
 */
export const EARLY_DISTRIBUTION_WITHHOLDING_CITATION: CitationData = {
  sourceUrl: "https://www.law.cornell.edu/uscode/text/26/72",
  sourceDocument: "26 U.S.C. §72(t)(1) additional tax; §3405(c)(1) mandatory withholding",
  sourceNote:
    'Section 72(t)(1): the tax "shall be increased by an amount equal to 10 percent of the portion of such amount which is includible in gross income", unless an exception applies. Section 3405(c)(1)(B): on an eligible rollover distribution, "the payor of such distribution shall withhold from such distribution an amount equal to 20 percent". The withholding is a prepayment of income tax; nothing sets it to cover the additional tax as well. Read on Cornell LII 2026-10-19.',
  effectiveYear: 2026,
  dateRetrieved: "2026-10-19",
};

/**
 * The 1099-R instructions on reporting a direct rollover, for the Readout's
 * code G question (SPEC-5-readout-v3 R2).
 */
export const DIRECT_ROLLOVER_REPORTING_CITATION: CitationData = {
  sourceUrl: "https://www.irs.gov/pub/irs-pdf/i1099r.pdf",
  sourceDocument: "IRS, Instructions for Forms 1099-R and 5498 (2026), Direct Rollovers",
  sourceNote:
    'The instructions: "Report a direct rollover in box 1 and a -0- (zero) in box 2a, unless the rollover is a direct rollover of a qualified rollover contribution other than from a designated Roth account", and enter code G. The exception the same page names is a direct rollover into a designated Roth account in the same plan, which reports "the taxable amount in box 2a" with code G. Read 2026-10-19.',
  effectiveYear: 2026,
  dateRetrieved: "2026-10-19",
};
