# enklayve.com — Build Spec 5: Every Season of a Household

> Adopted 2026-10-19. This spec adds no pillar and changes no principle. It fills the seasons of a household's life that the catalog is thin on, reads the documents those households actually hold, and un-parks the one roadmap item whose gate has moved. Every addition clears the same bar as everything before it: deterministic, computed on the device, cited to the public rule, never advice.

Specs 1 through 4 built a catalog that serves two households very well: the one that is **planning**, with slack to spend on a Roth ladder or a rent-vs-buy horizon, and the one in a **crisis month**, deciding which of four bills to pay. Reading the shipped catalog (70 calculators in 12 hubs, 51 tax jurisdictions, 13 document kinds, 99 cited shards) against the life of an ordinary household shows where it goes quiet.

- [SPEC-5-later-life.md](SPEC-5-later-life.md) — the household at or near 65: Medicare's surcharges, penalties and clocks; Social Security for a couple and for someone still working; the programs that pay Medicare's bills for a low-income retiree; Supplemental Security Income.
- [SPEC-5-young-family.md](SPEC-5-young-family.md) — the household with a child in care: the rewritten Child and Dependent Care Credit, the dependent-care FSA it competes with, whether a second income is worth it after childcare, and the programs keyed to the poverty line that the screener does not yet name.
- [SPEC-5-layoff-month.md](SPEC-5-layoff-month.md) — the first month after a job ends: what cashing out a 401(k) really costs, COBRA against the Marketplace with the credit applied, and what an unemployment check or a severance payment nets.
- [SPEC-5-readout-v3.md](SPEC-5-readout-v3.md) — the standardized forms these households hold and the Readout cannot read: the SSA-1099, 1099-R, 1099-G, the Social Security Statement, the Medicare Summary Notice, the Closing Disclosure, and the Regulation F debt-validation notice.
- [SPEC-5-student-loans.md](SPEC-5-student-loans.md) — federal student loan payments under the Repayment Assistance Plan, now that the plan set is fixed in statute and live, with the un-park gate kept.

---

## 1. Thesis of this pass

The household enklayve serves best is between 25 and 55, working, and either comfortable or in trouble. Three other seasons of the same household's life are decided by published, deterministic rules that the site does not expose:

1. **The years around 65.** Medicare's income-related surcharge is a true cliff: one dollar of modified adjusted gross income over a tier boundary costs a full year of the next tier's premium, and the income that decides it is from two years earlier. The late-enrollment penalties are lifetime and compound. The spousal and survivor benefit rules decide tens of thousands of dollars for a couple. The Medicare Savings Programs and Extra Help pay a low-income retiree's Part B premium and drug costs, and most who qualify have never heard of them. Every one of these is a published formula, and the household at this age is the one the lead-generation incumbents monetize hardest, through Medicare Advantage marketing rather than mortgages.
2. **The years with a child in care.** The Child and Dependent Care Credit was rewritten for 2026 into a three-band shape that no consumer tool shows. It competes with a dependent-care FSA whose limit was raised for the first time since 1986. Together they decide whether a second income clears the cost of the childcare it requires, which is a benefit-cliff question the site already knows how to ask. And the programs keyed to the poverty line that a family with young children is most likely owed, WIC and school meals and Lifeline, are missing from a screener whose purpose is to name what a household is owed.
3. **The month after a layoff.** The life-event sequence for a job loss says *decide on COBRA* and *do not cash out the retirement account without seeing the cost*. It cannot show the cost, or the comparison, because the calculators for them do not exist. The three decisions that month, the retirement account, the health coverage, and what the unemployment check nets, are the ones that set the household's floor for the next two years.

Two capability gaps cut across all three. The Readout reads 13 document kinds, almost all of them tax forms a working household files; the documents a retiree, a new parent, or a laid-off worker actually holds (an SSA-1099, a 1099-R, a 1099-G, the Social Security Statement, a Medicare Summary Notice, a Closing Disclosure, a collections letter) are unread. And the one high-value item parked by two specs running, the student-loan payment, has had its gate satisfied by statute since July 1, 2026.

None of this is new math for the site. Every item below composes engines that already exist, or adds one small cited shard. That is the test this pass applies: an item earns a place only if the rule is published, the figure is cited, and the engine beneath it is one the golden corpus already pins.

---

## 2. What we add, in five moves

### 2.1 Compositions: zero new data, highest value per hour

The Benefit Cliff Explorer (SPEC-4 §A1) was the proof that the most valuable tool on the site could be built from engines already shipped. This pass starts there again. Each item in Wave A composes existing engines and needs at most a shard of statutory constants:

- **Married: jointly or separately?** Two incomes, two withholdings, one household: the federal and state engines run both ways and show the difference, the credits a separate return forfeits (EITC, the education credits, the dependent-care credit), and the one case where separate wins on the site's own numbers (an income-driven student-loan payment, §S1).
- **Compare two states** (an enhancement to Take-Home Pay, no new tile): the same salary through two jurisdictions side by side, which is the question the moving-states life-event sequence sends a reader to answer and the site cannot today without two tabs.
- **Selling a home: the taxable gain.** IRC §121's $250,000 / $500,000 exclusion, the two-of-five-years test, the partial exclusion for an unforeseen move, through the capital-gains engine.
- **When private mortgage insurance ends.** The Homeowners Protection Act's 80% request point and 78% automatic termination, read off the amortization schedule the loan engine already produces, with the date each arrives.
- **Cashing out a 401(k)**, **COBRA against the Marketplace**, and **what the unemployment check nets**, which are the layoff-month companion's subject.

### 2.2 Later life: the thirteenth hub

Seven tools for the household at or near 65, in a hub of their own because the Retirement hub (nine tools, all about accumulating and drawing down) would become the dumping ground SPEC-2 §1.5 forbids. The catalog is in [SPEC-5-later-life.md](SPEC-5-later-life.md). The marquee item is **Medicare Premiums & IRMAA**: the one cliff in American personal finance sharper than the ACA's, since it has no phase-out at all, and it is set by an income the household reported two years ago and can no longer change.

### 2.3 The young family, and a screener that names what it finds

The rewritten §21 credit and its FSA, the second-income question, and the poverty-line-keyed programs the screener is missing. The catalog is in [SPEC-5-young-family.md](SPEC-5-young-family.md). The screener change is the cheapest real money in this spec: five programs whose eligibility floor is a cited percentage of a poverty line the site already draws.

### 2.4 Readout v3: the forms these households hold

Seven standardized forms, each with a fixed federal layout the anchored extractor can pin to a revision, and the cross-checks they make possible. The catalog is in [SPEC-5-readout-v3.md](SPEC-5-readout-v3.md). The rule from SPEC-4's Readout v2 is unchanged and is the reason this wave is scoped to *standardized* forms: an extractor built against an imagined layout is the failure SPEC-2 §2.2 exists to prevent, and every form here has a published model.

### 2.5 Student loans, gated and now buildable

Parked in SPEC-3 §4.10 and again in SPEC-4 §9 because the plan set was moving. It stopped moving: the One Big Beautiful Bill Act wrote the Repayment Assistance Plan into the Higher Education Act, it opened July 1, 2026, and the plans it replaces have a statutory end date. [SPEC-5-student-loans.md](SPEC-5-student-loans.md) carries the evidence, keeps the gate, and specifies the tool.

---

## 3. The admission bar, carried forward and extended

SPEC-4 §3 added four tests for Pillar 4 tools: a federal floor with state variance named, a harm-if-wrong tier, the advice line on the tile, and dignity in the copy. The gate that enforces the tier binds any tile that *declares* one; declaring one has been Pillar 4's admission bar alone.

This pass extends the discipline without extending the pillar: **every tile this spec adds declares a harm tier, whatever hub it joins.** Several of them shape decisions with a clock on them (when to enroll in Part B, whether to roll over a distribution inside 60 days, which repayment plan to choose), and a clock is what makes a wrong number expensive. The tiers assigned in the companions follow SPEC-4 §3.2's definitions exactly:

- **Tier 1** where the output is a figure the reader will check against a statement (IRMAA, the earnings test, the dependent-care credit).
- **Tier 2** where the output shapes a choice and the consequences must render beside it (the Medicare penalties, cashing out a 401(k), COBRA vs Marketplace, the student-loan plan).
- **Tier 3** where the question is eligibility that only an agency decides, or a right the reader may have (the Medicare Savings Programs screen, SSI, the collections notice). These ship screener-only with named free channels, exactly as the charity-care and garnishment tiles do.

The rule is made mechanical in Phase 27 (§7.3). The two further tests of SPEC-4 §3 apply as written: state variance is named before the federal figure wherever a state may differ (the Medicare Savings Programs' asset tests, which several states have abolished, are the clearest case), and the dignity sweep in [`tests/ui/dignity.test.ts`](../../tests/ui/dignity.test.ts) covers every new tile the day it lands.

---

## 4. Non-negotiables carried forward, and one added

Everything in SPEC §2, SPEC-4 §4 additions 10 and 11, and SPEC-3 §2's robustness invariants holds without exception.

12. **A composition cites through the engines it composes, never beside them.** When COBRA vs Marketplace shows a premium tax credit, that line carries the ACA shard's citation because it came from `estimatePremiumTaxCredit`, not a citation the tile wrote. When the 401(k) cash-out shows state tax, the line is the state jurisdiction's. A composition tool introduces no literal of its own: the handful of statutory constants it needs (a 10% additional tax, a 20% withholding rate, a 102% COBRA ceiling) live in a cited shard like every other figure, and the magic-number rule of SPEC-3 §2.5 applies to them in full.

And one decision restated because this pass leans on it harder than any before: **the user supplies the figure only they have.** A Social Security estimate comes off the statement, a COBRA premium off the election notice, a prior-year MAGI off the return. The site says where to find each one and never estimates an earnings record, a plan's cost, or a hospital's policy.

---

## 5. Roadmap, ordered by value ÷ effort

| Wave | Items | New data |
| --- | --- | --- |
| **A — compositions** | Married jointly vs separately · Compare two states · Home-sale exclusion · PMI end date · Cashing out a 401(k) · COBRA vs Marketplace · Unemployment and severance net | Three small statutory shards (§6) |
| **B — later life** | Medicare Premiums & IRMAA · Medicare enrollment penalties · HSA and Medicare timing · Social Security earnings test · Spousal and survivor benefits | One CMS shard; the Social Security shard extended |
| **C — later life, screeners** | Medicare Savings Programs & Extra Help · SSI estimate · the screener's 65-plus rows | Two shards |
| **D — young family** | Dependent-care credit and FSA · Is the second income worth it · the screener's poverty-line programs · Saver's Match as upcoming data | Two shards; one `upcomingChanges` block |
| **E — Readout v3** | SSA-1099 · 1099-R · 1099-G · 1098-T/E · Social Security Statement · Medicare Summary Notice · Closing Disclosure · Reg F validation notice · five cross-checks | No shards; extractors and checks |
| **F — student loans** | Federal student loan payment (RAP, Standard, legacy IBR) · the §221 interest deduction · the §127 employer payment | One shard, watched at the statute |

Wave A ships first for the same reason SPEC-4's Wave A did: it is the most value the site can add before a single new source has to be read. Waves B through D each need a sourcing pass against the agency's own document, and B is ordered before D only because its shards are published on one calendar (the CMS and SSA October announcements) and can be read in one sitting.

---

## 6. Data layer additions

Every shard follows the gated pipeline without exception: a `DATASET_SCHEMAS` entry, an integrity hash, a manifest entry with `expectedRefreshMonths` and `staleAfterYears`, a refresh adapter *or* a `source-watch.json` entry, a `watch-coverage.json` accounting, and a row in [data-sources.md](../data-sources.md). Nothing may be unwatched silently; that rule has been mechanical since 2026-08-30 and it binds every id below.

| Shard id | Source | Refresh | Watched by | `staleAfterYears` |
| --- | --- | --- | --- | --- |
| `early-distribution-2026` | IRC §72(t), §402(c)(3), §3405(c) | Amendment | source-watch, at the Code | 1 |
| `separation-rules-2026` | IRC §4980B(f)(2)(C) (COBRA 102%), §85 (UI taxable), §3402(p)(2) and Form W-4V (10% voluntary withholding), Pub. 15 §7 (supplemental 22% / 37%) | Annual, Dec (Pub. 15) | IRS adapter for Pub. 15; source-watch for the Code | 0 |
| `home-sale-exclusion-2026` | IRC §121 | Amendment | source-watch, at the Code | 1 |
| `pmi-cancellation-2026` | 12 U.S.C. §4902 (Homeowners Protection Act) | Amendment | source-watch, at the Code | 1 |
| `medicare-costs-2026` | CMS annual premiums and deductibles notice; the Part D national base beneficiary premium announcement; Medicare.gov cost pages | Annual, Oct–Nov | CMS adapter (the fact sheet states every figure as a labeled line) | 0 |
| `medicare-savings-2026` | CMS Medicare Savings Program limits; SSA Extra Help limits; 42 CFR §400.200 ff. | Annual, Jan–Mar (follows the poverty guidelines) | adapter where the page tabulates; source-watch for the rule | 0 |
| `ssi-2026` | SSA COLA fact sheet (federal benefit rate); 20 CFR §416.1112 and §416.1124 (exclusions); 20 CFR §416.1205 (resource limits) | Annual, Oct | SSA adapter (same fact sheet the FICA adapter reads) | 0 |
| `social-security-2024` (extended) | SSA COLA fact sheet (earnings-test exempt amounts); SSA Handbook §724 and POMS RS 00615.201 (spousal and survivor reduction fractions) | Annual, Oct | the existing SSA adapter, widened | existing |
| `dependent-care-2026` | IRC §21 and §129 as amended by Pub. L. 119-21; Pub. 503 | Amendment (statutory, unindexed) | source-watch, at the Code | 1 |
| `fpl-keyed-programs-2026` | 7 CFR §246.7(d) (WIC); 42 U.S.C. §1758(b)(1) (school meals); 47 CFR §54.409(a) (Lifeline); 45 CFR §1302.12 (Head Start); 42 U.S.C. §8624(b)(2) (LIHEAP) | Amendment; the percentages are statutory, the dollar lines derive from the FPL shard | source-watch, at each rule | 1 |
| `savers-credit-2024` (`upcomingChanges`) | IRC §6433 (the Saver's Match, effective for 2027); IRS Notice 2026-48 | Once, then on the proposed regulations | source-watch | existing |
| `student-loans-2026` | 20 U.S.C. §1087e(q) and (d) as added by Pub. L. 119-21 (RAP and the new Standard plan); §1098e (IBR); IRC §221 and §127; StudentAid.gov plan pages | Amendment; §221's phase-out from the annual revenue procedure | source-watch at the statute and the Department's page; the IRS adapter for §221 | 0 |

Two notes on the table. First, **a shard that transcribes a statute is watched, never parsed**, the rule SPEC-4 §10.7 set for the Pillar 4 shards: a change to what §72(t) excepts from the additional tax is read by a person. Second, **the `staleAfterYears: 0` posture of Pillar 4 applies to every shard here whose figure moves on January 1**, which is every Medicare, SSI, and separation figure. A Part B premium a year out of date is a wrong number with no banner, which is the failure the window prevents.

Every statutory anchor in this spec and its companions is a **lead, not a fact**, exactly as SPEC-4 §6 put it. Each is verified against the live published source during its phase's sourcing step and pinned with a content hash like every other number on the site. The dollar figures the companions quote are the ones the research for this spec found published for 2026; they are there so a reader can judge the shape of each rule, and none of them enters a shard on the authority of this document.

---

## 7. Interfaces this pass adds

### 7.1 The thirteenth hub, and the hub ceiling

`HUB_CONFIGS` in [`src/tiles/registry.ts`](../../src/tiles/registry.ts) gains one entry, placed directly after Retirement:

| Hub id | Title | Pillar | Default tool | Tools |
| --- | --- | --- | --- | --- |
| `medicare-later-life` | Medicare & Later Life | `retirement` | `medicare-irmaa` | `medicare-irmaa` (L1), `medicare-penalties` (L2), `hsa-medicare-timing` (L7), `ss-earnings-test` (L3), `ss-spousal-survivor` (L4), `medicare-savings` (L5), `ssi-estimate` (L6) |

SPEC-4 §7.1 set 13 hubs as the ceiling and this is the thirteenth. **The ceiling holds.** Every other tile in this spec joins an existing hub, and the companions name which. Retirement grows to ten tools, Paycheck & Taxes to nine, and Benefits & Aid to twelve, at or past the top of SPEC-2 §1.5's "roughly three to ten" range; the alternative, a fourteenth hub, is worse, and the segmented control has been shown to carry twelve. A later pass that needs more room splits Benefits & Aid along the line it already has (credits against programs) rather than adding a hub.

### 7.2 Two profile fields and two Readout targets

`SituationValues` ([`src/profile/situation.ts`](../../src/profile/situation.ts)) gains:

```ts
/** Four-digit birth year of the filer. Read by the Social Security, Medicare and
 *  earnings-test tiles; written by whichever the reader fills in first. */
birthYear: number;
/** Annual qualifying dependent-care expenses (IRC §21(b)(2)). Read by the
 *  dependent-care and second-income tiles. */
dependentCareExpensesAnnual: number;
```

Adding a profile field trips five gates by design (the schema, the written-by test, the read-by test, the portable-file round-trip, and the ledger's strict schema). Both fields are added in Phase 27 with each gate satisfied, so no later phase pays that cost twice. `ages` stays as it is: written by nothing, for the reason its comment gives, and `birthYear` is a single number a person can answer.

`ReadoutTarget` ([`src/readout/types.ts`](../../src/readout/types.ts)) widens by exactly two values, each a deliberate edit per SPEC-4-readout-v2 §2.1:

- `socialSecurityPia`, written only by the Social Security Statement's full-retirement-age estimate (§R4), which is the one figure on that document that is the primary insurance amount.
- `unemploymentCompensationAnnual`, written only by a 1099-G's box 1 (§R3), which feeds the engine's projection of the tax on benefits.

The SSA-1099's box 5 does **not** become a target: the Social Security Taxation tile takes benefits as its own input and nothing else on the site reads the figure, so a profile field for it would be the kind nothing writes and nothing reads. A test pins the target set at these two additions, as [`tests/readout/answer.test.ts`](../../tests/readout/answer.test.ts) pins the EOB's absence of targets today.

### 7.3 Every new tile declares a tier

`checkHarmTier` in [`scripts/audit-release.ts`](../../scripts/audit-release.ts) gains a companion, `checkTierDeclared(tiles, legacy)`: a tile is either in the `legacy` allowlist (the catalog as of 2026-10-19, enumerated by id) or it declares `harmTier`. The allowlist **may only shrink**, which a test asserts against a committed baseline the same way `adapter-baseline.json` is held: an id removed from it is a tile that gained a tier, and an id added to it is a build failure. This is the watch-coverage pattern applied to the admission bar, and it is why §3's rule is a gate rather than a convention.

### 7.4 New clocks, in the shard that holds clocks

Every dated step this spec adds is a `Deadline` through `renderDeadline`, as SPEC-4 §7.3 requires, and every window lives in [`data/enrollment-windows-2026.json`](../../data/enrollment-windows-2026.json) rather than beside the tile that shows it, the rule Phase 20b wrote into a test. The shard's name says *enrollment*; it has held appeal windows since Phase 23b and it is the one place a clock is written. New window ids:

| Window id | Clock | Rule |
| --- | --- | --- |
| `rollover-60-day` | 60 days from receipt of a distribution to complete a rollover | IRC §402(c)(3)(A) |
| `part-d-creditable-gap` | 63 consecutive days without creditable drug coverage before the Part D penalty attaches | 42 CFR §423.46 |
| `medicare-irmaa-reconsideration` | 60 days from the IRMAA determination notice to request reconsideration | 20 CFR §418.1330, applying §404.909's 60 days |
| `idr-transition-2028` | July 1, 2028: the last day a borrower on ICR, PAYE or SAVE may remain before being moved | 20 U.S.C. §1087e(q) as amended, transition provisions |
| `collections-validation` | 30 days after receipt of a validation notice to dispute in writing | 12 CFR §1006.34(b)(5) |
| `medicare-summary-appeal` | 120 days from the Medicare Summary Notice date to request a redetermination | 42 CFR §405.942 |

The §7.3 test that every window carries a citation and that a ceiling is never rendered with a floor's "at least" wording runs over the real shard, so each row above is checked the day it lands.

### 7.5 The shell budget is a line in every phase

`SHELL_GZIP_BUDGET_KB` (319 at adoption; 306.8 kB measured after the unemployment rules moved out of the precached shell) is a gate, and raising it is the owner's decision each time. Every phase in §8 therefore states what it adds to the shell and which of its data loads on demand by the pattern the unemployment estimator set on 2026-10-19 (one hash-checked chunk per shard, runtime-cached on first use). The rule for this pass: **a shard a reader needs only after choosing their situation loads on demand; a shard every reader needs loads with the shell.** The Medicare cost table is the former. The §21 credit parameters are the latter. **Superseded 2026-10-19 by the owner's decision:** every tool this spec adds loads its code and its shards on demand, whatever the shard. Only the definition (title, keywords, how block) stays in the shell, through `lazyMount` in `src/tiles/lazy.ts`.

---

## 8. Build plan: Phases 27–33

Ordered prompts in the SPEC/SPEC-2 convention. Each phase is independently shippable and leaves the suite green. Phases 28 through 33 assume Phase 27 has landed.

### Phase 27: Foundations

**Goal.** Make §3 and §7 enforceable before a tile is built.

**Deliverables.** The `medicare-later-life` hub, registered in the phase that ships its first calculator (Phase 29), not here, by the Phase 18 rule that no hub is empty. The two `SituationValues` fields with all five gates satisfied. The two `ReadoutTarget` values and the test that pins the set. `checkTierDeclared` with its committed legacy baseline and the shrink-only test. The six window ids in the enrollment-windows shard, each cited, each through the existing §7.3 test.

**Acceptance.** Nothing user-visible changes. `checkTierDeclared` fails a fixture tile outside the baseline with no tier and passes the real catalog. The baseline test fails on an id added. Every new window renders through `renderDeadline` with a source link. The portable file and the ledger round-trip with the two new fields present and absent.

**Shell cost.** None beyond the window rows.

**Status — shipped 2026-10-19, with three deliberate departures.**

- **Shipped.** `checkTierDeclared`, run over the real catalog from the test suite, with its baseline in [`scripts/tier-legacy.json`](../../scripts/tier-legacy.json): the 69 tiles and hubs with no tier on that date. The list may only shrink, a tile that gains a tier must leave it, and the test holds a ceiling of 69.
- **Shipped.** `birthYear` on `SituationValues`, with every profile gate satisfied. The Social Security tile reads it and writes it, so the Medicare and earnings-test tiles inherit a year the reader has already given.
- **Shipped.** The six windows in the enrollment-windows shard, each read from its own section's text. Each is a limit on the reader, so none says "at least".
- **Departure: two citations corrected.** The IRMAA reconsideration window cites §418.1325 with §404.909(a)(1): §418.1330, which this spec named, covers only a dispute over the IRS's figure. The student-loan transition is the act's own note, Pub. L. 119-21 §82001(a): choose before July 1, 2028, or be moved on that date. It renders as June 30, 2028.
- **Departure: the windows are visible.** They appear in the Enrollment & Appeal Windows tool under five new programs, since that tool shows every window the shard holds. Hiding them would have meant a second, unrendered list of clocks, which §7.4 rules out.
- **Departure: three items deferred to the phase that uses them.** `dependentCareExpensesAnnual` waits for Phase 31, and the two `ReadoutTarget` values wait for Phase 32. A profile field nothing reads fails the profile's own read-by gate, and a target is a profile field. The target set is now a value, `READOUT_TARGETS`, pinned by a test, so adding the two will be the deliberate edit §7.2 asks for.
- **Measured shell cost: 2.2 kB** (307.3 → 309.5 of 319), almost all of it the six windows' cited prose.

### Phase 28: The compositions

**Goal.** Wave A, the zero-data tools and the three small statutory shards.

**Deliverables.** `early-distribution-2026`, `separation-rules-2026`, `home-sale-exclusion-2026`, `pmi-cancellation-2026`, each watched at the Code. The tiles: `filing-jointly-vs-separately` (Paycheck & Taxes, tier 1), `home-sale-gain` (Home & Big Purchases, tier 1), `pmi-end-date` (Home & Big Purchases, tier 1), `retirement-cash-out` (Retirement, tier 2), `cobra-vs-marketplace` (Insurance & Protection, tier 2). The enhancements: a *compare with another state* control on Take-Home Pay; a *net of taxes* reading on the unemployment estimator; an *extra pay* mode on the W-4 tile for a bonus or severance. The job-loss life-event sequence gains `tileId` links to the two new tiles at its retirement-account and COBRA steps. Detail for the layoff items is in [SPEC-5-layoff-month.md](SPEC-5-layoff-month.md).

**Acceptance.** Golden cases: a joint-vs-separate pair where separate forfeits the EITC; a §121 sale with a partial exclusion; a PMI schedule where the 80% request date comes before the 78% automatic date on an original-value basis, and an extra principal payment that reaches 80% early moves the request date and not the automatic one; a cash-out at 40 where the balance due at filing exceeds the 20% withheld; a COBRA-vs-Marketplace case where the credit flips the answer. The 60-day rollover renders as a `Deadline`. The dignity sweep and `checkHarmTier` pass on every new tile.

**Shell cost.** Five tiles and four small shards, loaded with the shell (every reader may need them). Expected under 6 kB gzipped; the phase states the measured figure.

**Status — in progress.** **`pmi-end-date` shipped 2026-10-19** with `pmi-cancellation-2026` (12 U.S.C. §§4901-4903, watched at §4902 on Cornell LII). The tool shows the request date on the original schedule, the request date reached sooner with extra principal, the automatic date and the final cutoff. Extra principal moves only the first of those. Its golden cases were computed outside the codebase, and a zero-rate loan lands exactly on the 80% line, so the observation probes hold the `<=`. The Home & Big Purchases hub took the tool's tier and left the legacy baseline the same day. **Measured: 3.4 kB** (309.5 → 312.9 of 319), about twice the per-tool share this phase assumed, most of it the how block and the cited note. At that rate the four remaining tools and three shards do not fit in the 6.1 kB left. Before they ship, the owner decides between a budget raise and loading Wave A's tools on demand, as the unemployment rules now do. **Decided the same day: on demand.** Every SPEC-5 tool's code and shard now load when it is opened (`lazyMount` in `src/tiles/lazy.ts`, shards through `loadDeferred`), while its definition stays in the shell for search, its hub and its crawlable page. When PMI Ends moved onto the pattern and took 1.9 kB back. **`home-sale-gain` shipped on it**, with `home-sale-exclusion-2026` (26 U.S.C. §121): the full exclusion, the §121(c) partial exclusion with the spec's golden case, and the tax on the remainder through the capital-gains engine, cited to that shard. **Measured: 1.0 kB** (311.0 → 312.0 of 319). The three remaining tools need about 3 kB more at that rate.

### Phase 29: Later life, the figures

**Goal.** The hub, with the tools whose output is a figure to check against a statement.

**Deliverables.** `medicare-costs-2026` and its CMS adapter; the Social Security shard extended with the earnings-test amounts and the spousal and survivor fractions, through the existing SSA adapter. The hub with L1 `medicare-irmaa` (tier 1), L2 `medicare-penalties` (tier 2), L7 `hsa-medicare-timing` (tier 2), L3 `ss-earnings-test` (tier 1), L4 `ss-spousal-survivor` (tier 1). Detail in [SPEC-5-later-life.md](SPEC-5-later-life.md).

**Acceptance.** IRMAA golden cases at each tier boundary, including the dollar-over case that is the point. The Part D penalty reproduces Medicare.gov's own worked example (a 14-month gap). The Part B penalty renders as a lifetime figure with the "at today's premium" caveat. The spousal benefit at 62 reproduces the SSA Handbook §724 example. The earnings test withholds in whole months and states that the withheld months are credited back at full retirement age. The HSA tile's last-contribution month is derived from the lookback and never from the enrollment date alone.

**Shell cost.** `medicare-costs-2026` loads on demand (the IRMAA table is the heaviest new data in the spec, and only a reader who opens the hub needs it). The hub and five tiles load with the shell.

### Phase 30: Later life, the screeners

**Goal.** The two tier-3 screens, and the screener's 65-plus rows.

**Deliverables.** `medicare-savings-2026` and `ssi-2026`. L5 `medicare-savings` (tier 3, channels: the State Health Insurance Assistance Program, the state Medicaid agency, SSA's Extra Help application). L6 `ssi-estimate` (tier 3, channels: SSA). The What Am I Owed screener gains an opt-in *anyone 65 or older, or on Medicare* toggle that adds the Medicare Savings Program and Extra Help rows, each cited, each a "likely to be worth applying" and never a determination.

**Acceptance.** Both tiles can never render "you qualify", "you are eligible" or "you do not qualify" at any input, asserted as the charity-care tile's test asserts it. The state-variance caveat on asset tests renders above the federal figure, by DOM-order test. The SSI estimate reproduces the SSA Red Book's worked example to the dollar. The screener's new rows appear only with the toggle on, and the toggle rides the permalink.

**Shell cost.** Two tiles; both shards load on demand with the hub.

### Phase 31: The young family

**Goal.** The rewritten credit, its FSA, the second-income question, and the screener's missing programs.

**Deliverables.** `dependent-care-2026` and `fpl-keyed-programs-2026`. F1 `dependent-care` (Benefits & Aid, tier 1). F3 `second-income` (Benefit Cliffs, tier 1), composing `resourcesAt` from [`src/engine/cliffs.ts`](../../src/engine/cliffs.ts). The screener gains the WIC, school-meal, Lifeline and Head Start rows and a LIHEAP pointer row, with the one new input they need (a child under five, or a pregnancy, as a yes/no). The `upcomingChanges` block on `savers-credit-2024` for the 2027 Saver's Match, rendered on the Saver's Credit tile as the rule that replaces it. Detail in [SPEC-5-young-family.md](SPEC-5-young-family.md).

**Acceptance.** The credit's applicable percentage reproduces §21(a)(2) at $15,000, $43,000, $75,000 and $150,000 of AGI for a joint return, including the two floors. The credit is limited by the federal engine's tax liability, never shown as refundable. The FSA comparison shows both routes and the split, and cites the FICA saving through the FICA shard. The second-income tile's Medicaid line is a status change, never a dollar figure, by the same test the Cliff Explorer carries. Every screener row cites the rule that sets its percentage, and LIHEAP shows no number.

**Shell cost.** Two tiles and two small shards with the shell.

### Phase 32: Readout v3

**Goal.** The seven standardized forms and five cross-checks. Split into **32a** (the tax and benefit statements: SSA-1099, 1099-R, 1099-G, 1098-T and 1098-E, the Social Security Statement) and **32b** (the consumer documents: the Medicare Summary Notice, the Closing Disclosure with its Loan Estimate, the Reg F validation notice). Detail in [SPEC-5-readout-v3.md](SPEC-5-readout-v3.md).

**Acceptance.** Every extractor is pinned to a revision and flags an unrecognized one. Every check declares its false-positive case. The two new targets are written only by the documents §7.2 names. The validation notice's 30-day window and the Summary Notice's 120-day window render as `Deadline`s. OCR suppresses every rule check. Nothing persists.

**Shell cost.** None; the Readout's extractors are already a lazy chunk.

### Phase 33: Student loans

**Goal.** The payment tool, shipped only when its gate passes.

**Deliverables.** `student-loans-2026`, watched at the statute and the Department's page. S1 `student-loan-payment` (Borrowing & Debt, tier 2) with the RAP, Standard and legacy-IBR modes; the §221 and §127 lines. The `idr-transition-2028` window surfaced for a borrower who says they are on an ending plan. Detail in [SPEC-5-student-loans.md](SPEC-5-student-loans.md).

**Acceptance.** The gate: every RAP parameter the shard carries agrees between the statute and the Department's published plan terms on the day the shard is sourced, recorded in the shard's `sourceNote` with both URLs. RAP golden cases at each AGI tier edge, the $10 floor, the dependent reduction, and the interest waiver. The Standard term resolves from balance at each breakpoint. The tool never names a plan as the choice; it shows each eligible plan's payment and total under stated assumptions.

**Shell cost.** One tile and one small shard with the shell.

---

## 9. Decisions recorded

- **No Medicare plan comparison.** Part C and Medigap premiums are market prices that vary by plan, county and carrier. The site shows what the law charges (Part B, Part D's base, the surcharges and penalties) and nothing a carrier charges. A reader comparing plans is sent to Medicare.gov's plan finder and their SHIP, which are free.
- **No earnings-record estimation.** The primary insurance amount comes off the Social Security Statement, as the claiming tile has always required. Estimating it from a wage history would be a model of a 35-year record the site does not hold.
- **State Medicare Savings Program figures are not modeled.** The federal floors are. Several states have raised the income lines or abolished the asset test; the tile says so above the figure and names the state agency, by the garnishment precedent. A per-state adapter set is the un-park gate, as it was for unemployment.
- **The legacy income-driven plans are not computed.** SAVE, PAYE and ICR have a statutory end. A borrower on one is shown the transition deadline and the two plans available after it. Computing a payment under a plan the law is closing would be a number with an expiry date the reader cannot see.
- **In-kind support is not estimated for SSI.** The rules changed in 2024 and remain fact-specific. The estimate covers earned and unearned cash income and says what it leaves out.
- **No fourteenth hub.** §7.1.
- **Spanish stays with the i18n boundary.** This pass reaches the households for whom a Spanish-language utility would matter most, and the case for it is stronger than it was. It is still a presentation layer across every tile rather than a tool, and it belongs to its own spec with the pre-rendered-variant decision SPEC §0.4 deferred, not to a tool wave.

---

## 10. Acceptance criteria for this pass

1. Every tile this spec adds declares a harm tier, enforced by `checkTierDeclared` against a shrink-only baseline; `checkHarmTier` and the dignity sweep pass over the whole catalog.
2. The hub count is 13 and no higher; every new tile's hub is the one its companion names.
3. Every new shard is in the manifest with a hash, a refresh mechanism, a `watch-coverage.json` accounting, and a data-sources row; no Medicare, SSI, or separation figure carries a grace year.
4. Every statutory constant a composition needs comes from a cited shard; a sweep of the new tiles for numeric literals of statutory meaning finds none, by the `numericConstants` test already in the build suite.
5. Every clock renders through `renderDeadline` from the enrollment-windows shard, cited, and participates in the staleness banner.
6. The IRMAA, Part D penalty, spousal-benefit, SSI, and §21 golden cases reproduce the agency's own published example where one exists, and a hand-computed case where none does.
7. The two new `ReadoutTarget` values are written only by the documents named, pinned by test; every new extractor is revision-pinned; every new check declares its false-positive case.
8. The student-loan tool ships only with its sourcing gate recorded in the shard, and never names a plan as the choice.
9. Each phase states its measured shell cost, and a raise of `SHELL_GZIP_BUDGET_KB` is a separate commit by the owner's decision, as every raise has been.
10. `npm run test`, `npm run typecheck`, `npm run lint`, `npm run audit`, and the Playwright e2e stay green at the end of every phase.

---

## 11. One line positioning

A calm, fast, private place to answer real money questions, at every age a household asks them, where every number is computed on your device, cites its source, and tells you what to do next.
