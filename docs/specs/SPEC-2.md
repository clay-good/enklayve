# enklayve.com — Build Spec 2: Experience, Ingestion, and Guidance

> A calm, private, personal money guide. Drop in your documents, see exactly where you stand, and get the next right step. All computed on your device. Nothing ever leaves.

This is the second specification for enklayve.com. It builds directly on BUILD-SPEC.md, which defines the engine, the data layer, the refresh workflows, and the three pillars (Take Home and Taxes, What You're Owed, and Safe Harbor). This document adds the parts that turn a strong calculator suite into something that feels like a personal money guide:

1. The home experience and information architecture (the design decision).
2. The Readout: deterministic document ingestion, the vaulytica pattern applied to personal finance documents.
3. Your Situation: a session profile so the user enters their numbers once and every tool knows them.
4. Your Plan: a deterministic guidance engine, the calm and personal feel without any AI.
5. The Readout Report: a downloadable, deterministic summary of where the user stands.
6. The expansion roadmap of additional personal finance tools.
7. Build prompts for Claude Code, continuing the phase sequence from Spec 1.

The guiding ambition: enklayve should feel like a personal money guide that is always on the user's side. Opinionated enough to tell you the next right step, calm enough never to shame you, and honest enough to show its math and cite its sources. Where popular money personalities sell courses, push dogma, and guess, enklayve gives the same clarity for free, lets the user adjust the rules, shows every calculation, and never sends a byte anywhere.

---

## 0. Design decisions (adopted 2026-05-29)

These supersede earlier wording across both specs:

1. **First-person, personal naming.** The product's owned surfaces are named in the first person — **"My Situation"**, **"My Plan"**, **"My Readout Report"**, **"My Enough Number"** — so it reads as *my* personal finance tool. (Earlier drafts called these "Your Situation" / "Your Plan"; the codebase and copy now use the first person. Internal route ids like `#/your-plan` are unchanged to preserve links.) The guidance prose still warmly addresses the reader as "you" ("here's your next right step").
2. **Warm, kind, and explanatory by default.** Every tool page carries a plain-English **"How this works"** that explains the logic and the math, a **"Learn more"** list of trusted external resources, and a one-line promise that it's computed on-device, US-only, and is information rather than advice. The voice is warm and never shaming.
3. **Resources on every page.** Beyond per-figure citations, every tool and the home link out to authoritative U.S. sources (IRS, HHS, SSA, Benefits.gov, HealthCare.gov, CFPB, Federal Student Aid) so the user can always go deeper.
4. **United States only, for now.** enklayve is intentionally scoped to U.S. federal and state taxes and benefits. International support is explicitly deferred so every figure stays accurate; the home says so plainly. (The i18n scaffolding in Phase 11 is for U.S. English presentation, not other countries.)
5. **No modal is ever a trap.** Dialogs (e.g. My Situation) are always dismissable by a visible Close button, a Done button, the Escape key, and clicking outside. (Implementation note: a global `[hidden] { display: none !important }` reset ensures the `hidden` attribute always wins over an overlay's `display: flex`, so closing actually hides it.)
7. **The home is radically simplified to three calm zones, and the header to a wordmark + a sun/moon (adopted 2026-06-01).** The teaching journey (§0.6) taught well but still read as busy, and the header carried three controls. The product is now spelled out plainly at a roughly 7th-grade reading level and stripped to the essentials:
   - **Header:** left, the wordmark **enklayve** with the lowercase tagline **"personal finance"** beside it (shortened from "personal finance counsel" on 2026-06-02 — quieter, and "counsel" overstated it); nothing else. The "Search tools" and "My Situation" buttons and the theme control are all gone from the header.
   - **Home body, three centered zones:** (1) the Readout **drag-and-drop**; (2) a **live search box** that drops matching tools in a combobox as you type; (3) **every tool listed** under the eight plain-language category headings (§1.5). No teaching journey, no wall of value props on the home (the trust story stays on `#/about`); a single quiet "See your plan" link points first-timers to My Plan.
   - **Footer:** a row of **uniform buttons** — My situation, Why enklayve, GitHub, and the author credit — that wraps to a tidy two-up grid on a phone.
   - **One light theme (adopted 2026-06-01, SPEC §10):** enklayve ships a single, calm, easy-on-the-eyes light theme and **no theme toggle at all**. The dark and high-contrast themes and the sun/moon switcher were removed for the simplest, most delightful default.
   This supersedes the §0.6 "home leads with the journey" decision and the §1.1/§1.3 header+card sketch; the ⌘K palette, the crawlable All Tools index, every route/deep link, and the My Situation export/import are all unchanged (the panel now opens from the footer). The eight-category browse taxonomy (§1.5) is now what the home itself renders.
6. **The home leads with a teaching journey, not a tool grid (adopted 2026-05-30).** The eight expandable category cards (§1.5) sorted the catalog but taught nothing, and a wall of fifty tools read as busy — the opposite of a guide. So the home now leads with the **ordered path My Plan already encodes** (§4.1): the seven steps — starter cushion → employer match → high-cost debt → full rainy-day fund → tax-advantaged retirement → sinking funds → war chest — rendered as a numbered, calm sequence where **each step teaches the lesson behind it and links to the one tool that performs it**. The trust story ("Why enklayve") moved off the home onto its own `#/about` page (linked from the footer), and the hero was trimmed to one line plus one sentence. The full catalog stays one quiet click away: **"Browse all tools"** (the crawlable All Tools index / `tools.html`) and **⌘K search** in the header. The `Pillar` taxonomy is **retired from the main experience** but kept as the grouping for the All Tools index and the static `tools.html` (the catalog/SEO surface), so deep links and crawlability are unchanged. This supersedes the "eight category cards on the home" parts of §1.1 and §1.5 below; the rest of §1 (upload hero, inline search, no mega dropdown, pre-rendered index) stands.

### 0.1 Voice and positioning (adopted 2026-05-29)

Don't *describe* the product as "calm and kind" — *be* it, and let the framing be relatable:

- **A friendlier, more capable version of the money gurus — and free.** The Dave-Ramsey-style personalities built fortunes charging for guidance that boils down to what this site does deterministically: know your real take-home, what you owe, what you're owed, and your next right step. enklayve gives more than they sell, for free, and it stays free.
- **Free forever, a public utility.** No accounts, ads, cookie banners, sponsors, subscriptions, upsells, or "premium" tier — ever. Knowing where you stand should be a public good. This is non-negotiable; "free and stays free" is a core principle, not a launch promotion.
- **Peace in digital form.** A deliberate contrast to the transactional web. No dark patterns, no shame, no FOMO — peace, knowledge, and deterministic verification, so people genuinely understand their situation and how to keep going.
- **Trust through verification, not authority.** Every figure shows its math and links the public rule behind it; the user can check it themselves rather than trust a personality.
- **Cover the project legally.** Clear, friendly disclaimers appear on the home and on every tool: educational information, **not** financial, tax, investment, or legal advice; figures are estimates from public data and the user's inputs; verify anything important with the official source or a qualified professional.

### 0.2 Country scope and roadmap

United States only **today** (federal and state taxes and benefits). The intended expansion order, as each jurisdiction's rules are learned properly, is **Europe, then India, China, and Russia**, and possibly stopping there rather than guessing at countries we don't understand. The principle: be right before being everywhere. The home states the current scope and the roadmap plainly.

### 0.3 Deployment

The repository is connected to **Cloudflare's native Git integration (Workers Builds)**, which builds and deploys on every push to `main`. The site is live and stays current automatically; there is no GitHub deploy workflow and no `CLOUDFLARE_*` GitHub secret. GitHub Actions is the quality gate (lint, types, tests, build, the release audit); Cloudflare is the deploy.

---

## 1. The design decision: home experience and information architecture

The question was whether to put a vaulytica style upload front and center, then a search bar, then the tools, in a compact sophiewell style rather than the longer roughlogic scroll. The answer is yes to all three, with one refinement.

### 1.1 Recommendation

Lead with the upload, follow with search, then offer compact grouped browsing. Concretely, the home screen is three stacked zones above the fold:

1. **The Readout dropzone (hero).** Big, central, inviting. Drop a pay stub, W-2, 1040, or 1095-A and get an instant private readout. This is the single most personal moment in the product and the strongest differentiator. It is the vaulytica pattern, reframed for personal finance: you give it your documents, it gives you a result, and nothing is uploaded anywhere.
2. **A prominent search bar.** The same fuzzy command palette from Spec 1, shown inline. Search is how returning users and confident users navigate. This is the sophiewell hero search behavior.
3. **Compact grouped browsing.** A small grid of category cards, one per topic group plus an All Tools index. Cards expand to reveal their tools. This is the sophiewell density you preferred, not the long roughlogic scroll. (The grouping was reorganized from the original four pillars into eight smaller topic groups; see §1.5.)

### 1.2 The one refinement: do not use a single mega dropdown

A single dropdown listing all forty plus tools is awkward to operate, poor on mobile, and weak for accessibility and screen readers. Use search as the primary path and grouped expandable category cards as the browse path. Keep a dedicated All Tools index route as well, fully pre rendered for search engine crawlability in the roughlogic style, so every tool has a stable, linkable, indexable home. Search for the people who know what they want, cards for the people who want to look around, and the index for completeness and discoverability.

### 1.3 Home layout sketch

```
+-------------------------------------------------+
|  enklayve            [theme]      [Your Plan]   |
|                                                 |
|         Know where you stand. Privately.        |
|                                                 |
|     +-------------------------------------+     |
|     |  Drop a pay stub, W-2, 1040, or     |     |
|     |  1095-A  ->  instant private readout|     |
|     |        (or browse the tools)        |     |
|     +-------------------------------------+     |
|                                                 |
|     [  Search any tool or question...      ]    |
|                                                 |
|   +----------+ +----------+ +----------+        |
|   | Take Home| | What     | | Safe     |        |
|   | & Taxes  | | You're   | | Harbor   |        |
|   |          | | Owed     | |          |        |
|   +----------+ +----------+ +----------+        |
|   +----------+ +----------+                     |
|   | Your Plan| | All tools|                     |
|   +----------+ +----------+                     |
+-------------------------------------------------+
```

### 1.4 Why this beats the incumbents on first impression

The lead generation calculators bury the tool under advertising and route the user toward a lender. enklayve leads with an action that helps immediately and visibly keeps the user's data on the device. The hero is the trust promise made tangible.

### 1.5 Tool grouping: eight topic groups (adopted 2026-05-29)

The original three pillars (Take Home & Taxes, What You're Owed, Safe Harbor) plus My Plan were the right *story* but the wrong *browse structure*. As the catalog grew past forty tools, "Take Home & Taxes" became a ~27-tool dumping ground spanning paychecks, taxes, investing, borrowing, budgeting, home buying, health plans, and college — which is the opposite of easy to scan — while "Safe Harbor" mixed calm-wealth, retirement income, and insurance.

So the home cards and the All Tools index now group tools into **eight smaller, plainly-named money areas**, each holding roughly three to ten related tools:

1. **Paycheck & Taxes** — take-home, W-4, hourly↔salary, federal income tax, self-employment tax, marginal explorer, paycheck optimizer.
2. **Investing** — capital gains, cost-basis lot picker, tax-loss harvesting, compound growth, CPI inflation.
3. **Retirement** — contribution optimizer, Roth conversion ladder, backdoor Roth, RMD, drawdown & RMD timeline, Social Security claiming, downshift point.
4. **Borrowing & Debt** — loan/mortgage amortization, refinance, auto loan, balance transfer, freedom date.
5. **Budgeting & Cash Flow** — 50/30/20, zero-based budget, cash-flow timeline, sinking fund.
6. **Home, Family & Protection** — home affordability, rent vs buy, college cost, health-plan chooser, life insurance, disability, umbrella, estate checklist.
7. **Benefits & Aid** — the What-You're-Owed pillar intact: FPL, the screener, EITC, CTC, ACA PTC, Saver's Credit, SNAP, Medicaid, FAFSA SAI, Pell.
8. **Where You Stand** — the calm overview and the guide: Peace of Mind, My Plan, the sabbatical planner.

The three-pillar narrative still describes the *product* (and the engine code is unchanged); the eight groups are purely the **browse taxonomy** (`Pillar` in `src/tiles/types.ts`, rendered by the home and the All Tools index). This is safe to reorganize precisely because **My Situation centralizes the shared inputs** — income, filing status, state, household size, savings, debts — so the tools never depended on their grouping; a value typed in one group still prefills any tool in any other. Search (the command palette) and the pre-rendered All Tools index remain the primary and the crawlable browse paths, so the regrouping changes only how the home cards are labeled and split, not any route or deep link.

---

## 2. The Readout: deterministic document ingestion

This is the vaulytica architecture, applied to personal finance documents. The user drops a file or a folder, the browser parses it locally, extracts known fields deterministically, and uses them to populate tools and produce a readout. Nothing is uploaded.

### 2.1 Supported documents and what we extract

- Pay stub: gross pay, net pay, pay frequency, federal and state withholding, retirement contributions, pre tax deductions, and year to date totals. Feeds take home, W-4 tuning, and the retirement optimizer.
- W-2: wages, federal and state withholding, retirement plan contributions, and HSA amounts. Feeds tax owed and the refund estimate.
- Form 1040 from a prior year: adjusted gross income, taxable income, and total tax. Feeds the marginal rate explorer, the benefits screener income, and the FAFSA Student Aid Index.
- 1099 forms (interest, dividends, nonemployee compensation, brokerage proceeds): investment income, self employment income, and capital gains with cost basis.
- Form 1095-A: marketplace premiums and the benchmark plan figure. Feeds the premium tax credit estimator and reconciliation.
- Form 1098 and mortgage statements: mortgage interest, balance, and rate. Feeds amortization and refinance break even.
- FAFSA Submission Summary: the figures needed to verify a Student Aid Index estimate.

### 2.2 How extraction stays deterministic

- Typed PDFs are parsed with the same library family vaulytica uses (pdfjs for PDF, mammoth for Word), then fields are read by anchoring to known form labels and box numbers, for example the wages box on a W-2 or the adjusted gross income line on a 1040. This is anchored, rule based extraction, not inference.
- Optical character recognition is offered only as a clearly labeled fallback for scanned or photographed documents, using the same on device engine vaulytica uses. Any value that came from optical character recognition is flagged as lower confidence and needs review. The engine is deterministic given the same image, but the user is told the source.
- Every extracted field carries a confidence state and a needs review flag. The user always confirms the extracted numbers before any tool uses them. The product never silently trusts a parsed figure.
- Form layouts change year to year, so extractors are versioned and citation pinned to the form revision, and they refresh on the same workflow contract as the data in Spec 1. If a form revision is unrecognized, the field is marked unrecognized rather than guessed.

### 2.3 The ingestion result

After confirmation, the extracted fields flow into Your Situation (section 3), which powers every relevant tool, and into the Readout Report (section 5). The user sees an immediate plain English summary: here is your gross and net, here is your effective tax rate, here is your refund estimate, here is what you may be owed, and here is your next right step.

---

## 3. Your Situation: the session profile

The personal money guide feeling depends on continuity. The user should enter a number once, not retype income in eight tools. Your Situation is a single in memory profile that every tile reads from and writes to.

### 3.1 What it holds

Household size and ages, filing status, state and county, income and its sources, pre tax contributions, balances by account type, debts with rates and balances, essential and total monthly expenses, and any figures extracted by the Readout. Each field records where it came from: typed by the user, extracted from a document, or assumed as a default.

### 3.2 How it respects the privacy principle

Spec 1 says sensitive inputs never persist and are cleared on unload. Your Situation honors this exactly:

- The profile lives only in memory during the session and is cleared on unload.
- Continuity across sessions is opt in and user held. The user may export Your Situation to a local file that they keep. They may re import it later to resume. The product never writes it to storage automatically and never sends it anywhere.
- The export may be passphrase encrypted on the device, reusing the techniques already proven in encryptalotta, so a user can keep a portable, private financial profile that only they can open. This is a natural bridge to the sibling product and keeps the no server promise intact.

### 3.3 Why this matters

Once the site knows the user's situation, every tool gets faster and the guidance engine in section 4 becomes possible. This is the difference between a pile of calculators and a guide that knows you, achieved without an account and without a server.

---

## 4. Your Plan: the deterministic guidance engine

This is the personal money guide core. It is a rules based, ordered plan that reads Your Situation and tells the user the single next right step, with the math shown and the reasoning explained. It is opinionated by default and adjustable by choice. It uses no AI and makes no prediction.

### 4.1 The default ordered plan

A calm, sensible default sequence, framed around security and optionality rather than escape or shame:

1. Starter cushion: a small starter rainy day fund so a surprise does not become a crisis.
2. Capture the full employer match: this is money the employer is offering, so take all of it.
3. Clear high cost debt: pay down debts above a high interest threshold, with the user choosing the smallest balance first or the highest rate first approach.
4. Full rainy day fund: build to a chosen number of months of essential expenses.
5. Fund tax advantaged retirement: move toward the current year limits, prioritized by tax efficiency.
6. Sinking funds for known expenses: set aside for college, a car, a home, or a sabbatical that the user has named.
7. Build the war chest: pay down the mortgage and grow toward Your Enough Number from the Safe Harbor pillar.

### 4.2 How it behaves

- The engine reads Your Situation, determines which step the user is currently on, and surfaces one concrete next action with the exact dollar figure and the tile that performs it.
- Every step shows its math and cites the rule behind any threshold, for example a contribution limit or a deduction figure.
- The plan is adjustable. The user can choose smallest balance first or highest rate first for debt, can change the rainy day target in months, can reorder steps, and can turn steps off. The default is opinionated, but the user is never locked into the opinion.
- The tone follows the Safe Harbor rules from Spec 1: encouraging, never scolding, framing progress and not failure. The plan says here is the next right step, never you are behind.

### 4.3 How this is better than a money personality

- It is free, with no course to buy and nothing to upsell.
- It shows every calculation rather than asking for trust.
- It cites the public rule behind every number.
- It is adjustable rather than dogmatic, so it fits the user rather than forcing the user to fit it.
- It is private, computing entirely on the device and sending nothing anywhere.

---

## 5. The Readout Report: a downloadable summary

Mirroring vaulytica's output of a cited Word document, enklayve produces a downloadable Readout Report that summarizes where the user stands. It is generated on the device from Your Situation, with no server and no upload.

### 5.1 Contents

- A snapshot: income, effective and marginal tax rates, take home, net worth, and rainy day months covered.
- The tax picture: what is owed or refunded, and the marginal cost of the next dollar of income.
- What you may be owed: the benefits and aid the screener found likely, with estimated dollar figures.
- Your Plan: the current step and the next right step, with the math.
- An assumptions and sources appendix: every assumption the user accepted, every dataset version used, and the citation for every figure, so the report is reproducible and auditable.

### 5.2 Formats

A clean printable document in the same spirit as the vaulytica report, generated with the same document library family, plus the option to export Your Situation as the portable encrypted profile described in section 3.

---

## 6. Expansion roadmap: more tools within personal finance scope

These extend the three pillars without leaving personal finance. They are grouped and roughly prioritized. They reuse the engine, the session profile, and the guidance plan.

### 6.1 Cash flow and budgeting
- A zero based monthly budget where every dollar is assigned, in the give every dollar a job spirit.
- Spending plan frameworks such as the fifty thirty twenty split, computed from the user's take home.
- Cash flow timeline that maps income and bills across the month to spot tight days.

### 6.2 Debt freedom
- A debt freedom planner that compares smallest balance first and highest rate first, shows the freedom date for each, and totals the interest saved.
- A balance transfer and consolidation break even, deterministic, given the fees and rates the user enters.

### 6.3 Home and big purchases
- Home buying readiness: affordability, down payment, closing costs, and the monthly all in cost including taxes and insurance the user enters.
- Rent versus buy over a chosen horizon, inflation aware.
- Sinking fund planner for any named goal, tied to the guidance plan.

### 6.4 Benefits and open enrollment
- A health plan chooser that compares plans deterministically given premiums, deductibles, and out of pocket maximums the user enters, including the HSA and FSA tradeoff.
- A paycheck optimizer that tunes the W-4, the HSA, and the retirement contribution to a chosen take home or tax outcome.

### 6.5 Tax moves
- Roth conversion ladder math.
- Tax loss harvesting calculation given the lots the user enters.
- Backdoor and mega backdoor Roth step by step math.

### 6.6 Protection and the basics
- Life insurance needs using a transparent needs based method, deterministic from the inputs.
- Disability and umbrella coverage sizing.
- An estate and beneficiary checklist, a deterministic checklist rather than legal advice, with a clear pointer that document review belongs to the sibling product vaulytica.

### 6.7 Long horizon
- A college cost planner tied to the FAFSA Student Aid Index estimator in Pillar 2.
- A Social Security claiming age comparison, deterministic from the published benefit formula.
- A retirement drawdown and required minimum distribution timeline, inflation aware.

---

## 7. Build prompts for Claude Code

These continue the phase sequence from BUILD-SPEC.md, which ended at Phase 11. Hand them to Claude Code one at a time, and do not begin a phase until the previous one's acceptance criteria pass. Keep both spec files in the repository root so each prompt can reference them.

Sequencing note: the session profile in Phase 12 is foundational and should ideally be built immediately after the user interface shell from Spec 1 Phase 4, because every tile benefits from reading and writing the profile. If Spec 1 tiles are already built, retrofit them to the profile during Phase 12.

### Phase 12: Your Situation, the session profile

Goal: a single in memory profile that all tiles read from and write to, with opt in user held export and import.

Prompt to Claude Code:

> Implement Your Situation, the session profile described in section 3 of BUILD-SPEC-2.md. Hold household size and ages, filing status, state and county, income and sources, contributions, balances by account type, debts with rates and balances, essential and total expenses, and any Readout extracted fields. Track the provenance of each field as typed, extracted, or assumed. The profile must live only in memory and clear on page unload, per the Spec 1 privacy principle. Add a user initiated export to a local file and a re import, with optional passphrase encryption reusing the techniques from the encryptalotta repository. Wire all existing tiles to read defaults from the profile and write user entries back to it. Acceptance criteria: entering income in one tile pre fills it in another within the session, the profile never persists automatically, unload clears it, and an encrypted export re imports correctly.

### Phase 13: The home experience and information architecture

Goal: the three zone home of section 1, upload hero, search, and compact grouped cards, plus the All Tools index.

**Status: ✅ done.** The home is the three stacked zones of §1.1: the **Readout dropzone** is the hero (it navigates into a `#/readout` view; deterministic parsing lands in Phase 14), the **inline fuzzy search** is the ⌘K command palette below it, and a compact grid of **expandable `<details>` category cards** — one per pillar plus Your Plan — sits below that, collapsed by default so the page is short to scroll (the sophiewell density, not a mega dropdown). A dedicated **All Tools index** is reachable in-app at `#/all-tools` and is mirrored by a static, pre-rendered, crawlable `tools.html` emitted from the tile registry at build time (`scripts/tools-index.ts` + a Vite plugin), so every tool has a stable, linkable, indexable home. A drift test asserts the static index lists exactly the registry's tiles; axe-core covers the home, the index, and the Readout view with zero violations. `format:check`, `lint`, `typecheck`, `test` (128), `build`, and `wrangler deploy --dry-run` are all green.

**Redesigned 2026-06-01 (see §0.7):** the home now keeps the dropzone and the live search but renders **every tool grouped under its plain-language category** in place of the teaching journey, the header is reduced to the wordmark + tagline + a sun/moon toggle, and the secondary controls (My Situation, the high-contrast toggle) moved to a uniform-button footer. The `#/all-tools` route and the static `tools.html` are unchanged.

Prompt to Claude Code:

> Build the home experience per section 1 of BUILD-SPEC-2.md. Place the Readout dropzone as the hero, the fuzzy command palette search as an inline bar below it, and a compact grid of expandable category cards below that, one per pillar plus Your Plan plus an All Tools index. Do not use a single mega dropdown. Add a fully pre rendered All Tools index route for search engine crawlability in the roughlogic style. Keep it dense and short to scroll, in the sophiewell style. Apply the royal purple design language from Spec 1. Acceptance criteria: the home passes axe-core, search and card browsing both reach every tool, the All Tools index is pre rendered and linkable, and the page is short to scroll on mobile.

### Phase 14: The Readout, document ingestion

Goal: deterministic on device parsing of personal finance documents into confirmed fields.

**Status: ✅ done (fourth wave).** The Readout is now live (`#/readout`). The deterministic, anchored extraction engine (`src/readout/extract.ts`) takes the text of a document and reads each field by **anchoring to known labels and box numbers — never by inference** (§2.2): it detects the document kind and form revision, runs a revision-pinned extractor, and returns typed fields each carrying a **confidence state and a needs-review flag**. Extractors are **versioned**: an unrecognized form revision is **flagged, not guessed** (it returns no fields plus a warning), and OCR-sourced text marks every field lower confidence. The first-wave extractors cover the **typed W-2, Form 1040, and pay stub** (box 1 wages, box 2 withholding, box 12-D 401(k); AGI, taxable income, total tax, filing status; annualized gross), each pinned to its IRS form citation (the pay stub, being the employer's own document, carries none). On-device text extraction (`src/readout/extractText.ts`) reads typed PDFs with **pdf.js, dynamically imported** so the shell bundle is untouched (pdf.js + its worker code-split into separate chunks; the worker is a same-origin asset under `worker-src 'self'`, configured to fetch nothing so `connect-src 'none'` stays literally true). The Readout view (`src/ui/readoutView.ts`) is the dropzone → parse → **confirm (always) → flow into Your Situation** (provenance "extracted") → plain-English summary flow, with a link into Your Plan. The summary now delivers the full §2.3 payoff: beyond the "here's where you stand" line, it composes the same engine the Readout Report uses to show the **effective tax rate, the annual take-home, and the single next right step from My Plan** right there (so the instant readout is genuinely instant), then links onward to My Plan and the Report.

The **second wave (added now)** extends the same anchored, revision-pinned engine to the remaining document family from §2.1, each cited to its IRS form and detected by a title-marker table (so a stray "W-2" mention can't win, and a **1098-T tuition / 1098-E student-loan** statement can't masquerade as a mortgage 1098): the **1099 series** — **1099-INT** (box 1 interest), **1099-DIV** (1a ordinary / 1b qualified / 2a capital-gain distributions), **1099-NEC** (box 1 nonemployee compensation, which targets `annualIncome` since it *is* a contractor's income, feeding Take-Home / SE Tax / Quarterly Taxes), and **1099-B** (1d proceeds and 1e basis, plus the computed realized gain that feeds Capital Gains) — and **Form 1095-A** (the Part III "Annual Totals" premium / benchmark-SLCSP / advance-credit columns the ACA Premium Tax Credit tile needs) and **Form 1098** (box 1 mortgage interest, box 2 outstanding principal, feeding Amortization / Refinance). The 1099/1095-A/1098 figures flow in as **informational** confirmed fields (no `SituationValues` field maps to investment income, premiums, or a mortgage yet — so they're shown for review and the summary says so plainly, exactly like W-2 box 2 withholding), keeping the change surgical. 513 tests pass (added the golden extraction corpus — W-2/1040/pay stub, the 1099/1095-A/1098 set, the 1098-T disambiguation, OCR-flagging, unrecognized-revision, unknown-document, determinism — plus the view behavior/axe tests). `format:check`, `lint`, `typecheck`, `build`, `wrangler deploy --dry-run`, and the release audit are all green.

The **third wave (added now)** lands the last document family in §2.1: the **FAFSA Submission Summary**, detected by its unmistakable title marker (anchored first, so a tax-return line it references can't be mistaken for a 1040) and pinned to its award-year revision. Its extractor reads the one figure the Summary exists to confirm — the **Student Aid Index (SAI)** — anchoring `Student Aid Index (SAI):` and reading the value, which under the new methodology can be **negative** (down to −$1,500), cited to Federal Student Aid. The SAI flows in as an **informational** confirmed field (no `SituationValues` field maps to it) framed as the official number to check the **FAFSA Student Aid Index** and **Pell Grant** estimates (Phase 6) against — closing the loop the SAI tile opened ("supply the one figure"). With it, **every document in §2.1 has an extractor.** 587 tests pass (added the FAFSA golden cases — the SAI read, the negative-SAI case, the no-parenthetical/informational-target case); `format:check`, `lint`, `typecheck`, `test`, `build`, `wrangler deploy --dry-run`, and the release audit are all green.

The **fourth wave (added now)** lands **Word (.docx) parsing via mammoth** — the last reader named in the §2.2 prompt. `extractText.ts` gains a `.docx` branch (detected by extension or the OOXML MIME type) that **dynamically imports mammoth** — so, exactly like pdf.js, it never weighs down the shell and loads only when a Word file is dropped (it code-splits into its own lazy chunk). It calls `mammoth.extractRawText({ arrayBuffer })` (raw text, not HTML — the anchored extractors read labels and box numbers, not markup) entirely on the device: mammoth resolves its **`browser` package field** (an in-memory JSZip unzip, no worker, no `fetch`), so `connect-src 'none'` is untouched and the privacy promise holds. The dropzone copy and the file picker's `accept` list now advertise Word documents alongside typed PDFs and text. Because the extracted text flows through the *same* deterministic, revision-pinned engine, every existing extractor (W-2, 1040, 1099 series, 1095-A, 1098, FAFSA) reads a `.docx` of that form with no new code. A real-`.docx` round-trip test builds a minimal valid OOXML package with JSZip and asserts mammoth extracts its text through the same browser build the bundle ships (a vitest alias points the Node test at mammoth's `mammoth.browser.min.js`, so the test mirrors production rather than Node's Buffer-based path). 612 tests pass; `format:check`, `lint`, `typecheck`, `test`, `build`, and the release audit are all green.

- Deferred to a later wave (same pattern): the OCR engine itself (the *flagging* is built; bundling an on-device OCR engine lands with **offline support in Phase 8**, so the pdf.js/worker chunks are service-worker-cached and the "works fully offline" criterion is fully met).

Prompt to Claude Code:

> Implement the Readout per section 2 of BUILD-SPEC-2.md. Parse typed PDFs and Word documents on the device using the pdfjs and mammoth library family, offering on device optical character recognition only as a clearly labeled lower confidence fallback for scans. Extract the listed fields from pay stubs, W-2, 1040, 1099 forms, 1095-A, 1098 and mortgage statements, and the FAFSA Submission Summary by anchoring to known form labels and box numbers, never by inference. Mark each field with a confidence state and a needs review flag, and require the user to confirm extracted values before any tool uses them. Version the extractors, pin them to the form revision, and wire them into the data refresh workflow contract from Spec 1 so an unrecognized revision is flagged rather than guessed. On confirmation, flow values into Your Situation and show an immediate plain English summary. Confirm nothing is uploaded by verifying the Content Security Policy connect-src remains none. Acceptance criteria: a sample typed W-2 and 1040 extract correctly to confirmed fields, optical character recognition results are flagged, an unrecognized form revision is flagged not guessed, and ingestion works fully offline.

### Phase 15: Your Plan, the guidance engine

Goal: the deterministic, adjustable, calm ordered plan that surfaces the next right step.

**Status: ✅ done.** The default ordered plan of §4.1 is encoded as **data** in a pure engine (`src/engine/plan.ts`): seven steps (starter cushion → full employer match → high-cost debt → full rainy-day fund → tax-advantaged retirement → sinking funds → war chest), each with an `evaluate(input, config)` that reports whether its goal is met, the gap in dollars, the math, and any citation. `evaluatePlan` walks the configured order, skips disabled steps, and marks the **first not-satisfied step** as the current one — deterministically (golden-tested across a range of situations). The plan is **fully adjustable** per §4.2: the user can change the rainy-day target in months, choose smallest-balance-first vs highest-rate-first debt payoff, reorder steps (▲/▼), and turn steps off — all encoded in the URL so a plan is deep-linkable. The **Your Plan tile** (`src/tiles/yourPlan.ts`) reads Your Situation (and lets the user complete it inline, including a debts editor that writes back to the shared profile), shows the single next right step with its dollar figure and a button that **navigates to the tile that performs it** (a new `navigate` on the `TileContext`), and lists the whole plan with each step's math collapsible. The one statutory threshold — the retirement contribution limit — is cited to a newly seeded **IRS 2024 retirement-limits dataset** (`data/retirement-limits-2024.json`, gated and hashed like every shard, exposed via `BundledData.retirementLimits()`); the opinionated product defaults (cushion, rainy-day months, debt threshold, enough multiple) are labeled assumptions, not cited rules. Tone follows SPEC §5.3: satisfied steps read "On track," never "you are behind." 155 tests pass (added 20 golden engine cases + 7 tile behaviors, and the tile is in the axe sweep with zero violations); `format:check`, `lint`, `typecheck`, `build`, and `wrangler deploy --dry-run` are all green.

Prompt to Claude Code:

> Implement Your Plan per section 4 of BUILD-SPEC-2.md. Encode the default ordered plan as data, not hard coded logic, so steps can be reordered and toggled. Read Your Situation, determine the current step, and surface one concrete next action with its dollar figure and a link to the tile that performs it. Show the math for every step and cite the rule behind any threshold. Let the user choose smallest balance first or highest rate first for debt, change the rainy day target in months, reorder steps, and turn steps off. Enforce the Safe Harbor tone rules from Spec 1: encouraging, never scolding, progress not failure, red for warnings only. Add golden cases that assert the engine selects the correct current step for a range of situations. Acceptance criteria: the engine selects the right step deterministically for the golden situations, every step shows its math and citation, the plan is fully adjustable, and the copy follows the tone rules.

### Phase 16: The Readout Report

Goal: a downloadable, cited, reproducible summary generated on the device.

**Status: ✅ done.** A pure, deterministic builder (`src/readout/report.ts`) composes everything already shipped into a "where you stand" summary: the **snapshot** (income, effective + marginal rate, take-home, net worth, rainy-day months), the **tax picture** (federal/FICA/state tax and the cost of the next $1,000 of income), **what you may be owed** (the FPL position, the Medicaid/ACA likelihood it implies, and the EITC/Child Tax Credit dollar estimates), **Your Plan** (the current next right step with its math), and an **assumptions-and-sources appendix** (the assumptions accepted, the dataset versions used from the manifest, and every citation the figures trace to). It is **reproducible**: the same profile and dataset versions yield an identical model and a byte-identical HTML document (no embedded timestamp, no randomness — a golden test asserts this). `renderReportHtml` emits a **self-contained, script-free, no-external-resource** HTML file (inline royal-purple styles), so it opens and prints anywhere and honors the privacy promise. The Report view (`src/ui/reportView.ts`, route `#/report`, reachable from the Readout summary) previews it in-app with **Download (.html)** and **Print** actions; generation is entirely on the device, so `connect-src 'none'` is untouched. `format:check`, `lint`, `typecheck`, `build`, and the release audit are all green.

- The **"What you may be owed"** section now composes the same What-You're-Owed benefits engine the screener uses (Phase 6, third wave) on the household already in My Situation: the FPL position with its Medicaid/ACA likelihood, plus the refundable **EITC and Child Tax Credit** dollar estimates (qualifying children are the household members under 17), each cited, and a note pointing to the screener for SNAP, the Saver's Credit, and the full picture. The portable encrypted profile export (§5.2) shipped in Phase 12 and sits alongside the report in Your Situation.

Prompt to Claude Code:

> Implement the Readout Report per section 5 of BUILD-SPEC-2.md, generated entirely on the device with no upload, using the same document library family as vaulytica. Include the snapshot, the tax picture, what you may be owed, Your Plan with its next right step, and an assumptions and sources appendix listing every assumption, every dataset version, and every citation, so the report is reproducible. Offer the portable encrypted profile export alongside it. Acceptance criteria: the report generates offline, every figure traces to a citation in the appendix, and regenerating from the same profile and dataset versions produces an identical report.

### Phase 17: Expansion tools, first wave

Goal: the highest value tools from section 6 that deepen the guide.

**Status: ✅ done (tenth wave).** Every tool named in §6.1–6.7 now ships — the catalog is complete (the standalone Zero-Based Budget tile of the third wave was later folded into the single Budget Overview page, §6.1, so the live registry is 55 tiles, not 56). Twenty-four distinct §6 tools (plus the Phase 5 Cost-Basis Lot Picker and W-4 Withholding tiles) are live, each deterministic, deep-linkable, worked-example-first, and passing axe:

- **50/30/20 Spending Plan** (§6.1, `src/tiles/spendingPlan.ts`): splits monthly take-home into needs / wants / savings, with one-tap presets (50/30/20, 60/20/20, 70/20/10) and an editable split (savings is the remainder, never negative). The framework is a labeled guideline, not a cited rule (like Compound Growth).
- **Home Buying Readiness** (§6.3, `src/tiles/homeAffordability.ts`): the all-in home price you can afford on the conventional 28/36 debt-to-income guideline — the binding monthly budget, minus the taxes/insurance you enter, backs out a maximum loan via the `loanPrincipalFromPayment` engine helper (with `monthlyMortgagePayment`, its exact inverse — both golden-tested, §3.3). Reads income from Your Situation and writes it back.
- **Sinking Fund Planner** (§6.3, `src/tiles/sinkingFund.ts` + the golden-tested `requiredMonthlyContribution` helper): solves the future-value-of-an-annuity equation for the level monthly amount that reaches a goal by a date, counting what's already saved and an assumed return (labeled, never a forecast); recognizes when today's savings already get there. This makes My Plan's "sinking funds" step concrete for one goal at a time.
- **Rent vs Buy** (§6.3, `src/tiles/rentVsBuy.ts` + the golden-tested `rentVsBuy` helper): a net-cost comparison over a chosen horizon — buying's cash out (down payment, closing, P&I, ownership costs) minus sale proceeds (appreciated value less selling costs and the remaining loan balance) vs renting's growing rent minus the investment gain on the cash a renter doesn't tie up. Appreciation, rent growth, and the investment return are user assumptions; two simplifications (flat carrying costs, no separately-invested monthly cash-flow difference) are stated plainly.
- **Health Plan Chooser** (§6.4, `src/tiles/healthPlan.ts` + the golden-tested `healthPlanAnnualCost` helper): compares two plans for a year of expected spend — premiums plus out-of-pocket on care (deductible, then coinsurance, capped at the out-of-pocket max) — names the cheaper, and flags the HDHP/HSA tradeoff.
- **Zero-Based Budget** (§6.1, `src/tiles/zeroBudget.ts`): give every dollar a job — a category list editor that shows what's left to assign (the goal is zero), flags over-assignment, and defaults income from My Situation. Pairs with the 50/30/20 plan (big-picture split → named jobs).
- **Cash-Flow Timeline** (§6.1, `src/tiles/cashFlow.ts` + the golden-tested `cashFlowTimeline` helper): a dated income/bill list editor that walks a running daily balance to surface the tightest day and any day it dips negative — the classic "rent's due before payday" squeeze.
- **Life Insurance Needs** (§6.6, `src/tiles/lifeInsurance.ts` + the golden-tested `lifeInsuranceNeed` helper): the transparent DIME method (income replacement + Debts + Mortgage + final expenses + Education, less existing coverage and liquid assets), grouped under Safe Harbor as family protection. Information, not advice.

Fourth wave (added now) — the §6.5 tax-move tools plus the first §6.7 long-horizon tool:

- **Tax-Loss Harvesting** (§6.5, `src/tiles/taxLossHarvesting.ts` + the golden-tested `taxLossHarvest` helper): nets short- and long-term gains and losses the way Schedule D does (like characters net first, then a net loss in one bucket offsets a net gain in the other, the surviving gain keeping the larger side's character), applies the **$3,000 / $1,500-MFS** net-capital-loss offset against ordinary income, carries the rest forward, and estimates the tax saved at the rates you enter. The statutory limit cites **IRC §1211(b)** and the **wash-sale rule** cites **IRC §1091** inline; filing status (for the MFS limit) reads from My Situation.
- **Roth Conversion Ladder** (§6.5, `src/tiles/rothLadder.ts` + the golden-tested `rothConversionLadder` helper): lays out the **5-year seasoning** schedule — what you convert each year, the year each conversion becomes penalty-free, the estimated conversion tax at your ordinary rate, and the steady annual stream the ladder builds for bridging spending before 59½. The 5-year rule cites **IRC §408A(d)(3) / Pub 590-B**.
- **Social Security Claiming Age** (§6.7, `src/tiles/socialSecurity.ts` + `src/engine/socialSecurity.ts`): compares the monthly benefit at **62 / full retirement age / 70** from the published SSA formula — the early-claiming reduction (5/9 of 1% per month for the first 36 months, then 5/12 of 1%) and the delayed-retirement credit (2/3 of 1% per month). The FRA-by-birth-year table and the adjustment rules live in a new gated, cited dataset (`data/social-security-2024.json`, SSA), so every figure carries the SSA citation; the repeating fractions are stored exactly as numerator/denominator of one percent. You start from the PIA on your statement — it does not estimate your earnings record.

Fifth wave (added now) — completing the §6.5 tax-move group and the §6.6 protection group:

- **Backdoor Roth** (§6.5, `src/tiles/backdoorRoth.ts` + the golden-tested `backdoorRoth` / `megaBackdoorRoth` helpers): two modes in one tile. **Backdoor** — a nondeductible traditional-IRA contribution converted to a Roth, with the **pro-rata rule** (IRC §408(d)(2)) taxing the conversion in proportion to any pre-tax IRA balance (cited inline); a clean backdoor with no pre-tax money is tax-free, and the tile shows the taxable portion and tax owed when it isn't. **Mega-backdoor** — after-tax 401(k) room as the **§415(c)** limit less elective deferrals and employer contributions. Both limits read from and **cite** the bundled IRS retirement-limits dataset (the IRA limit honors the age-50 catch-up).
- **Disability Insurance Needs** (§6.6, `src/tiles/disability.ts` + the golden-tested `disabilityCoverageNeed` helper): the monthly income gap if you couldn't work — a chosen replacement share of income (a labeled ~60% guideline) less existing coverage and other income. Reads income from My Situation. Information, not advice.
- **Umbrella Liability Coverage** (§6.6, `src/tiles/umbrella.ts` + the golden-tested `umbrellaCoverageNeed` helper): sizes personal umbrella coverage to the common net-worth guideline — exposure (net worth plus optional future-income exposure) above existing auto/home liability limits, rounded up to the $1M layer umbrellas are sold in. A labeled guideline, not a cited rule.

Sixth wave (added now) — the §6.7 long-horizon tools and the §6.6 estate checklist:

- **Retirement Drawdown & RMD Timeline** (§6.7, `src/tiles/drawdown.ts` + the golden-tested `retirementDrawdown` helper): projects the balance year by year **in today's dollars** (a real, after-inflation return — never a market forecast, §2.1), each year withdrawing the **greater of the chosen draw and the required minimum distribution** from the bundled **IRS Uniform Lifetime Table (cited)**, then growing the remainder. Reports how long the savings last (or that they outlast the projection), the first RMD age and amount, milestone balances, and the total withdrawn. Sequence-of-returns risk is honestly noted as out of scope.
- **College Cost Planner** (§6.7, `src/tiles/collegeCost.ts` + the golden-tested `collegeCostPlan` helper): inflates each enrollment year's cost forward at an assumed college-inflation rate, sums them, and reuses the sinking-fund annuity solve for the **level monthly contribution** to fully fund it by the start date (counting what's already saved and an assumed return). Rates are labeled assumptions; the "save the full cost by freshman year" simplification is stated plainly. Pairs with the FAFSA Student Aid Index estimator (Phase 6) for the aid side.
- **Estate & Beneficiary Checklist** (§6.6, `src/tiles/estateChecklist.ts`): a **deterministic checklist** of the basics (will, current beneficiaries, financial + healthcare powers of attorney, guardianship, transfer-on-death, letter of instruction), tracking how many are in place with the selection encoded in the URL. Explicitly a checklist, not legal advice — it points document drafting and review to a qualified attorney and the sibling product **vaulytica** (SPEC-2 §6.6). A different tile shape (checkboxes, a progress count) that still fits the result-card pattern.

Seventh wave (added now) — finishing the verifiable, no-new-dataset gaps across Phase 5, §6.2, and §6.4:

- **Cost-Basis Lot Picker** (Phase 5 §3.2, `src/tiles/lotPicker.ts` + the golden-tested `src/engine/costBasis.ts`): the deferred FIFO / specific-identification helper. Enter your lots (shares, cost per share, long-term flag), a sale price, and either a FIFO total or per-lot quantities; it returns the realized gain split into **short-term (ordinary) and long-term (preferential)** — the character that feeds the Capital Gains tile. A dynamic-row editor; pure arithmetic, no dataset.
- **Balance Transfer Break-Even** (§6.2, `src/tiles/balanceTransfer.ts` + the golden-tested `balanceTransferBreakEven` helper): compares keeping the current card against transferring (a fee, then an intro APR for a promo window, then the post-intro APR) at the same monthly payment. Reports each path's interest and months, whether the balance clears inside the intro window, and the net saving after the fee — honestly flagging when a payment can't cover the interest rather than showing ∞. (The full multi-debt smallest-balance/highest-rate comparison lands as the Debt Freedom Planner in the tenth wave below.)
- **Paycheck Optimizer** (§6.4, `src/tiles/paycheckOptimizer.ts`): built on the **existing tax engine** — the same federal + FICA + state math as the take-home tile — so every figure is exact. Shows take-home now and the **tax saved per $1,000** into a 401(k) (income tax only, modeled as an AGI adjustment) versus an HSA (also escapes FICA, modeled as a wage reduction, so it saves ~7.65% more). Reads filing status, state, and income from My Situation. The W-4-withholding-tuning half waits on the W-4 estimator.

Eighth wave (added now) — the §6.4 self-employed / 1099 toolkit, the deferred Phase 5 W-4 tile (reframed so it needs no new dataset), and a framework-free chart layer:

- **Quarterly Taxes & Set-Aside** (§6.4, `src/tiles/quarterlyTaxes.ts`): the question every 1099 worker has — "how much of each payment do I keep for the IRS, and what do I send each quarter?" It sums the two taxes the self-employed owe — self-employment tax (both FICA halves) **and** federal + state income tax on profit less the deductible half of SE tax — on the **existing tax engine**, so every figure is exact and cited (SE tax → SSA/IRS, income tax → the federal/state jurisdictions, the four installments → Form 1040-ES). It shows the share to skim off every payment, the four equal 1040-ES installments with their due dates, and — when you enter last year's tax — the **safe-harbor minimum** (100%/110%-above-$150k AGI vs 90% of this year) that avoids the underpayment penalty. The QBI/§199A deduction is omitted, stated plainly, so the figure errs slightly high — the safe side for setting money aside.
- **What Should I Charge?** (§6.4, `src/tiles/freelanceRate.ts`): works backward from the take-home you want to the hourly rate you must bill — grossing up by a labeled tax set-aside to the pre-tax profit, adding business expenses to reach the revenue, and dividing by **billable** hours (the honest part: admin/marketing/downtime aren't billable). Pure arithmetic, a labeled guideline like 50/30/20; points to Quarterly Taxes for the precise set-aside.
- **1099 Contract vs W-2 Salary** (§6.4, `src/tiles/contractVsSalary.ts`): translates a contractor rate into the rough W-2 salary it equals, subtracting the employer-side FICA an employer would have covered (~7.65%, cited to the FICA dataset) and the benefits you self-fund. A clearly-labeled rule-of-thumb to weigh an offer, not a take-home-equalizing solve; flips to show why contractors charge ~1.25–1.4× a salaried hourly wage.
- **Self-Employed Retirement** (§6.4, `src/tiles/selfEmployedRetirement.ts`): SEP-IRA (~20% of net self-employment earnings) vs Solo 401(k) (the same employer share **plus** an employee deferral, with the 50+ catch-up), each capped at the **§415(c)** overall limit — showing why the Solo 401(k) almost always wins at low-to-moderate profit. Both ceilings read from and **cite** the bundled IRS retirement-limits dataset; net earnings come off the existing SE-tax engine.
- **W-4 Withholding & Refund Check** (Phase 5, `src/tiles/w4Withholding.ts`): the long-deferred W-4 tile, **reframed to need no new dataset** (like ACA's benchmark premium and Social Security's PIA). Rather than reproduce the IRS Pub 15-T percentage-method tables, it has the user enter their actual per-paycheck federal withholding (off a pay stub) and compares it to the projected federal income tax from the **same engine as the take-home tile** (cited), showing the refund or balance due and the per-paycheck W-4 tweak to land near zero — with the honest framing that a refund is an interest-free loan to the government. The only uncited figure is a labeled forgone-interest assumption.
- **A tiny accessible chart layer** (`src/ui/charts.ts`): three framework-free, `role="img"` + legend primitives — **donut** (share of a whole), **flow bar** (income → assigned → left), and **balance timeline** (the cash-flow squeeze) — colored from a per-theme `--enk-chart-1..10` palette via `element.style` (no `innerHTML`, preserving the XSS-by-construction guarantee). Wired into **50/30/20** (needs/wants/savings donut), **Cash-Flow Timeline** (running-balance bars flagging the below-zero day), and a substantially upgraded **Zero-Based Budget** (opens with the big default buckets instead of a blank row, one-tap category chips, keyboard ▲/▼ **and** pointer drag-to-reorder, plus a donut and flow bar that update live).

Ninth wave (added now) — one holistic budgeting screen folding the two halves together:

- **Budget Overview** (§6.1, `src/tiles/budgetOverview.ts`): a single screen that combines *where* a month's money goes (the zero-based allocation, as a donut and an income → assigned → left flow bar) with *when* it moves (the cash-flow timeline, the running daily balance). One list of budget lines feeds both pictures — every line counts toward the allocation, and a line that also carries a day-of-month lands on the timeline as a dated bill, with income arriving on payday — so a first-timer sees the big-buckets shape immediately (it opens with the default buckets, never a blank row) and adds a due date to the lines that have one to surface the tight days (the classic "rent's due before payday" squeeze). It reuses the existing golden-tested `cashFlowTimeline` engine helper and the chart layer; pure arithmetic on the user's own numbers, income defaulting from My Situation, state encoded in the URL. (It is a deliberate consolidation of the §6.1 group, not new math — the standalone Zero-Based Budget and Cash-Flow Timeline tiles stay for users who want just one half.)

496 tests pass (added the self-employed golden/behavior corpus, the W-4 behavior cases, the chart-render assertions on the budget tiles, and the Budget Overview behavior + axe coverage; every new tile is in the axe sweep with zero violations); `format:check`, `lint`, `typecheck`, `build`, `wrangler deploy --dry-run`, and the release audit are all green.

Tenth wave (added now) — completing §6.2 with the iconic debt snowball, a budgeting visual refresh, and an app-wide copy clean-up:

- **Debt Freedom Planner** (§6.2, `src/tiles/debtFreedom.ts` + the golden-tested `debtFreedomPlan` helper): the multi-debt comparison §6.2 always called for, the one the single-balance Freedom Date tile deferred. List each debt (balance, APR, minimum), set the extra you can pay beyond the minimums, and it runs the same monthly budget two ways — the **snowball** (smallest balance first, for quick wins and momentum) and the **avalanche** (highest rate first, the mathematically cheapest) — paying every minimum, throwing the rest at one target, and **rolling each cleared debt's payment onto the next**. It surfaces each method's freedom date and total interest, the order debts fall away, and **exactly what the snowball's momentum costs over the avalanche**, so the choice stays the user's (the adjustable-not-dogmatic stance of §0.1, a friendlier take on the money-guru playbook). Deterministic month-by-month arithmetic, nothing to cite; debts default from My Situation. Pairs with Budget Overview (find the extra) and Freedom Date (a single balance).
- **Budget Overview visual refresh** (§6.1, `src/tiles/budgetOverview.ts` + `src/ui/charts.ts`): a Ramsey-inspired-but-on-brand pass on the centerpiece budgeting screen — a warm "tell your money where to go" intro, a new **stat strip** primitive (tinted at-a-glance cards that glow when balanced and warn when over-assigned or dipping negative), a **floating-zero cash-flow timeline** (positive balances rise above the line, the squeeze hangs visibly below it) with a **payday marker**, and a polished flow bar. The status copy gives every dollar a job in plain, encouraging language. The sibling Zero-Based Budget shares the voice.
- **Em-dash removal across all rendered pages.** Every user-facing string in the app (tiles' descriptions/how/labels/status, the shell journey + hero, the Readout view) had its em-dashes replaced with context-appropriate punctuation; code comments and the specs/docs are intentionally untouched, since they aren't pages.

524 tests pass (added the `debtFreedomPlan` golden corpus — the 0%-rate exact case, the avalanche-never-costs-more invariant, single-debt parity with `debtPayoff`, the underfunded "never" case, and determinism — plus the Debt Freedom Planner behavior + axe coverage, and the budget visual-scaffold checks); `format:check`, `lint`, `typecheck`, `build`, and the release audit are all green.

Close-out housekeeping (2026-06-02): with every §6.1–6.7 tool live, Phase 17 is marked done and the catalog is complete. A documentation-accuracy pass reconciled the counts the waves had drifted past: the live registry is **55 tiles** (the standalone Zero-Based Budget tile was folded into Budget Overview), the engine is **24 jurisdictions = 14 income-tax states + DC + 9 no-income-tax** (the earlier "16 income-tax states" was an arithmetic slip), and the unit/golden suite stands at **623 tests across 53 files**. The Readout dropzone copy that promised OCR "with offline support" was corrected — offline (Phase 8) already shipped, so OCR is now framed plainly as "coming soon." `format:check`, `lint`, `typecheck`, `test`, `build`, `wrangler deploy --dry-run`, the release audit, and the Playwright e2e suite (responsiveness · offline · smoke) are all green. **Remaining deferrals are deliberate and accuracy-bound** (SPEC §0.4): bundling the on-device OCR engine (a second `connect-src 'self'` worker exception plus a multi-megabyte language model — a privacy-surface and dependency decision held for explicit sign-off), the i18n string extraction, Idaho/Utah (held until their phase-out-credit and mid-year-rate details can be modeled exactly), and international jurisdictions.

- The **ACA premium-tax-credit estimator** (Phase 6 §4.2) shipped in a later wave — see the Phase 6 status above. It sidesteps the per-county benchmark dataset by having the user supply that one local figure (HealthCare.gov), shipping only the cited applicable-percentage table.
- The **FAFSA Student Aid Index + Pell Grant** shipped in Phase 6's fourth wave (the 2024-25 dependent-student federal methodology, seeded and cited, framed as an estimate to verify against the official SAI Formula Guide and the FAFSA Submission Summary). The **W-4** tile shipped this wave by sidestepping the Pub 15-T tables (above) rather than seeding them; a future percentage-method withholding dataset could still power an exact paycheck-by-paycheck W-4 worksheet.

Prompt to Claude Code:

> Implement the first wave of expansion tools from section 6 of BUILD-SPEC-2.md: the zero based monthly budget and the fifty thirty twenty spending plan from cash flow and budgeting, the debt freedom planner from debt freedom, the home buying readiness and rent versus buy tools from home and big purchases, and the health plan chooser and paycheck optimizer from benefits and open enrollment. Each must read and write Your Situation, feed Your Plan where relevant, carry citations on any rule based figure, include a worked example, and encode state in the URL. Add golden cases for each. Acceptance criteria: each tool integrates with the profile and the plan, passes its worked example, and is covered by golden cases. Build the remaining section 6 tools in later waves on the same pattern.

---

## 8. Defaults chosen (so building is not blocked)

1. Navigation: upload hero, then search, then expandable category cards, plus a pre rendered All Tools index. No mega dropdown.
2. Continuity: in memory profile by default, with opt in user held encrypted export and import. No automatic persistence, ever.
3. Guidance: the default ordered plan in section 4.1, opinionated by default, fully adjustable by the user.
4. Document ingestion: anchored rule based extraction for typed documents, optical character recognition only as a labeled fallback, user confirmation always required.
5. Expansion order: ship section 6 in waves, leading with cash flow, debt freedom, home, and open enrollment, since those touch the most people and feed the guidance plan most directly.

---

## 9. One line positioning

enklayve: a calm, private money guide that shows you exactly where you stand, what you are owed, and the next right step. Drop in your documents, see the whole picture, and keep every byte on your device.
