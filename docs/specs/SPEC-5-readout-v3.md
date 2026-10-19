# SPEC-5 companion — Readout v3: the forms these households hold

> Extends the Readout from the 13 document kinds of SPEC-2 §2.1 and SPEC-4-readout-v2 §3 to the standardized forms a retiree, a new parent, a homebuyer, and a laid-off worker actually hold, for [SPEC-5.md](SPEC-5.md) §2.4 and Phase 32. Adopted 2026-10-19. The determinism, anchoring, confirmation, and four-part-answer rules of SPEC-2 §2.2 and SPEC-4-readout-v2 §2 are unchanged and non-negotiable.

## 1. The admission rule for a document kind

SPEC-4-readout-v2 §3 left five kinds *unscheduled* because each "needs its own extractor validation against real document layouts before it earns a phase." That is the rule this wave applies, and it is why every kind below is a **standardized form with a published model**: a federal information return with numbered boxes, a Social Security document SSA issues from one template, a CMS notice with a fixed layout, a Bureau form with a model in an appendix to a regulation. A document a hospital or an employer designs for itself (the EOB, the itemized bill, the pay stub) is read on captions every issuer uses and no more; a document with a model form is read on its boxes and pinned to the model's revision, the way a W-2 is.

Three of the five unscheduled kinds qualify under that rule and are scheduled here: `collectionsNotice` (the Regulation F model validation notice, mandatory in substance since November 30, 2021), `closingDisclosure` (the TRID form, fixed since October 2015), and, in its Medicare form, the EOB's sibling the `medicareSummaryNotice`. The 401(k) statement with its fee disclosure (ERISA §404(a)(5) prescribes content, not a layout), the insurance declarations page, and the property tax bill stay unscheduled for the reason they were.

## 2. New document kinds

| # | Kind | Model | Extract | The answer it enables | Phase |
| --- | --- | --- | --- | --- | --- |
| R1 | `ssa1099` — Form SSA-1099, Social Security Benefit Statement | SSA, one template, revised annually | Box 3 benefits paid, box 4 repaid, box 5 net, box 6 voluntary withholding, the Medicare premiums deducted (the description block) | What this says: the net benefit and what was withheld. What you may be owed: the taxable share through the Social Security Taxation tile. Next: nothing dated; the SSA-1042S variant is flagged as unrecognized | 32a |
| R2 | `form1099r` — distributions from pensions, IRAs, 401(k)s | IRS, numbered boxes | Box 1 gross, 2a taxable, 2b "taxable amount not determined", 4 federal withheld, 7 distribution code, the IRA/SEP/SIMPLE checkbox | What this says: what was distributed and what the code means (an early distribution, a rollover, a Roth conversion, a death benefit). What looks wrong: a code 1 with no exception alongside box 4 at 20% is the April bill J1 computes; a code G with box 2a non-zero is worth a question. Next: the 60-day clock when the code and dates imply a rollover still possible | 32a |
| R3 | `form1099g` — unemployment compensation, state refunds | IRS, numbered boxes | Box 1 unemployment compensation, box 2 state refund, box 4 federal withheld, box 11 state withheld | What this says: the year's benefits and withholding. What you may be owed: nothing; what you may **owe** is the J3 gap, shown with the same honesty. Target: `unemploymentCompensationAnnual` | 32a |
| R4 | `ssaStatement` — the Social Security Statement | SSA, the 2021 redesign, one template | The monthly estimate at each claiming age from 62 to 70 in the "Personal Monthly Retirement Benefit Estimates" bar, the disability and survivor estimates, the earnings record's last year, the "if you stop working" assumption | What this says: the full-retirement-age estimate is the primary insurance amount in today's dollars, which is the one figure the claiming, spousal and earnings-test tiles start from. Target: `socialSecurityPia`. Next: nothing dated | 32a |
| R5 | `form1098t` and `form1098e` — tuition and student-loan interest | IRS, numbered boxes | 1098-T box 1 payments received, box 5 scholarships, the half-time and graduate checkboxes; 1098-E box 1 interest | The education-credit tile's expense input and the §221 deduction line. Today these are only **disambiguated** from a mortgage 1098 and dropped; they become read | 32a |
| R6 | `medicareSummaryNotice` — the Medicare Summary Notice (Original Medicare) | CMS, quarterly, fixed layout | Per claim: provider, service dates, amount charged, Medicare-approved amount, Medicare paid, "maximum you may be billed", claim approved or denied, the notice date | The EOB's four checks, re-anchored on CMS's captions: the plan-math check becomes approved-minus-paid against "maximum you may be billed"; a denied claim surfaces the redetermination route. Next: 120 days from the notice date to request a redetermination (42 CFR §405.942), as a `Deadline` (`medicare-summary-appeal`) | 32b |
| R7 | `closingDisclosure` — the TRID Closing Disclosure, with the Loan Estimate | 12 CFR §1026.38, model form H-25; §1026.37, H-24 | Page 1: loan amount, rate, term, monthly principal and interest, cash to close; page 2: the itemized closing costs by section (A through H) with the borrower-paid column; page 3: the calculating-cash-to-close table, which restates the Loan Estimate's figures beside the final ones | What this says: the loan the reader is signing, fed into the amortization tile as confirmed inputs. What looks wrong: the P&I does not reconcile with the loan engine at the stated rate and term; a Loan Estimate figure moved in a category that may not move (§1026.19(e)(3)(i), zero tolerance), or the 10% cumulative category moved by more than 10% (§1026.19(e)(3)(ii)), each phrased as a question to ask at or before the closing table. Next: the three-business-day receipt rule (§1026.19(f)(1)(ii)) stated, not a `Deadline`, since the trigger is the lender's delivery and not a date on the form | 32b |
| R8 | `collectionsNotice` — the Regulation F validation notice | 12 CFR §1006.34, Model Form B-1 | The debt collector and the creditor, the itemization date and which of the five permitted dates it is, the amount on that date, interest and fees and payments since, the current amount, and **the validation-period end date** the form must print | What this says: who claims what, as of when. What looks wrong: an itemization date that is none of the five permitted dates; interest and fees that do not reconcile to the current amount. What to do next: dispute in writing before the end date, which renders as a `Deadline` (`collections-validation`) read off the form and checked against 30 days from an assumed receipt; the garnishment screener for what a judgment could reach; the CFPB complaint route and state legal aid as channels | 32b |

R8 is **Tier 3** in the Readout's own terms: every rule check it runs is a question, it never says a debt is not owed, and its "what to do next" names free channels only. The benefits-notice precedent (Phase 22) applies: the clock is read off the notice and shown for review; the site's own 30-day computation is a cross-check that renders as "the form says X; thirty days from receipt would be about Y", never as the figure.

## 3. Cross-checks, in the registry

Each is a `CheckDefinition` in [`src/readout/checks.ts`](../../src/readout/checks.ts) with `appliesTo` naming both kinds, fires only when both are present in the session, declares its false-positive case, and phrases a mismatch as a question naming who to ask.

| Pair | What it asks | Kind | Citation |
| --- | --- | --- | --- |
| Pay stub × W-2 | Does the final stub's year-to-date federal withholding reconcile with box 2, and the YTD 401(k) with box 12 code D? | arithmetic | none |
| 1095-A × 1040 | Was the advance credit reconciled on Form 8962 against the income the return reports, and (for 2026 and after) is the household aware there is no cap on repaying an excess (IRC §36B(f)(2)(B), repealed)? | rule | the ACA shard |
| SSA-1099 × 1040 | Does box 5 appear on line 6a, and is the taxable share on 6b consistent with the IRC §86 computation at the return's other income? | plan-math | the Social Security taxation shard |
| Closing Disclosure × Loan Estimate | Which charges moved, and was each in a category permitted to move by the amount it did? | rule | 12 CFR §1026.19(e)(3), transcribed into a small `trid-tolerances` block in the no-surprises shard's sibling or its own shard, cited and watched |
| Medicare Summary Notice × provider bill | Does the provider's bill exceed "maximum you may be billed"? | plan-math | none; the MSN's own figure is the standard |

The last is the Medicare form of the EOB × medical-bill cross-check, which SPEC-4 called the single most valuable one on the list; it reaches the household most likely to receive a bill it should not pay.

## 4. The two targets, and nothing else

`ReadoutTarget` widens by exactly `socialSecurityPia` (R4) and `unemploymentCompensationAnnual` (R3), per [SPEC-5.md](SPEC-5.md) §7.2. Every other field above is **informational**: shown for review, fed into the tile that uses it by the confirmed-field path the 1099-B's realized gain already takes, never written to the profile. The SSA-1099's box 5, the 1099-R's gross distribution, and the Closing Disclosure's loan terms are each the kind of figure a tile takes as its own input, and the narrowness of the target set remains the safety property SPEC-4 §8 Phase 22a recorded.

## 5. Constraints that do not bend

1. **Anchored extraction, pinned to a model revision.** The SSA-1099 and the IRS forms carry a year; the Statement carries its redesign; the MSN its CMS form revision; the Closing Disclosure its H-25 version; the validation notice its B-1 version. An unrecognized revision is flagged, never guessed.
2. **Confirmation before use**, as today.
3. **OCR suppresses every rule check**, which for R8 means a photographed collections letter yields "what this says" and the clock for review and nothing that could be read as "this debt is invalid."
4. **Nothing persists.** The Closing Disclosure is the most sensitive document the site will ever read, with the reader's name, address and loan number on page 1; the extractor reads the figures and the page-1 identifiers are never extracted at all, which a test asserts by fixture.
5. **Every clock is a `Deadline`** from the enrollment-windows shard, cited, through `renderDeadline`.

## 6. Acceptance criteria

1. Every extractor in §2 is revision-pinned and has a golden fixture, including the negative fixture (an SSA-1042S is not an SSA-1099; a 1098 mortgage statement is not a 1098-T).
2. Every check in §3 declares its false-positive case and fires only with both kinds present; the registry test rejects an empty one.
3. The two targets are written only by R3 and R4, pinned by test; no other new field carries a target.
4. The `collections-validation` and `medicare-summary-appeal` windows render through `renderDeadline` with their citations, and the validation-notice end date is shown as the form's figure with the site's computation as a cross-check.
5. The page-1 identifiers of a Closing Disclosure and the account number on a validation notice are never extracted, asserted by fixture.
6. OCR-sourced text runs zero rule checks on every new kind.
