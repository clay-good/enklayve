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
3. **No telemetry, no accounts, no third party anything.** No analytics, no fonts from a CDN, no trackers. The only persisted state is a single theme preference and a single locale preference in localStorage.
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
- **Three themes:** light first, plus dark, plus a high contrast theme. High contrast matters for older users doing retirement math.
- **Big, legible numbers.** Generous whitespace, rounded cards, soft shadows, and one delightful micro interaction on result reveal (a gentle count up that respects reduced motion preferences).
- **Tone:** plain English, encouraging, never scolding. Here is where you stand, not you are behind.
- **Result cards** show the answer large, the breakdown collapsible, and a one tap copy plus permalink. Every input has a worked example default.

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
  - Scope notes for later phases: state-level itemized deductions, exemption *credits* (vs. the modeled income exemptions), Yonkers' percent-of-state-tax surcharge, and AMT are intentionally deferred.
- ✅ **Phase 4 — UI shell and design system.** Done. A tiny vanilla render layer (`src/ui/dom.ts`, no framework), three instant-switch themes (light/dark/high-contrast) with royal-purple primary + warm-gold accent and red reserved for warnings (`src/ui/theme.ts` + `styles.css`, persisted alongside the locale in localStorage — the only persisted state), a reduced-motion-aware count-up (`countup.ts`), the result card (large answer, collapsible per-line-cited breakdown, copy-number + copy-link buttons), fragment-based routing that encodes/restores tile state (`router.ts`), a fuzzy command palette (Cmd/Ctrl-K, multi-word tokens) searching the full tile catalog (`fuzzy.ts` + `commandPalette.ts` + `tiles/registry.ts`), and the assembled shell (`shell.ts`). Datasets are inlined at build time via Vite `?raw` and run through the same integrity/schema/staleness gate in the browser (`src/data/browser.ts`), keeping `connect-src 'none'` literally true. The **Take-Home Pay** tile (`tiles/takeHome.ts`) is fully built end-to-end on the engine — worked example, per-line citations, deep-linkable URL state — proving the tile pattern for Phase 5; every other §3–5 + SPEC-2 §4 tool is registered as a "coming soon" catalog entry the palette and home grid already reach. axe-core is wired into the Vitest run: home, the tile form, and the fully mounted shell pass with zero violations (color-contrast is verified by hand against the theme tokens since happy-dom has no layout engine). 88 tests pass; `lint`, `typecheck`, `format:check`, `build`, and `wrangler deploy --dry-run` are all green.
- 🟡 **Phase 5 — Pillar 1 tiles (first wave).** In progress. Shared tile-form helpers (`src/ui/form.ts`) and a deterministic time-value-of-money module (`src/engine/finance.ts`, golden-tested) were added, and four Pillar 1 tiles are now live on the engine + shell, each with a worked example, deep-linkable URL state, and golden/behavior coverage: **Take-Home Pay** (Phase 4), **Federal Income Tax** (`federalIncomeTax.ts` — standard-vs-itemized "big four" toggle, marginal + effective breakdown, IRS-cited), **Marginal Rate Explorer** (`marginalExplorer.ts` — attributes the cost of the next dollars across federal/FICA/state, each cited), and **Compound Growth** (`compoundGrowth.ts` — user-supplied rate shown as a clearly labeled assumption, no market prediction). axe-core covers every tile form with zero violations. 102 tests pass; `lint`, `typecheck`, `format:check`, `build`, and `wrangler deploy --dry-run` are all green.
  - Remaining Phase 5 tiles (W-4 estimator, hourly/salary, self-employment tax, capital gains, loan/refinance/auto borrowing, retirement optimizer, RMD, CPI inflation adjuster) stay registered as "coming soon" and land in later waves on this same pattern. Several need new datasets (IRS retirement limits, BLS CPI-U, life-expectancy tables) seeded first.
  - Sequencing note (SPEC-2 §7): **Your Situation** (Phase 12, the in-memory session profile) is foundational and ideally lands soon so tiles read/write a shared profile instead of re-entering income; the current tiles will be retrofitted to it then.

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

Prompt to Claude Code:

> Implement all Pillar 2 tiles listed in section 4 of BUILD-SPEC.md: the Federal Poverty Level calculator with the contiguous, Alaska, and Hawaii variants, the ACA premium tax credit estimator using the applicable percentage table and the county benchmark silver plan, the EITC estimator, the Child Tax Credit and Additional Child Tax Credit, the Saver's Credit, the SNAP eligibility estimator with the gross and net income tests, the Medicaid threshold checker by state, the FAFSA Student Aid Index estimator using the published federal methodology, and the Pell Grant award estimator. Then build the combined What am I owed screener that takes household size, income, state, and ages once and returns a calm plain English list of likely eligible programs with an estimated dollar figure and a citation for each line, asking for no identifying information. Seed the required datasets with full citations and wire them into the refresh manifest. Add golden cases. Acceptance criteria: every program tile matches its published worked example, the screener composes them correctly, and every figure cites its source.

### Phase 7: Pillar 3 tiles, Safe Harbor

Goal: the calm wealth tools and vocabulary in section 5.

Prompt to Claude Code:

> Implement all Pillar 3 tiles listed in section 5 of BUILD-SPEC.md using the reframed vocabulary exactly: Rainy Day Fund, Runway, War Chest, Your Enough Number, Downshift Point, Freedom Date, the Peace of Mind dashboard, and the sabbatical and big purchase planner. All assumptions (return rate, inflation rate) must be user editable with clearly labeled defaults, and inflation aware tools must use the bundled CPI data. Enforce the section 5.3 tone rules: encouraging never scolding, frame progress not failure, and never use red as a primary color in this pillar. Add golden cases for the deterministic math. Acceptance criteria: every tool shows and lets the user edit its assumptions, the dashboard composes the underlying tools correctly, and the copy follows the tone rules.

### Phase 8: Offline and progressive web app

Goal: full offline capability.

Prompt to Claude Code:

> Add a service worker that pre caches the application shell and the data shards per section 11 of BUILD-SPEC.md, with a cache versioning strategy tied to the data manifest version so a data refresh invalidates the right caches. Add a web app manifest so enklayve installs as a progressive web app with the royal purple theme color. Ensure sensitive inputs are cleared on page unload. Acceptance criteria: the site loads and computes fully offline after a first visit, and a data refresh correctly invalidates stale caches.

### Phase 9: Data refresh workflows

Goal: the GitHub Actions that keep the data current per section 7.

Prompt to Claude Code:

> Implement one GitHub Actions workflow per data source group in section 7.2 of BUILD-SPEC.md, each following the section 7.3 contract: fetch, parse with a source specific adapter, emit normalized JSON plus content hash, append a human readable entry to the source diff log, run the full golden test suite, and open a pull request only if tests pass and values changed, or an alert pull request that flips affected rules to fail safe if a source fails. Use the correct cadence per source (monthly for CPI, annual staggered for the rest). Never auto commit data to the main branch without the test gate. Write the adapters for the IRS annual notice, the BLS CPI database, the SSA fact sheet, the HHS poverty guidelines, and the California state source as the first set. Acceptance criteria: each workflow runs on its schedule and manually, the diff log is updated, and the test gate blocks bad data.

### Phase 10: Continuous integration, audit release, and deploy

Goal: a clean pipeline from commit to Cloudflare.

Prompt to Claude Code:

> Add a continuous integration workflow that runs lint, format check, unit tests, the golden corpus, Playwright end to end and accessibility tests, and a build, on every push and pull request. Add an audit release script in the scripts directory that mechanically verifies the family invariants before any release: Content Security Policy connect-src is none, there are no third party network references in the built output, every shipped rule has a citation, and no sensitive input is persisted. Add a deploy workflow that runs wrangler deploy to Cloudflare Workers Static Assets on merge to the main branch only after continuous integration passes. Acceptance criteria: continuous integration is green, the audit release script fails the build if any invariant is violated, and a merge to main deploys to Cloudflare.

### Phase 11: Internationalization, documentation, and launch checklist

Goal: polish and ship.

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

enklayve: the calm, private place to know your real take home, what you owe, what you are owed, and how much is enough. Computed entirely on your device. Nothing ever leaves.
