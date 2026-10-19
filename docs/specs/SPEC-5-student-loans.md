# SPEC-5 companion — Federal Student Loans, un-parked

> For [SPEC-5.md](SPEC-5.md) §2.5 and Phase 33. Adopted 2026-10-19. The un-park gate SPEC-4 §9 set is kept and made mechanical; the tool ships only when it passes. Statutory anchors are leads to verify during sourcing; the figures quoted are the published ones and none enters a shard on this document's authority.

## 1. Why it was parked, and what moved

SPEC-3 §4.10 parked an income-driven repayment comparison because "the federal plan landscape is still shifting," and SPEC-4 §9 kept it parked with a gate: *one full academic year of stability, each plan's formula pinned to a citable published table.* Both were right. Between 2023 and 2025 the SAVE plan was created by regulation, enjoined by a court, and left in forbearance, and a payment computed under it would have been wrong in a harmful way within months.

The One Big Beautiful Bill Act (Pub. L. 119-21, Title VIII, enacted July 4, 2025) ended the shifting by statute rather than regulation:

- It added the **Repayment Assistance Plan (RAP)** to the Higher Education Act (20 U.S.C. §1087e(q)) with its formula written in the section, and made it available from **July 1, 2026**. The Department opened enrollment on that date.
- It replaced the standard plan for loans made on or after July 1, 2026 with a **new Standard plan** whose term is set by balance (§1087e(d), as amended).
- It repealed the authority for income-contingent repayment, so **SAVE, PAYE and ICR end**, with existing borrowers on them to be moved by **July 1, 2028**. Legacy income-based repayment (IBR, §1098e) continues for loans made before July 1, 2026.
- It ended Grad PLUS for new borrowers and set new annual and aggregate limits, which the College Cost Planner should state.

A formula in a statute with an effective date is the citable published table the gate asked for. The "full academic year" half of the gate is the part this spec keeps: the tool ships when the Department's published RAP terms and the statute agree on every parameter on the day the shard is sourced, and that agreement is recorded in the shard. If they do not agree, the shard does not ship and the tile waits, exactly as Phase 21 waited on Direct File.

## 2. The tool

### S1 · Federal Student Loan Payment — **Tier 2** · Phase 33 · Borrowing & Debt hub

**Answers:** "What will my payment be on each plan I can choose, and what will I pay in total?"

**Deterministic core, three modes, each a cited formula:**

**RAP** (§1087e(q)). The annual payment is a percentage of adjusted gross income by tier: AGI of $10,000 or less pays $120 a year ($10 a month); above that, 1% of AGI for AGI up to $20,000, 2% up to $30,000, and one point more for each $10,000 of AGI, to 10% above $100,000; less **$50 a month for each dependent**, never below the $10 floor. Two features change the total paid and must render: **unpaid interest is waived** after an on-time payment, so the balance never grows; and the Department **matches principal** so the balance falls by at least $50 a month when the payment does not cover that. Forgiveness after **360 qualifying payments** (30 years). Married filing jointly uses joint AGI; the tile says the separate-return treatment is the Department's to state and links the page. Parent PLUS loans and consolidations that repaid them are not eligible.

**New Standard** (§1087e(d)(1)(A), as amended, for loans made on or after July 1, 2026). A fixed payment over a term set by the total balance: 10 years under $25,000; 15 years from $25,000 to under $50,000; 20 years from $50,000 to under $100,000; 25 years at $100,000 and above. The payment is the amortization engine's, which the site already golden-tests.

**Legacy IBR** (§1098e), for loans made before July 1, 2026 and the borrower's choice until 2028. 15% of discretionary income (AGI less 150% of the poverty line for the family size, from the FPL shard the site already draws) for a borrower who was not new on July 1, 2014, and 10% for one who was; capped at the 10-year standard payment; forgiveness after 25 or 20 years respectively. The statute wrote the percentages and the tile reads the poverty line from the shard it already has.

The tile shows, for each plan the reader says they are eligible for, the monthly payment now, and the total paid and the year the balance ends under a stated assumption of income growth (a labeled assumption, defaulting to 0%, with the assumption hint when it leaves the defensible band). It never names a plan as the choice.

**A borrower on an ending plan.** A reader who says they are on SAVE, PAYE or ICR is shown no payment under that plan. They are shown the `idr-transition-2028` window as a `Deadline` with its citation, the two plans available after it, and the Department's page.

**Two cited lines beside the result.**

- **The student-loan interest deduction** (IRC §221): up to $2,500 of interest paid, phased out over the MAGI range the annual revenue procedure indexes, taken above the line, so it is a line the Federal Income Tax tile's adjustments could carry and this tile shows with the deduction's worth at the reader's marginal rate through the engine.
- **Employer payments under §127**: up to $5,250 a year of an employer's student-loan payments excluded from income, made permanent by Pub. L. 119-21 §70412 and indexed after 2026. Informational; the reader's employer either offers it or does not.

**Forgiveness is income after 2025.** The exclusion in IRC §108(f)(5) for discharged student debt expired for discharges after December 31, 2025; the death-and-disability exclusion was made permanent. The tile states, beside any forgiveness year it projects, that the forgiven balance is taxable income under current law unless Congress acts, and that the amount depends on a balance decades away. It does not compute that tax, which would be a forecast of two unknowns.

**Data.** `student-loans-2026`: the RAP tier table, floor, dependent reduction, principal match and payment count; the Standard term breakpoints; the IBR percentages, poverty multiple, caps and payment counts; the new annual and aggregate loan limits for the College Cost Planner's note; the §221 cap and phase-out; the §127 cap; the 2028 transition date; and a `sourceNote` recording the gate: the statute URL, the Department's plan page URL, and the date each parameter was found to agree. Watched on source-watch at both; the §221 phase-out through the IRS adapter. `staleAfterYears: 0`.

**Harm tier.** Tier 2: the output shapes a plan choice that is hard to reverse (a borrower who leaves IBR may not return to it), so the consequences render beside each plan: the total paid, the forgiveness year and its tax, the interest-waiver on RAP, the one-way doors. The advice line names the Department's own loan simulator and the servicer, and says that the Department determines eligibility and the servicer applies the terms.

**Limits, on-screen.** Public Service Loan Forgiveness is named and not computed (it is a count of qualifying payments under qualifying employment, both the Department's to certify). Private loans are out of scope. Consolidation effects on payment counts are stated as the Department's rule to apply. The tile computes a payment from the figures the reader enters and the formulas the statute writes, and nothing it does not.

**Done when.** The gate is recorded in the shard. Golden cases: RAP at $9,000, $10,001, $20,000, $55,000 and $120,000 of AGI with zero and two dependents, proving the tiers, the floor and the reduction; a RAP case where the payment is below the month's interest and the balance still falls by $50; the Standard term at each breakpoint; an IBR case at both percentages against the 10-year cap; a SAVE borrower sees the 2028 window and no SAVE payment. The tool never names a plan as the choice, by copy test. `checkHarmTier` and the dignity sweep pass.

## 3. What this is not

- **Not a comparison of the ending plans.** A SAVE or PAYE payment is a number with a statutory expiry, and the site does not show numbers that will be wrong on a date it can see.
- **Not a forgiveness-tax estimate.** Two unknowns decades out.
- **Not a PSLF tracker.** Qualifying payments and qualifying employment are the Department's to certify.
- **Not advice on which plan.** Each eligible plan's payment and total, side by side, with the doors named.

## 4. The un-park gate, as a check

The sourcing step for `student-loans-2026` writes, into the shard's `sourceNote`, for each parameter: the statutory section, the Department page, and *agree* or *differ*. A `differ` on any parameter fails the shard's own test, and the tile does not ship. This is Phase 21's `omitted` block and Phase 23b's `upcomingChanges` block applied to the question "is this rule settled," which is the question the park was about.
