# enklayve.com — Build Spec 4: The Public Utility Pass

> Adopted 2026-08-28. This spec adds a fourth pillar and one new capability to each of the three existing ones. It does not change the thesis, the privacy model, or the determinism contract.

Specs 1–3 built a very good calculator suite: 59 deterministic tools across 10 hubs, every statutory number cited, a document Readout that extracts, a session profile, and an ordered plan. The catalog is complete against its own roadmap. This spec argues that the catalog is complete against the wrong map.

- [SPEC-4-safety-net.md](SPEC-4-safety-net.md) — the Pillar 4 tool catalog, item by item, with the admission bar applied to each.
- [SPEC-4-readout-v2.md](SPEC-4-readout-v2.md) — generalizing the Readout from extraction to answers.
- [SPEC-4-ledger.md](SPEC-4-ledger.md) — the standing ledger and the recompute diff, without accounts or a server.

---

## 1. Thesis of this pass

Everything enklayve does well today serves a household that is **planning**. Take-home, marginal rates, Roth ladders, rent-vs-buy, drawdown timelines: these are the questions of someone with slack — money, time, and attention left over after the month is survived. That household is real and worth serving, and we serve it better than the incumbents because we don't sell its data.

But it is not where the money actually is decided for most Americans. The outcomes that separate a household that stabilizes from one that spirals are decided in a different set of moments:

- A raise or extra shift that quietly costs more in lost benefits than it adds in pay.
- A hospital bill that is wrong, or that is legally not owed at all.
- A collections call that claims access to income the law protects.
- A benefits determination letter nobody reads because it is written to be unreadable.
- A month where four bills are due and three can be paid, and the order chosen determines whether the household keeps its housing, its car, and its job.
- The paperwork avalanche after a death, a divorce, a layoff, or a disability.

None of these are hard math. Most are **published, deterministic rules that no clean tool exposes**, because the people who need them are not a lead-generation audience. Bankrate will not build a wage-garnishment exemption calculator, because there is no mortgage to sell at the end of it. That is precisely why it belongs to a public utility.

**This pass turns enklayve from a calculator suite into the thing a person opens on the worst day.**

---

## 2. What we add, in four moves

### 2.1 Pillar 4 — Rough Water

A fourth pillar alongside Take Home & Taxes, What You're Owed, and Safe Harbor. Safe Harbor is calm wealth; Rough Water is the other half of the same nautical frame — the tools for when conditions are bad. The pillar name is a vision-level name; the user-facing hubs stay plainly titled the way the existing 10 hubs are ("Medical Bills", "Debt & Collections", "Benefit Cliffs", "Life Changes").

The pillar's marquee item, and the single highest value-÷-effort item in this entire spec, is the **Benefit Cliff Explorer** (§4.1 of [SPEC-4-safety-net.md](SPEC-4-safety-net.md)): what actually happens to a household's *total resources* — wages, minus taxes, plus EITC/CTC/ACA PTC/SNAP, against Medicaid eligibility — as earnings rise. Every dataset it needs is already bundled and cited. Every incumbent shows the tax marginal rate and stops. Nobody shows a working parent that the shift from $34,000 to $38,000 can be net-negative, or by how much, or exactly where the edge sits.

### 2.2 Readout v2 — documents that answer, not just extract

The Readout today reads 10 tax forms and populates three profile fields. That is the smallest possible version of the right idea. The generalization: **any document a household receives becomes an answer**, in a fixed four-part shape — *what this says* · *what looks wrong* · *what you may be owed* · *what to do next, by when*.

The highest-value additions are not tax forms. They are the documents that arrive with a deadline and no explanation: an Explanation of Benefits, a hospital itemized bill, a benefits determination or denial notice, a collections letter, a closing disclosure, a 401(k) statement with its fee disclosure. Detail in [SPEC-4-readout-v2.md](SPEC-4-readout-v2.md).

### 2.3 The Sequencer — ordering, not arithmetic

My Plan (SPEC-2 §4) orders the *building* steps for a household with surplus. It has no answer for a household with a deficit, which is the more common case and the one where ordering is worth the most money. Two new deterministic sequencers:

- **Bill triage** — when you cannot pay everything this month, the order that preserves housing, utilities, transportation to work, and legal standing, ranked by *consequence severity and timeline*, not by interest rate. The single most valuable thing on the site for a household in crisis, and it is a rules table plus a sort.
- **Life-event sequences** — job loss, death of a family member, divorce, new disability, new baby, moving states. Each is a deterministic, dated checklist of what must be filed, claimed, or changed, in order, with the deadline attached (COBRA election windows, ACA special enrollment periods, beneficiary changes, state UI filing, address-of-record changes). This is the "paperwork shock" tooling, and it is the estate-checklist tile shape (SPEC-2 §6.6) generalized.

### 2.4 The Standing Ledger — the site remembers, without an account

The one honest form of "engagement" for a utility: **the site remembers your situation on your device, and tells you when the world moved under you.** When a bundled dataset changes — new poverty guidelines, a new contribution limit, a new ACA applicable-percentage table — the site recomputes your saved snapshot against the new data and shows the diff: *these four answers changed, this one crossed a threshold, this one has a deadline in 21 days.*

This is the deterministic, private, no-account version of the notification loop every finance app monetizes. No server, no sync, no push. Detail in [SPEC-4-ledger.md](SPEC-4-ledger.md).

**On gamification:** the recompute diff *is* the progression mechanic, and it is the only one this product should have. Points, streaks, levels, and avatars would make the site less trustworthy on the day someone opens it in a panic. The return-visit reason is "it knows my situation and the law changed," not "I have a 14-day streak." This is recorded as a decision, not an omission — see §7.

---

## 3. The admission bar for Pillar 4

Pillar 4 tools carry risks the first three pillars mostly do not: they touch legally consequential decisions, they vary enormously by state, and being wrong can hurt someone materially. The existing bar (SPEC §2, SPEC-3 §2) is necessary but not sufficient. A Pillar 4 tool ships only if it clears **all nine** of the existing invariants plus these four:

1. **Federal floor, state variance named.** The computation is anchored to a federal rule that holds everywhere (a CCPA garnishment cap, a No Surprises Act protection, an FPL percentage). Where a state can be more generous or more restrictive, the tool says so explicitly and does not pretend the federal number is the answer. A tool that cannot be anchored to a federal floor is either built as a 50-state adapter set (the tax-engine pattern, SPEC §8) or parked.
2. **Harm-if-wrong tiering.** Every Pillar 4 tool is tagged with what happens if its output is wrong. Tier 1 (informational: a cliff estimate) ships on the normal bar. Tier 2 (decision-shaping: a bill-triage order) ships with the consequences stated on-screen, not just the ranking. Tier 3 (rights-adjacent: garnishment exemptions, balance-billing protections) ships **screener-only** — it tells you what the rule is and that your situation appears to fall inside or outside it, then names the specific free channel to act through (state legal aid, the CFPB complaint process, the No Surprises Help Desk, a state insurance commissioner). It never drafts a dispute and never says "you don't owe this."
3. **The advice line, stated on the tile.** Pillar 4 is information about published rules applied to numbers you typed. It is not legal, tax, medical-billing, or benefits-eligibility determination. Only the administering agency determines eligibility; only a licensed professional gives advice. Every Pillar 4 tile carries this in its "how/why" block in the house voice — plainly, once, without a wall of disclaimer.
4. **Dignity in the copy.** SPEC §5.3's tone rules apply doubled. No tool in this pillar may imply the user caused their situation, and none may frame the output as a failure state. "Here is what the rule says and what you can do next" — never "you should have."

---

## 4. Non-negotiables carried forward, and two added

Everything in SPEC §2 still holds without exception: deterministic, zero runtime network calls, no telemetry or accounts, offline-first, every statutory number cited, a worked example per tile, deep-linkable, sensitive inputs never persisted, MIT.

Two additions specific to this pass:

10. **Nothing new persists without an explicit, per-session, user-initiated act.** The Standing Ledger is opt-in, device-local, and revocable in one click. The default remains: enter, compute, close, nothing left behind. A user who never opts in must experience the site exactly as it is today.
11. **A deadline shown is a deadline cited.** Any date the site puts in front of a user — a COBRA election window, an enrollment period, an appeal deadline — carries the citation to the rule that sets it and the same verify-before-relying staleness banner as a bracket. Deadlines are the highest-harm numbers on the site.

---

## 5. Roadmap, ordered by value ÷ effort

The full item-by-item catalog with data requirements is in [SPEC-4-safety-net.md](SPEC-4-safety-net.md). Summary order:

**Wave A — no new data, high value.** Everything here computes from shards already bundled and cited.

| # | Item | Why first |
| --- | --- | --- |
| A1 | Benefit Cliff Explorer | Marquee. All data present (FPL, EITC/CTC, ACA, SNAP, Medicaid, the tax engine). Nobody else builds it. |
| A2 | Marginal Reality Rate | Extends the existing Marginal Rate Explorer to include benefit phase-outs. Same engine, one new term. |
| A3 | Bill Triage Sequencer | A consequence-severity rules table plus a sort. Highest value for a household in deficit. |
| A4 | Life-Event Sequences (job loss, death, divorce, new baby, disability, moving states) | The estate-checklist tile shape generalized. Needs a cited deadline table (see §6). |
| A5 | Free-Filing & Free-Help Eligibility | Pure income/age/complexity tests against published thresholds. Saves real households real money for near-zero effort. |

**Wave B — one new cited dataset each.**

| # | Item | New data |
| --- | --- | --- |
| B1 | Medical Bill & EOB Checker (Readout v2) | No Surprises Act protections; the plan math is already in `healthPlanAnnualCost`. |
| B2 | Wage Garnishment & Exempt Income | CCPA caps (15 U.S.C. §1673); federal-benefit protection rules; state exemption pointers. |
| B3 | Benefits Determination / Denial Reader | Appeal-window table by program. |
| B4 | Open Enrollment & Special Enrollment Period map | SEP qualifying-event and window table. |
| B5 | Unemployment Insurance estimator | 50-state adapter set — built the way the state tax engine was, or parked. |

**Wave C — the ledger.** The recompute diff, the deadline surfacing, and the snapshot lifecycle ([SPEC-4-ledger.md](SPEC-4-ledger.md)). Deliberately last: it is only worth building once there are answers worth re-running and deadlines worth surfacing.

---

## 6. Data layer additions

New shards follow the existing gated pipeline without exception — schema, integrity hash, manifest entry, staleness window, refresh workflow, and an entry in [data-sources.md](../data-sources.md). Anticipated:

| Shard | Source | Cadence | Pillar |
| --- | --- | --- | --- |
| `garnishment-limits-<yr>` | 15 U.S.C. §1673 (CCPA); Dept. of Labor Wage & Hour fact sheets; federal-benefit account protection rules | Annual (tracks the federal minimum wage) | 4 |
| `no-surprises-<yr>` | No Surprises Act (Pub. L. 116-260, Div. BB) and CMS implementing guidance | As revised | 4 |
| `enrollment-windows-<yr>` | CMS Marketplace SEP rules; COBRA election periods (ERISA/IRC); Medicare enrollment periods | Annual | 2 & 4 |
| `appeal-windows-<yr>` | Per-program federal regulations (Medicaid fair hearing, SNAP, ACA, UI) | As revised | 4 |
| `free-filing-<yr>` | IRS Free File / Direct File eligibility; VITA/TCE income limits | Annual, Jan | 1 & 2 |
| `state-ui-<st>-<yr>` | Per-state UI agency benefit tables — one adapter per state, tax-engine pattern | Annual, staggered | 4 |

Every one of these has a real staleness risk with real consequence, so each gets a **tighter** staleness window than the tax shards, and the fail-safe contract (SPEC §7.3) degrades to a banner rather than a number, as always.

---

## 7. Decisions recorded

- **No simulation, no game.** A life-simulation game teaching that investing plus nutrition plus fitness compounds is a genuinely good idea and it is a **different product**. It cannot share this codebase's determinism contract (a life sim is a stochastic model of an uncertain future; §2.1 forbids exactly that), its trust posture, or its tone. Building it inside enklayve would compromise the one thing that makes enklayve worth using on a bad day: that it is boring, exact, and cites everything. Park it as a sibling product in the family, the way vaulytica handles documents.
- **No points, streaks, badges, or avatars.** See §2.4. The recompute diff is the return-visit mechanic.
- **No accounts, ever.** The Standing Ledger is device-local and user-held. If continuity across devices is ever wanted, it is a file the user carries (the existing portable export), not a row in our database, because we will never have a database.
- **Scope stays US.** Pillar 4 is more US-specific than anything before it. The country-scope roadmap (SPEC-2 §0.2) is unchanged: get the US right first.
- **Student-loan IDR stays parked**, per SPEC-3 §4.10, with an explicit un-park gate: it ships when the plan set has been stable for one full academic year and each plan's formula can be pinned to a citable published table. It is high value and it will be wrong in a harmful way if we build it against a moving target.

---

## 8. Acceptance criteria for this pass

1. Pillar 4 exists as a named pillar in the vision with at least Wave A shipped, every tool clearing the §3 four-part admission bar in addition to all existing invariants.
2. The Benefit Cliff Explorer correctly reproduces at least three hand-computed worked cliff cases (one ACA subsidy edge, one Medicaid MAGI edge, one SNAP gross-income-test edge) as golden tests, and its output is honest about which programs are modeled and which are not.
3. Every Pillar 4 tile carries its harm tier, its federal-floor/state-variance statement, and the advice line in its "how/why" block — enforced by the audit the way citation coverage already is.
4. Every deadline rendered anywhere on the site carries a citation and participates in the staleness banner (§4, addition 11).
5. Readout v2 answers in the four-part shape for at least the EOB and the benefits-determination document kinds, and no extracted value reaches My Situation without user confirmation, exactly as today.
6. The Standing Ledger is opt-in, device-local, one-click revocable, and a user who never opts in sees no behavioral change whatsoever; the recompute diff is golden-tested against a synthetic dataset-version bump.
7. `npm run test`, `npm run audit`, and the Playwright e2e stay green throughout.

---

## 9. One line positioning

A calm, fast, private place to answer real money questions — including the ones you only ask on your worst day — where every number is computed on your device, cites its source, and tells you what to do next.
