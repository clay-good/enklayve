# SPEC-4 companion — Pillar 4: Rough Water

> The tool catalog for [SPEC-4.md](SPEC-4.md) §2.1, with the §3 admission bar applied item by item. Ordered by value ÷ effort within each wave.

Every item records: **what it answers** (in the user's words), **the deterministic core**, **data** (bundled already, or a new gated shard), **harm tier** (SPEC-4 §3.2), and **the honest limits**. Nothing here ships until its limits are on-screen.

Statutory anchors named below are the *intended* citation targets. Each is verified against the live published source during implementation and pinned into a shard with a content hash like every other number on the site — a citation named in a spec is a lead, not a fact.

---

## Wave A — no new data

### A1 · Benefit Cliff Explorer — **Tier 1** · marquee

**Answers:** "If I take the raise / the extra shift / the second job, am I actually better off?"

**Deterministic core.** Sweep gross earned income across a range and compute, at each step, the household's **total resources**: gross wages, less federal income tax, less FICA, less state income tax, plus EITC, plus the refundable CTC/ACTC, plus the ACA premium tax credit, plus the estimated SNAP allotment — with Medicaid MAGI eligibility rendered as a discrete status change rather than a dollar amount. Plot total resources against gross income; mark every point where the curve flattens or falls, and report the **width and depth of each cliff** in dollars.

**Data.** All present and cited: `federal-income-tax-*`, `fica-*`, `state-*-income-tax-*`, `eitc-ctc-*`, `child-tax-*`, `aca-*`, `snap-*`, `medicaid-*`, `federal-poverty-level-*`. This is why it is first.

**Limits, on-screen.** Programs *not* modeled are named explicitly and prominently: housing assistance, childcare subsidies (CCDF), WIC, LIHEAP, TANF, state EITCs and state-only programs. Several of these have steeper cliffs than anything we do model, so the honest statement is "this shows the cliffs in the programs listed; your real cliff may be larger." SNAP is estimated at the federal baseline with state variation flagged (as the existing SNAP tile already does). The output is an estimate for orientation, not an eligibility determination.

**Why it matters.** This is the single most consequential number in American household finance that no consumer tool displays, and the reason is structural: an incumbent whose revenue is lead-gen has no product to sell to a household at $34,000. We do not have that constraint.

### A2 · Marginal Reality Rate — **Tier 1**

**Answers:** "What does my next $1,000 *actually* cost me?"

**Deterministic core.** The existing Marginal Rate Explorer sums federal + FICA + state. Add the benefit-phase-out term from A1's engine: the EITC phase-out rate, the CTC phase-out, the ACA applicable-percentage step, and the SNAP net-income reduction. Report the combined effective marginal rate, which for some working households exceeds 100%.

**Data.** Same as A1. Effort is small once A1's engine exists — it is A1 evaluated at a point instead of swept.

**Limits.** Inherits A1's unmodeled-program list verbatim.

### A3 · Bill Triage Sequencer — **Tier 2**

**Answers:** "I have $600 and $1,400 of bills. What do I pay first?"

**Deterministic core.** The user lists what is owed and its type. The engine sorts by **consequence severity and timeline**, not interest rate, using a rules table with the classic ordering that housing, utilities needed for habitability, transportation required to keep a job, and legally-enforced obligations (child support, certain tax debts) outrank unsecured consumer debt — and that unsecured medical debt, despite generating the most anxiety, generally carries the least immediate consequence. Output is an ordered list where **each line states the actual consequence and its timeline**, which is the part that changes behavior.

**Data.** A hand-authored, cited consequence-rules table. Anything with genuine state-by-state variance (utility disconnection moratoria and notice periods, eviction timelines, vehicle repossession rules) is rendered as "your state sets this — here is where to check," never as a specific number.

**Harm tier.** Tier 2: the ranking shapes a decision, so consequences ship on-screen alongside the order, and the tool never says "skip this bill." It says what happens if each is unpaid.

**Limits.** Not legal advice, not a hardship-program directory. It should, however, name the *categories* of relief that exist at each line (utility hardship and budget-billing programs, hospital financial assistance / charity care obligations, lender forbearance) so a user knows a channel exists.

### A4 · Life-Event Sequences — **Tier 2**

**Answers:** "My husband died / I lost my job / we're divorcing / the baby is here. What do I have to do, and by when?"

**Deterministic core.** The Estate & Beneficiary Checklist (SPEC-2 §6.6) tile shape, generalized into a set of dated, ordered sequences — one per event: **job loss, death of a spouse or parent, divorce, new disability, new child, moving to another state.** Each step carries what to file or change, who administers it, the deadline where a deadline exists, and a link to the enklayve tile that does the associated math.

**Data.** A new `enrollment-windows-*` / `appeal-windows-*` pair (SPEC-4 §6) for anything with a hard clock — COBRA election periods, ACA special enrollment periods, Medicare enrollment periods, state UI filing timeliness. Steps without a statutory deadline are marked as sequencing guidance rather than a clock.

**Limits.** Deadlines are the highest-harm numbers we render (SPEC-4 §4, addition 11): each is cited and each participates in the staleness banner. Where a plan or state can set a longer window than the federal floor, the tool says the floor is a floor.

**Why it matters.** The paperwork shock after a death or a layoff is where households lose benefits they were entitled to, purely through missed windows. A dated, ordered, cited checklist is a genuinely large amount of recovered money for a very small amount of code.

### A5 · Free Filing & Free Help Eligibility — **Tier 1**

**Answers:** "Do I have to pay to file? Is there free help near me?"

**Deterministic core.** Income, age, and return-complexity tests against the published eligibility thresholds for IRS Free File, IRS Direct File (where available), and the VITA / TCE / MilTax programs. Reads income and filing status from My Situation. Output: which free channels the household appears to qualify for, and the specific complexity features (self-employment, rental income, certain credits) that would disqualify a given channel.

**Data.** New `free-filing-*` shard; small, annual, January cadence. State-availability for Direct File is data, not logic, so it lives in the shard.

**Limits.** Eligibility rules and state availability change annually and mid-season; tight staleness window, and the tool points to the official program page rather than embedding a stale list.

---

## Wave B — one new cited dataset each

### B1 · Medical Bill & EOB Checker — **Tier 3 (screener-only)**

**Answers:** "Is this bill right? Do I actually owe this?"

**Deterministic core.** Three independent checks, each of which either passes, fails, or reports insufficient information — never a verdict:

1. **Plan-math check.** Given the EOB's allowed amount and the plan's deductible / coinsurance / out-of-pocket maximum, recompute patient responsibility using the existing `healthPlanAnnualCost` machinery and compare to what was billed. A mismatch is stated as a mismatch to ask about, not as an error proven.
2. **Balance-billing screen.** Where the EOB and bill together indicate an out-of-network provider at an in-network facility, or emergency care, flag that **No Surprises Act** protections may apply and name the channel to raise it through.
3. **Duplicate / arithmetic screen.** On an itemized bill: repeated line items, quantities inconsistent with dates of service, and line items summing to something other than the stated total.

**Data.** New `no-surprises-*` shard for the protection scope; plan parameters are user-entered as they already are.

**Harm tier.** Tier 3. The tool never says "you don't owe this." It says what the rule is, whether the situation appears to fall inside its scope, and names the free channel — the federal No Surprises Help Desk, the state insurance commissioner, the plan's own appeal process — with the appeal window cited.

**Limits.** We do not price-benchmark and we do not adjudicate medical necessity. Both would require data we cannot bundle and judgment we should not make.

### B2 · Wage Garnishment & Exempt Income — **Tier 3 (screener-only)**

**Answers:** "They're taking money from my paycheck / my bank account. How much can they legally take?"

**Deterministic core.** The federal **CCPA (15 U.S.C. §1673)** ceiling on garnishment of disposable earnings, with the separate, higher ceilings that apply to child support and the separate rules for federal student loans and federal tax levies. Plus the federal protections that apply when exempt federal benefits (Social Security, SSI, VA, and similar) are deposited into an account. Output: the maximum a general creditor garnishment may take under the federal floor, given the user's disposable earnings.

**Data.** New `garnishment-limits-*` shard, tracking the federal minimum wage figure the CCPA formula keys off, plus the per-debt-type ceilings.

**Harm tier.** Tier 3, and the most sensitive item in the pillar. **Many states protect substantially more than the federal floor, and a few effectively prohibit general wage garnishment entirely** — so the federal number is a *ceiling under federal law*, never "what they can take from you." The tool states this before the number, not after, and routes to state legal aid and the CFPB complaint process.

**Limits.** No dispute drafting, no exemption-claim forms, no representation. Screener plus channel, full stop.

### B3 · Benefits Determination & Denial Reader — **Tier 3 (screener-only)** · Readout v2

**Answers:** "What does this letter actually say, and can I do anything about it?"

**Deterministic core.** Recognize the notice type (Medicaid, SNAP, ACA eligibility, UI determination), extract the determination, the stated reason code where one is present, the effective date, and **the appeal deadline** — then present the four-part Readout v2 answer shape. See [SPEC-4-readout-v2.md](SPEC-4-readout-v2.md).

**Data.** New `appeal-windows-*` shard, per-program.

**Limits.** We do not evaluate whether the determination was correct. We make the letter legible, surface the clock, and name the appeal channel — which is most of the value, because the dominant failure mode is a window closing unread.

### B4 · Enrollment Windows Map — **Tier 2**

**Answers:** "Something changed in my life. Can I change my health coverage right now, or do I have to wait?"

**Deterministic core.** A qualifying-event → window mapping across the Marketplace SEP rules, COBRA election periods, employer plan change rules, and Medicare enrollment periods. Input is the life event and its date; output is which windows are open, when each closes, and what each covers.

**Data.** The `enrollment-windows-*` shard shared with A4.

**Limits.** Employer plans may be more generous than the floor; state-based Marketplaces may differ from the federal one. Both are stated.

### B5 · Unemployment Insurance Estimator — **Tier 1, gated**

**Answers:** "If I'm laid off, roughly what will I get, and for how long?"

**Deterministic core.** Per-state benefit formulas from base-period wages: the weekly benefit amount formula, the weekly minimum and maximum, dependent allowances where they exist, and the maximum benefit duration.

**Data.** A `state-ui-<st>-<yr>` adapter set — the same one-adapter-per-state pattern as the state tax engine (SPEC §8), with the same launch-fidelity honesty about what each adapter does and does not model.

**Gate.** This ships **only** as a state-adapter set with the coverage stated per state, exactly as the tax engine does. A "typical state" estimate would be worse than nothing for someone deciding whether they can make rent. If the adapter effort is not funded, this item is parked rather than approximated.

---

## Parked, with un-park gates

| Item | Why parked | Un-park gate |
| --- | --- | --- |
| Student-loan income-driven repayment comparison | SPEC-3 §4.10; the plan set has been moving | One full academic year of stability, each plan's formula pinned to a citable published table |
| Property tax & homestead / senior / veteran / disability exemptions | Set at the state and often county level; thousands of jurisdictions with no canonical machine-readable source | A canonical per-state source exists, or scope narrows to "here is the exemption *category* to ask your assessor about" as a Tier 1 informational map |
| Hospital charity-care / financial-assistance eligibility | Nonprofit hospitals must have written policies, but the thresholds are per-hospital and not centrally published | Scope narrows to "your household is at X% of FPL; nonprofit hospitals are required to publish a policy; here is how to request it" — an FPL computation plus a pointer, which may be worth building *now* as a small A-wave addition |
| Debt-collection statute-of-limitations by state | Genuinely legal, genuinely state-specific, high harm if wrong | Probably never; route to legal aid instead |
| Bankruptcy means test | Deterministic and published, but a person at this point needs a lawyer, and a screener risks substituting for one | Only alongside an unambiguous, prominent route to counsel — revisit after B2 ships and we see how Tier 3 lands |
| Rental assistance / housing voucher eligibility | Local income limits and administration; waitlists dominate outcomes | A canonical income-limit dataset can be bundled and cited |
