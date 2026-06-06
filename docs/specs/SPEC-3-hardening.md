# SPEC-3 companion — Hardening Ledger

> **Status — 2026-06-05.** §A (A1–A4) is applied and shipped. From §B, **B4** (freelance empty-state) is applied; **B1** (URL-clamp disclosure) and **B3** (SNAP AK/HI note) remain open by choice — both are non-blocking judgment calls and B3's surface (the owed-screener region path) is deferred with the rest of the AK/HI allotment work. §C is left untouched on purpose (those are correct). Every §D corner is now pinned by [`tests/engine/propertyInvariants.test.ts`](../../tests/engine/propertyInvariants.test.ts), and the negative-AGI medical-floor corner was hardened (the floor can no longer go negative and inflate the deduction).

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

---

## §B — Triage / hardening opportunities (design judgment, none blocking)

### B1 · Silent URL-clamp breaks the deep-link reproducibility promise — **low** (invariant §2.3, ledger T2)

- **Where:** Read-time clamps that rewrite an out-of-range fragment param without telling the user. Confirmed examples: [`sinkingFund.ts`](../../src/tiles/sinkingFund.ts) (`?m=0` → 1), [`peaceOfMind.ts:34-39`](../../src/tiles/peaceOfMind.ts#L34) (`?wr=0` → 0.1, `?m=0` → 1), [`fafsaSai.ts:47`](../../src/tiles/fafsaSai.ts#L47) (`?size=0` → 1).
- **Judgment:** The clamps themselves are **correct and must stay** — they prevent divide-by-zero (this is why §C2 is not a bug). The only gap is that a pasted link silently produces a different value than it encoded, which nicks the "pasting a link reproduces the exact result" promise. Optional, light fix: when an incoming param was actually out of range, show a one-line note ("Rainy-day target was raised to the 1-month minimum"). Do not change the clamp.

### B2 · Extreme labeled assumptions render as fact with no signal — **low** (invariant §2.4, ledger T1)

- **Where:** Unbounded user-assumption rates: [`rentVsBuy.ts:55-58`](../../src/tiles/rentVsBuy.ts#L55) (`appr`/`rg`/`ir` via `parseNumber`, may be negative or huge), `balanceTransfer` transfer-fee %, `compoundGrowth` return %, `collegeCost` 0% inflation ([`collegeCost.ts:39`](../../src/tiles/collegeCost.ts#L39)).
- **Judgment:** This is **by design** — §2.1 of [SPEC.md](SPEC.md) says the user supplies the assumption and we show the math; a hard clamp would betray that. Not a defect. The principled enhancement is the opt-in sensitivity band ([SPEC-3.md](SPEC-3.md) §4.9) plus an optional calm hint when a value leaves any defensible band ("that's an unusually high rate"). Never a blocking clamp; the hint stays a pure function of the input so determinism holds.

### B3 · Region-limited benefit estimates are skipped without explanation — **low**

- **Where:** [`owedScreener.ts`](../../src/tiles/owedScreener.ts) and [`snap.ts`](../../src/tiles/snap.ts) — SNAP is seeded for the contiguous-US allotments only; Alaska/Hawaii are skipped.
- **Judgment:** Correct to skip (we don't have the AK/HI allotment shards), but a user in those regions sees the absence rather than the reason. Light fix: emit a neutral "SNAP estimate isn't available for Alaska/Hawaii yet — check Benefits.gov" row instead of silently omitting it. Data-honest, no number invented.

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
- **Guard against regression:** Keep the comment at [`fica.ts:67`](../../src/engine/tax/fica.ts#L67) and the golden assertion in [`tests/golden/selfEmployment.test.ts`](../../tests/golden/selfEmployment.test.ts); add a comment on the additional-Medicare lines pointing at Form 8959 line 8 so the base choice is self-documenting.

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

These are correct today but lightly tested; adding cases hardens them against future edits. They feed the property suite in [SPEC-3.md](SPEC-3.md) §2.9.

- **Capital-gains long-term bracket fallback** — [`capitalGains.ts`](../../src/engine/capitalGains.ts) falls back to the `single` schedule (then a 15% default) when a filing status lacks a long-term bracket table. Add a golden case for `qualifying_surviving_spouse` to pin the fallback.
- **RMD age beyond the table** — [`rmd.ts`](../../src/engine/rmd.ts) clamps an age past the Uniform Lifetime Table's max to the terminal factor. Add an age-130 case.
- **I-bond / inflation lookups for an absent period/year** — both return `null` for an unknown key ([`savingsBond.ts`](../../src/engine/savingsBond.ts), [`inflation.ts`](../../src/engine/inflation.ts)); add a `null`-return case for each.
- **Debt payoff where payment exactly equals interest** — the boundary of the `payment <= interest → null` guard in [`finance.ts`](../../src/engine/finance.ts); the strict-less-than case is covered, the equality case is not.
- **Negative-AGI medical floor** — [`deductions.ts`](../../src/engine/tax/deductions.ts) computes the 7.5%-of-AGI medical floor; a negative-AGI input (large adjustments) is an untested corner.

None of these is a defect; each is a cheap insurance policy on a correct behavior.
