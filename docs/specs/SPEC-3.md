# enklayve.com — Build Spec 3: Hardening, Citation Integrity, and the Next Wave

> Your private financial enclave. Every number is computed on your device. Nothing is ever sent anywhere.

This is the third build spec. Where [SPEC.md](SPEC.md) set the vision and the engine and [SPEC-2.md](SPEC-2.md) added the experience, ingestion, and guidance layers, this one is a **trust pass**: it stress-tests every public-facing tool and function, tightens the citation guarantee, and lays out the next wave of tools and enhancements that stay inside the principles.

It was written after a full read of the shipped code (28 jurisdictions, ~52 calculators in 10 hubs, the deterministic engine, and the readout). The headline finding is reassuring: **the engine and tiles are genuinely robust.** The decimal-money discipline holds, divide-by-zero and non-finite paths render a neutral sentinel rather than `$NaN`, missing data shows a verify-before-relying banner, and the no-orphan-numbers audit is real. The fixes this pass prescribes are small and surgical — a handful of citation-consistency lines and a few low-severity hardening items — not a rewrite.

The document has three companions, and this file is the index:

1. **This file (SPEC-3.md)** — the thesis of the pass, the robustness invariants every public function must satisfy, and the expansion roadmap (phased prompts in the SPEC-2 style).
2. **[SPEC-3-hardening.md](SPEC-3-hardening.md)** — the stress-test ledger. Every confirmed fix with location, repro, and the minimal change; the triage items; and — just as important — the **rejected findings**: code that looked wrong, was investigated, and is correct. That section exists so nobody "fixes" a correct calculation later.
3. **[SPEC-3-citations.md](SPEC-3-citations.md)** — the citation-integrity spec: the inline-citation rule restated precisely, the coverage and freshness contracts, the audit results, and the formatting/wrapping conventions (including the long-`sourceDocument` problem).

---

## 1. Thesis of this pass

The wedge is trust, and trust is not a slogan — it is the sum of small guarantees that each hold under stress. A user who types their salary into a take-home calculator is extending credit to every line of math behind it. This pass pays that credit down in three currencies:

1. **Correctness under stress.** Every public function is a pure function of its inputs and the bundled dataset (§2.1 of [SPEC.md](SPEC.md)). A pure function can still surprise: a zero denominator, a negative AGI, a hostile URL fragment, a number near `Number.MAX_VALUE`. The robustness invariants in §2 below are the contract that says *no input produces a wrong-but-plausible number presented as fact.*
2. **Citation integrity.** "Every rule cites its source" is the load-bearing principle. A number that is shown without its source — even a derived one whose inputs are cited elsewhere on screen — chips at the guarantee. §3 below and [SPEC-3-citations.md](SPEC-3-citations.md) define exactly which numbers must carry an inline citation and how those citations should read.
3. **Honest scope growth.** New tools earn their place only if they compute deterministically from cited, bundled data and never give advice or guess a market return. §4 curates the next wave against that bar and explicitly parks the tempting-but-out-of-scope ideas.

Nothing here weakens an existing principle. Every change is additive or a tightening.

---

## 2. Robustness invariants (the stress-test contract)

These are the properties every **public-facing function** — a tile's `mount`, an engine export, a readout extractor — must satisfy. They are written so they can be turned into property-based tests (see §2.9). Most are already met; the ledger in [SPEC-3-hardening.md](SPEC-3-hardening.md) records the exceptions.

### 2.1 No non-finite number ever reaches the screen

Any displayed figure that could be `NaN`, `Infinity`, or `-Infinity` must render the neutral sentinel `(out of range)` (or an equivalent empty state), never `$NaN`, `$∞`, or `NaN%`. The shared formatters already enforce this: [`Money.format`](../../src/engine/money.ts#L135) returns `(out of range)` for non-finite values, and tiles that compute in plain `number` space mirror it (see the `usd`/`months` helpers in [`peaceOfMind.ts`](../../src/tiles/peaceOfMind.ts#L96)). **Invariant:** a tile that formats a raw `number` must route it through a non-finite-guarded formatter, not `Intl.NumberFormat` directly.

### 2.2 Division denominators are guarded or proven non-zero

Every division by a user-supplied or derived quantity (income, term, count, price, payment, rate, household size) is either (a) guarded with an explicit zero check that yields a defined result, or (b) provably non-zero because the input is clamped at read time. Both patterns are in use and both are acceptable; what is not acceptable is an unguarded divide that depends on a field a user can set to zero. The engine's [`Money.divide`](../../src/engine/money.ts#L63) throws on a zero divisor by design, so callers must guard before calling it.

### 2.3 Inputs are clamped at the boundary, and clamping that changes a deep link is disclosed

Read-time parsing (`parseNonNegative`, `parseNumber`, and the per-tile `Math.max(min, …)` guards) clamps out-of-range values. This is correct and must stay. The one refinement: when a value arrived from the **URL fragment** and was silently rewritten (e.g. `?m=0` becomes a 1-month minimum), the tile should not pretend the link reproduced exactly. A deep link is a promise that "pasting a link reproduces the exact result" (§2.7 of [SPEC.md](SPEC.md)); a clamp quietly breaks it. The disclosure can be light (a one-line note), and is only required when the incoming param was actually out of range — see ledger item T2.

### 2.4 Labeled assumptions may be extreme, but extremes are signposted

The app deliberately lets the user supply assumptions (a rate of return, an inflation rate, an appreciation rate) and shows the math rather than guard-railing the scenario (§2.1 of [SPEC.md](SPEC.md)). That is correct and is **not** a bug. The invariant is narrower: when an assumption is outside any defensible band (a negative or >100% annual return, a transfer fee over ~20%), the tile may show a calm, non-blocking hint ("that's an unusually high rate") so the user knows the output is a stress scenario, not a recommendation. This is an enhancement, never a hard clamp — see ledger item T1. Determinism is preserved: the hint is a pure function of the input.

### 2.5 Missing or stale data degrades to a banner, never a number

A tile that depends on a bundled shard must check availability before computing and render the verify-before-relying banner if it is missing (the pattern in [`federalIncomeTax.ts`](../../src/tiles/federalIncomeTax.ts#L116), [`acaPtc.ts`](../../src/tiles/acaPtc.ts#L125), [`backdoorRoth.ts`](../../src/tiles/backdoorRoth.ts#L89)). Two corollaries from the audit:

- **No silent magic-number fallback for a statutory figure.** A `?? 168600`-style default substitutes a stale constant for a missing cited value and presents it as fact. Where a tile needs a figure from a second shard, it must gate on that shard's availability, not fall back to a literal. See ledger item C4 ([`fafsaSai.ts`](../../src/tiles/fafsaSai.ts#L85)).
- **Tiles with no bundled-data dependency need no banner.** A pure user-arithmetic tile (e.g. the health-plan chooser, which only divides the user's own premium/deductible/coinsurance) correctly has no data guard. Do not add one.

### 2.6 URL-param round-trips never silently change the meaning of the answer

A stale or hostile `?param` may not produce a different *kind* of answer without the user seeing it. Enum-typed params (filing status, deduction mode, region, state) must validate-and-fall-back to a visible default that the UI then reflects (the selected option changes), so the user can see the substitution. This is already the established pattern; the invariant just names it.

### 2.7 Iterative loops have a proven upper bound and a defined terminal case

Amortization, drawdown, debt-payoff, and compounding loops must terminate. The two failure modes are an infinite loop (payment ≤ interest forever) and a silent truncation (a cap that drops the tail without telling the user). The engine already returns `null` for the non-terminating debt case ([`finance.ts`](../../src/engine/finance.ts) payoff path) and caps horizons explicitly (covered by [`tests/engine/horizonCaps.test.ts`](../../tests/engine/horizonCaps.test.ts)). **Invariant:** every loop has a documented cap, and hitting the cap is either impossible for real inputs or surfaced to the user, never swallowed.

### 2.8 Every statutory number on screen carries an inline citation

This is the citation contract; it is specified in full in [SPEC-3-citations.md](SPEC-3-citations.md) and summarized in §3 below. Stated as an invariant: if a breakdown line shows a figure that originates from a bundled shard (a bracket, a limit, a threshold, a poverty line, a credit amount, an allowance from a published table), that line carries a `citation`. Derived arithmetic on the user's own inputs (an effective rate, a sum the user could do themselves) does not require one, but a derived figure whose *siblings* are all cited should be cited too, for consistency — that is the seam the audit found.

### 2.9 These invariants are testable

The invariants above should be encoded as a small property-based suite (extending [`tests/engine/invariants.test.ts`](../../tests/engine/invariants.test.ts)) that fuzzes each public engine function over the boundary space (zero, negative, very large, fractional, empty/singleton arrays) and asserts: the result is finite or a defined sentinel, the function does not throw except where documented, and known statutory identities hold (SE tax on 92.35% of net earnings, capital-gains stacking on ordinary income, EITC plateau, the I-bond composite-rate formula). A companion UI smoke pass should mount every tile with an adversarial `URLSearchParams` and assert no `NaN`/`Infinity` text node appears.

---

## 3. The citation contract, restated

Full detail lives in [SPEC-3-citations.md](SPEC-3-citations.md). The three obligations, in brief:

- **Coverage.** Every shipped statutory figure resolves to a non-empty citation; the build-time audit ([`scripts/audit-release.ts`](../../scripts/audit-release.ts)) fails the build on an orphan. On screen, a breakdown line that shows a statutory figure carries an inline `citation`; the audit found three low-severity consistency gaps where a derived figure sits uncited beside cited siblings (the I-bond "Value now", the backdoor-Roth "Tax-free portion", and the FAFSA allowance lines).
- **Freshness.** Each shard's `effectiveYear` is current for the active tax year, or the gap is documented in the `sourceDocument` string and inside the refresh window. The deliberate, documented exceptions (CA brackets pending the FTB's 2026 schedule, the FAFSA 2026-27 methodology, the CPI-U 2025 partial-year average, ACA's post-ARPA 2026 table) remain defensible as of 2026-06-05.
- **Formatting.** A citation reads as `{sourceDocument} ({effectiveYear})` in the tooltip and renders as a compact "source" link ([`resultCard.ts`](../../src/ui/resultCard.ts#L40)). The audit flagged that several `sourceDocument` strings have grown to 500–840 characters — fine in the manifest as an audit record, unwieldy as a hover tooltip. [SPEC-3-citations.md](SPEC-3-citations.md) defines a short-label/long-note split to fix this without losing the provenance detail.

---

## 4. Expansion roadmap: the next wave

Same bar as always: US personal finance, deterministic, computable from bundled cited data, no market guessing, no advice. Each tool below was checked against that bar; the parked list at the end records what failed it and why. Ordered by value ÷ effort.

### 4.1 Cross-tool linking (enhancement, trivial, highest ROI)

The calculators already share an engine and a profile; they don't yet point at each other. Add a small "related" affordance so a user mid-decision lands on the next relevant tool with context carried over:

- Capital Gains and Federal Income Tax → **Marginal Rate Explorer** ("what will my next $1,000 cost?").
- Social Security Claiming Age → **Retirement Drawdown**, pre-filled with the claimed benefit.
- Retirement Optimizer → **Backdoor Roth** when income blocks a direct Roth and there's contribution room.
- Every plan step in My Plan → its primary tile *and* its prerequisite (capture-the-match before extra debt paydown).

No new math, no new data. Pure routing plus the existing profile sync. Deterministic by construction.

### 4.2 Estimated-tax due-date calendar (enhancement to Quarterly Taxes, low effort)

Quarterly Taxes shows the four payment amounts but not *when* to send them. Add the IRS 1040-ES calendar (Apr 15, Jun 15, Sep 15, Jan 15 of the following year, with the next-business-day rule) as a cited breakdown. The dates are statutory and already adjacent to a cited shard. Surfaces the penalty risk that the amounts alone hide.

### 4.3 IRA deductibility screener (new tool, Retirement hub, low effort)

"Can I deduct my traditional-IRA contribution, or is it nondeductible because I (or my spouse) have a workplace plan?" Inputs: contribution, filing status, MAGI, covered-by-a-plan flag. Output: deductible amount, phase-out status, nondeductible basis, and a pointer to the pro-rata rule it sets up. The phase-out ranges live in the IRS annual notice alongside the retirement limits already bundled — cite IRC §219 and the published ranges. Pairs naturally with the existing Backdoor Roth tile and closes a genuinely common confusion. Deterministic; one new figure to seed.

### 4.4 Gift-tax exclusion tracker (new tool, Paycheck & Taxes hub, low effort)

"Is my gift to family taxable, or does it sit under the annual exclusion / lifetime exemption?" Inputs: gift amount, recipient (spouse vs not), lifetime exemption already used (user-supplied). Output: annual-exclusion headroom, lifetime-exemption impact, whether a Form 709 is required. Two cited IRS figures (the annual exclusion and the lifetime exemption from the annual inflation-adjustment notice). Deterministic, descriptive (no "should you gift"), cleanly in scope. Needs a small new shard.

### 4.5 Kiddie-tax estimator (new tool, Investing hub, low–medium effort)

"How is my child's investment income taxed?" Inputs: child's earned and unearned income, age/student status, parents' marginal rate. Output: the IRC §1(g) stack — the dependent standard-deduction shelter, the next band at the child's rate, the remainder at the parents' rate — and the effective rate on the unearned portion. All parameters are statutory and cited. Deterministic; frames the complexity honestly and points to a pro for the edge cases.

### 4.6 Education-credit comparison: AOTC vs Lifetime Learning (new tool, Benefits & Aid hub, low–medium effort)

"Which education credit saves more this year?" Inputs: AGI, filing status, qualified expenses by type, years in program. Output: AOTC vs LLC side by side, phase-out status, the refundable portion of the AOTC. Needs a new shard for the two credits' parameters (annual IRS notice) — they are not yet bundled. High household value, deterministic, comparison-not-advice framing.

### 4.7 AMT quick screener (new tool, Paycheck & Taxes hub, low effort, screener-only)

"Might I owe the Alternative Minimum Tax?" A deliberately *coarse* screener: AMT exemption and phase-out (cited IRS figures) against the user's preference items (SALT, etc.), returning a yes/maybe/no with a pointer to Form 6251. It explicitly does not attempt the full AMT computation — that would over-promise. Honest, cited, and useful as a flag.

### 4.8 Peace-of-Mind arrival date (enhancement, low–medium effort)

The dashboard shows progress toward the Enough Number but not *when* you arrive at the current savings rate. Add a deterministic projection: at a user-supplied monthly savings rate (a labeled assumption, no market return guessed unless the user supplies one), show the months/years to the target. Pure arithmetic over the existing readings; keeps the calm-progress tone.

### 4.9 Sensitivity bands (enhancement, opt-in, medium effort)

For the assumption-heavy tools (Rent vs Buy, College Cost, Compound Growth, Retirement Drawdown), add an opt-in "show me a range" toggle that recomputes the same deterministic function at the user's assumption ±a labeled delta and shows low/base/high. This is the principled answer to the "extreme inputs look like fact" seam (invariant §2.4): instead of guard-railing, show the fragility. Still 100% deterministic — three pure evaluations, not a simulation.

### 4.10 Parked (out of scope or deferred, on purpose)

Recorded so they are not re-proposed without the bar in mind:

- **Anything needing a market-return forecast** (Monte Carlo retirement success, "will my portfolio last") — violates §2.1. Sensitivity bands (§4.9) are the in-scope substitute.
- **NUA, installment sales, QOZ, charitable-remainder-trust valuation, passive-activity-loss tracking** — statute-heavy and case-dependent; a screener would be low value and risks reading as advice. Defer until there is a clear deterministic core and a cited table.
- **Multistate / nonresident allocation** — requires per-state sourcing rules not yet modeled; revisit after the state engine deepens beyond launch fidelity (per [data-sources.md](../data-sources.md), credits and local add-ons are already deferred).
- **Student-loan income-driven repayment comparison** — high value but large, and the federal plan landscape is still shifting; defer until the formulas stabilize and can be cited cleanly.

---

## 5. Acceptance criteria for this pass

> **Status — 2026-06-05.** Criteria 1–3 are met and shipped; the suite is green (`npm run test`, `npm run audit`, and the Playwright e2e). Criterion 4 is forward-looking — it governs the §4 tools when they are built; none of those is in this pass.

1. ✅ The robustness invariants in §2 are encoded as tests (the property suite of §2.9 — see [`tests/engine/propertyInvariants.test.ts`](../../tests/engine/propertyInvariants.test.ts), which sweeps the engine's public functions over the boundary space and pins the SE-92.35%, capital-gains-stacking, EITC-plateau, and I-bond composite-rate identities), and the full golden + UI suite stays green.
2. ✅ The confirmed fixes in [SPEC-3-hardening.md](SPEC-3-hardening.md) §A are applied (and §B4); the rejected §C findings are left untouched and their correctness is captured in a test or comment so they are not "fixed" later.
3. ✅ The citation-consistency gaps in [SPEC-3-citations.md](SPEC-3-citations.md) are closed, every long `sourceDocument` string is split into a short name plus a `sourceNote`, the audit enforces the ≤160-char cap, and `npm run audit` still passes.
4. ⏳ Any new tool from §4 ships with a worked example, an inline citation on every statutory line, a verify-before-relying banner on its data dependency, a deep-linkable URL state, and a "how/why" copy block — the same bar every existing tile meets. *(Forward-looking: applies when the §4 tools are built.)*

---

## 6. One line positioning

The same as it ever was, now load-bearing under stress: **a calm, fast, private place to answer real money questions, where every number is computed on your device, cites its source, and behaves the same way no matter what you throw at it.**
