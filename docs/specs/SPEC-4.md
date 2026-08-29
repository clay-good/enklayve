# enklayve.com — Build Spec 4: The Public Utility Pass

> Adopted 2026-08-28. Hardened 2026-08-28 (§7 interfaces, §8 build plan, §9 readiness gate). This spec adds a fourth pillar and one new capability to each of the three existing ones. It does not change the thesis, the privacy model, or the determinism contract.

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

A fourth pillar alongside Take Home & Taxes, What You're Owed, and Safe Harbor. Safe Harbor is calm wealth; Rough Water is the other half of the same nautical frame — the tools for when conditions are bad. The pillar name is a vision-level name; the user-facing hubs stay plainly titled the way the existing 10 hubs are ("Benefit Cliffs", "When Money Is Tight", "Life Changes").

The pillar's marquee item, and the single highest value-÷-effort item in this entire spec, is the **Benefit Cliff Explorer** (§A1 of [SPEC-4-safety-net.md](SPEC-4-safety-net.md)): what actually happens to a household's *total resources* — wages, minus taxes, plus EITC/CTC/ACA PTC/SNAP, against Medicaid eligibility — as earnings rise. Every dataset it needs is already bundled and cited. Every incumbent shows the tax marginal rate and stops. Nobody shows a working parent that the shift from $34,000 to $38,000 can be net-negative, or by how much, or exactly where the edge sits.

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

**On gamification:** the recompute diff *is* the progression mechanic, and it is the only one this product should have. Points, streaks, levels, and avatars would make the site less trustworthy on the day someone opens it in a panic. The return-visit reason is "it knows my situation and the law changed," not "I have a 14-day streak." This is recorded as a decision, not an omission — see §9.

---

## 3. The admission bar for Pillar 4

Pillar 4 tools carry risks the first three pillars mostly do not: they touch legally consequential decisions, they vary enormously by state, and being wrong can hurt someone materially. The existing bar (SPEC §2, SPEC-3 §2) is necessary but not sufficient. A Pillar 4 tool ships only if it clears **all nine** of the existing invariants plus these four:

1. **Federal floor, state variance named.** The computation is anchored to a federal rule that holds everywhere (a CCPA garnishment cap, a No Surprises Act protection, an FPL percentage). Where a state can be more generous or more restrictive, the tool says so explicitly and does not pretend the federal number is the answer. A tool that cannot be anchored to a federal floor is either built as a 50-state adapter set (the tax-engine pattern, SPEC §8) or parked.
2. **Harm-if-wrong tiering.** Every Pillar 4 tool is tagged with what happens if its output is wrong. **Tier 1** (informational: a cliff estimate) ships on the normal bar. **Tier 2** (decision-shaping: a bill-triage order) ships with the consequences stated on-screen, not just the ranking. **Tier 3** (rights-adjacent: garnishment exemptions, balance-billing protections) ships **screener-only** — it tells you what the rule is and that your situation appears to fall inside or outside it, then names the specific free channel to act through (state legal aid, the CFPB complaint process, the No Surprises Help Desk, a state insurance commissioner). It never drafts a dispute and never says "you don't owe this." The tier is a machine-checked field, not a convention — see §7.2.
3. **The advice line, stated on the tile.** Pillar 4 is information about published rules applied to numbers you typed. It is not legal, tax, medical-billing, or benefits-eligibility determination. Only the administering agency determines eligibility; only a licensed professional gives advice. Every Pillar 4 tile carries this in its "how/why" block in the house voice — plainly, once, without a wall of disclaimer.
4. **Dignity in the copy.** SPEC §5.3's tone rules apply doubled. No tool in this pillar may imply the user caused their situation, and none may frame the output as a failure state. "Here is what the rule says and what you can do next" — never "you should have."

---

## 4. Non-negotiables carried forward, and two added

Everything in SPEC §2 still holds without exception: deterministic, zero runtime network calls, no telemetry or accounts, offline-first, every statutory number cited, a worked example per tile, deep-linkable, sensitive inputs never persisted, MIT.

Two additions specific to this pass:

10. **Nothing new persists without an explicit, per-session, user-initiated act.** The Standing Ledger is opt-in, user-held, and revocable in one click. The default remains: enter, compute, close, nothing left behind. A user who never opts in must experience the site exactly as it is today.
11. **A deadline shown is a deadline cited.** Any date the site puts in front of a user — a COBRA election window, an enrollment period, an appeal deadline — carries the citation to the rule that sets it and the same verify-before-relying staleness banner as a bracket. Deadlines are the highest-harm numbers on the site, and this is enforced by the type system (§7.3), not by review.

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
| A6 | Charity-care pointer (folded into A5) | An FPL computation the site already does, plus a cited pointer. About a day of work. |

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

New shards follow the existing gated pipeline without exception — a `DATASET_SCHEMAS` entry, an integrity hash, a `ManifestEntry` (with `expectedRefreshMonths` and `staleAfterYears`), a refresh workflow under `scripts/refresh/`, and a row in [data-sources.md](../data-sources.md). Anticipated:

| Shard id | Source | `expectedRefreshMonths` | `staleAfterYears` | Pillar |
| --- | --- | --- | --- | --- |
| `garnishment-limits-<yr>` | 15 U.S.C. §1673 (CCPA); DOL Wage & Hour fact sheets; federal-benefit account protection rules | 12 | 0 | 4 |
| `no-surprises-<yr>` | No Surprises Act (Pub. L. 116-260, Div. BB) and CMS implementing guidance | 12 | 0 | 4 |
| `enrollment-windows-<yr>` | CMS Marketplace SEP rules; COBRA election periods (ERISA/IRC); Medicare enrollment periods | 12 | 0 | 2 & 4 |
| `appeal-windows-<yr>` | Per-program federal regulations (Medicaid fair hearing, SNAP, ACA, UI) | 12 | 0 | 4 |
| `free-filing-<yr>` | IRS Free File / Direct File eligibility; VITA/TCE income limits | 12 | 0 | 1 & 2 |
| `bill-triage-consequences` | Hand-authored, cited consequence-rules table (see §A3) | 12 | 1 | 4 |
| `state-ui-<st>-<yr>` | Per-state UI agency benefit tables — one adapter per state, tax-engine pattern | 12 | 0 | 4 |

Every one of these carries real staleness risk with real consequence, so each is pinned at **`staleAfterYears: 0`** — no grace year, unlike the tax shards. A Pillar 4 shard past its effective year degrades to the verify-before-relying banner immediately, and the fail-safe contract (SPEC §7.3) shows a banner rather than a number, as always.

Every statutory anchor named in this spec and its companions is a **lead, not a fact**. Each is verified against the live published source during the refresh-workflow step of its phase and pinned with a content hash like every other number on the site. No number enters a shard on the authority of this document.

---

## 7. Interfaces this pass adds

The contracts below are what make §3 and §4 enforceable rather than aspirational. All are small, additive, and land in Phase 18 before any Pillar 4 tool is built.

### 7.1 The pillar and its hubs

`Pillar` (in `src/tiles/types.ts`) gains one value: **`"rough"`**. Three new hubs register under it, each following the existing `HubConfig` shape, with the fourth item folded into an existing hub rather than creating a one-tool hub:

| Hub id | Title | Default tool | Tools |
| --- | --- | --- | --- |
| `benefit-cliffs` | Benefit Cliffs | `cliff-explorer` | `cliff-explorer` (A1), `marginal-reality` (A2) |
| `when-money-is-tight` | When Money Is Tight | `bill-triage` | `bill-triage` (A3), `garnishment` (B2), `free-filing` (A5) |
| `life-changes` | Life Changes | `life-events` | `life-events` (A4), `enrollment-windows` (B4), `ui-estimator` (B5, gated) |

The **EOB & Medical Bill Checker** (`eob-checker`, B1) joins the existing `protection` hub next to the Health Plan Chooser, because it reuses `healthPlanAnnualCost` and belongs beside the tool that sets up the plan parameters it checks.

This takes the site from 10 hubs to 13. That is the ceiling: any further Pillar 4 tool joins an existing hub or displaces one, per the SPEC-2 §1.5 rule that no card becomes a dumping ground and no hub is a card with one thing on it.

### 7.2 `harmTier` — machine-checked, not conventional

`TileDefinition` gains:

```ts
/** Harm-if-wrong tier (SPEC-4 §3.2). Required for every pillar: "rough" tile.
 *  1 = informational, 2 = decision-shaping (consequences must render on-screen),
 *  3 = rights-adjacent (screener-only; must name a free channel to act through). */
harmTier?: 1 | 2 | 3;
/** For harmTier 3: the free channels this tool routes to. Required at tier 3. */
channels?: { label: string; url: string; note?: string }[];
```

A new check, `checkHarmTier(tiles)` in `scripts/audit-release.ts`, fails the build when any tile with `pillar === "rough"` omits `harmTier`, when a tier-3 tile has an empty `channels`, or when a tier-2 or tier-3 tile's `how` block is missing the advice line. It lives beside `checkProvenance` and `checkCitationLength` so every release invariant is readable in one place, but it **runs from the test suite, not the audit CLI** — the CLI executes under plain `node`, which cannot resolve the extensionless TypeScript module graph the tile registry is built from. `tests/build/auditRelease.test.ts` applies it to the real catalog and CI runs `npm run test`, so the gate is no weaker for living there.

### 7.3 `Deadline` — a date cannot exist without its citation

A new engine type makes §4's addition 11 impossible to violate by omission:

```ts
export interface Deadline {
  label: string;
  /** ISO date, or a window expressed as days-from-trigger. */
  due: { on: string } | { daysFromTrigger: number; trigger: string };
  citation: CitationData;          // non-optional, on purpose
  channel?: { label: string; url: string };
}
```

Every deadline rendered anywhere on the site is produced by a single `renderDeadline(deadline, asOf)` helper, so the citation link and the staleness banner are structural rather than remembered. `asOf` is an explicit parameter — the system clock is an *input*, displayed on screen and encoded in the deep link, so a deadline view stays reproducible (the determinism contract, honestly kept). A UI test asserts that every rendered deadline node carries a source link.

### 7.4 The cliff engine

One new module, `src/engine/cliffs.ts`, which A1, A2, and the Readout's "what you may be owed" section all call:

```ts
export interface ResourcePoint {
  grossIncome: number;
  netAfterTax: number;            // gross − federal − FICA − state
  credits: number;                // EITC + refundable CTC/ACTC
  acaPremiumCredit: number;
  snapAllotment: number;
  totalResources: number;         // the sum that matters
  medicaidEligible: boolean | null;  // null = not determinable for this state
  notes: string[];                // e.g. "SNAP not estimated for AK/HI"
}
export function sweepResources(input: CliffInput, opts?: SweepOptions): ResourcePoint[];
export function findCliffs(points: ResourcePoint[]): Cliff[];
```

Hardened behavior, all testable:

- **Bounded sweep.** Default range is `$0` to `max(4 × FPL for the household, 2 × entered income)`, capped at `$250,000`. Step defaults to `$250`, clamps to `[$50, $5,000]`, and the point count is hard-capped at **400** — the proven upper bound SPEC-3 §2.7 requires. A range/step combination exceeding the cap widens the step rather than truncating the range, and says so.
- **Cliff definition.** A cliff is a maximal contiguous run of points where `totalResources` is non-increasing while `grossIncome` rises. Each reports its start income, end income, **width** (income delta) and **depth** (peak `totalResources` minus trough). A run whose depth is below `$1` is discarded as float noise, not reported.
- **Medicaid is never monetized.** Losing Medicaid is rendered as a status change annotated at the crossing income, never converted to a dollar figure. We cannot price a household's coverage and must not pretend to. This is the honesty constraint that keeps A1 from becoming a fake number.
- **Robustness.** `sweepResources` joins the §2.9 property suite: no non-finite value in any field, at any point, for any of the 51 jurisdictions × 5 filing statuses × the household-size and income grid.

---

## 8. Build plan: Phases 18–24

Ordered prompts in the SPEC/SPEC-2 convention. Each phase is independently shippable and leaves the suite green. Phases 19–24 assume Phase 18 has landed.

### Phase 18: Pillar 4 foundations

**Goal.** Make the §3 admission bar and the §4 deadline rule enforceable before a single Pillar 4 tool exists.

**Context.** Every following phase depends on this. **Nothing user-visible ships here at all** — see the note below.

**Deliverables.** The `"rough"` pillar value; `harmTier` and `channels` on `TileDefinition`; `checkHarmTier` with its fixture tests and a test applying it to the real catalog; the `Deadline` type (`src/engine/deadline.ts`) and the single `renderDeadline` path (`src/ui/deadline.ts`) with their tests and styles.

**Acceptance.** ✅ `checkHarmTier` flags a fixture tile that is `pillar: "rough"` with no tier, a tier-3 tile with no channel, and a tier-2 tile missing the advice line — and passes the real catalog. `renderDeadline` cannot be called without a citation (the type makes it a compile error) and always paints the source link and the `asOf` date. The existing 59 tiles are untouched and the suite is green.

**Two deviations from the spec as first written, both deliberate.** *(1) No empty hubs.* The plan called for registering the three §7.1 hubs with `coming-soon` placeholder tiles. Building it showed that to be worse on three counts: `defineHub` hard-codes `status: "ready"` and `mountHub` renders nothing for a tool with no `mount`, so placeholders need new rendering code that exists only to be deleted; `SUB_TOOLS` feeds the SEO page generator and `SEARCH_ENTRIES` feeds the command palette, so placeholders would advertise tools that do not exist; and a public utility showing "coming soon" cards is a small broken promise on every visit. Each hub now lands in the phase that ships its first real calculator, which also makes Phase 18 a zero-risk deploy. *(2) No `cliffs.ts` scaffold.* An engine module with types but no implementation is dead code until Phase 19 builds it; it lands there instead.

### Phase 19: The Benefit Cliff Explorer and the Marginal Reality Rate

**Goal.** Ship the marquee item and its point-evaluated sibling.

**Context.** Zero new data. The whole phase is `src/engine/cliffs.ts` plus two tiles and the `benefit-cliffs` hub itself, which is registered here rather than in Phase 18.

**Deliverables.** `sweepResources` / `findCliffs` per §7.4; the `cliff-explorer` tile with a chart on the existing framework-free chart layer and a table fallback; the `marginal-reality` tile; "Related tools" links to and from the existing Marginal Rate Explorer; the unmodeled-program list rendered prominently on both.

**Acceptance.** ✅ Three hand-computed golden cliff cases pass — one ACA subsidy edge, one Medicaid MAGI edge, one SNAP gross-income-test edge ([`tests/engine/cliffs.test.ts`](../../tests/engine/cliffs.test.ts)). The sweep returns no non-finite value across filing statuses, household sizes, and incomes. Both tiles are Tier 1, deep-linkable, worked-example-first, axe-clean, and name every program they do not model.

**Three things the plan didn't anticipate, all now settled.**

- *`findCliffs` reports plateaus as well as drops.* §7.4 defined a cliff as a maximal non-increasing run with a $1 noise floor, which silently discards a *flat* stretch — earning $2,000 more and keeping none of it. §A1 asks for where the curve "flattens or falls", so a `Cliff` now carries `kind: "drop" | "plateau"`. They are never conflated: only one is a loss.
- *Two composition bugs the unit tests would not have caught, found by reading a real sweep.* The ACA premium tax credit was being added below 100% FPL, where no credit exists — inventing thousands of dollars at the low end and flattening the real step at the 100%-FPL line. And the refundable Child Tax Credit is shown at its cap because the bundled shard carries the cap but not the earned-income phase-in; rather than hard-code a statutory literal (SPEC §2 principle 5), the overstatement is **disclosed** in the on-screen "what this leaves out" list. The first was a bug and is fixed; the second is a stated limit.
- *A hub inherits the strictest harm tier of its tools.* `defineHub` generates a real navigable tile, and the Phase 18 gate correctly failed the build because that generated tile had no tier. Hubs now take the highest tier among their calculators and the union of their channels — a hub hosting a tier-3 screener is itself rights-adjacent, and must not slip under the bar by being a container.

### Phase 20: The sequencers

**Goal.** Bill triage and life-event sequences — the ordering tools.

**Deliverables.** The cited `bill-triage-consequences` shard and its refresh workflow; the `bill-triage` tile (Tier 2, consequences rendered per line, state-variable items rendered as "your state sets this"); the `enrollment-windows-<yr>` and `appeal-windows-<yr>` shards; the `life-events` tile covering all six sequences, every dated step going through `renderDeadline`.

**Acceptance.** Every deadline carries a citation and participates in the staleness banner. The triage output never says "skip a bill" — a copy test asserts the forbidden phrasings are absent. Both tiles carry the advice line and pass `checkHarmTier`.

**Split into 20a and 20b.** ✅ **20a — Bill Triage — is shipped**, as the `bill-triage-2026` shard (the ordering framing and consequence language come from the CFPB's own *Prioritizing bills* tool) plus `engine/triage.ts` and the `when-money-is-tight` hub. It needed none of the deadline machinery, so it could be sourced and shipped on its own. **20b — Life-Event Sequences — is deferred to its own phase**, because it turns on `enrollment-windows` and `appeal-windows`: statutory clocks (COBRA election, ACA special enrollment, Medicare enrollment, per-program appeal windows) that are the highest-harm numbers on the site under §4 addition 11. They deserve a dedicated sourcing pass against live published regulations rather than being carried along beside a tool that needed none of them.

Two notes from building 20a. The shard carries *state-set* timing as a pointer with no figure in it, and a schema test asserts no `timingNote` contains a "within N days"-style number — so the 50-jurisdiction problem cannot leak back in later as a plausible-looking default. And the tile's first visit falls back to the worked example **whole**: defaulting the bill rows but not the available money opened the page on "$0 covers $0 of $2,455" with every line reading "nothing left for this", an alarming and meaningless first impression for a tool people reach on a bad day.

### Phase 21: Free filing and free help

**Goal.** The cheapest real money the site can hand someone.

**Deliverables.** The `free-filing-<yr>` shard (income, age, and complexity thresholds; Direct File state availability as data); the `free-filing` tile reading income and filing status from My Situation; explicit disqualifying-complexity output.

**Acceptance.** ✅ Tier 1, cited, `staleAfterYears: 0`, and it links to the official program page rather than embedding a list that will rot.

**What sourcing turned up, and one deviation.** IRS Direct File **is not available for filing season 2026** — the IRS notified states it would not run and set no launch date, and it appears on neither the 2026 filing-season release nor the free-preparation page. So the shard carries an `omitted` block: channels that were checked and found unavailable, with the reason and a link. An absence should read as a verified fact, not as a list nobody updated. The shipped thresholds are the Free File guided-software AGI ceiling ($89,000 for tax year 2025), Free File Fillable Forms (no ceiling — which is why "you have to pay to file" is never the honest answer, and a test pins that at every income up to $5,000,000), VITA (generally $69,000 or less, **plus** people with disabilities and taxpayers with limited English proficiency regardless of that figure — the two routes a reader of the raw rules most easily misses), TCE (age 60 and older, no income limit), and MilTax.

**A6 is not folded into A5 after all.** §A6 proposed carrying the charity-care pointer inside this tile. Built out, "which free tax-filing channel am I eligible for" and "am I likely to qualify for hospital financial assistance" are two different questions that happen to share an income input, and joining them makes both harder to find. ✅ A6 shipped as its own tile, `charity-care`, in the same hub — and at **harm tier 3, not tier 1** as §A6 assumed. It states a federal legal obligation (IRC §501(r)(4): a nonprofit hospital must have a written financial assistance policy and hand you a paper copy on request, free), which is rights-adjacent in the same way the balance-billing screener is. So it ships screener-only with named channels, and tests assert it can never say "you qualify", "you are eligible", or "you do not qualify" at any income — thresholds are set per hospital and published nowhere central, so guessing would invent the single most important number in the answer.

### Phase 22: Readout v2

**Goal.** Documents that answer.

**Deliverables.** The four-part `ReadoutAnswer` shape and the check registry of [SPEC-4-readout-v2.md](SPEC-4-readout-v2.md) §4; the `eobHealth`, `medicalBill`, and `benefitsNotice` document kinds; the `no-surprises-<yr>` shard; the EOB checker in the `protection` hub (Tier 3); the EOB × medical-bill cross-check.

**Acceptance.** Every check declares its type, its citation where it has one, and its false-positive case — a registry test fails any check missing the last one. OCR-sourced text suppresses rule checks entirely. No extracted value reaches My Situation without confirmation. Nothing persists.

**Split into 22a and 22b, both now shipped.** ✅ **22a — the answer layer**: the `ReadoutAnswer` shape, the `src/readout/checks.ts` registry and its contract tests, the three new document kinds, the EOB × medical-bill cross-check, and the four sections rendered in the Readout view. ✅ **22b — the rule check and the tile**: the `no-surprises-2026` shard, the balance-billing screen, and the `eob-checker` tile (§B1) in the Insurance & Protection hub at tier 3.

**Three notes from building 22b.**

- *A rule check's citation travels with the shard, not with the code.* Copying a hashed shard's citation into the module that reads it is the drift seam where the cited source and the hashed source quietly diverge. So `CheckDefinition` gained `citationFromData`, a declared promise that the run supplies the citation — and `runChecks` **drops** a rule outcome that arrives without one. The promise is enforced at run time, not merely declared, and a fixture test proves the drop.
- *The harm-tier gate keyed on the wrong thing.* It applied only to tiles in the `rough` pillar. `eob-checker` belongs in Insurance & Protection, which is where someone holding a health claim actually goes — and a rights-adjacent screener is no less rights-adjacent for its hub. The gate now binds **any** tile that declares a tier; declaring one at all remains Pillar 4's admission bar.
- *That gate immediately caught a latent bug.* `defineHub` copied the `how` of whichever tool was listed first, not of the tool that set the tier — so a hub could inherit tier 3 and a `how` block with no advice line in it. It now takes the strictest tool's `how`, which by the same gate must carry the line.

**Three notes from building 22a.**

- *`ReadoutTarget` did not widen, and that is the finding.* Nothing on a health claim, an itemized bill, or a determination notice maps to income, retirement contributions, or filing status. The narrowness of the target set is the safety property (§2.1), and three new document kinds arriving without touching it is evidence the boundary was drawn in the right place. A test pins it: no EOB field carries a `target`.
- *The EOB's "what you may be owed" section ships empty on purpose.* It is the most tempting place on the site to state a protection without citing it. The empty-with-a-reason mechanism — built for exactly this — carries the honest answer until the shard lands: "surprise-billing protections are stated only where we can cite the rule that grants them."
- *The benefits notice reads its clock off the notice, and states none of its own.* A statutory appeal window is a Phase 23 `appeal-windows` shard figure, and SPEC-4 §7.3 makes `Deadline.citation` non-optional so an uncited one is a compile error. So the notice's *printed* deadline is extracted and shown for review, and every `next` action on it is undated — asserted by test, so a literal cannot creep in later.

### Phase 23: The rights-adjacent screeners

**Goal.** Garnishment and enrollment windows — the two Tier 3 / Tier 2 items with the most careful copy on the site.

**Deliverables.** The `garnishment-limits-<yr>` shard; the `garnishment` tile stating the state-variance caveat **before** the number, with `channels` routing to state legal aid and the CFPB complaint process; the `enrollment-windows` tile.

**Acceptance.** The garnishment tile renders the federal-ceiling caveat above the figure — asserted by a DOM-order test, not by review. `checkHarmTier` passes on tier-3 channel coverage. A copy review confirms the §3.4 dignity rule.

**Split into 23a and 23b, both now shipped.** ✅ **23a — Wage Garnishment Limits**: the `garnishment-limits-2026` shard, `engine/garnishment.ts`, and the `garnishment` tile at tier 3. ✅ **23b — Enrollment & Appeal Windows**: the `enrollment-windows-2026` shard, `engine/sequences.ts`, and the `enrollment-windows` tile at tier 2 — which also unblocks **Phase 20b**, whose six life-event sequences are dated by exactly these clocks.

**Three notes from building 23b.**

- *`Deadline` gained a calendar-month window, because two of these rules are written in months.* Medicare's initial enrollment period runs "3 months before … through 3 months after that first month of eligibility" (42 CFR §407.14) and its Part B special enrollment period ends "on the last day of the eighth consecutive month" (42 CFR §406.24). Three months is 89, 90, 91, or 92 days depending on where in the year it lands, and the difference is whether someone enrolls in time — so `monthsFromTrigger` was added rather than an approximation in days.
- *Floors and ceilings are not the same thing, and summaries lose the difference.* COBRA, SNAP, and the Marketplace windows are floors a plan or agency may exceed but never shorten. The Medicaid fair-hearing period is not: 42 CFR §431.221(d) gives a state "a reasonable time, not to exceed 90 days", which makes 90 days the **most** a state must allow. So the shard carries `bound`, only a floor maps to `isFloor` (which renders as "at least"), and a test asserts the floor caveat never appears on a ceiling.
- *A rule change already published for 2027 is carried as data, not left to rot.* 45 CFR §155.410(e)(5) shortens Marketplace open enrollment for benefit years from 2027 — no later than November 1 to no later than December 31, and no longer than nine weeks — so the January 15 date on the page is explicitly labeled as the 2026 rule that does not carry forward. An `upcomingChanges` block is the same instinct as Phase 21's `omitted` block: a fact about the future of the data, stated rather than discovered later.

**Three notes from building 23a.**

- *The shard stores statutory inputs, not the four numbers a reader sees.* The protected floor is thirty times the $7.25 federal minimum wage — $217.50 a week — and the biweekly, semi-monthly, and monthly equivalents are **derived** from that one figure rather than stored beside it. One number to refresh when the minimum wage moves, and no way for four literals to drift apart (§A4).
- *That derivation had to be exact, not merely close.* `217.50 × 52 / 24` in floating point is `$471.24999999999994`, where the statute means `$471.25`. The engine does it through `Money` instead, which is the reason `Money` exists.
- *The caveat's position is the product.* Below the figure, "your state may protect more" reads as a footnote to a number the reader has already taken as the answer — and several states bar wage garnishment for ordinary consumer debt outright. So it renders above, and a DOM-order test asserts that ordering across every input combination rather than trusting review to catch an edit that moved it.

### Phase 24: The Standing Ledger (Path 1)

**Goal.** The recompute diff, on the carried-file path only.

**Context.** Path 2 (device-local storage) is **not** in this phase — see §9.

**Deliverables.** The ledger snapshot schema; export/import reusing the existing `enklayve.situation.encrypted` envelope (PBKDF2-SHA256 → AES-GCM) under a new `enklayve.ledger` format id; the recompute-diff engine with its three-tier output; the deadline view.

**Acceptance.** A snapshot round-trips bit-for-bit. The diff is golden-tested against a synthetic dataset-version bump. A schema test proves no snapshot can hold a document, an unconfirmed extracted value, or an identifier. A user who never exports sees no behavioral change — asserted by an e2e test that no new persisted state appears in a full session.

### Gated, not scheduled

**B5, the Unemployment Insurance estimator**, has no phase number. It ships as a `state-ui-<st>-<yr>` adapter set with per-state coverage stated, or it does not ship. A "typical state" approximation is worse than nothing for someone deciding whether they can make rent, and is explicitly forbidden.

---

## 9. Decisions recorded

- **No simulation, no game.** enklayve models published rules applied to numbers you type. A life simulation is a stochastic model of an uncertain future, which §2.1 forbids outright, and building one would compromise the property that makes this site worth opening on a bad day: that it is boring, exact, and cites everything. Dropped — not built here, and not spun off.
- **No points, streaks, badges, or avatars.** See §2.4. The recompute diff is the return-visit mechanic.
- **No accounts, ever.** The Standing Ledger is user-held. If continuity across devices is ever wanted, it is a file the user carries, not a row in our database, because we will never have a database.
- **Device-local ledger storage is deferred, not adopted.** `checkLocalStorage` in the release audit permits persistence in exactly one module today, which is the mechanical expression of SPEC §2 principle 8. Path 2 of [SPEC-4-ledger.md](SPEC-4-ledger.md) would require widening that allowlist, and widening a privacy gate is a decision that deserves its own evidence — that real users lose snapshots on the carried-file path. Phase 24 ships Path 1 only; Path 2 is revisited afterward with that evidence or not at all.
- **Scope stays US.** Pillar 4 is more US-specific than anything before it. The country-scope roadmap (SPEC-2 §0.2) is unchanged: get the US right first.
- **Student-loan IDR stays parked**, per SPEC-3 §4.10, with an explicit un-park gate: it ships when the plan set has been stable for one full academic year and each plan's formula can be pinned to a citable published table. It is high value and it will be wrong in a harmful way if we build it against a moving target.
- **13 hubs is the ceiling.** §7.1.

---

## 10. Acceptance criteria for this pass

1. Pillar 4 exists as a named pillar with at least Wave A shipped, every tool clearing the §3 four-part admission bar in addition to all existing invariants.
2. `checkHarmTier` runs in the test suite over the real catalog and fails a fixture tile that omits a tier, a tier-3 tile with no channel, or a tier-2/3 tile missing the advice line.
3. The Benefit Cliff Explorer reproduces three hand-computed cliff cases as golden tests (ACA edge, Medicaid MAGI edge, SNAP gross-income-test edge), never monetizes Medicaid, and names every program it does not model.
4. `sweepResources` is bounded at 400 points, joins the §2.9 property suite, and returns no non-finite value across all 51 jurisdictions × 5 filing statuses.
5. Every deadline on the site is produced by `renderDeadline`, carries a citation, and participates in the staleness banner; a UI test asserts it.
6. Readout v2 answers in the four-part shape for the EOB, medical-bill, and benefits-notice kinds; every check declares its false-positive case; OCR suppresses rule checks; nothing persists and nothing reaches My Situation unconfirmed.
7. Every new shard is pinned at `staleAfterYears: 0` with a refresh workflow and a [data-sources.md](../data-sources.md) row.
8. The Standing Ledger (Path 1) round-trips exactly, its diff is golden-tested against a synthetic version bump, and a user who never exports sees no behavioral change.
9. `npm run test`, `npm run typecheck`, `npm run lint`, `npm run audit`, and the Playwright e2e stay green at the end of every phase.

---

## 11. One line positioning

A calm, fast, private place to answer real money questions — including the ones you only ask on your worst day — where every number is computed on your device, cites its source, and tells you what to do next.
