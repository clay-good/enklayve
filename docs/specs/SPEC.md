# enklayve.com — Build Specification and Vision

> Your private financial enclave. Every number is computed on your device. Nothing is ever sent anywhere.

This is the single source of truth for building enklayve.com: the vision in exhaustive form, followed by step by step build instructions written as prompts you can hand to Claude Code, one phase at a time.

The document has two halves:

1. **The Vision** (sections 1 through 12): what enklayve is, what it contains, and how it behaves.
2. **The Build Plan** (section 13): an ordered set of detailed prompts for Claude Code, each with goal, context, deliverables, and acceptance criteria.

---

## 1. Thesis

enklayve is a deterministic personal finance utility. It is a calm, fast, beautiful place to answer real money questions: what is my actual take home pay, what do I owe in taxes, how much is enough to feel safe, and what public benefits am I owed. It does this with zero accounts, zero telemetry, zero AI, and zero runtime network calls. Every figure is reproducible from public data that we bundle into the site, and every rule cites the public document it came from.

The wedge against Bankrate, NerdWallet, and SmartAsset is not features. It is trust. Those products are lead generation businesses that route the numbers you type to lenders and advertisers, wrapped in cookies and behavioral tracking. enklayve routes nothing anywhere. The browser physically cannot send your data out. That is the entire pitch, and it is literally true at the network layer.

The product is one website with three pillars:

1. **Take Home and Taxes**: the engine room. Paychecks, federal and state and local income tax, self employment tax, capital gains, borrowing math, savings growth, and inflation.
2. **What You're Owed**: benefits and financial aid eligibility. Federal poverty level, ACA premium tax credits, EITC, Child Tax Credit, SNAP, Medicaid thresholds, and the FAFSA Student Aid Index.
3. **Safe Harbor**: calm wealth. Rainy day fund, runway, war chest, and your enough number. The true north is calm, security, and optionality, never the message that you must stop working.

---

## 2. Non negotiable principles (the family DNA)

These mirror the conventions already proven in sophiewell, roughlogic, encryptalotta, and vaulytica.

1. **100 percent deterministic.** Every output is a pure function of the inputs and the bundled dataset version. No AI, no inference, no randomness, no market prediction. Where an assumption is required (a rate of return, an inflation rate), the user supplies it or accepts a clearly labeled default, and we show the math.
2. **No runtime network calls.** The Content Security Policy sets connect-src to none. The site cannot phone home even if a bug tried to.
3. **No telemetry, no accounts, no third party anything.** No analytics, no fonts from a CDN, no trackers. The only persisted state is a single locale preference in localStorage (the theme preference was retired when enklayve moved to a single light theme, 2026-06-01).
4. **Offline first.** A service worker pre caches the shell and the data shards. The site works on a plane.
5. **Every rule cites its source.** A tax bracket, a contribution limit, a poverty line: each carries its value, the source URL, the source document name, the effective year, the date retrieved, and a content hash. If a source goes stale past its expected refresh window, the affected calculator shows a verify before relying banner rather than silently presenting a stale number.
6. **A worked example in every tile.** A Try an example button pre fills a realistic case so the user sees how the tool behaves before typing anything personal.
7. **Copyable, deep linkable, reproducible.** State is encoded in the URL fragment. Pasting a link reproduces the exact result. Every numeric output has a copy button.
8. **Sensitive inputs never persist.** Income, balances, and similar figures live only in memory and are cleared on page unload.
9. **MIT licensed, free forever, open source, auditable.** No ads, no paid tier, no upsell.

---

## 3. Pillar 1 in full: Take Home and Taxes

The engine room. This pillar defines the tax engine that the other two pillars reuse.

### 3.1 Paycheck and withholding
- Take home pay across all fifty states plus the District of Columbia, combining federal income tax, Social Security and Medicare (FICA), state income tax, and local income tax where it applies (for example New York City, Yonkers, and Ohio and Pennsylvania municipalities).
- W4 withholding estimator, computed deterministically from the published withholding methods.
- Hourly to salary and salary to hourly conversions, overtime, and stacking of multiple jobs.
- Pay frequency handling (weekly, biweekly, semimonthly, monthly) with correct annualization.

### 3.2 Taxes owed
- Federal income tax with marginal and effective rate breakdown, and a toggle between the standard deduction and itemized deductions (start with the big four: state and local taxes capped, mortgage interest, charitable contributions, and medical above the floor).
- Self employment tax plus the quarterly estimated payment schedule (the 1040 ES cadence).
- Capital gains, short term and long term, bracket aware, including the net investment income surtax thresholds, with a cost basis helper supporting first in first out and specific identification.
- A marginal rate explorer that answers the question, what does my next one thousand dollars of income actually cost me, across federal, FICA, and state.

### 3.3 Borrowing
- Loan and mortgage amortization with a full schedule and extra payment what ifs.
- Refinance break even.
- Auto loan, APR to nominal rate conversions, and the true total cost of credit.

### 3.4 Saving and growth (deterministic, no market guessing)
- Compound interest and contribution growth where the user supplies the rate. We never predict markets.
- Retirement contribution optimizer against the current IRS limits for 401k, IRA, and Roth, including catch up amounts.
- Required minimum distribution schedule.
- CPI inflation adjuster: what one dollar in a past year is worth today, computed straight from Bureau of Labor Statistics data.

---

## 4. Pillar 2 in full: What You're Owed

Benefits and financial aid eligibility. This is the most socially useful pillar and the most underserved by a clean, private, all in one tool. Every program here is governed by a published deterministic formula. The data refreshes annually from canonical federal sources.

### 4.1 Foundations
- Federal Poverty Level calculator (household size, state, and the contiguous states versus Alaska versus Hawaii variants), since nearly every program keys off a percentage of the poverty line. Source: the Department of Health and Human Services annual guidelines.

### 4.2 Tax credits and refundable benefits
- ACA premium tax credit and subsidy estimator. Inputs: household size, income as a percentage of the poverty line, age, and county. Uses the applicable percentage table and the benchmark second lowest cost silver plan figure, which is published annually by county. Output: estimated monthly premium tax credit and the expected contribution.
- Earned Income Tax Credit estimator, computed from the published phase in rate, plateau, phase out rate, and maximum credit by number of qualifying children.
- Child Tax Credit and the refundable Additional Child Tax Credit.
- Saver's Credit eligibility and amount.

### 4.3 Means tested programs
- SNAP eligibility estimator: the gross income test and net income test against the poverty line, the standard deduction, the earned income deduction, and the maximum allotment by household size. Source: the United States Department of Agriculture Food and Nutrition Service annual cost of living adjustment, with a clear note that states vary.
- Medicaid eligibility threshold checker by state, based on the modified adjusted gross income thresholds, distinguishing expansion from non expansion states.

### 4.4 Financial aid
- FAFSA Student Aid Index estimator. The federal methodology is a published, fully deterministic formula: parents' contribution plus the student's contribution from income plus the student's contribution from assets. Source: the Department of Education annual Student Aid Index and Pell Grant Eligibility guide.
- Pell Grant eligibility and estimated award from the Student Aid Index.

### 4.5 The combined screener
- A single What am I owed screener. The user enters household size, income, state, and the ages of household members once. The screener returns a calm, plain English list of programs the household likely qualifies for, with an estimated dollar figure for each, and a citation for every line. It never asks for identifying information and never sends anything anywhere.

---

## 5. Pillar 3 in full: Safe Harbor (calm wealth)

The emotional core. Same deterministic math as the rest of the personal finance world, but reframed away from the anxious, you must escape your job message toward calm, security, and optionality. The vocabulary matters and is part of the spec.

### 5.1 The reframed vocabulary
- **Rainy Day Fund** (the emergency fund): how many months of essential expenses your savings cover. Also called the sleep at night number.
- **Runway**: how long your current savings would last at your current burn rate if income stopped.
- **War Chest**: your total liquid safety net and net worth, entered manually, tracked deterministically, with no account linking.
- **Your Enough Number** (the calm version of the financial independence number): the amount that buys you choices, computed as a multiple of essential expenses or from a user chosen safe withdrawal rate. Framed as the point where work becomes optional, not the point where you must quit.
- **Downshift Point** (the calm version of coast financial independence): the age or balance after which you can stop adding savings and still arrive at your enough number on schedule.
- **Freedom Date** (debt payoff reframed): the date your debts are gone.

### 5.2 The tools
- Rainy Day Fund tile: essential expenses in, target months chosen, current balance in, shows the gap and the months covered with a calm progress view.
- Runway tile: balance and burn rate in, shows months and a downshift scenario (what if I reduce spending or income).
- Your Enough Number tile: essential annual expenses and chosen withdrawal rate in, shows the target in today's dollars, inflation aware using CPI data.
- Downshift Point tile: current savings, assumed real return supplied by the user, and target, shows when continued saving becomes optional.
- Peace of Mind dashboard: combines rainy day months, runway, and progress toward enough into one calm overview, with encouraging plain English summaries (here is where you stand, never you are behind).
- Sabbatical and big purchase planner: can I afford a six month break, what does it cost my runway and my enough date.

### 5.3 Tone rules for this pillar
- Encouraging, never scolding. Frame progress, not failure.
- Always label assumptions. When a return rate or inflation rate is used, show it and let the user change it.
- Red is never the primary color here. Good news states use the warm accent. Red is reserved strictly for genuine warnings.

---

## 6. Tech stack and hosting

Pillar 1 carries a real rules engine (fifty state tax), so match the rigor of vaulytica rather than the vanilla scripting of the calculator only repos.

- **TypeScript in strict mode**, since the tax rule schema is the moat and must be typed.
- **Vite plus esbuild** for the build.
- **zod** for runtime validation of every bundled dataset at build time, so a malformed data refresh fails the build rather than shipping a wrong number.
- **decimal.js** for all money math. Never use floating point arithmetic on currency.
- **Vitest** for unit and golden case integration tests.
- **Playwright** for end to end and accessibility tests.
- **axe-core** for automated WCAG 2.2 AA checks in continuous integration.
- **No user interface framework.** Vanilla TypeScript with a tiny render layer keeps the bundle small and the determinism obvious. Revisit only if a framework clearly earns its weight.

### Hosting on Cloudflare Workers Static Assets
- Vite builds to a dist directory. A minimal Worker serves the static assets and sets headers: a strict Content Security Policy, long cache lifetimes on hashed assets, and no cache on index.html and the data manifest.
- Deployment uses wrangler deploy from continuous integration on merge to the main branch.
- The wrangler configuration declares the dist directory as the asset source with the Worker acting as the asset router. There is no KV, no D1, and no R2, because there is no server side state by design.

---

## 7. Data layer and the refresh workflows

This is the work the incumbents do not bother to do cleanly, and it is where GitHub Actions earns its place in this family.

### 7.1 Layout
- Datasets live in a data directory as versioned, sharded JSON files, each with a sibling content hash file.
- A top level data manifest pins every dataset to a version, an effective year, and an integrity hash.
- The build embeds the manifest so the running application knows exactly what it is computing from, and can display the effective year and a verify banner when needed.

### 7.2 The full refresh manifest

| Dataset | Source | Cadence | Pillar |
|---|---|---|---|
| Federal income tax brackets, standard deduction, AMT, capital gains thresholds | IRS annual revenue procedure and inflation adjustment notice | Annual, October to November | 1 |
| Retirement, HSA, and FSA limits, catch up amounts, mileage rate | IRS annual notice | Annual | 1 |
| FICA wage base, cost of living adjustment, Social Security bend points | Social Security Administration fact sheets | Annual, October | 1 and 3 |
| Consumer Price Index for all urban consumers (inflation) | Bureau of Labor Statistics public database, no key required | Monthly, second week | 1 and 3 |
| Treasury I bond and savings bond fixed and inflation rates | TreasuryDirect | Semiannual, May and November | 1 and 3 |
| Fifty state income tax brackets, standard deductions, and local add ons | State Department of Revenue publications, one adapter per state | Annual, staggered | 1 |
| Federal Poverty Level guidelines | Department of Health and Human Services | Annual, January | 2 |
| EITC parameters and Child Tax Credit parameters | IRS annual revenue procedure | Annual | 2 |
| ACA applicable percentage table and county benchmark silver plan | Internal Revenue Service and Centers for Medicare and Medicaid Services | Annual | 2 |
| SNAP cost of living adjustment, deductions, and maximum allotments | USDA Food and Nutrition Service | Annual, October | 2 |
| Medicaid modified adjusted gross income thresholds by state | Centers for Medicare and Medicaid Services and state publications | Annual | 2 |
| FAFSA Student Aid Index tables and Pell Grant schedule | Department of Education | Annual | 2 |

### 7.3 The workflow contract
Every refresh job follows the same shape, already proven across the family:

1. Fetch the source, parse it with a source specific adapter, and emit normalized JSON plus a content hash.
2. Append a human readable diff to a source diff log document, describing what changed and the old to new values.
3. Run the full golden test suite against the new data.
4. If the tests pass and the values changed, open a pull request with the diff summary. If a source returns a not found error or fails schema validation, open an alert pull request that flips the affected rules into fail safe mode rather than shipping a wrong number.
5. Never auto commit a data change to the main branch without passing the test gate.

---

## 8. The fifty state tax engine (the moat)

A declarative rule corpus, not a pile of conditional statements. Each jurisdiction is a typed data file consumed by one generic evaluator.

- A jurisdiction record carries: an identifier (for example US, or US-CA, or US-NY), the tax year, the supported filing statuses, the marginal brackets per filing status in order, the standard deduction per filing status, any personal exemptions, any local add on rules (such as New York City or Yonkers or Ohio municipalities), any special rules (such as a state mental health surtax), the citation for the data, and the effective date range.
- One evaluator consumes any number of jurisdiction data files. Adding a state means adding data, not code. This is how the engine stays maintainable across annual updates and how outside contributors can help safely.
- Federal, state, and local computations compose into one result object: federal tax, FICA, state tax, local tax, marginal rate, effective rate, and take home, with every line traceable to its citation.
- Fail safe is per jurisdiction. If the California source is stale, California calculators show a verify banner while the other forty nine keep working.
- States with no income tax (Texas, Florida, Washington, and others) are first class data records, not omissions.

---

## 9. Determinism and verification

- **Golden corpus.** Hundreds of cases of the form inputs plus dataset version produce an expected output, stored under a tests golden directory. Continuous integration fails if any case drifts. This is also the gate every data refresh pull request must pass.
- **Cross validation.** The federal engine is spot checked against independent published examples (for instance the IRS published worked examples), in the spirit of the roughlogic correctness corpus.
- **Bounds and fuzz testing** on the tax engine: more income never decreases tax owed within a bracket, take home is never negative, marginal rate is never below zero.
- **Provenance test.** Every shipped rule must resolve to a non empty citation. No orphan numbers are allowed to ship.

---

## 10. Design language: cheery, crisp, royal

The jan.ai feeling (clean, airy, friendly, fast) expressed with a purple identity.

- **Primary color:** royal purple, around hex 6D28D9, with vivid violet accents. **Secondary accent:** warm gold or amber for good news states and primary calls to action. The purple and gold pairing reads as celebratory and royal rather than corporate.
- **Red is for warnings only.** Money tools that use red as a primary color make people anxious, which is the opposite of the Safe Harbor pillar's purpose.
- **One calm light theme (adopted 2026-06-01).** enklayve ships a single, easy-on-the-eyes light theme and no theme switcher, for the simplest possible experience. (Earlier drafts shipped light, dark, and high-contrast themes with a toggle; these were removed at the owner's direction in favor of one delightful default. The soft off-white background and high-contrast purple-on-near-black text keep it gentle and readable; `prefers-reduced-motion` is still honored.)
- **Big, legible numbers.** Generous whitespace, rounded cards, soft shadows, and one delightful micro interaction on result reveal (a gentle count up that respects reduced motion preferences).
- **Tone:** plain English, encouraging, never scolding. Here is where you stand, not you are behind.
- **Result cards** show the answer large, the breakdown collapsible, and a one tap copy plus permalink. Every input has a worked example default.
- **First-person, warm, explanatory, US-only (adopted 2026-05-29; see BUILD-SPEC-2 §0).** Owned surfaces are named in the first person ("My Situation", "My Plan", "My Readout Report", "My Enough Number"). Every tool page carries a "How this works" explainer (the logic and the math), a "Learn more" list of trusted U.S. resources, and an on-device / US-only / not-advice promise. The product is scoped to the United States for now. Modals are never traps (visible Close + Done + Escape + click-outside).

---

## 11. Privacy, offline, and accessibility

- Content Security Policy: default to self, connect to none, scripts from self, objects none, base URI none.
- Service worker caches the shell and the data shards for full offline use.
- No analytics, no fonts from a content delivery network, no third party requests of any kind. Self host the fonts.
- WCAG 2.2 AA verified by axe-core in continuous integration, full keyboard navigation, and respect for the reduced motion preference.
- Sensitive inputs are never persisted and are cleared on page unload.

---

## 12. Proposed repository structure

- A src directory containing: an engine folder (the tax evaluator, money handling via decimal, and the citation types), a data access folder (manifest loader, integrity check, and fail safe gating), a tiles folder (one module per calculator), a ui folder (render layer, theme, result card, and command palette), and an i18n folder.
- A data directory holding the sharded JSON, the content hash files, and the manifest.
- A scripts directory with one refresh adapter per source, the build script, and an audit release script.
- A tests golden directory holding the correctness corpus.
- A worker directory with the Cloudflare Worker asset router and headers.
- A wrangler configuration file.
- A docs directory with this spec, a data sources document, the source diff log, and an adding a state guide.

---

## 13. The build plan: ordered prompts for Claude Code

Hand these to Claude Code one phase at a time. Each phase lists a goal, the context to load, the deliverables, and the acceptance criteria. Do not start a phase until the previous phase's acceptance criteria pass. Convert the existing repo at the enklayve folder, or start fresh in this folder, your choice, but preserve any reusable continuous integration patterns from the sibling repos.

**Build progress (status):**

- ✅ **Phase 0 — Scaffold and tooling.** Done. TypeScript strict, Vite, Vitest (happy-dom), ESLint, Prettier, Cloudflare Worker asset router with strict CSP (`connect-src 'none'`), `wrangler.toml`, CI workflow, and the royal-purple hello page. `build`, `test`, `lint`, `typecheck`, `format:check`, and `wrangler deploy --dry-run` all pass.
- ✅ **Phase 1 — Money and citation primitives.** Done. `src/engine/money.ts` (decimal.js, documented ROUND_HALF_UP) and `src/engine/citation.ts` (`Citation`, `Cited<T>`, `assertCited` provenance gate). Full unit coverage of rounding edge cases, arithmetic, and the provenance assertion.
- ✅ **Phase 2 — Data layer, manifest, integrity, fail-safe.** Done. Zod schemas for every §7.2 dataset kind (jurisdiction schema is the §8 moat), `src/data/integrity.ts` (sha256 via Web Crypto), `src/data/loader.ts` (per-dataset fail-safe gate: hash → parse → schema → staleness), seeded federal 2024 and California 2024 jurisdictions with citations, and `scripts/build-manifest.ts`. Tests cover hash corruption, schema rejection, and staleness.
- ✅ **Phase 3 — The tax engine.** Done. One generic evaluator in `src/engine/tax/` composes federal + FICA + state + local into a single cited `TaxResult` (income tax, FICA with wage base + Additional Medicare, standard vs itemized "big four" with the SALT cap and medical floor, special rules like the CA mental-health surtax, and opt-in local add-ons like NYC/Columbus). Seeded the ten most populous states + DC (CA, NY, TX, FL, PA, IL, OH, GA, NC, MI, DC) — including no-income-tax states (TX, FL) as first-class records — plus the 2024 FICA dataset. Golden corpus: hand-verified federal/FICA/state cases cross-checked against the published 2024 schedules, a 147-case generated drift-guard snapshot (`npm run golden:regen`), bounds + 1,600-iteration seeded fuzz invariants, and an extensibility test proving a new jurisdiction needs only data.
  - **Filing-status fallback fix (2026-06-05):** the seeded states define only single / married-jointly / head-of-household, and `bracketsFor`/`standardDeductionFor`/`personalExemptionFor` fell back to **single** for any other status. That silently over-taxed a **qualifying surviving spouse** (QSS), who uses the married-filing-jointly schedule federally and in essentially every state — in CA the QSS filer was put on the single brackets (first tier at $10,412 instead of MFJ's $20,824). Introduced a status-aware `fallbackChain`: **QSS → married_jointly → single**, while married-filing-separately keeps the documented **MFS → single** state-level assumption and federal (which defines all five) is unaffected. The UI offers all five statuses, so the bug was reachable. Golden/engine suite unchanged (no case used QSS+state); added `tests/engine/filingStatusFallback.test.ts` (QSS resolves to MFJ brackets/deduction/exemption, MFS still resolves to single, and a QSS California return equals the MFJ tax and is below the single tax).
  - **State coverage rollout (2026-06-02, §14.3 "fill in the rest"):** the remaining no-income-tax states — **AK, NV, NH, SD, TN, WA, WY** — were added as first-class records alongside TX and FL, so **all nine no-income-tax states now ship** (18 state jurisdictions total). Each is data-only (the engine is unchanged), carries its Department-of-Revenue citation, and is golden-tested (zero state + local tax; total equals federal + FICA). The records note the non-wage taxes that don't touch a paycheck: NH's Interest & Dividends Tax (repealed effective 2025), WA's capital-gains excise tax, and TN's repealed Hall tax. A resident of any of the nine now sees their state by name with $0 confirmed, rather than the generic "no state tax modeled." Remaining income-tax states are added the same data-only way through the staggered annual refresh.
  - **Flat-rate "fill in the rest" wave (2026-06-02, §14.3):** six more income-tax states were transcribed from their 2024 schedules and added data-only (the engine is unchanged) — **AZ** (2.5% flat, federal standard deduction), **CO** (4.40% flat on federal taxable income), **IN** (3.05% flat, $1,000 personal exemption, county taxes deferred), **KY** (4.0% flat, $3,160 standard deduction), **MA** (5.0% plus the **4% millionaire surtax** above $1,053,750, modeled as a clean second bracket, with the $4,400/$8,800/$6,800 personal exemptions), and **MS** (4.7% above the first $10,000 of taxable income, modeled as a `[{0,0},{10000,0.047}]` schedule, with its standard deduction and personal exemption). Every figure is cross-checked against the Tax Foundation's 2024 state-rate table and cited to the state Department of Revenue; each carries a golden case (the worked single-filer rate, and an invariant that MA's surtax raises tax above the flat 5%). This brings the engine to **24 jurisdictions** (14 income-tax states + DC + 9 no-income-tax). State-specific credits (e.g. Utah's phase-out credit, Arizona's dependent credit), county/municipal add-ons, and state itemized deductions stay deferred — the same launch fidelity as the original eleven. Idaho and Utah were intentionally held this wave (Idaho's 2024 rate was reduced mid-year; Utah's standard deduction is delivered as a phasing-out credit) rather than ship an approximation that could overstate tax.
  - **Idaho added (2026-06-03, §14.3):** with Idaho's mid-year rate cut settled into a clean **5.3% flat tax** (HB 40, enacted March 2025) on Idaho taxable income, it now models exactly like Colorado — a single bracket over a **federal-conformity standard deduction** ($16,100 / $32,200 / $24,150). Added data-only (`state-id-income-tax-2024.json`, the engine unchanged), cited to the Idaho State Tax Commission rate schedule, and golden-tested (single $60k → $2,326.70 = 5.3%·(60,000 − 16,100)). The rate schedule's small 0% floor on the first ~$4,811 (single) of taxable income is omitted — its 2026 value is unpublished — so the figure errs slightly high, the conservative side for setting money aside. This brings the engine to **25 jurisdictions** (15 income-tax states + DC + 9 no-income-tax). **Utah stays held:** HB 106 (2025) set a clean 4.5% flat rate, but Utah grants no standard deduction — instead a nonrefundable taxpayer tax credit of 6% of the federal deduction that *phases out* with income, which the bracket-plus-standard-deduction model cannot represent without overstating low-income tax. It waits on an exemption-credit engine feature (an explicitly deferred capability).
  - Scope notes for later phases: state-level itemized deductions, exemption *credits* (vs. the modeled income exemptions), Yonkers' percent-of-state-tax surcharge, and AMT are intentionally deferred.
- ✅ **Phase 4 — UI shell and design system.** Done. A tiny vanilla render layer (`src/ui/dom.ts`, no framework), three instant-switch themes (light/dark/high-contrast) with royal-purple primary + warm-gold accent and red reserved for warnings (`src/ui/theme.ts` + `styles.css`, persisted alongside the locale in localStorage — the only persisted state), a reduced-motion-aware count-up (`countup.ts`), the result card (large answer, collapsible per-line-cited breakdown, copy-number + copy-link buttons), fragment-based routing that encodes/restores tile state (`router.ts`), a fuzzy command palette (Cmd/Ctrl-K, multi-word tokens) searching the full tile catalog (`fuzzy.ts` + `commandPalette.ts` + `tiles/registry.ts`), and the assembled shell (`shell.ts`). Datasets are inlined at build time via Vite `?raw` and run through the same integrity/schema/staleness gate in the browser (`src/data/browser.ts`), keeping `connect-src 'none'` literally true. The **Take-Home Pay** tile (`tiles/takeHome.ts`) is fully built end-to-end on the engine — worked example, per-line citations, deep-linkable URL state — proving the tile pattern for Phase 5; every other §3–5 + SPEC-2 §4 tool is registered as a "coming soon" catalog entry the palette and home grid already reach. axe-core is wired into the Vitest run: home, the tile form, and the fully mounted shell pass with zero violations (color-contrast is verified by hand against the theme tokens since happy-dom has no layout engine). 88 tests pass; `lint`, `typecheck`, `format:check`, `build`, and `wrangler deploy --dry-run` are all green.
  - **Command-palette relevance (2026-06-05):** the fuzzy matcher accepts any subsequence, so a short query dragged in unrelated tools via scattered character hits across the catalog text (typing "refinance" listed "Life Insurance Needs"; "roth" listed "Home Buying Readiness"). Two fixes, both in the search layer (the matcher itself is unchanged): (1) `searchEntryText` now matches the **title + curated keywords only**, never the free-text description — a palette matches a label and its tags, not its blurb; (2) the palette prefers results where **every query token is a contiguous substring** of that text, falling back to the single best fuzzy match only for a pure abbreviation no substring covers ("thp" → "Take-Home Pay"). Net effect: "refinance"/"aca"/"snowball" return exactly their tool, "roth" returns the Roth tools (and nothing about homes or insurance), and broad terms ("tax", "retire", "debt") return only genuinely-related tools — while abbreviation search still resolves. A new `commandPalette` test guards it.
  - **Skip-to-content link (2026-06-05):** added the WCAG 2.4.1 "bypass blocks" affordance the shell was missing — the first focusable element on every page, hidden until focused, then sliding in at the top-left. It focuses the existing `<main id="content" tabindex="-1">` *directly* (a click handler that `preventDefault`s) rather than navigating to `#content`, since a bare hash fragment would be parsed by the fragment router and bounce the reader to the home. Complements the existing post-navigation focus move into the content region. A smoke test asserts it is the first child, targets `#content`, and on activation focuses `<main>` without changing the route; axe stays clean.
- 🟡 **Phase 5 — Pillar 1 tiles (fourth wave).** In progress. Shared tile-form helpers (`src/ui/form.ts`) and a deterministic time-value-of-money module (`src/engine/finance.ts`, golden-tested) were added, and thirteen Pillar 1 tiles are now live on the engine + shell, each with a worked example, deep-linkable URL state, and golden/behavior coverage. First wave: **Take-Home Pay** (Phase 4), **Federal Income Tax** (`federalIncomeTax.ts` — standard-vs-itemized "big four" toggle, marginal + effective breakdown, IRS-cited), **Marginal Rate Explorer** (`marginalExplorer.ts` — attributes the cost of the next dollars across federal/FICA/state, each cited), and **Compound Growth** (`compoundGrowth.ts` — user-supplied rate shown as a clearly labeled assumption, no market prediction). Second wave: **Self-Employment Tax** (`selfEmploymentTax.ts` — the full 15.3% on 92.35% of net profit with the Social Security wage-base cap and the 0.9% Additional Medicare surtax, the deductible half, and the four equal **1040-ES quarterly estimates**; built on the existing FICA dataset so the rates carry the SSA/IRS citation and the quarters cite Form 1040-ES), **Hourly ↔ Salary** (`hourlySalary.ts` — convert either direction with 1.5× overtime and an optional second-job stack; pure arithmetic on the user's own pay, so nothing to cite), and **Loan & Mortgage Amortization** (`loanAmortization.ts` — scheduled payment, full-term interest, and an **extra-payment what-if** showing the interest and the months saved, on the golden-tested `amortizationSummary` helper reusing `monthlyMortgagePayment` + `debtPayoff`). Third wave: **Refinance Break-Even** (`refinance.ts` — current vs new payment, the monthly saving, and the months to recoup the closing costs; the new golden-tested `refinanceBreakEven` helper surfaces "no break-even" rather than a negative when the new rate isn't lower), **Auto Loan & True Cost of Credit** (`autoLoan.ts` — the monthly payment, total of payments, true cost of credit, and the effective annual rate the APR compounds to; reuses `amortizationSummary`), and **Retirement Contribution Optimizer** (`retirementOptimizer.ts` — the 401(k)/IRA/HSA room left this year against the current IRS limits *with the age-based catch-ups*, read from and **cited to** the bundled IRS retirement-limits dataset; the 401(k) figure reads from and writes back to My Situation so it feeds My Plan). Fourth wave (added now): **Capital Gains** (`capitalGains.ts` + `src/engine/capitalGains.ts` — short-term gains stacked on ordinary income through the federal brackets, long-term gains through the preferential **0/15/20%** bands, and the **3.8% Net Investment Income Tax** above the MAGI threshold; the new `capital-gains-2024.json` dataset carries the brackets and NIIT thresholds, cited to Rev. Proc. 2023-34 / IRC §1411), **CPI Inflation Adjuster** (`inflation.ts` + `src/engine/inflation.ts` — what an amount in one year is worth in another, straight from the bundled **BLS CPI-U annual averages** in `cpi-u-annual.json`; year pickers offer only the years we actually have, never extrapolating), and **Required Minimum Distribution** (`rmd.ts` + `src/engine/rmd.ts` — balance ÷ the **IRS Uniform Lifetime Table** factor for your age from `rmd-uniform-lifetime-2024.json`, cited to Pub 590-B; below the SECURE 2.0 begin age of 73 it says so plainly rather than inventing a number). axe-core covers every tile form with zero violations. 307 tests pass; `lint`, `typecheck`, `format:check`, `build`, `wrangler deploy --dry-run`, and the release audit are all green.
  - **Capital Gains' cost-basis helper:** the full **FIFO / specific-identification lot picker** (SPEC §3.2) now ships as its own **Cost-Basis Lot Picker** tile (`src/tiles/lotPicker.ts` + the golden-tested `src/engine/costBasis.ts`) — enter your lots (shares, cost per share, long-term flag), a sale price, and either a FIFO total or per-lot quantities, and it returns the realized gain split into short- and long-term to feed the Capital Gains tile (added in the Phase 17 seventh wave). Net losses are surfaced there as a negative gain. The single-figure Capital Gains tile itself still expects a net gain for the bracket math.
  - **W-4 Withholding Estimator** shipped in the Phase 17 eighth wave (`src/tiles/w4Withholding.ts`), the last "coming soon" Phase 5 tile to go live. Rather than seed the IRS Publication 15-T percentage-method tables, it is **reframed as a refund reality check** (the same "user supplies the one local figure" move as ACA's benchmark premium and Social Security's PIA): the user enters their actual per-paycheck federal withholding off a pay stub, and the tile compares it to the projected federal income tax from the same engine as the take-home tile (cited), showing the refund/balance due and the per-paycheck W-4 tweak to land near zero. A future Pub 15-T withholding dataset could still power an exact paycheck-by-paycheck worksheet.
- ✅ **Phase 12 — Your Situation, the session profile (SPEC-2 §3).** Done, taken out of numeric order per the SPEC-2 §7 sequencing note (it is foundational right after the shell). An in-memory `SituationStore` (`src/profile/situation.ts`) holds the §3.1 fields with per-field provenance (typed / extracted / assumed), notifies subscribers, and is **cleared on page unload** (`pagehide`) — it is never persisted automatically, honoring SPEC §2 principle 8. Continuity is opt-in and user-held via `src/profile/portable.ts`: export to a local JSON file and re-import, with optional passphrase encryption (PBKDF2 → AES-GCM via Web Crypto, a local computation allowed under `connect-src 'none'`). A **Your Situation** header panel (`src/ui/situationPanel.ts`) views/edits the core fields and drives export/import/clear. The four existing Pillar 1 tiles now resolve their inputs with the precedence **URL fragment > profile > default** and write filing status, state, and income back, so a value entered in one tile pre-fills the next within the session. 118 tests pass (added the store, the portable round-trip incl. encrypted + wrong-passphrase, cross-tile prefill, and a panel axe check); `lint`, `typecheck`, `format:check`, `build`, and `wrangler deploy --dry-run` are all green.
  - Also fixed: the browser tab title for the home view is now just "enklayve" (was a longer tagline).

### Phase 0: Scaffold and tooling

Goal: a buildable, lintable, testable empty project that deploys a hello page to Cloudflare Workers Static Assets.

Prompt to Claude Code:

> Initialize a new TypeScript project for enklayve.com. Use Vite with esbuild, strict TypeScript, Vitest for unit tests, Playwright for end to end and accessibility tests, and axe-core. Add decimal.js and zod as dependencies. Do not add any user interface framework. Create the repository structure described in section 12 of BUILD-SPEC.md. Add a minimal Cloudflare Worker in the worker directory that serves the dist directory as static assets and sets a strict Content Security Policy with connect-src none, default-src self, script-src self, object-src none, and base-uri none, plus long cache headers on hashed assets and no cache on index.html. Add a wrangler configuration that declares dist as the asset directory. Add npm scripts for dev, build, test, lint, format, and deploy. Produce a single hello page that renders the word enklayve in royal purple. Acceptance criteria: npm run build produces a dist directory, npm run test passes with at least one trivial test, npm run lint passes, and wrangler can dry run a deploy locally.

### Phase 1: Money and citation primitives

Goal: the foundational types and helpers that everything else depends on.

Prompt to Claude Code:

> Implement the money and citation primitives in the engine folder. Money math must use decimal.js with a Money type that prevents floating point currency errors, supports rounding to cents with documented rounding rules, and formats according to locale. Implement a Citation type that carries value, source URL, source document name, effective year, date retrieved, and content hash, per section 2 principle 5 of BUILD-SPEC.md. Implement a Cited wrapper that pairs any value with its Citation, and a helper that asserts no value ships without a non empty citation. Write unit tests covering rounding edge cases, money arithmetic, and the provenance assertion. Acceptance criteria: full unit coverage of the money rounding rules and a passing provenance test that fails when a citation is empty.

### Phase 2: Data layer, manifest, integrity, and fail safe

Goal: load bundled datasets safely, verify their integrity, and gate stale data.

Prompt to Claude Code:

> Implement the data access layer per sections 7 and 8 of BUILD-SPEC.md. Define zod schemas for every dataset type listed in the section 7.2 manifest. Implement a manifest loader that reads the data manifest, verifies each shard against its content hash, validates it against its zod schema, and exposes the effective year for each dataset. Implement the fail safe gate: a dataset whose effective year is older than its expected refresh window, or whose hash fails, is marked stale, and any calculator depending on it must be able to detect that and show a verify before relying banner. Seed the data directory with one real federal income tax dataset for the current tax year and one state dataset for California, each with full citations. Write tests that corrupt a hash and confirm the fail safe triggers, and that confirm schema validation rejects malformed data. Acceptance criteria: integrity and schema failures are caught at load time, and the fail safe state is observable by tiles.

### Phase 3: The tax engine

Goal: the deterministic, declarative, fifty state composable tax evaluator.

Prompt to Claude Code:

> Implement the tax engine per section 8 of BUILD-SPEC.md as one generic evaluator that consumes typed jurisdiction data files. Support federal, state, and local layers composing into one result object with federal tax, FICA, state tax, local tax, marginal rate, effective rate, and take home, each line carrying its citation. Implement filing statuses, ordered marginal brackets, standard versus itemized deduction (big four only for now), FICA including the wage base and the additional Medicare thresholds, and local add ons. Build the data files for the federal jurisdiction and at least the ten most populous states plus the District of Columbia, including the no income tax states as first class records. Write a golden corpus under tests golden with at least one hundred cases cross checked against published IRS worked examples and reputable state examples. Add bounds and fuzz tests per section 9. Acceptance criteria: the golden corpus passes, bounds invariants hold under fuzzing, and adding a new state requires only a new data file with no engine changes.

### Phase 4: User interface shell and design system

Goal: the calm, royal, jan.ai inspired shell that all tiles render inside.

Prompt to Claude Code:

> Build the user interface shell and design system per sections 10 and 11 of BUILD-SPEC.md. Implement the three themes (light, dark, high contrast) with royal purple as primary near hex 6D28D9 and a warm gold accent, red reserved for warnings only. Build a tiny vanilla render layer, a result card component (large answer, collapsible breakdown, copy button, permalink button), a tile container with a Try an example button, a command palette with fuzzy search over all tiles, fragment based routing that encodes and restores tile state from the URL, and the theme and locale preference persistence in localStorage. Implement the gentle count up on result reveal that respects the reduced motion preference. Wire axe-core into the test run. Acceptance criteria: the shell passes axe-core with no violations, full keyboard navigation works, deep links restore state, and switching themes is instant.

### Phase 5: Pillar 1 tiles, Take Home and Taxes

Goal: every calculator in section 3, built on the engine and the shell.

Prompt to Claude Code:

> Implement all Pillar 1 tiles listed in section 3 of BUILD-SPEC.md: take home pay across all states plus DC, the W4 withholding estimator, hourly and salary conversions with overtime and multi job stacking, federal income tax with marginal and effective breakdown and standard versus itemized toggle, self employment tax with the quarterly estimate schedule, capital gains with the cost basis helper, the marginal rate explorer, loan and mortgage amortization with extra payment what ifs, refinance break even, auto loan and true cost of credit, compound growth, the retirement contribution optimizer against current IRS limits, the required minimum distribution schedule, and the CPI inflation adjuster. Each tile must use the engine, carry citations on every output, include a worked example default, and encode its state in the URL. Add golden cases for every tile. Acceptance criteria: every tile has a passing worked example, every output line shows its citation, and the golden corpus covers each tile.

### Phase 6: Pillar 2 tiles, What You're Owed

Goal: the benefits and financial aid eligibility tools and the combined screener in section 4.

**Status: ✅ done (fourth wave).** Shipped the spine of the most socially-useful pillar, deterministic and cited. A new benefits engine (`src/engine/benefits.ts`) holds the pure math — `povertyLine`/`fplPercent`, `estimateEitc`, `estimateCtc`, and now `estimateSaversCredit`, `estimateSnap`, `medicaidEligibility` — golden-tested against the published 2024 figures (HHS guidelines; IRS Rev. Proc. 2023-34 EITC + Saver's Credit; IRC §24 CTC; USDA FNS FY2024 SNAP; Medicaid.gov expansion status). Seeded the datasets with full citations and wired them into the manifest: the **Federal Poverty Level** in all three variants (`federal-poverty-level-2024-{contiguous,alaska,hawaii}.json`), the **EITC/CTC parameters** (`eitc-ctc-2024.json`), the **Saver's Credit tiers** (`savers-credit-2024.json`), the **SNAP FY2024 contiguous** allotments + deductions + income tests (`snap-fy2024-contiguous.json`), and the **Medicaid expansion map** (`medicaid-2024.json`, all 50 states + DC). Seven tiles are live: first wave — **Federal Poverty Level**, **Earned Income Tax Credit**, **Child Tax Credit**, and the centerpiece **What Am I Owed screener**; second wave (added now) — **Saver's Credit** (50/20/10% of capped contributions by AGI tier, reads income + contributions from My Situation), **SNAP Eligibility** (the gross + net income tests against the poverty line, standard + 20% earned-income deductions, and an estimated monthly benefit; contiguous 48 + DC, with AK/HI/territories and the shelter/dependent-care deductions honestly noted as out of scope), and **Medicaid Threshold** (adult MAGI eligibility by state — a clean 138% verdict in expansion states, DC at 215%, and an honest "limited / category-specific" note in non-expansion states rather than an invented number). The screener now also folds in a SNAP dollar estimate (contiguous) and the Saver's Credit when My Situation holds a contribution. 328 tests pass (added Saver's Credit / SNAP / Medicaid golden cases + the three tiles' behavior + axe); `format:check`, `lint`, `typecheck`, `build`, `wrangler deploy --dry-run`, and the release audit are all green.

**Third wave (added now): the ACA premium-tax-credit estimator.** The **ACA Premium Tax Credit** tile (`src/tiles/acaPtc.ts`) is now live, computing the marketplace subsidy as the benchmark (second-lowest-cost silver) plan premium minus the household's expected contribution — income × the applicable percentage for its FPL band, interpolated within the band. The applicable-percentage table is seeded as a cited dataset (`aca-2024.json`, the **ARPA/IRA-enhanced schedule** in effect through 2025: 0% up to 150% FPL, sliding to a flat 8.5% at 400%+ with no cliff) and read through `BundledData.aca()`; the engine math (`acaApplicablePercent`, `estimatePremiumTaxCredit`) is golden-tested against worked FPL cases. The **per-county benchmark premium is the one figure not bundled** — like Social Security's PIA, the user enters it (pointed to HealthCare.gov's plan preview), which sidesteps the genuinely large per-county SLCSP dataset while keeping every shipped number verifiable. The tile reuses the FPL dataset for the region variants, reads household/state/income from My Situation, and the screener now points to it for a dollar estimate (and no longer assumes the obsolete 400% cliff). 472 tests pass; all checks green.

**Fourth wave (added now): the FAFSA Student Aid Index and Pell Grant — the last two tiles in the catalog.** The **FAFSA Student Aid Index** tile (`src/tiles/fafsaSai.ts` + the golden-tested `src/engine/fafsa.ts`) implements the published, deterministic **2024-25 dependent-student** need-analysis formula and shows every step: parents' total income less the allowances (federal income tax paid, a payroll-tax allowance computed from the FICA wage base, the income protection allowance for the family size, and the employment expense allowance for two-earner households), plus a 12% assessment of parents' reportable net worth, run through the federal AAI assessment schedule, plus the student's own contribution (50% of income above the student protection allowance + 20% of assets). Per the new methodology it is **not** divided by the number in college and can floor at **−$1,500**. The **Pell Grant** tile (`src/tiles/pell.ts`) takes the SAI (from the estimator or the user's FAFSA Submission Summary, the same "supply the one figure" move as ACA's benchmark premium) and returns the award: max Pell ($7,395) less the SAI, floored at the minimum ($740), zero once the SAI reaches the maximum. Both read the new gated, cited **`data/fafsa-2024-2025.json`** (ED SAI Formula Guide) via `BundledData.fafsa()`, are golden-tested for the formula composition + invariants (monotonicity, the floor, the Pell schedule), and are in the Pillar 2 axe sweep. They are framed firmly as an **estimate to verify** against the official SAI Formula Guide and the FAFSA Submission Summary — the formula is exact, the seeded table values are cited and flagged for review (the independent-student variant and per-state aid are out of scope, stated plainly). With these two, **every tile in the catalog is now built** (the `coming-soon` placeholder mechanism is retired from the registry). 580 tests pass; all checks green.

Prompt to Claude Code:

> Implement all Pillar 2 tiles listed in section 4 of BUILD-SPEC.md: the Federal Poverty Level calculator with the contiguous, Alaska, and Hawaii variants, the ACA premium tax credit estimator using the applicable percentage table and the county benchmark silver plan, the EITC estimator, the Child Tax Credit and Additional Child Tax Credit, the Saver's Credit, the SNAP eligibility estimator with the gross and net income tests, the Medicaid threshold checker by state, the FAFSA Student Aid Index estimator using the published federal methodology, and the Pell Grant award estimator. Then build the combined What am I owed screener that takes household size, income, state, and ages once and returns a calm plain English list of likely eligible programs with an estimated dollar figure and a citation for each line, asking for no identifying information. Seed the required datasets with full citations and wire them into the refresh manifest. Add golden cases. Acceptance criteria: every program tile matches its published worked example, the screener composes them correctly, and every figure cites its source.

### Phase 7: Pillar 3 tiles, Safe Harbor

Goal: the calm wealth tools and vocabulary in section 5.

**Status: 🟡 second wave done.** Shipped the calm-wealth core. A **product decision deviates from the literal tile list**: Rainy Day Fund, Runway, War Chest, and Your Enough Number were the *same computation* in different framings (savings ÷ monthly spend = months; net worth = assets − debts), and four separate calculators would re-collect the same essentials/savings/debts. So they are consolidated into the one **Peace of Mind dashboard** the spec already calls for in §5.2 (`src/tiles/peaceOfMind.ts`): the user enters shared inputs once (read from / written to Your Situation) and sees every reading together — the **rainy-day cushion** vs a chosen target, **runway** at full burn plus a **downshift** scenario (cutting to essentials), **net worth** (the war chest), and **Your Enough Number** with progress toward it. Assumptions (target months, safe-withdrawal rate) are shown and adjustable, encoded in the URL; a count-up and accessible `<progress>` bars give the calm reveal. **Freedom Date** (`src/tiles/freedomDate.ts`) stays its own tile — debt payoff is a genuinely distinct calculation — on a golden-tested `debtPayoff` engine helper (exact month-by-month decimal payoff; a payment that can't cover interest is surfaced as a calm warning, not ∞). Second wave (added now): **Downshift Point** (`src/tiles/downshift.ts` + the golden-tested `coastFireProjection` helper) — the coast-FIRE point after which saving becomes optional: today's balance grown at a labeled real return with no further contributions, the "coast number" you'd need invested today to coast to your Enough Number, and the gap, framed as optionality not pressure; and the **Sabbatical / Big-Purchase Planner** (`src/tiles/sabbatical.ts` + the golden-tested `sabbaticalPlan` helper) — what a break (or one-time purchase) costs, whether savings cover it, and the runway left, with red reserved for a genuine shortfall. Both default from My Situation. The reframed vocabulary (cushion / runway / war chest / Enough Number / freedom date / downshift) and §5.3 tone (progress, never "behind"; red only for genuine warnings) are honored. 345 tests pass (added the `coastFireProjection` + `sabbaticalPlan` golden corpora and the two tiles' behavior + axe coverage); `format:check`, `lint`, `typecheck`, `build`, `wrangler deploy --dry-run`, and the release audit are all green.

- **Enough Number and inflation (decision):** §5.2 asks for the Enough Number "inflation aware using CPI data, in today's dollars." It already *is* in today's dollars (annual essentials today ÷ the withdrawal rate). Bundled CPI-U is a *historical* series; using it to inflate the target into a future year would be a forecast, which SPEC §2.1 forbids ("we never predict markets"). So the forward projection is intentionally **not** added — instead the standalone **CPI Inflation Adjuster** (Phase 5) covers the honest "what a past dollar is worth today" need, and the Downshift Point uses a **real** (after-inflation) return so its target stays in today's dollars. Rainy Day / Runway / War Chest / Your Enough Number remain the dashboard's readings, not separate registry entries.

Prompt to Claude Code:

> Implement all Pillar 3 tiles listed in section 5 of BUILD-SPEC.md using the reframed vocabulary exactly: Rainy Day Fund, Runway, War Chest, Your Enough Number, Downshift Point, Freedom Date, the Peace of Mind dashboard, and the sabbatical and big purchase planner. All assumptions (return rate, inflation rate) must be user editable with clearly labeled defaults, and inflation aware tools must use the bundled CPI data. Enforce the section 5.3 tone rules: encouraging never scolding, frame progress not failure, and never use red as a primary color in this pillar. Add golden cases for the deterministic math. Acceptance criteria: every tool shows and lets the user edit its assumptions, the dashboard composes the underlying tools correctly, and the copy follows the tone rules.

### Phase 8: Offline and progressive web app

Goal: full offline capability.

**Status: ✅ done.** A build-emitted **service worker** (`scripts/service-worker.ts` → `sw.js` via the `offlinePwa` Vite plugin) precaches a small **core shell** (index.html, the entry JS/CSS, `tools.html`, the manifest, and the icons) on install and **runtime-caches everything else same-origin on first use** — so the first visit stays light while the lazily-imported chunks (notably pdf.js for the Readout) become available offline after they're used. The cache name carries a **version hashed from the full built asset list plus `data/manifest.json`**, and stale caches are dropped on `activate`, so any code or data refresh invalidates exactly the right cache (§8). Navigations fall back to the cached shell, so the app opens offline. A **web app manifest** (`manifest.webmanifest`) makes it installable with the royal-purple theme and a maskable icon (`public/icon.svg`); `main.ts` registers the worker after load (guarded, production-only, best-effort). Sensitive inputs were already cleared on unload (Phase 12 `pagehide`). The **privacy guarantee is preserved**: every page keeps `connect-src 'none'`; only `sw.js` is served with `connect-src 'self'` (it caches same-origin static assets only — there is no server endpoint and it never touches the user's in-memory data, so nothing can leave the device). 240 tests pass (the SW + manifest renderers are guarded by tests, mirroring the tools-index drift guard); `format:check`, `lint`, `typecheck`, `build`, and `wrangler deploy --dry-run` are all green.

- Runtime offline behavior (load-and-compute with the network cut) is an end-to-end concern verified by the Playwright suite wired in Phase 10; the CI checks here cover the generated artifacts and the registration path. The service worker only activates over HTTPS (or localhost), matching the deploy target.

Prompt to Claude Code:

> Add a service worker that pre caches the application shell and the data shards per section 11 of BUILD-SPEC.md, with a cache versioning strategy tied to the data manifest version so a data refresh invalidates the right caches. Add a web app manifest so enklayve installs as a progressive web app with the royal purple theme color. Ensure sensitive inputs are cleared on page unload. Acceptance criteria: the site loads and computes fully offline after a first visit, and a data refresh correctly invalidates stale caches.

### Phase 9: Data refresh workflows

Goal: the GitHub Actions that keep the data current per section 7.

**Status: 🟡 seventh set done.** The §7.3 workflow contract is implemented as a small, pure harness plus one workflow per source group. The contract (`scripts/refresh/contract.ts`) is I/O-free and unit-tested: `diffShards` walks two shards and reports every changed leaf as `path: old -> new` (ignoring the always-fresh `citation.dateRetrieved`), and `decideOutcome` encodes the four §7.3 terminal states — **open-pr** (fetched, valid, changed, tests green), **alert-pr** (source 404'd or failed to parse → fail-safe, ship nothing), **blocked** (new data fails the golden gate → propose nothing), and **no-op**. Source adapters (`scripts/refresh/adapters.ts`) are the **first set the prompt names** — the **IRS** annual revenue procedure, the **BLS CPI** database, the **SSA** fact sheet, the **HHS** poverty guidelines, and the **California** FTB source — each anchoring to its source's known labels (never inferring) and returning a structured failure when the anchors are absent, exactly like the Readout extractors. The BLS adapter is fully machine-readable (the public JSON API); the prose sources anchor the cleanly-stated figures (the FICA wage base, the poverty base + per-person increment, the standard deductions) and **flag rather than guess** the rest — rolling a shard to a new effective year and transcribing a full bracket table stay the reviewer's data-only step on the PR, with the diff log and the golden gate making that review safe. The runner (`scripts/refresh/run.ts`) wires fetch → parse → diff → write the candidate shard + append a human-readable entry to the new **source diff log** (`docs/source-diff-log.md`, §7.3 step 2), emitting the outcome for the workflow; the pure planning step is unit-tested with synthetic fetch results. **GitHub Actions workflows** (`.github/workflows/refresh-*.yml`, each a thin caller of the reusable `_data-refresh.yml`) run on the correct cadence (monthly for CPI, annual staggered for the rest) **and on manual dispatch**, then — only on open-pr — rebuild the manifest, run the **full golden suite as the gate**, and open a data PR via the `gh` CLI; a fetch/parse failure opens a fail-safe **alert PR** instead. Nothing is ever auto-committed to `main` without passing the test gate, and the job never merges itself — a human reviews every PR.

The **second set (added now)** extends the same anchored pattern to the two remaining Pillar 2 benefit sources that have seeded shards: the **USDA FNS SNAP** cost-of-living adjustment (anchoring the one-person maximum allotment and the each-additional-person increment, the same table-plus-increment shape as the HHS poverty parser) and the **CMS / Medicaid.gov** expansion status (anchoring the effective 138% FPL eligibility threshold; flipping a state's expansion status stays the reviewer's deliberate data-only step, like a full bracket table). Each gets its own workflow caller (`refresh-snap.yml`, annual ~October; `refresh-medicaid.yml`, annual) on the shared `_data-refresh.yml`.

The **third set (added now)** completes the remaining *state income-tax* sources that fit the existing anchor — **New York, Georgia, North Carolina, and DC** — each a one-adapter-per-state entry reusing the same generic standard-deduction parser as California (the CA workflow is the template), with its own staggered-cron caller (`refresh-state-{ny,ga,nc,dc}.yml`, Feb–Apr). Only these four publish a standard deduction by filing status to anchor.

The **fourth set (added now)** covers the seeded flat-rate states whose anchorable figure is the *rate*, not a deduction — **Pennsylvania, Illinois, and Michigan** — via a new `parseFlatRateJurisdiction` parser that anchors the single flat rate from prose ("the income tax rate is 4.95%"), validates it against a plausibility range, and overlays it onto every single-element bracket (which is exactly how a flat tax is stored), plus the personal exemption where IL/MI carry one. Each gets a staggered-cron caller (`refresh-state-{pa,il,mi}.yml`, Apr–May). The no-income-tax states (**TX, FL**) have nothing to refresh.

The **fifth set (added now)** lands the graduated bracket-table parser the earlier sets deferred, completing the last seeded state with an income tax — **Ohio** (multi-tier marginal schedule, no flat rate and no standard deduction). A new `parseGraduatedBracketJurisdiction` anchors each taxable tier as a `(rate)% … in excess of $(threshold)` pair exactly as a published rate schedule states it, refreshing both the per-tier rate *and* its threshold; the lowest ($0) bracket is preserved from the committed shard since its rate is the stable, often-zero base tier rather than an "in excess of" figure. The gap between a rate and its threshold may not cross another `%` or `$`, so a `0%` base-tier mention can never wrongly pair with a higher tier's dollar figure; a plausibility guard rejects any rate outside (0%, 15%], and the assembled schedule must match the committed shard's bracket *count* and stay strictly ascending, so a structural change (a tier added or removed) anchors nothing and routes to the fail-safe alert for a reviewer. One prose schedule is overlaid onto every graduated filing status, which is correct for Ohio (one schedule for all statuses). It gets a staggered-cron caller (`refresh-state-oh.yml`, May). With it, **every seeded state with an income tax has a refresh adapter.** 584 tests pass (added the Ohio bracket-table corpus — the full schedule overlay, the 0%-base-tier disambiguation, the no-tier and tier-added-structural-change failures, the parsed shard validated against the real §7.2 zod schema); `format:check`, `lint`, `typecheck`, `test`, `build`, and the release audit are all green.

The **sixth set (added now)** lands the one remaining seeded Pillar 1/3 source: the **TreasuryDirect Series I savings-bond rates**. A new `parseTreasuryBonds` adapter anchors the currently-published **fixed rate** and **semiannual inflation rate** from the TreasuryDirect prose, converts them to decimals, guards them against a plausibility range (fixed 0–5%, semiannual inflation −5–10%), and refreshes the **latest committed rate period's** figures in place; appending a brand-new May/November period (a structural roll) stays the reviewer's data-only step, exactly like the graduated bracket table and the new-effective-year roll. It gets a semiannual caller (`refresh-treasury.yml`, cron May 1 + Nov 1, the TreasuryDirect announcement cadence) on the shared `_data-refresh.yml`. This set is paired with the new **Treasury I Bond tile** (SPEC §3.4; `src/tiles/savingsBond.ts` + the golden-tested `src/engine/savingsBond.ts`) — the composite-rate formula (`fixed + 2·semi + fixed·semi`, floored at 0) computed straight from the bundled, cited `data/treasury-bonds-2024.json`, valuing a purchase one six-month period at a time **through the last published period only** (never a forecast, §2.1). With it, **every dataset kind in the §7.2 refresh manifest that has a seeded shard now has a refresh adapter**, and every §3.4 saving-and-growth tool — including the I-bond/savings-bond rates — is live.

The **seventh set (added 2026-06-04)** closes the gap the flat-rate "fill in the rest" wave (§14.3) opened: those seven states (AZ, CO, IN, KY, MA, MS, ID) shipped **data-only** and so lacked the adapter the originally-seeded states had, which quietly falsified the fifth set's "every seeded state with an income tax has a refresh adapter" claim. They now each get one, reusing the existing parsers wherever the shape fits: **AZ / CO / IN / KY / ID** are single-rate flat taxes (the PA/IL/MI `parseFlatRateJurisdiction` verbatim, IN's $1,000 personal exemption overlaid like IL's); **MS** is a two-tier "0% then a flat 4% over a $10,000 floor" schedule (the Ohio `parseGraduatedBracketJurisdiction`, base tier preserved); and **MA** is the one state whose shape fits neither parser — a 5% base rate plus the constitutional 4% surtax over an inflation-adjusted threshold ($1,107,750 for 2026), stored as a two-element schedule with the *combined* 9% upper rate the source never states as a single figure. So MA gets a small dedicated `parseMassachusettsSurtax` that anchors the two figures that actually move year to year (the base rate and the surtax threshold) and the 4% surtax rate, combining them onto the upper bracket. A shared `pctToRate` helper rounds the percent→decimal conversion to ten places, fixing a latent IEEE-754 spurious-diff bug (a clean read of Indiana's 2.95% had diffed against the committed `0.0295` and would have opened a PR every run; rates that already divide cleanly are unaffected). Each state gets a staggered-cron caller (`refresh-state-{az,co,in,ky,id,ms,ma}.yml`). **Now every seeded jurisdiction with an income tax genuinely has a refresh adapter.** 635 tests pass (added the seventh-set adapter corpus — the five flat reuses, the MS two-tier reuse, and MA's anchor / moved-threshold / missing-anchor / implausible-rate cases); `format:check`, `lint`, `typecheck`, `test`, `build`, `wrangler deploy --dry-run`, and the release audit are all green.

- Deferred to later sets (same pattern): per-filing-status graduated schedules for any future state whose tiers differ by status. Repo setting note: opening PRs from a workflow requires "Allow GitHub Actions to create and approve pull requests" enabled; the workflows use the built-in `GITHUB_TOKEN` (no third-party action, no extra secret).

Prompt to Claude Code:

> Implement one GitHub Actions workflow per data source group in section 7.2 of BUILD-SPEC.md, each following the section 7.3 contract: fetch, parse with a source specific adapter, emit normalized JSON plus content hash, append a human readable entry to the source diff log, run the full golden test suite, and open a pull request only if tests pass and values changed, or an alert pull request that flips affected rules to fail safe if a source fails. Use the correct cadence per source (monthly for CPI, annual staggered for the rest). Never auto commit data to the main branch without the test gate. Write the adapters for the IRS annual notice, the BLS CPI database, the SSA fact sheet, the HHS poverty guidelines, and the California state source as the first set. Acceptance criteria: each workflow runs on its schedule and manually, the diff log is updated, and the test gate blocks bad data.

### Phase 10: Continuous integration, audit release, and deploy

Goal: a clean pipeline from commit to Cloudflare.

**Status: ✅ done.** The **audit-release script** (`scripts/audit-release.ts`, `npm run audit`) mechanically verifies the family invariants and fails the build on any violation: (1) the Worker CSP keeps `connect-src 'none'` for pages, (2) the built `index.html` loads no cross-origin resources, (3) every dataset shard carries a complete citation (the no-orphan-numbers gate), and (4) `localStorage` is touched only by the theme/locale boundary, so nothing financial ever persists. Its checks are pure functions, unit-tested with good and violating inputs, and the CLI runs against the real `dist/` + sources. **CI** (`.github/workflows/ci.yml`) runs format-check, lint, typecheck, tests (incl. the golden corpus and axe accessibility checks), build, then the audit — on Node 24 so the TypeScript build scripts run directly.

- **Deploy is via Cloudflare's native Git integration (Workers Builds), not a GitHub Action.** The repo is connected to Cloudflare, which builds and deploys on every push to `main` — so the site is already live and stays current automatically. No `CLOUDFLARE_*` GitHub secrets are needed, and there is no `deploy.yml` workflow (an earlier draft added one; it was removed as redundant). GitHub Actions is the quality gate; Cloudflare is the deploy.
- **Now landed: the Playwright end-to-end suite** (`e2e/`, `npm run test:e2e`, `playwright.config.ts`). It runs the real production build (`vite preview` over `dist/`) in headless Chromium, as its **own CI job** so the Vitest unit/golden suite stays fast and browser-free. Three things happy-dom cannot check are now measured in a real browser: (1) **responsiveness** — every key view (home, All Tools, About, Readout, Report) fits with **no horizontal scroll across eight device widths (320–1440px)**, and **all 56 tools** (harvested from `sitemap.xml`) fit at a tight 360px phone, including a tool with its result card and "show the math" table open; the measurement disables the `overflow-x: clip` backstops first so a *genuine* leak is caught rather than masked; (2) **offline** — after the first visit the service worker serves the shell with the network cut (the Phase 8 criterion, now verified end-to-end); (3) a **deep-link → compute smoke** path and the ⌘K palette. This pass also fixed two real overflow leaks it surfaced: the Readout's native file input (a wide intrinsic min-width) and the Readout Report's value cells (the shared `white-space: nowrap` forced prose sentences onto one line, widening the table past a phone).

Prompt to Claude Code:

> Add a continuous integration workflow that runs lint, format check, unit tests, the golden corpus, Playwright end to end and accessibility tests, and a build, on every push and pull request. Add an audit release script in the scripts directory that mechanically verifies the family invariants before any release: Content Security Policy connect-src is none, there are no third party network references in the built output, every shipped rule has a citation, and no sensitive input is persisted. Add a deploy workflow that runs wrangler deploy to Cloudflare Workers Static Assets on merge to the main branch only after continuous integration passes. Acceptance criteria: continuous integration is green, the audit release script fails the build if any invariant is violated, and a merge to main deploys to Cloudflare.

### Phase 11: Internationalization, documentation, and launch checklist

Goal: polish and ship.

**Status: 🟡 second wave done (crawlability + docs + on-page SEO/social surface + mobile responsiveness).** The search-engine crawlability surface and the documentation set are live. enklayve is a fragment-routed single page, so on its own no individual tool has a crawlable URL; the build now emits a **pre-rendered static shell per tile** (`/tools/<id>.html`, `scripts/tool-pages.ts`) carrying the tool's name, description, "how this works," and trusted sources with a deep link into the live on-device tool, plus a **`sitemap.xml`** listing the home, the All Tools index, and every tool shell, and a **`robots.txt`** advertising it (`scripts/sitemap.ts`, wired through the `staticSeo` Vite plugin). All three are rendered in `scripts/` so a **drift test** (`tests/ui/seo.test.ts`) asserts they list exactly the registry's tiles — the same guard the static `tools.html` already had. Each shell is self-contained (inline styles, nothing cross-origin *loaded* — only the "learn more" anchors point out), so the privacy promise is intact. The **documentation set** (SPEC §12) ships under `docs/`: a **data-sources** reference (sources, cadence, the fail-safe contract), an **adding-a-state** guide (data-only, the jurisdiction shape, the no-income-tax record), a **contributing** guide (the non-negotiable principles, the tile contract, local workflow), and a **launch checklist** that walks every acceptance criterion across Phases 0–13.

**Second wave (added now): the on-page discovery + social surface, and mobile responsiveness.** The home `index.html` — the primary indexable page — now carries the full head a crawler and a social scraper expect: a descriptive `<title>` and meta description, a self-referential **canonical**, `robots`, **Open Graph** + **Twitter Card** tags, and **JSON-LD `WebApplication`** structured data (free, `FinanceApplication`); the per-tile static shells and the All Tools index gained the same OG/Twitter/robots tags with absolute canonicals (`scripts/tool-pages.ts`, `scripts/tools-index.ts`). A new `tests/ui/seo.test.ts` block guards the home head (canonical, OG/Twitter, parseable JSON-LD, no cross-origin loads). **Raster social card (2026-06-04):** the OG/Twitter image was an SVG (`icon.svg`), which does not render on Twitter/X, Facebook, LinkedIn, Slack, or iMessage — so shared links showed no preview. A committed generator (`scripts/og-image.ts`, `npm run og:image`) renders an on-brand 1200×630 card and screenshots it via Playwright to `public/og-image.png`; the home and both static-page generators now point `og:image`/`twitter:image` at it with `summary_large_image`, and the seo test asserts the card is a raster `.png`. It is a one-off brand asset (committed like `icon.svg`), so CI never runs Playwright for it. On the responsiveness side, the symptom that several tools could be dragged sideways on a phone was traced to two leaks and fixed at the root in `src/styles.css`: form controls (a `<select>` with a long option label, number inputs) now carry `min-width: 0` so they shrink inside their grid track, and the "Show the math" breakdown tables get their own contained horizontal scroll; an `overflow-x: clip` backstop on the content column guarantees the page only ever scrolls vertically (it leaves vertical scroll and the sticky header untouched), and `viewport-fit=cover` + `env(safe-area-inset-*)` keep the chrome clear of the notch. The **release audit** (`scripts/audit-release.ts`) was refined so its "no cross-origin loads" check correctly treats a self-referential absolute URL on the production origin (the new canonical/og URLs) as same-origin rather than a third-party load, while still flagging any genuine CDN/third-party resource (covered by new audit unit cases, including a look-alike-origin case). 593 tests pass; `format:check`, `lint`, `typecheck`, `build`, `wrangler deploy --dry-run`, and the release audit are all green.

- **The Playwright end-to-end + live-offline suite now ships** (see Phase 10): a separate CI job runs headless Chromium over the production build to verify responsiveness (no horizontal scroll on every view, 320–1440px, all 56 tools at 360px), the offline service worker, and the deep-link → compute path. axe accessibility continues to run inside Vitest.
- **Deferred to a later wave:** the i18n string layer (the locale preference already persists alongside the theme since Phase 4; a full pre-rendered-static-variants extraction across all tiles is held rather than ship a speculative abstraction, per §0.4 — the scaffolding is for U.S. English presentation, not other countries yet).

Prompt to Claude Code:

> Add internationalization scaffolding with English as the default locale and the locale preference persisted, following the encryptalotta pattern of pre rendered static variants rather than runtime translation. Write the documentation set per section 12 of BUILD-SPEC.md: a data sources document listing every source and cadence, the adding a state guide, and a contributor guide. Generate a sitemap and per tile pre rendered shells for search engine crawlability, in the roughlogic style. Write a launch checklist that confirms every acceptance criterion across phases 0 through 10, confirms offline works, confirms the audit release passes, and confirms a clean deploy. Acceptance criteria: the documentation is complete, the sitemap and shells exist, and the launch checklist passes end to end.

---

## 14. Defaults chosen (so building is not blocked)

These were open questions in the earlier discussion. Proceed with these defaults unless overridden:

1. **Tax year scope:** current year plus one prior year, since the data is already structured by year and people file late.
2. **Itemized deductions depth:** the big four only at launch (state and local taxes capped, mortgage interest, charitable, and medical above the floor).
3. **State coverage rollout:** the ten most populous states plus the District of Columbia at launch, with a visible coming soon list, then fill in the rest through the staggered annual refresh.

---

## 15. One line positioning

enklayve: the honest money guidance the experts charge for — your real take-home, what you owe, what you're owed, and your next right step — free forever, private by design, and showing its work. Computed entirely on your device. Nothing ever leaves. (Voice and positioning: see BUILD-SPEC-2 §0.1.)
