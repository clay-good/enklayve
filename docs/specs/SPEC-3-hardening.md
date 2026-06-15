# SPEC-3 companion — Hardening Ledger

> **Status — 2026-06-15 (later pass).** A sweep for the §A4/§A6 magic-number anti-pattern across the *engine* (the earlier passes covered the tiles) found one more: **A7** — the federal Additional Medicare Tax threshold in [`fica.ts`](../../src/engine/tax/fica.ts) fell back to the statutory literal `?? 200000` (the single/HoH figure) when a filing-status key was absent, because its schema field used the loose `z.record(FilingStatus, …)` that validates a *partial* shard. A future FICA refresh dropping the `married_jointly` key would have validated, and MFJ filers (whose real threshold is $250,000) would have been silently overtaxed at $200,000 with no signal. Fixed the same way A6 was: a dedicated **complete-record** schema (`amountForEveryStatus`, all five statuses required) so an incomplete shard fails load-time validation → the loader marks FICA invalid → the take-home / SE-tax tiles' existing fail-safe banner fires; both `?? 200000` literals were then dead and removed. Pinned by a new FICA fail-safe case in [`tests/data.test.ts`](../../tests/data.test.ts). The capital-gains NIIT threshold's `[status] ?? .single ?? 0` chain is left as-is — that is the **deliberate** §D single-schedule fallback (a status-to-status fallback, not a hardcoded literal), already documented and tested.

> **Status — 2026-06-15.** A follow-up read extended §A4's magic-number rule to the three tiles the first pass had missed and closed one more §1.1 citation seam. **A5** (Social Security "Your choice" line) now carries the same `citation: cite` its four sibling benefit lines do. **A6** (retirement-limit literals) removes the `?? 24500 / 8000 / 72000` and `?? 0` fallbacks from the four `retirementLimits()` consumers (`selfEmployedRetirement`, `backdoorRoth`, `retirementOptimizer`, `iraDeduction`) by tightening `RetirementLimitsSchema.limits` from a loose `z.record` to a struct that *requires* the eight named limits the tiles read (with a `.catchall` for the IRS notice's extra keys) — so a shard missing one fails load-time validation and the tile degrades to the verify-before-relying banner instead of substituting a stale statutory literal. The §C1 self-documenting comment (Form 8959 line 8) was also applied. All pinned: A5 by the existing Social Security tile test, A6 by a new `RetirementLimitsSchema` fail-safe case in [`tests/data.test.ts`](../../tests/data.test.ts).

> **Status — 2026-06-09.** §A (A1–A4) and all of §B (B1–B4) are now applied and shipped. **B1** (URL-clamp disclosure) landed as a shared `clampNote`/`didClamp` pair in [`form.ts`](../../src/ui/form.ts), wired into the three confirmed surfaces (Sinking Fund, Peace of Mind, FAFSA SAI); **B2** (extreme-assumption hint) now ships as a shared `assumptionHint` primitive in the same file — a calm, non-clamping `role="note"` line on each assumption-heavy tile's primary rate (Compound Growth, Rent vs Buy, College Cost, Balance Transfer, Retirement Drawdown); **B3** (SNAP AK/HI note) now surfaces a data-honest "not estimated here" row in the owed screener instead of silently dropping SNAP for Alaska/Hawaii. **B4** (freelance empty-state) was applied earlier. §C is left untouched on purpose (those are correct). Every §D corner is now pinned by [`tests/engine/propertyInvariants.test.ts`](../../tests/engine/propertyInvariants.test.ts), and the negative-AGI medical-floor corner was hardened (the floor can no longer go negative and inflate the deduction).

> The stress-test results behind [SPEC-3.md](SPEC-3.md) §2. Every public-facing tool and engine function was read and reasoned about over its boundary space (zero, negative, very large, fractional, empty/singleton, hostile URL fragment, missing shard). **Every claim here was verified against the source before it was written down.**

This ledger has three parts, and the third is as important as the first:

- **§A — Confirmed fixes.** Verified, low-risk, with location, repro, and the minimal change.
- **§B — Triage / hardening opportunities.** Real, but design judgment calls — improvements, not defects. Apply if cheap; none block a release.
- **§C — Rejected findings.** Code that *looked* wrong, was investigated, and is **correct**. This section exists so a future reader (or a future audit pass) does not "fix" a correct calculation. Each carries the reason it is right and, where possible, a pointer to the test that pins it.

Severity scale: **critical** (wrong money or a crash that ships) · **high** (plausible wrong answer, no signal to the user) · **medium** (clarity / robustness) · **low** (consistency / polish).

The overall verdict from the read: the engine and tiles are robust. Decimal-money discipline holds, non-finite values render `(out of range)` rather than `$NaN`, missing shards show a banner, and the no-orphan-numbers audit is real. The confirmed list is short by design — it reflects what is actually wrong, not what an unguided scan flagged.

---

## §A — Confirmed fixes

### A1 · I-bond "Value now" line is uncited beside cited siblings — **low**

- **Location:** [`src/tiles/savingsBond.ts:117`](../../src/tiles/savingsBond.ts#L117)
- **What:** In the breakdown, "Fixed rate", "Current composite rate", and "Interest earned" all carry `citation: cite` (the TreasuryDirect shard). The headline-mirroring line `{ label: "Value now", value: fmt(result.currentValue), emphasis: true }` carries none. `currentValue = purchaseAmount + interestEarned`, and `interestEarned` directly above it *is* cited — so the most prominent number in the table is the one without a source link.
- **Repro:** Open the Treasury I Bond tile; the "Value now" row has no "source" link while the rows it is computed from do.
- **Expected:** For consistency with its cited inputs and the §2.8 invariant, the line should carry `citation: cite`.
- **Fix:** Add `citation: cite` to the "Value now" line. One field.

### A2 · Backdoor-Roth "Tax-free portion" is uncited beside its cited complement — **low**

- **Location:** [`src/tiles/backdoorRoth.ts:169`](../../src/tiles/backdoorRoth.ts#L169)
- **What:** "Taxable portion (pro-rata)" (line 165) carries `citation: PRO_RATA_CITATION`. Its complement "Tax-free portion (your basis)" (line 169) — the other half of the same IRC §408(d)(2) pro-rata split — carries none.
- **Repro:** Backdoor mode with a non-zero pre-tax IRA balance; the taxable line links to Pub 590-A, the tax-free line does not.
- **Expected:** Both halves of the pro-rata computation cite the same rule.
- **Fix:** Add `citation: PRO_RATA_CITATION` to the "Tax-free portion" line. (Note: `PRO_RATA_CITATION` at line 25 has no `contentHash`, which is **correct** — `contentHash` is optional in `CitationData`; see §C3. No change there.)

### A3 · FAFSA statutory-allowance lines are uncited beside the cited SAI/Pell — **low**

- **Location:** [`src/tiles/fafsaSai.ts:124-129`](../../src/tiles/fafsaSai.ts#L124)
- **What:** The "Student Aid Index" and "Estimated Pell Grant" lines carry `citation: fafsa.citation`. The allowance lines above them — "Income protection allowance", "Payroll-tax allowance", "Employment expense allowance" — come straight from the published ED tables in the same shard but carry no citation. The tile's own docstring promises it "shows every allowance and step" from "bundled, cited Dept. of Education tables", so the table-sourced lines should link to that source.
- **Repro:** Run the FAFSA SAI tile; the allowance rows have no "source" link while the SAI/Pell rows do.
- **Expected:** Lines that read a value from a published ED table carry `citation: fafsa.citation`. The purely derived lines ("Available income (after allowances)", which is income minus the allowances) are arithmetic on already-shown figures and do **not** need a citation — be discerning, per §2.8.
- **Fix:** Add `citation: fafsa.citation` to the three table-sourced allowance lines (income protection, payroll-tax, employment-expense). Leave the derived subtotals uncited.

### A4 · FAFSA SS-wage-base falls back to a stale magic number when FICA data is absent — **low–medium**

- **Location:** [`src/tiles/fafsaSai.ts:85`](../../src/tiles/fafsaSai.ts#L85)
- **What:** `const ssWageBase = data?.fica()?.socialSecurityWageBase ?? 168600;`. The tile gates on `fafsa()` availability (and shows the banner if missing) but, if the FICA shard is absent while FAFSA is present, it substitutes the literal `168600` — a 2026 figure that becomes silently wrong in a later year, presented as part of the payroll-tax allowance with no signal. This is the magic-number anti-pattern called out in [SPEC-3.md](SPEC-3.md) §2.5.
- **Repro:** Force `data.fica()` to return null with `data.fafsa()` present; the SAI computes against a hardcoded wage base rather than refusing.
- **Expected:** A statutory figure is either read from its cited shard or the tool degrades to the verify-before-relying banner — never a literal.
- **Fix:** Gate on the FICA shard alongside FAFSA: if `data?.fica()?.socialSecurityWageBase` is absent, render the existing banner and return, the same way [`federalIncomeTax.ts:116`](../../src/tiles/federalIncomeTax.ts#L116) gates on both `federal()` and `fica()`. Remove the `?? 168600` literal.

### A5 · Social Security "Your choice" line is uncited beside its cited siblings — **low** · ✅ applied

- **Location:** [`src/tiles/socialSecurity.ts:125-129`](../../src/tiles/socialSecurity.ts#L125)
- **What:** The breakdown's four comparison lines — full-retirement-age, earliest, at-FRA, and max-credits benefit — all carry `citation: cite` (the SSA fact-sheet shard). The emphasized headline-mirroring line "Your choice: age N" carried none, even though `chosen.monthlyBenefit` is computed by the same `socialSecurityBenefit` formula on the same cited data. The §1.1 consistency rule (same group, cited siblings → cite it) and the same shape as A1/A2.
- **Fix:** Add `citation: cite` to the "Your choice" line. One field. **Done.**

### A6 · Retirement-limit literals substituted for absent shard fields — **low–medium** · ✅ applied

- **Location:** [`selfEmployedRetirement.ts:106-108`](../../src/tiles/selfEmployedRetirement.ts#L106), [`backdoorRoth.ts:193`](../../src/tiles/backdoorRoth.ts#L193), [`retirementOptimizer.ts:66-72`](../../src/tiles/retirementOptimizer.ts#L66), [`iraDeduction.ts:165`](../../src/tiles/iraDeduction.ts#L165), schema at [`schemas.ts:317`](../../src/data/schemas.ts#L317).
- **What:** `RetirementLimitsSchema.limits` was `z.record(z.string(), z.number())`, so under `noUncheckedIndexedAccess` every named limit read was `number | undefined` and each tile papered over it differently — `selfEmployedRetirement` with 2026 statutory literals (`?? 24500 / 8000 / 72000`), `backdoorRoth` and `retirementOptimizer` with `?? 0` (the former renders a **cited $0** §415(c) limit when the field is absent), and `iraDeduction` with an `as { … }` type assertion. The same §A4/§2.5 magic-number anti-pattern as the FAFSA wage-base literal, spread across four tiles, missed by the first pass.
- **Fix:** Tighten the schema so the eight limits the tiles read (`elective_deferral_401k`, `catch_up_401k_50plus`, `defined_contribution_415c`, `ira_contribution`, `ira_catch_up_50plus`, `hsa_self_only`, `hsa_family`, `hsa_catch_up_55plus`) are **required** (a `.catchall(z.number().gte(0))` keeps the notice's other keys). A shard missing one now fails `safeParse` → the loader marks it invalid → `retirementLimits()` returns null → the tile's existing banner gate fires. With the keys guaranteed `number`, every fallback literal, the `?? 0`s, and the type assertion are dead and were removed. Pinned by a new fail-safe case in [`tests/data.test.ts`](../../tests/data.test.ts) (real shard validates; dropping any consumed key fails). **Done.**

### A7 · Additional Medicare threshold falls back to a statutory literal for an absent filing status — **low–medium** · ✅ applied

- **Location:** [`fica.ts:18`](../../src/engine/tax/fica.ts#L18) and [`fica.ts:79`](../../src/engine/tax/fica.ts#L79), schema at [`schemas.ts`](../../src/data/schemas.ts) (`additionalMedicareThresholdByFilingStatus`).
- **What:** Both the employee-side FICA and the self-employment paths read `fica.additionalMedicareThresholdByFilingStatus[status] ?? 200000`. The schema field was `amountByStatus` (`z.record(FilingStatus, z.number().gte(0))`), which validates a **partial** object — a shard with only `single` parses clean. So if a future SSA/IRS refresh dropped a status, the shard would still load, `[status]` would be `undefined`, and the engine would substitute the **$200,000 single/HoH literal** for, e.g., a married-filing-jointly filer whose real threshold is **$250,000** — overstating the 0.9% surtax on the $50,000 gap (up to ~$450 of wrong tax) with no signal. The same §A4/§2.5 magic-number anti-pattern as A6, in the engine rather than a tile, and missed by the tile-focused passes. (The shipped shard defines all five statuses correctly, including the surtax-specific `qualifying_surviving_spouse: 200000` — which is right: the Additional Medicare Tax uses $200,000 for QSS, *not* the $250,000 the income-tax MFJ mapping would give — so this is a robustness gap, not a wrong number today.)
- **Fix:** A dedicated **complete-record** schema (`amountForEveryStatus`: a `z.object` requiring all five filing statuses) for the federal threshold, replacing the loose `amountByStatus` on that one field. A shard missing any status now fails `safeParse` → the loader marks FICA invalid → the take-home / SE-tax / federal-income-tax tiles' existing `fica()` banner gate fires (the A4/A6 pattern). With every status guaranteed `number`, both `?? 200000` literals are dead and were removed. The capital-gains `niitThresholdByFilingStatus[status] ?? .single ?? 0` chain is **left untouched** — that is the deliberate §D single-schedule fallback (a status-to-status fallback within the same shard, not a hardcoded statutory literal), which is correct as written. Pinned by a new FICA fail-safe case in [`tests/data.test.ts`](../../tests/data.test.ts) (real shard validates; dropping any status fails). **Done.**

---

## §B — Triage / hardening opportunities (design judgment, none blocking)

### B1 · Silent URL-clamp breaks the deep-link reproducibility promise — **low** (invariant §2.3, ledger T2) · ✅ applied

- **Where:** Read-time clamps that rewrite an out-of-range fragment param without telling the user. Confirmed examples: [`sinkingFund.ts`](../../src/tiles/sinkingFund.ts) (`?m=0` → 1), [`peaceOfMind.ts:34-39`](../../src/tiles/peaceOfMind.ts#L34) (`?wr=0` → 0.1, `?m=0` → 1), [`fafsaSai.ts:47`](../../src/tiles/fafsaSai.ts#L47) (`?size=0` → 1).
- **Judgment:** The clamps themselves are **correct and must stay** — they prevent divide-by-zero (this is why §C2 is not a bug). The only gap is that a pasted link silently produces a different value than it encoded, which nicks the "pasting a link reproduces the exact result" promise. Optional, light fix: when an incoming param was actually out of range, show a one-line note ("Rainy-day target was raised to the 1-month minimum"). Do not change the clamp.
- **Done:** [`didClamp`](../../src/ui/form.ts) detects a present-but-rewritten fragment param (comparing the value the link supplied against the value after the clamp), and [`clampNote`](../../src/ui/form.ts) renders one calm `.clamp-note` line that dismisses itself the moment the user edits any input (at which point they are driving and the note is stale). Wired into all three confirmed surfaces; the clamps are unchanged. Pinned by cases in [`safeHarborTiles.test.ts`](../../tests/ui/safeHarborTiles.test.ts), [`expansionTiles.test.ts`](../../tests/ui/expansionTiles.test.ts), and [`owedTiles.test.ts`](../../tests/ui/owedTiles.test.ts) (including the in-range no-note case).

### B2 · Extreme labeled assumptions render as fact with no signal — **low** (invariant §2.4, ledger T1) · ✅ applied

- **Where:** Unbounded user-assumption rates: [`rentVsBuy.ts:55-58`](../../src/tiles/rentVsBuy.ts#L55) (`appr`/`rg`/`ir` via `parseNumber`, may be negative or huge), `balanceTransfer` transfer-fee %, `compoundGrowth` return %, `collegeCost` 0% inflation ([`collegeCost.ts:39`](../../src/tiles/collegeCost.ts#L39)).
- **Judgment:** This is **by design** — §2.1 of [SPEC.md](SPEC.md) says the user supplies the assumption and we show the math; a hard clamp would betray that. Not a defect. The principled enhancement is the opt-in sensitivity band ([SPEC-3.md](SPEC-3.md) §4.9) plus an optional calm hint when a value leaves any defensible band ("that's an unusually high rate"). Never a blocking clamp; the hint stays a pure function of the input so determinism holds.
- **Done:** the sensitivity-band half shipped earlier (§4.9). The calm-hint half now ships as a shared [`assumptionHint`](../../src/ui/form.ts) primitive — a pure function of the rate that returns one `.assumption-hint` `role="note"` line ("… of X% is unusually high/low — treat the result as a stress scenario, not a recommendation") when the value leaves a documented defensible band, and `null` inside it (inclusive of the edges), so callers append unconditionally. It **never clamps** — the input is untouched and the math still runs, preserving §2.1. The companion [`assumptionHints`](../../src/ui/form.ts) helper folds however many of a tile's rates are out of band into **one** combined line ("Home appreciation (40.0%) and rent growth (35.0%) are outside the usual range — …") rather than stacking a note per rate; a single out-of-band rate reuses the singular wording verbatim.

  **Coverage is now comprehensive across the catalog** — every tile whose headline rests on a user-supplied *forecast-style* assumption (a growth/return/inflation/fee rate, never a contractual one) carries the hint on each such rate: Compound Growth return (±50 pts), College Cost inflation (0–20) **and** expected return (±50), Rent vs Buy appreciation/rent-growth/investment-return (±20/±20/±50), Retirement Drawdown real return (±15), Downshift real return (±15), Sinking Fund return (±50), and Balance Transfer fee (0–20, the spec's "~20%"). **Deliberately excluded:** tiles whose rate is *contractual and known to the user* — Freedom Date's card APR, Home Affordability's quoted mortgage rate, the loan tiles' rates — are not forecasts, so a hint would be noise; and Peace of Mind's safe-withdrawal rate, where a *low* value is the conservative case rather than a stress scenario, so the generic "unusually high/low → stress scenario" message would misfit. Pinned by [`tests/ui/assumptionHint.test.ts`](../../tests/ui/assumptionHint.test.ts) (the band/edge/non-finite logic for both the singular and combined forms) plus a per-tile "extreme → hint, default → no hint, input unchanged, result still computed" case in each tile's test file. **This closes B2 in full; no further tiles are pending.**

### B3 · Region-limited benefit estimates are skipped without explanation — **low** · ✅ applied

- **Where:** [`owedScreener.ts`](../../src/tiles/owedScreener.ts) and [`snap.ts`](../../src/tiles/snap.ts) — SNAP is seeded for the contiguous-US allotments only; Alaska/Hawaii are skipped.
- **Judgment:** Correct to skip (we don't have the AK/HI allotment shards), but a user in those regions sees the absence rather than the reason. Light fix: emit a neutral "SNAP estimate isn't available for Alaska/Hawaii yet — check Benefits.gov" row instead of silently omitting it. Data-honest, no number invented.
- **Done:** the owed screener's region path (the only surface that lets the user pick Alaska or Hawaii) now pushes a data-honest finding — program "SNAP (food assistance)", estimate "Not estimated here", a note naming the region and pointing to Benefits.gov, and no invented number (citation `null`) — instead of silently dropping SNAP. Pinned by a Hawaii case in [`owedTiles.test.ts`](../../tests/ui/owedTiles.test.ts). The standalone SNAP tile takes no region input (contiguous-only by construction), so its existing "Alaska, Hawaii, and the territories use different amounts" copy is sufficient there.

### B4 · Freelance-rate collapses to $0 with no explanation when billable hours are zero — **low** · ✅ applied

- **Where:** [`freelanceRate.ts`](../../src/tiles/freelanceRate.ts) — when billable hours and weeks are both 0, the "hours" line correctly shows `(out of range)` but the rate line shows `$0.00` with no tie-back.
- **Judgment:** Not wrong (the guard works; no `NaN` ships), just opaque. Light fix: set `min="1"` on the hours/weeks inputs, or show a one-line empty-state ("Enter billable hours to get a rate"). Invariant §2.1 is already satisfied.
- **Done:** the "Rate to bill per hour" and "Day rate" lines now render `(enter billable hours)` when billable hours are zero, tying the empty result back to the empty input. Pinned by a case in [`tests/ui/selfEmployedTiles.test.ts`](../../tests/ui/selfEmployedTiles.test.ts).

---

## §C — Rejected findings (investigated → code is correct; do not "fix")

Each of these was flagged during the stress test, traced to the source, and found correct. Leaving a note (and ideally a test) prevents a well-meaning future change from breaking a correct calculation.

### C1 · SE Additional Medicare is applied to the 92.35% base — **correct**

- **Location:** [`src/engine/tax/fica.ts:76-78`](../../src/engine/tax/fica.ts#L76)
- **The flag:** "The 0.9% Additional Medicare surtax should apply to full self-employment income, not the 92.35%-reduced base."
- **Why it is correct:** IRS **Form 8959, Part II, line 8** ("self-employment income") is the amount from **Schedule SE** (Section A line 4 / Section B line 6), which **is** net earnings × 0.9235. The Additional Medicare Tax on SE income is computed on that reduced figure, reduced further by Medicare wages against the threshold. Applying the surtax to the full, un-reduced profit (the proposed "fix") would **overstate** the tax. The code's use of `taxableBase` (the 92.35% amount) at lines 77–78 is faithful to the form.
- **Guard against regression:** Keep the comment at [`fica.ts:67`](../../src/engine/tax/fica.ts#L67) and the golden assertion in [`tests/golden/selfEmployment.test.ts`](../../tests/golden/selfEmployment.test.ts). ✅ The recommended Form 8959 line 8 comment now sits on the additional-Medicare lines ([`fica.ts:76`](../../src/engine/tax/fica.ts#L76)) so the 92.35%-base choice is self-documenting.

### C2 · Peace-of-Mind withdrawal-rate divide-by-zero — **cannot occur**

- **Location:** [`src/tiles/peaceOfMind.ts:72,88-89`](../../src/tiles/peaceOfMind.ts#L72)
- **The flag:** "`enough = annualEssentials / (withdrawalRatePct / 100)` divides by zero when the rate is 0%, producing `Infinity`/`NaN`."
- **Why it is correct:** `withdrawalRatePct` is clamped to a 0.1 floor in **two** places — `readConfig` at [`peaceOfMind.ts:37`](../../src/tiles/peaceOfMind.ts#L37) (`Math.max(0.1, parseNumber(p.get("wr"), 4))`) and the live input handler at [line 295](../../src/tiles/peaceOfMind.ts#L295) — and the `wr` input has `min="0.1"`. It is never 0. Even if it somehow were, `enoughProgressPct` is guarded by `enough > 0 && Number.isFinite(netWorth)` ([line 89](../../src/tiles/peaceOfMind.ts#L89)) and the `usd` formatter returns `(out of range)` for non-finite values. Both the §2.2 and §2.1 invariants already hold here.

### C3 · Hand-authored `PRO_RATA_CITATION` has no `contentHash` — **correct**

- **Location:** [`src/tiles/backdoorRoth.ts:25-30`](../../src/tiles/backdoorRoth.ts#L25)
- **The flag:** "The citation is missing `contentHash`, which the `Citation` interface requires."
- **Why it is correct:** The tile uses `CitationData` (from [`src/data/schemas.ts:32`](../../src/data/schemas.ts#L32)), where `contentHash` is `z.string().min(1).optional()` — optional by design, because a hand-authored statutory-rule citation is not backed by a content-hashed shard. The stricter `Citation` interface in [`citation.ts`](../../src/engine/citation.ts) governs shard-backed values, not inline rule citations. No change.

### C4 · Health-plan coinsurance scale / missing-data banner — **correct**

- **Location:** [`src/tiles/healthPlan.ts:108,148`](../../src/tiles/healthPlan.ts#L148) and [`src/engine/finance.ts:650`](../../src/engine/finance.ts#L650)
- **The flag(s):** "User entering `0.2` for 20% gets 0.2%; and the tile has no verify-before-relying banner."
- **Why it is correct:** The field is labeled "Coinsurance (%)" with a default of `20` and `step=5`, and the tile passes `coinsuranceRate: plan.coinsurancePct / 100` — a percent in, a rate out. The engine then clamps the rate to `[0,1]` (`Math.min(1, Math.max(0, …))`), so a 150% entry sensibly becomes 100% and a negative becomes 0. And the tile depends on **no bundled shard** — it is pure arithmetic over the user's own premium/deductible/coinsurance/OOP-max — so per §2.5 it correctly has no data banner. Adding one would be wrong.

### C5 · ACA PTC silently uses missing FPL data mid-compute — **cannot occur**

- **Location:** [`src/tiles/acaPtc.ts:125-134`](../../src/tiles/acaPtc.ts#L125)
- **The flag:** "`compute()` calls `data?.fpl(region)` with no assertion, so a missing FPL shard yields a wrong subsidy."
- **Why it is correct:** `compute()` reads `const fpl = data?.fpl(fields.region);` and immediately `if (!fpl) { …verify-banner…; return; }` before any calculation. The missing-data path is explicitly guarded; no number is produced. Invariant §2.5 holds.

### C6 · Lot-picker lot count is unbounded from the URL — **already safe**

- **Location:** [`src/tiles/lotPicker.ts`](../../src/tiles/lotPicker.ts)
- **The flag:** "`?k=9999999` could blow up the picker."
- **Why it is correct:** The count is clamped with `Math.min(…, 100)` (and a lower bound) at read time, so a hostile fragment is bounded before use. Defensive and correct as written.

---

## §D — Coverage gaps worth a test (not bugs, just untested corners)

These are correct today but lightly tested; adding cases hardens them against future edits. They feed the property suite in [SPEC-3.md](SPEC-3.md) §2.9. **Status — 2026-06-15: all five are now pinned.**

- **Capital-gains long-term bracket fallback** — [`capitalGains.ts`](../../src/engine/capitalGains.ts) falls back to the `single` schedule (then a 15% default) when a filing status lacks a long-term bracket table. ✅ Pinned in [`tests/golden/capitalGains.test.ts`](../../tests/golden/capitalGains.test.ts): a hand-verified `qualifying_surviving_spouse` case (its 0% band tops at $98,900, distinguishing the QSS table from the single fallback), plus two synthetic-shard cases that exercise the missing-status → `single` and missing-`single` → flat-15% fallbacks.
- **RMD age beyond the table** — [`rmd.ts`](../../src/engine/rmd.ts) clamps an age past the Uniform Lifetime Table's max to the terminal factor. ✅ Pinned by the age-130 → terminal-factor case in [`tests/golden/rmd.test.ts`](../../tests/golden/rmd.test.ts).
- **I-bond / inflation lookups for an absent period/year** — both return `null` for an unknown key ([`savingsBond.ts`](../../src/engine/savingsBond.ts), [`inflation.ts`](../../src/engine/inflation.ts)). ✅ Pinned by the unknown-purchase-period case in [`tests/golden/savingsBond.test.ts`](../../tests/golden/savingsBond.test.ts) and the year-not-in-dataset case in [`tests/golden/inflation.test.ts`](../../tests/golden/inflation.test.ts).
- **Debt payoff where payment exactly equals interest** — the boundary of the `payment <= interest → null` guard in [`finance.ts`](../../src/engine/finance.ts). ✅ Pinned by the payment-exactly-equals-interest case in [`tests/engine/propertyInvariants.test.ts`](../../tests/engine/propertyInvariants.test.ts).
- **Negative-AGI medical floor** — [`deductions.ts`](../../src/engine/tax/deductions.ts) computes the 7.5%-of-AGI medical floor; a negative-AGI input (large adjustments) is an untested corner. ✅ Pinned by the negative-AGI medical-deduction case in [`tests/engine/propertyInvariants.test.ts`](../../tests/engine/propertyInvariants.test.ts) (the floor can no longer go negative and inflate the deduction).

None of these is a defect; each is a cheap insurance policy on a correct behavior.
