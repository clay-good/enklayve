# SPEC-5 companion — The Young Family

> The catalog for [SPEC-5.md](SPEC-5.md) §2.3. Adopted 2026-10-19. Statutory anchors are leads to verify during the phase's sourcing step; the dollar figures quoted are the ones found published while this was written and none enters a shard on this document's authority.

The site already computes the Child Tax Credit, the EITC with its qualifying-child count, the education credits, the child-tax (kiddie tax) stack, the §530A account, the college cost planner and the FAFSA estimate. What it does not compute is the single largest recurring cost of a household with a child under 13: care while the parents work. The credit for it was rewritten by the One Big Beautiful Bill Act for tax years beginning in 2026 into a shape no consumer tool shows, the FSA it competes with had its limit raised for the first time since 1986, and the question the two of them decide together (does the second income clear the cost of the childcare it requires?) is a benefit-cliff question the Cliff Explorer already knows how to ask and does not.

## Build index

| # | Tile id | Hub | Engine module | Phase | Tier |
| --- | --- | --- | --- | --- | --- |
| F1 | `dependent-care` | `benefits` | `engine/dependentCare.ts` | 31 | 1 |
| F3 | `second-income` | `benefit-cliffs` | `engine/cliffs.ts` | 31 | 1 |
| F4 | (screener rows, no tile) | `benefits` | `engine/benefits.ts` | 31 | — |
| F5 | (data only, no tile) | `benefits` | — | 31 | — |

F2, the FSA comparison, is a second output of F1 rather than a tile of its own, for the reason the four Safe Harbor readings became one Peace of Mind dashboard: the two routes share every input.

---

### F1 · Child & Dependent Care Credit, and the FSA — **Tier 1** · Phase 31

**Answers:** "How much of what we pay for childcare comes back at tax time, and should we use the FSA at work instead?"

**Deterministic core, the credit.** IRC §21 as amended by Pub. L. 119-21 §70404, effective for taxable years beginning after December 31, 2025:

- Qualifying expenses are capped at $3,000 for one qualifying individual and $6,000 for two or more (§21(c)), **reduced by any amount excluded through a dependent-care FSA** (§21(c), flush language, cross-referencing §129).
- Expenses cannot exceed the earned income of the lower-earning spouse; a spouse who is a full-time student or incapable of self-care is deemed to earn $250 a month for one qualifying individual or $500 for two or more (§21(d)).
- The applicable percentage starts at **50%** and falls in two bands: by one point for each $2,000 (or fraction) of AGI over $15,000, to a floor of 35%; then by one point for each $2,000 ($4,000 on a joint return) over $75,000 ($150,000 joint), to a floor of 20% (§21(a)(2)). So a joint return at $43,000 is at 36%, at $75,000 is at 35%, at $150,000 is at 35%, and at $210,000 is at 20%.
- The credit is nonrefundable: it is limited to the federal tax liability the engine computes (§26(a)), which is the reason it sits on the engine rather than beside it.
- Married filing separately generally cannot claim it (§21(e)(2)), which is one of the forfeitures the jointly-vs-separately tile (SPEC-5 §2.1) names.

**Deterministic core, the FSA.** A dependent-care assistance program excludes up to $7,500 ($3,750 married filing separately) from income for 2026 and after (§129(a)(2), as amended), and from FICA wages (§3121(a)(18)). The FSA's saving is therefore the reader's federal marginal rate plus 7.65% plus the state marginal rate, on the amount excluded, computed through the tax engine exactly as the Paycheck Optimizer computes an HSA's. The credit's saving is the applicable percentage on expenses net of the exclusion, limited by liability. The tile shows **both routes, and the best split** (the FSA first up to its limit, then the credit on the remainder up to the cap, which is the usual answer, with the cases where the credit alone wins at low income shown rather than assumed). Use-it-or-lose-it and the plan-year election deadline are stated.

**Data.** `dependent-care-2026`: the expense caps, the deemed earned income, the percentage bands with their floors and thresholds, the §129 limit. Statutory and unindexed, so watched at the Code on source-watch, `staleAfterYears: 1`. Loads with the shell; every reader with a child may need it.

**Limits, on-screen.** The qualifying-individual and work-related tests are stated as the reader's to apply; the credit for a disabled spouse or parent is the same credit and the tile says so; state dependent-care credits (several states match a share of the federal credit) are named and not computed.

**Done when.** The applicable percentage reproduces §21(a)(2) at the four AGI points above, including both floors and the joint-return bracket width; the §129 reduction of the expense cap is exact; the liability limit comes from the federal engine and the credit is never shown as refundable; the FSA line cites the FICA shard; the tile reads `dependentCareExpensesAnnual` and `qualifyingChildren` from the profile and writes the former back.

---

### F3 · Is the Second Income Worth It? — **Tier 1** · Phase 31 · Benefit Cliffs hub

**Answers:** "If I go back to work, after taxes, childcare, and what we lose in benefits, what do we actually keep?"

**Deterministic core.** `resourcesAt` from [`src/engine/cliffs.ts`](../../src/engine/cliffs.ts), evaluated at the household's income without the second earner and with it, gives total resources both ways: pay after federal, FICA and state tax, plus the EITC and refundable Child Tax Credit, plus the premium tax credit, plus SNAP, with Medicaid as a status change. The tile subtracts the childcare the second income requires (from `dependentCareExpensesAnnual`), adds back the F1 credit or FSA saving on it, and subtracts the reader's own entered costs of working (commuting, a second car). Output: the net gain per month, and the **effective rate on the second income**, which the Marginal Reality Rate already renders above 100% without clamping and this tile does the same.

**Data.** None new beyond F1's shard. Every figure cites through the engine it came from ([SPEC-5.md](SPEC-5.md) §4 addition 12).

**Limits, on-screen.** The Cliff Explorer's unmodeled-program list is inherited verbatim, and the one that matters most here is named first: **the Child Care and Development Fund subsidy**, whose state-set income limits produce a cliff steeper than any program modeled, so "your real cliff may be larger" is the honest sentence. The Medicaid line is a status change and never a dollar figure, by the same test the Cliff Explorer carries.

**Done when.** A golden case where the second income is net-negative after childcare and the SNAP gross-income test, hand-computed; the Medicaid line is a status change; the childcare field is shared with F1 through the profile; *Related tools* links run to F1 and to the Cliff Explorer, and from the Cliff Explorer back.

---

### F4 · The screener learns the programs keyed to the poverty line — Phase 31 · no new tile

**Answers:** "What else might we be owed that nobody told us about?"

The What Am I Owed screener computes the household's percentage of the poverty line and tests it against the Medicaid, ACA, EITC, CTC, SNAP and Saver's Credit rules. Five more federal programs set their eligibility floor as a percentage of the same line, in a regulation or a statute the site can cite, and the screener does not name them. Each new row is an "appears to be worth applying" with the rule, the percentage, and the agency's own page, never a determination:

| Program | Floor | Rule | What it is worth | Categorical note |
| --- | --- | --- | --- | --- |
| WIC | 185% FPL, by the state agency's published guidelines (July 1 to June 30) | 7 CFR §246.7(d)(2)(i) | Food, formula, nutrition support | Pregnant or postpartum, or a child under five; automatically income-eligible on SNAP, Medicaid or TANF |
| School meals | 130% free, 185% reduced-price | 42 U.S.C. §1758(b)(1) | Free or reduced-price breakfast and lunch | Automatically eligible on SNAP or TANF; many schools serve every child free under community eligibility, which the row says |
| Lifeline | 135% FPL | 47 CFR §54.409(a)(1) | Up to $9.25 a month off phone or internet service | Automatically eligible on SNAP, Medicaid, SSI, federal public housing, or veterans' pension |
| Head Start | 100% FPL | 45 CFR §1302.12(c) | Early education and care for a child under five | Automatically eligible on TANF, SSI, SNAP, or homelessness; a share of slots above the line |
| LIHEAP | State-set, within a federal ceiling of the greater of 150% FPL or 60% of state median income | 42 U.S.C. §8624(b)(2)(B) | Heating and cooling assistance | **No figure shown.** The row is a pointer to the state agency, by the unemployment-appeal precedent: a state-set line is not a number the site invents |

The one new input is a yes/no: **a child under five in the household, or a pregnancy.** Without it the WIC and Head Start rows do not render; the school-meal row keys off `qualifyingChildren`; Lifeline keys off income alone.

**Data.** `fpl-keyed-programs-2026`: one entry per program with the percentage, the rule citation, the categorical-eligibility list, the benefit description and the agency URL. The percentages are statutory and the dollar lines derive from the FPL shard the screener already reads, so the shard carries **no dollar figure at all**, which a schema test enforces the way the life-events shard's "no clock written twice" test does. Watched at each rule on source-watch.

**Limits.** WIC's state agencies publish the dollar guidelines each July from the January poverty guidelines; the screener computes 185% from the same guidelines and says the state's table governs. Lifeline's Tribal benefit and LIHEAP's state variance are named. A categorical note is a sentence a reader can act on, never a test the screener runs.

**Done when.** Every row cites its rule; LIHEAP renders no number at any input; the new input rides the permalink and defaults off; a Hawaii or Alaska household gets the region's own percentage lines; the Readout Report's "what you may be owed" section picks up the new rows through the same function.

---

### F5 · The Saver's Match, as upcoming data — Phase 31 · data only

The Saver's Credit (IRC §25B) ends with tax year 2026 and is replaced for 2027 by the **Saver's Match** (IRC §6433, SECURE 2.0 §103): a federal matching contribution of 50% of up to $2,000 of qualifying retirement contributions, paid into the taxpayer's own IRA or plan rather than against tax, phasing out between $20,500 and $35,000 of MAGI for a single filer and $41,000 and $71,000 on a joint return, claimed on a new Form 8880-A. Treasury and the IRS published Notice 2026-48 in August 2026 ahead of proposed regulations.

The `savers-credit-2024` shard gains an `upcomingChanges` block, the mechanism Phase 23b built for the 2027 open-enrollment change: the effective year, the replacement rule, its parameters and the notice, so the Saver's Credit tile can say, above its result, that for contributions made in 2027 the credit becomes a match paid into the account, with the figures and the citation. The Retirement Contribution Optimizer carries the same line beside its IRA room. No engine change until the regulations are final, when a `savers-match-2027` shard replaces the block; that is the annual-roll step for this shard and [annual-roll.md](../annual-roll.md) gains the row.

**Done when.** The block validates against the schema `upcomingChanges` already has; the tile renders it; the source-watch entry points at §6433 on Cornell and the notice.

---

## Parked, with un-park gates

| Item | Why parked | Un-park gate |
| --- | --- | --- |
| Child Care and Development Fund subsidy eligibility | State-set income limits and copay schedules; waitlists dominate | A canonical per-state limits table, or a Tier 1 map of where to apply |
| State dependent-care credits | 20-odd states, each a share or a schedule of its own | The state-engine pattern, data-only, as each is read |
| Adoption credit (§23) | Deterministic and cited but rare; the expense cap and phase-out are the whole tool | Low effort; ships if a reader asks for it, as a line on F1 |
| Paid family leave benefit estimates | Entirely state-run, formulas vary, and several states' programs are still phasing in | A per-state adapter set, the unemployment precedent |
