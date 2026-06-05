# Launch checklist

A single pass that confirms every acceptance criterion across Phases 0–13 still holds, plus the launch-specific gates (offline, audit, crawlability, clean deploy). Run it before announcing. Each box is either a command to run or a thing to verify; the commands are the same gate CI runs.

## The automated gate (must all be green)

```sh
npm run format:check
npm run lint
npm run typecheck
npm run test          # unit + golden corpus + axe accessibility
npm run build
npm run audit         # CSP, no cross-origin loads, provenance, no sensitive persistence
npm run deploy:dry
```

- [ ] `format:check`, `lint`, `typecheck` all clean.
- [ ] `test` green, including the tax-engine golden corpus, the bounds/fuzz invariants, and the axe sweep (home, About, All Tools, Readout, Report, and every tile form) with **zero violations**.
- [ ] `build` produces `dist/`; `deploy:dry` succeeds.
- [ ] `audit` passes: `connect-src 'none'` on pages, no cross-origin loads in `index.html`, every dataset shard cited, `localStorage` touched only by the theme/locale boundary.

## Privacy & determinism (SPEC §2)

- [ ] No analytics, no third-party requests, no CDN fonts anywhere in the build.
- [ ] Sensitive inputs (income, balances) never persist and clear on unload; only theme/locale is in `localStorage`.
- [ ] Recomputing any tile from the same inputs + dataset version yields an identical result; deep links restore exact state.
- [ ] Every shipped figure resolves to a non-empty citation (the audit's provenance check).

## Offline & PWA (Phase 8)

- [ ] After a first visit, the site loads and computes with the network cut (the service worker serves the cached shell; lazily-loaded chunks like pdf.js, mammoth, and the OCR engine + its `/ocr/` wasm core and language model are runtime-cached on first use).
- [ ] A code or data change bumps the SW cache version (hashed from the asset list + `data/manifest.json`) so stale caches are dropped on activate.
- [ ] The app installs as a PWA with the royal-purple theme and a maskable icon.

## Accessibility (Phase 4, SPEC §11)

- [ ] axe-core: zero violations across all views (in CI).
- [ ] Full keyboard navigation; visible focus; modals are never traps (Close + Done + Escape + click-outside) and restore focus to the prior element on dismiss. A skip-to-content link (WCAG 2.4.1) is the first focusable element and focuses `<main>` directly; focus moves into the content region after each route change.
- [ ] Reduced-motion preference is respected (count-up and hover transitions).
- [ ] The single calm light theme is legible throughout (the dark and high-contrast themes and the toggle were retired 2026-06-01 for the simplest default); red used only for genuine warnings.
- [ ] The page scrolls vertically only on every device width — no horizontal drag on any tool (form controls shrink to their track, wide tables scroll within their own region, and an `overflow-x: clip` backstop guards the content column); `viewport-fit=cover` + safe-area insets keep the chrome clear of the notch.
- [ ] Printing any view (notably the Readout Report's Print action) drops the app chrome and interactive controls via `@media print` and lays the content out black-on-white without breaking tables across pages; the Report appendix prints each citation's URL (guarded by a print-media e2e).

## Crawlability & docs (Phase 11)

- [ ] `dist/tools.html` lists exactly the registry's hubs **and names every hosted calculator, linking its `/tools/<id>.html` landing page** (drift test); the in-app `#/all-tools` mirrors it, listing every calculator under its hub.
- [ ] One pre-rendered shell per tile under `dist/tools/<id>.html`, each with a canonical and a deep link into the live tool (drift test).
- [ ] `dist/sitemap.xml` lists the home, the index, and every tool shell; `dist/robots.txt` advertises the sitemap.
- [ ] The home `index.html` carries a canonical, a descriptive title + description, Open Graph + Twitter Card tags (with a **raster 1200×630 `og:image` PNG** — `summary_large_image` — since SVG cards don't render on Twitter/X, Facebook, LinkedIn, Slack, or iMessage; regenerate with `npm run og:image`), and JSON-LD `WebApplication` structured data; the tool shells and the index carry the same OG/Twitter/robots with absolute canonicals (guarded by `tests/ui/seo.test.ts`). No cross-origin resource loads anywhere (the release audit allows only self-referential absolute URLs on the production origin).
- [ ] Docs present and current: [`data-sources.md`](data-sources.md), [`adding-a-state.md`](adding-a-state.md), [`contributing.md`](contributing.md), [`source-diff-log.md`](source-diff-log.md), and the specs.

## Data refresh workflows (Phase 9)

- [ ] One workflow per source group (`.github/workflows/refresh-*.yml`) runs on its §7.2 cadence and on manual dispatch (IRS, BLS CPI, SSA, HHS, USDA SNAP, CMS Medicaid, the TreasuryDirect I-bond rates, the standard-deduction states CA / NY / GA / NC / DC, the flat-rate states PA / IL / MI / AZ / CO / IN / KY / ID, the graduated states OH / MS, and the special-case MA — its dedicated parser anchors the 5% base rate and the inflation-adjusted surtax threshold). **Every seeded income-tax jurisdiction now has a refresh adapter.**
- [ ] A refresh opens a data PR only when values changed **and** the full golden suite passes; a fetch/parse failure opens a fail-safe alert PR instead; nothing is auto-committed to `main`.
- [ ] Each change is recorded in [`source-diff-log.md`](source-diff-log.md) with old-to-new values. (Repo setting: "Allow GitHub Actions to create and approve pull requests" must be enabled.)

## Content & correctness

- [ ] Federal/state/FICA golden cases cross-checked against published worked examples for the seeded tax year.
- [ ] Every tile has a worked example, a "How this works" explainer, "Learn more" links, and the on-device / US-only / not-advice promise.
- [ ] Deferred-for-accuracy items are still deferred, not faked: the per-county ACA benchmark (user-supplied), and any income-tax state beyond the seeded 25 jurisdictions (15 income-tax states + DC + the 9 no-income-tax states); within the seeded states, state-specific credits, county/municipal add-ons, and itemized deductions stay deferred at launch fidelity. Utah stays held because its deduction is a phasing-out taxpayer tax credit the bracket-plus-standard-deduction model cannot represent. (FAFSA SAI + Pell now ship as an estimate the user verifies against the official SAI Formula Guide and their FAFSA Submission Summary, with every seeded table value cited; the independent-student variant and per-state aid stay out of scope.)

## Deploy

- [ ] Merge to `main` triggers Cloudflare's Git integration (Workers Builds); the live site updates automatically. There is no GitHub deploy workflow and no `CLOUDFLARE_*` secret — GitHub Actions is the quality gate, Cloudflare is the deploy.
- [ ] Production responses carry the security headers (CSP, HSTS, `Referrer-Policy: no-referrer`, `X-Content-Type-Options`, frame/permissions policies).
- [ ] `index.html` and the data manifest are served `no-cache`; hashed `/assets/*` are immutable for a year.
