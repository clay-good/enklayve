# SPEC-5 companion — Later Life: Medicare & Social Security at 65

> The catalog for [SPEC-5.md](SPEC-5.md) §2.2, with the admission bar applied item by item. Adopted 2026-10-19. Every statutory anchor below is a lead to verify during the phase's sourcing step, not a fact; every dollar figure is the one found published for 2026 while this was written, shown so the shape of the rule is clear, and none enters a shard on this document's authority.

The household at or near 65 is served today by the Social Security Claiming Age tile (which takes the primary insurance amount off the statement and compares 62, full retirement age, and 70), the Social Security Taxation tile (the IRC §86 provisional-income rule), the RMD and drawdown tools, and the Medicare initial, general, and Part B special enrollment windows in the enrollment-windows shard. That is the right spine. What is missing is everything that happens to the *cost* of Medicare and the *size* of a couple's benefit: the surcharge an income two years back sets, the penalties a missed window compounds for life, the spousal and survivor rules, the earnings test for someone still working, the programs that pay the premiums of a low-income retiree, and SSI.

## Build index

| # | Tile id | Hub | Engine module | Phase | Tier |
| --- | --- | --- | --- | --- | --- |
| L1 | `medicare-irmaa` | `medicare-later-life` | `engine/medicare.ts` | 29 | 1 |
| L2 | `medicare-penalties` | `medicare-later-life` | `engine/medicare.ts` | 29 | 2 |
| L3 | `ss-earnings-test` | `medicare-later-life` | `engine/socialSecurity.ts` | 29 | 1 |
| L4 | `ss-spousal-survivor` | `medicare-later-life` | `engine/socialSecurity.ts` | 29 | 1 |
| L5 | `medicare-savings` | `medicare-later-life` | `engine/benefits.ts` | 30 | 3 |
| L6 | `ssi-estimate` | `medicare-later-life` | `engine/ssi.ts` | 30 | 3 |
| L7 | `hsa-medicare-timing` | `medicare-later-life` | `engine/contributionLimits.ts` | 29 | 2 |

The hub is `medicare-later-life`, "Medicare & Later Life", under the `retirement` pillar, placed directly after the Retirement hub. L1 is its default tool. It is the thirteenth hub and the last ([SPEC-5.md](SPEC-5.md) §7.1).

---

## Wave B — the figures

### L1 · Medicare Premiums & IRMAA — **Tier 1** · marquee · Phase 29

**Answers:** "What will Medicare actually cost me next year, and why is my premium higher than my neighbor's?"

**Deterministic core.** Part B's standard monthly premium plus the income-related monthly adjustment amount (IRMAA) for the reader's filing status and modified adjusted gross income from **two years before** the premium year, and the Part D surcharge on the same tiers. The tiers are a step function with no phase-out: one dollar over a boundary moves the whole year to the next tier. The tile shows the tier, the monthly and annual cost for one person and for a couple, **the next boundary and how far the reader's income is from it**, and the two-year lag stated plainly ("your 2026 premium is set by your 2024 return").

For 2026 the published figures are a $202.90 standard Part B premium and a $283 deductible, with the first surcharge tier opening above $109,000 of 2024 MAGI for a single filer and $218,000 for a joint return; the Part B totals by tier run $284.10, $405.80, $527.50, $649.20 and $689.90 a month, and the Part D surcharge from about $14.50 to $91.00 on top of the plan's own premium. Married filing separately has its own two-tier schedule. All of it is a lead for the shard.

**Data.** `medicare-costs-2026`: the Part B standard premium and deductible, the Part A premiums for those who buy it, the IRMAA tiers by filing status with the Part B and Part D amounts, and the Part D national base beneficiary premium ($38.99 for 2026, which L2 needs). Source: the CMS annual premiums-and-deductibles notice and the Part D base-premium announcement, both published in September–November for the following January, both tabulated with labeled lines an adapter can anchor. `staleAfterYears: 0`; loads on demand with the hub ([SPEC-5.md](SPEC-5.md) §7.5).

**Limits, on-screen.** MAGI for IRMAA is AGI plus tax-exempt interest (42 U.S.C. §1395r(i)(4)), which is not the ACA's MAGI nor the §86 provisional income; the tile says which it wants and where it sits on the 1040. A life-changing event (retirement, a spouse's death, divorce) lets a reader ask SSA to use a more recent year, on Form SSA-44, with a 60-day reconsideration window from the determination notice; the tile names the form and renders the window as a `Deadline` (`medicare-irmaa-reconsideration`, [SPEC-5.md](SPEC-5.md) §7.4). Part C and Medigap premiums are never shown ([SPEC-5.md](SPEC-5.md) §9).

**Done when.** Golden cases at each tier boundary for single and joint, including the dollar-over case; the "distance to the next boundary" line is exact; the SSA-44 route renders as a channel with its window cited; the IRMAA MAGI definition is cited; deep-linkable, worked-example-first, axe-clean.

**Why it matters.** A Roth conversion, a capital gain, or an RMD taken in the year before retirement can cost a couple over $1,000 a month in premiums two years later, and nothing on the site today connects the conversion ladder, the drawdown, or the capital-gains tile to that consequence. L1 is also a *Related tools* link from all three (SPEC-3 §4.1): "this year's income sets 2028's Medicare premium."

### L2 · Medicare Enrollment Penalties — **Tier 2** · Phase 29

**Answers:** "I missed my window. What does that cost, and for how long?"

**Deterministic core.** Three penalties, each a published formula:

- **Part B**: 10% of the standard premium for each full 12-month period the reader could have had Part B and did not, for as long as they have Part B (42 CFR §408.22). At 2026's $202.90, a two-year gap is $40.58 a month, rising with every premium increase.
- **Part D**: 1% of the national base beneficiary premium for each full month without Part D or other creditable coverage after the initial enrollment period, rounded to the nearest $0.10, for as long as the reader has Part D (42 CFR §423.46). Medicare.gov's own worked example is a 14-month gap, which the golden case reproduces.
- **Part A, for those who buy it**: 10% of the premium for twice the number of years of delay (42 CFR §406.32).

Inputs are the months of delay and whether the reader had creditable coverage. Output is each penalty per month, per year, and (for B and D) the lifetime figure at today's premium, with the premium's own growth left as the labeled assumption it is.

**Data.** `medicare-costs-2026` (L1) for the premiums; the `medicare-initial-enrollment`, `medicare-general-enrollment` and `medicare-part-b-sep` windows the shard already carries; the new `part-d-creditable-gap` window (63 consecutive days).

**Harm tier.** Tier 2: the output shapes the decision to enroll now or wait, so the consequence renders beside the figure, and the advice line names the exceptions the tile does not adjudicate (employer coverage from current employment, which opens the Part B special enrollment period; Extra Help, which waives the Part D penalty).

**Done when.** The Part D case reproduces the Medicare.gov example; the Part B lifetime figure carries the "at today's premium" caveat; every window renders through `renderDeadline`; the dignity sweep passes (a missed window is a fact about a calendar, not a fault).

### L7 · HSA and Medicare Timing — **Tier 2** · Phase 29

**Answers:** "I'm turning 65 and still working. When do I have to stop putting money in my HSA?"

**Deterministic core.** Enrollment in any part of Medicare ends HSA eligibility (IRC §223(b)(7)). The trap is that premium-free Part A enrollment after 65 is **backdated up to six months**, but never before the month of eligibility, so contributions made in the backdated months become excess contributions carrying a 6% excise tax (IRC §4973). The tile takes the planned Part A start (or the Social Security claim date, which enrolls the reader in Part A automatically), the 65th birthday month, and the coverage type, and returns the last month a contribution is allowed, the prorated annual limit for that year (one twelfth of the limit for each eligible month, §223(b)(2) and (8)), and the catch-up at 55 and over.

**Data.** None new: `retirement-limits-2024` already carries `hsa_self_only`, `hsa_family` and `hsa_catch_up_55plus`; the lookback and proration rules are statutory and transcribed into the tile's cited `how` copy, with the six-month figure in `medicare-costs-2026` so it is a shard figure rather than a literal.

**Harm tier.** Tier 2: the decision is whether to contribute this year; the consequence (the excise tax, and the correction route of withdrawing the excess before the filing deadline) renders on screen.

**Done when.** The last-contribution month is derived from the lookback rule, never from the enrollment date alone, and a golden case proves the two differ; the proration is exact in twelfths through `Money`; the tile is a *Related tools* link from the Retirement Contribution Optimizer's HSA row.

### L3 · Social Security Earnings Test — **Tier 1** · Phase 29

**Answers:** "I claimed early and I'm still working. How much of my benefit do they hold back?"

**Deterministic core.** In years before full retirement age, $1 of benefit is withheld for every $2 of earnings above the lower exempt amount; in the year full retirement age is reached, $1 for every $3 above the higher exempt amount, counting only earnings in the months before that birthday; from the month of full retirement age, nothing (42 U.S.C. §403(b) and (f); 20 CFR §404.415). For 2026 the published amounts are $24,480 and $65,160. SSA withholds in **whole monthly benefits**, not as a fraction of each check, and at full retirement age the benefit is recomputed upward to credit the months withheld. The tile shows the annual amount withheld, the number of whole months it represents, and the recomputation, so the reader sees that the money is deferred rather than lost.

**Data.** The `social-security-2024` shard, extended with the two exempt amounts through the existing SSA adapter (they are on the same COLA fact sheet as the wage base). Statutory fractions in the shard, not the tile.

**Done when.** A golden case withholds in whole months and shows the remainder paid; the year-of-FRA case counts only pre-birthday-month earnings; the tile reads `birthYear` from the profile and the benefit from the claiming tile's result when one is present (profile continuity); the recomputation line states the rule and cites it.

### L4 · Spousal and Survivor Benefits — **Tier 1** · Phase 29

**Answers:** "What does my spouse get on my record, and what will the survivor get?"

**Deterministic core.** A spousal benefit is 50% of the worker's primary insurance amount at full retirement age, reduced 25/36 of 1% for each of the first 36 months claimed early and 5/12 of 1% for each month beyond (SSA Handbook §724; POMS RS 00615.201), to a floor of 32.5% at 62 under the current full retirement age. A reader with their own record receives the higher of their own benefit and the spousal amount, never both, and the deemed-filing rule means they cannot choose which. A survivor benefit is the deceased worker's benefit, reduced from 100% at the survivor's full retirement age to 71.5% at 60, the 28.5% reduction spread evenly over the months between (Handbook §724; 20 CFR §404.410). The tile takes both PIAs and both birth years, and shows the spousal amount at the reader's chosen age, the own-versus-spousal comparison, and the survivor amount at 60, at full retirement age, and at the chosen age.

**Data.** The reduction fractions join the `social-security-2024` shard beside the early-claiming fractions it already stores as numerator and denominator of one percent, so the same `socialSecurityBenefit` machinery evaluates them.

**Limits.** The survivor's own earnings test, the government pension offset (repealed for benefits payable after December 2023 by the Social Security Fairness Act and so *not* modeled, stated so a reader does not look for it), and the child-in-care rules are out of scope and named.

**Done when.** The SSA Handbook §724 example ($1,600 PIA, 36 months early, $600) reproduces; the own-vs-spousal line is the higher of the two and says so; the survivor floor at 60 is 71.5%; *Related tools* links run to and from the claiming tile.

---

## Wave C — the screeners

### L5 · Medicare Savings Programs & Extra Help — **Tier 3 (screener-only)** · Phase 30

**Answers:** "Is there a program that pays my Part B premium or my drug costs?"

**Deterministic core.** Four programs keyed to the poverty line the site already draws, with a federal income floor and a federal resource limit each:

| Program | Income floor (federal) | Pays |
| --- | --- | --- |
| Qualified Medicare Beneficiary (QMB) | 100% FPL | Part A and B premiums, deductibles, coinsurance |
| Specified Low-Income Medicare Beneficiary (SLMB) | 120% FPL | Part B premium |
| Qualifying Individual (QI) | 135% FPL | Part B premium |
| Extra Help (Part D low-income subsidy) | 150% FPL | Part D premium and deductible; drug copays capped |

Income is tested monthly after a $20 general disregard, which is why CMS's published 2026 lines ($1,350 QMB, $1,616 SLMB, $1,816 QI for an individual) sit $20 above the arithmetic on the guidelines, and the tile derives them the same way from the FPL shard with the disregard as a cited figure. The 2026 federal resource limits are $9,950 for an individual and $14,910 for a couple for the three MSPs, and $18,090 / $36,100 for Extra Help, with the $1,500-per-person burial allowance already netted. Extra Help's partial-subsidy tier no longer exists; every qualifying beneficiary receives the full subsidy, with 2026 copays of $5.10 generic and $12.65 brand.

**Data.** `medicare-savings-2026`: the four percentages, the $20 disregard, the resource limits, and the copay figures, cited to CMS's annual MSP limits and SSA's Extra Help page, with the rule at 42 U.S.C. §1396d(p) for QMB and §1396a(a)(10)(E) for SLMB and QI. Loads on demand with the hub.

**Harm tier.** Tier 3, for the reason charity care is: eligibility is the state Medicaid agency's to determine, and **the state variance is the whole story**. Several states have raised the income lines above the federal floor and a growing number have abolished the asset test entirely; a reader over the federal resource limit may be eligible in their state. So the caveat renders **above** the figure, by DOM-order test, and the tile ships screener-only with three free channels: the State Health Insurance Assistance Program (SHIP), the state Medicaid agency's application, and SSA's online Extra Help application. Enrollment in an MSP also enrolls a reader in Extra Help automatically, which the tile states.

**Limits.** No state figure is shown. The tile never says "you qualify", "you are eligible", or "you do not qualify" at any input, asserted by test. It says "worth applying" with the reason, or "above the federal line; your state may set a higher one".

**Done when.** The derived monthly lines reproduce CMS's published 2026 figures to the dollar; the forbidden phrasings are absent at every input; the channels are populated and `checkHarmTier` passes; the screener's 65-plus rows (Phase 30) read the same engine function.

### L6 · SSI Estimate — **Tier 3 (screener-only)** · Phase 30

**Answers:** "If I'm eligible for SSI, roughly what would the federal payment be?"

**Deterministic core.** The federal benefit rate ($994 a month for an individual and $1,491 for a couple in 2026, 2.8% COLA) less countable income, where countable income is unearned income less a $20 general exclusion, plus earned income less $65 and half the remainder (20 CFR §416.1112 and §416.1124), with the student earned-income exclusion for a reader under 22 ($2,410 a month, $9,730 a year in 2026). The resource limit is $2,000 for an individual and $3,000 for a couple (20 CFR §416.1205, unchanged since 1989). SSA's Red Book carries worked examples; the tile reproduces one.

**Data.** `ssi-2026`: the two federal benefit rates, the three exclusions, the student exclusion, the resource limits, cited to the SSA COLA fact sheet and the regulations; through the SSA adapter, which already reads that fact sheet.

**Harm tier.** Tier 3: eligibility is SSA's determination (age 65, blindness, or disability, plus the resource test), the estimate covers cash income only, and a reader who hears "you qualify" from a website and is denied has been harmed. Channel: SSA's SSI application and the local field office.

**Limits, on-screen.** In-kind support and maintenance (the rules changed in 2024 and remain fact-specific) is not estimated; state supplements, which eleven states pay through SSA and others pay directly, are named and not computed; the disability determination itself is never addressed; the tile says that an SSDI benefit counts as unearned income and shows the $20 exclusion against it, since that combination is the common case.

**Done when.** The Red Book example reproduces to the dollar; the forbidden eligibility phrasings are absent; the resource limit renders as a fact about the program and never as a verdict about the reader; `checkHarmTier` passes.

---

## The screener's 65-plus rows · Phase 30

The What Am I Owed screener takes household size, income, state and qualifying children. It does not ask ages, by the rule in `SituationValues` that no surface asks for a list of them. It gains one opt-in yes/no: **anyone in the household 65 or older, or on Medicare.** With it on, the screener adds the QMB, SLMB, QI and Extra Help rows from L5's engine function, each cited, each phrased as "worth applying" with the federal line and the state caveat, and links to L5 for the resource test the screener does not ask. The toggle rides the permalink. With it off, the screener is unchanged, which a test asserts.

---

## Parked, with un-park gates

| Item | Why parked | Un-park gate |
| --- | --- | --- |
| State Medicare Savings Program lines and asset-test status by state | Set by each state's Medicaid agency; no canonical table | A per-state adapter set, the unemployment precedent |
| Medicare Advantage and Medigap plan comparison | Market prices, not rules | Never; the plan finder and SHIP are free and better |
| Social Security benefit estimate from an earnings history | A 35-year record the site does not hold; the statement already states the figure | Never; the statement is the source |
| Medicaid long-term-care eligibility and spend-down | State-set, asset-heavy, needs counsel | Probably never; route to the state agency and legal aid |
| SSI in-kind support and maintenance | Fact-specific after the 2024 rule change | A citable, deterministic rule with a published worked example |
