# SPEC-5 companion — The Month After a Layoff

> The three money decisions a job loss forces, for [SPEC-5.md](SPEC-5.md) §2.1 and Phase 28. Adopted 2026-10-19. Statutory anchors are leads to verify during sourcing; the dollar figures quoted are the published 2026 ones and none enters a shard on this document's authority.

The job-loss sequence in [`data/life-events-2026.json`](../../data/life-events-2026.json) already orders the month: file the unemployment claim, decide on COBRA inside the election window, check the Marketplace special enrollment period, recheck income against the benefits screener, triage the bills, watch the Part B clock. Two of its steps point at a decision the site cannot compute. *Decide on COBRA* links to the Health Plan Chooser, which compares two plans' terms and knows nothing about the premium tax credit that is the whole reason the Marketplace can be cheaper. The retirement-account step can only say *do not cash out without seeing the cost*, because nothing shows the cost. And the unemployment estimator shows the gross weekly benefit, which is not what arrives.

## Build index

| # | Tile id | Hub | Engine module | Phase | Tier |
| --- | --- | --- | --- | --- | --- |
| J1 | `retirement-cash-out` | `retirement` | `engine/earlyDistribution.ts` | 28 | 2 |
| J2 | `cobra-vs-marketplace` | `protection` | `engine/benefits.ts` (the ACA functions) | 28 | 2 |
| J3 | (enhancement to `ui-estimator`) | `when-money-is-tight` | `engine/stateUi.ts` + the tax engine | 28 | existing |
| J4 | (enhancement to `w4-withholding`) | `paycheck-taxes` | the tax engine | 28 | — |

---

### J1 · Cashing Out a 401(k) — **Tier 2** · Phase 28

**Answers:** "If I take the money out now, what do I actually get, what do I owe in April, and what did it cost me?"

**Deterministic core.** Four figures, each from a cited rule or the existing engine:

1. **What arrives.** An eligible rollover distribution paid to the participant has 20% federal income tax withheld, mandatorily (IRC §3405(c)). The check is 80% of the balance, before any state withholding.
2. **What is owed.** The distribution is ordinary income, stacked on the year's other income through the federal and state engines at the reader's filing status and state, so the marginal cost is the real one rather than the 20% the withholding implies. Plus the **10% additional tax** on an early distribution (IRC §72(t)(1)) unless an exception applies.
3. **The exceptions, as a checklist the reader ticks, never as inference.** Separation from service in or after the year the reader turns 55 (50 for qualified public-safety employees), §72(t)(2)(A)(v), the one most laid-off readers over 55 do not know they have; a series of substantially equal periodic payments, §72(t)(2)(A)(iv); the $1,000 emergency personal expense distribution once a calendar year, §72(t)(2)(I), repayable within three years; disability; unreimbursed medical expenses over the §213 floor; a qualified domestic relations order; and the SECURE 2.0 domestic-abuse and terminal-illness exceptions. The tile applies whichever the reader ticks and names Form 5329.
4. **The balance due at filing.** The real tax plus the additional tax, less the 20% withheld. For most readers this is positive, and it is the number that turns a $20,000 withdrawal into a $7,000 bill in April.

Then the 60-day clock: a distribution rolled into an IRA or a new plan within 60 days of receipt is not taxed (IRC §402(c)(3)(A)), but the 20% withheld must be made up from other money to roll the whole amount, or the withheld part is itself taxed and penalized. The tile renders the clock as a `Deadline` (`rollover-60-day`, [SPEC-5.md](SPEC-5.md) §7.4) from a receipt date the reader enters, and names the direct rollover, which skips both the withholding and the clock, as the route the notice the plan sent them describes (the §402(f) notice).

And one labeled assumption: what the same balance would be at the reader's chosen age at a rate they supply, through the compound-growth engine, shown beside the cash so the cost of the withdrawal is the sum the reader sees, not a lecture.

**Data.** `early-distribution-2026`: the 20% withholding rate, the 10% additional tax, the 60-day window, the age-55 and age-50 separation ages, the $1,000 emergency amount and its repayment window, the exception list with each paragraph cited. Statutory; watched at the Code on source-watch; `staleAfterYears: 1`.

**Harm tier.** Tier 2: the output shapes a decision with a clock on it, so every consequence renders beside the figure (the April bill, the withheld 20% the reader must replace to roll over, the lost growth), and the advice line names the plan's own §402(f) notice and a tax professional for an exception the checklist does not cover. The tile never says "don't", which the dignity sweep enforces; it says what each path costs.

**Done when.** A golden case at 40 where the balance due at filing exceeds the 20% withheld; a case at 56, separated this year, where the additional tax is zero by §72(t)(2)(A)(v); the $1,000 emergency case; the 60-day window renders through `renderDeadline` from the entered date; the growth line carries the assumption hint when the rate is outside the defensible band; the job-loss sequence's retirement step links here.

---

### J2 · COBRA or the Marketplace? — **Tier 2** · Phase 28

**Answers:** "The COBRA letter says $1,900 a month. Is the Marketplace cheaper once the credit is applied?"

**Deterministic core.** The COBRA premium is whatever the election notice says, which the law caps at 102% of the plan's full cost (IRC §4980B(f)(2)(C); 29 U.S.C. §1162(3)), or 150% during a disability extension; the reader enters it. The Marketplace side is the benchmark premium the reader looks up on HealthCare.gov, exactly as the ACA Premium Tax Credit tile already asks, less `estimatePremiumTaxCredit` at the household's **projected income for the year**, which after a layoff is lower than the W-2 that was and is the figure the credit is computed on. The tile shows both monthly costs, the annual difference, and the credit line cited through the ACA shard.

Then the clocks and the one-way doors, from the enrollment-windows shard the life-event sequence already uses: the COBRA election window (`cobra-election`), the first-premium and grace clocks, and the 60-day Marketplace special enrollment period (`aca-special-enrollment`) that opens when job-based coverage ends. The door that matters: voluntarily dropping COBRA mid-term does **not** open a special enrollment period, but the end of the COBRA period does, and so does open enrollment; and electing COBRA does not pause the Medicare Part B clock for a reader over 65 (`medicare-part-b-sep`). All four render through `renderDeadline` from the coverage-end date the reader enters.

**Data.** `separation-rules-2026` for the 102% and 150% ceilings; the ACA and FPL shards for the credit; the enrollment-windows shard for the clocks.

**Harm tier.** Tier 2: the comparison shapes a coverage decision and its consequences render with it. The advice line states what the tile does not compare: the plans' terms. A Marketplace plan starts its deductible at zero mid-year where the COBRA plan keeps the deductible already met, the provider networks differ, and the Health Plan Chooser is the tool for that half, linked as the next step with the premium difference carried over.

**Limits.** The reader supplies the benchmark premium (the per-county dataset is the one figure the site does not bundle, by the decision in SPEC-2 Phase 6). Income is a projection the reader makes and the credit reconciles on Form 8962; for 2026 and after there is no cap on repaying an excess credit (IRC §36B(f)(2)(B), repealed by Pub. L. 119-21 §71305), which the tile says in one line because it changes how cautious the projection should be.

**Done when.** A golden case where the credit flips the answer; the four windows render as `Deadline`s from the entered date; the one-way-door sentences are present and the dignity sweep passes; the job-loss sequence's COBRA step links here; the credit line's citation is the ACA shard's.

---

### J3 · What the Unemployment Check Nets — Phase 28 · enhancement to `ui-estimator`

**Answers:** "Is the weekly benefit taxed, and what should I have them hold back?"

Unemployment compensation is gross income federally (IRC §85), and the reader may elect 10% federal withholding on Form W-4V (IRC §3402(p)(2)) and nothing else. The estimator gains a *net of taxes* reading: the weekly benefit less 10% if the reader elects it, the projected federal and state tax on the year's benefits through the tax engine at the household's situation, and the gap between the two that becomes April's bill when no withholding is elected. State treatment is per-state data, not a federal rule: California, New Jersey, Pennsylvania and Virginia exempt benefits, most states tax them, and some offer their own voluntary withholding. So each `state-ui-<st>-2026` shard gains two fields, `benefitsTaxedByState` and `stateWithholdingOffered`, read off the agency's own page in the same sourcing pass as its formula, and a state whose shard does not yet carry them renders the federal half only and says so, by the rule the estimator already uses for a state with no rule set.

**Data.** `separation-rules-2026` for §85 and the W-4V rate; the per-state fields as each shard is read.

**Done when.** The net line is exact through `Money`; the state line renders only where the shard carries the field; the April-gap line reads "if you elect no withholding" rather than assuming; a state with no field says "state treatment not yet read for this state".

---

### J4 · Severance and the Bonus Check — Phase 28 · enhancement to `w4-withholding`

**Answers:** "Why was 22% taken out of my severance, and will I owe more or get it back?"

Severance, a bonus, and accrued vacation paid out at separation are supplemental wages. Paid separately from regular wages, an employer may withhold a flat 22% (optional, below $1,000,000 for the year) and must withhold 37% on the excess over $1,000,000 (IRC §3402(g); Treas. Reg. §31.3402(g)-1; Pub. 15 §7). The W-4 Withholding & Refund Check already compares withholding to the engine's projected tax; it gains an *extra pay* mode that adds the supplemental payment to the year's income, applies the flat rate as withheld, and shows whether 22% was more or less than the payment's real marginal cost, which is the whole answer to "will I owe more". The tile says plainly that the 22% is a withholding rate and not a tax rate, the sentence most readers have never been told.

**Data.** `separation-rules-2026` for the two supplemental rates, read annually from Pub. 15 through the IRS adapter (the rates track the third and top brackets, which Pub. L. 119-21 made permanent, so they are expected to hold but are read each December regardless).

**Done when.** A golden case where 22% under-withholds at a high marginal rate and one where it over-withholds at a low one; the $1,000,000 threshold applies to the year's cumulative supplemental wages; the mode rides the permalink.

---

## What the sequence looks like after Phase 28

The job-loss sequence in the life-events shard gains `tileId` links at two steps and no new clock, since every clock it needs already exists:

| Step | Before | After |
| --- | --- | --- |
| `cobra-decide` | → Health Plan Chooser | → COBRA or the Marketplace?, then the Health Plan Chooser for the terms |
| retirement account | prose only | → Cashing Out a 401(k) |
| `ui-claim` | → the unemployment estimator | unchanged; the estimator now shows the net |

A test already asserts every `tileId` in the shard names a tool that exists; both new ids are covered the day they land.
