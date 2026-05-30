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

- [ ] After a first visit, the site loads and computes with the network cut (the service worker serves the cached shell; lazily-loaded chunks like pdf.js are runtime-cached on first use).
- [ ] A code or data change bumps the SW cache version (hashed from the asset list + `data/manifest.json`) so stale caches are dropped on activate.
- [ ] The app installs as a PWA with the royal-purple theme and a maskable icon.

## Accessibility (Phase 4, SPEC §11)

- [ ] axe-core: zero violations across all views (in CI).
- [ ] Full keyboard navigation; visible focus; modals are never traps (Close + Done + Escape + click-outside).
- [ ] Reduced-motion preference is respected (count-up and hover transitions).
- [ ] Light, dark, and high-contrast themes all legible; red used only for genuine warnings.

## Crawlability & docs (Phase 11)

- [ ] `dist/tools.html` lists exactly the registry's tiles (drift test).
- [ ] One pre-rendered shell per tile under `dist/tools/<id>.html`, each with a canonical and a deep link into the live tool (drift test).
- [ ] `dist/sitemap.xml` lists the home, the index, and every tool shell; `dist/robots.txt` advertises the sitemap.
- [ ] Docs present and current: [`data-sources.md`](data-sources.md), [`adding-a-state.md`](adding-a-state.md), [`contributing.md`](contributing.md), [`source-diff-log.md`](source-diff-log.md), and the specs.

## Data refresh workflows (Phase 9)

- [ ] One workflow per source group (`.github/workflows/refresh-*.yml`) runs on its §7.2 cadence and on manual dispatch (the first set: IRS, BLS CPI, SSA, HHS, California).
- [ ] A refresh opens a data PR only when values changed **and** the full golden suite passes; a fetch/parse failure opens a fail-safe alert PR instead; nothing is auto-committed to `main`.
- [ ] Each change is recorded in [`source-diff-log.md`](source-diff-log.md) with old-to-new values. (Repo setting: "Allow GitHub Actions to create and approve pull requests" must be enabled.)

## Content & correctness

- [ ] Federal/state/FICA golden cases cross-checked against published worked examples for the seeded tax year.
- [ ] Every tile has a worked example, a "How this works" explainer, "Learn more" links, and the on-device / US-only / not-advice promise.
- [ ] Deferred-for-accuracy items are still deferred, not faked: FAFSA SAI + Pell, the per-county ACA benchmark (user-supplied), and any state beyond the seeded eleven.

## Deploy

- [ ] Merge to `main` triggers Cloudflare's Git integration (Workers Builds); the live site updates automatically. There is no GitHub deploy workflow and no `CLOUDFLARE_*` secret — GitHub Actions is the quality gate, Cloudflare is the deploy.
- [ ] Production responses carry the security headers (CSP, HSTS, `Referrer-Policy: no-referrer`, `X-Content-Type-Options`, frame/permissions policies).
- [ ] `index.html` and the data manifest are served `no-cache`; hashed `/assets/*` are immutable for a year.
