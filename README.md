# enklayve

> Your private financial enclave. Every number is computed on your device. Nothing is ever sent anywhere.

enklayve is the honest money guidance the personal-finance experts charge for — your real take-home pay, what you owe in taxes, what public benefits you're owed, and your next right step — except it's **free, and it always will be.** No accounts, no ads, no cookie banner, no upsell. It's a free public utility for understanding your money: deterministic, private, and showing its work.

It's meant to feel like peace in a transactional web. Every figure is reproducible from public data bundled into the site, every rule links its source so you can verify it yourself, and there's zero telemetry, zero AI, and zero runtime network calls. The Content-Security-Policy sets `connect-src 'none'`: the browser physically cannot send your data out, even if a bug tried to.

Scope is the **United States** today (federal and state taxes and benefits); Europe, India, China, and Russia are on the roadmap as each jurisdiction's rules are learned. enklayve is educational information, not financial, tax, investment, or legal advice.

See [docs/specs/SPEC.md](docs/specs/SPEC.md) and [docs/specs/SPEC-2.md](docs/specs/SPEC-2.md) for the full vision and the phased build plan.

## Status

Foundation phases are complete:

- **Phase 0 — Scaffold & tooling.** TypeScript (strict), Vite, Vitest, ESLint, Prettier, a Cloudflare Worker asset router with the strict CSP, and CI.
- **Phase 1 — Money & citation primitives.** [`src/engine`](src/engine) — exact decimal money math (decimal.js) and the citation/provenance types that guarantee no orphan numbers ship.
- **Phase 2 — Data layer.** [`src/data`](src/data) — zod schemas for every bundled dataset kind, content-hash integrity verification, and the per-dataset fail-safe gate. Seeded with the 2024 federal and California tax jurisdictions.
- **Phase 3 — The tax engine.** [`src/engine/tax`](src/engine/tax) — one generic evaluator that composes federal income tax, FICA, state, and local into a single fully-cited result. Seeded the ten most populous states plus DC (no-income-tax states are first-class records) and the 2024 FICA dataset, with a hand-verified + generated golden corpus and bounds/fuzz invariants.
- **Phase 4 — UI shell & design system.** [`src/ui`](src/ui) — a tiny vanilla render layer, three instant-switch themes (light / dark / high-contrast) in royal purple and gold, a reduced-motion-aware count-up, the result card (collapsible cited breakdown, copy + permalink), a fuzzy command palette (Cmd/Ctrl-K), and fragment-based routing that makes every result deep-linkable. axe-core runs in CI with zero violations.
- **Phase 5 (first wave) — Pillar 1 tiles.** [`src/tiles`](src/tiles) — **Take-Home Pay**, **Federal Income Tax** (standard vs itemized), **Marginal Rate Explorer**, and **Compound Growth**, each built on the engine with a worked example, per-line citations, and deep-linkable state. The remaining Pillar 1 tools are rolling out in later waves.
- **Phase 12 — Your Situation (session profile).** [`src/profile`](src/profile) — a single in-memory profile every tile reads from and writes to, so income is entered once. It is never persisted automatically and is cleared on unload; continuity is opt-in via a user-held export that can be passphrase-encrypted on the device (PBKDF2 → AES-GCM). A **Your Situation** panel views/edits it.
- **Phase 13 — The home experience.** The home leads with the **Readout dropzone** hero and a **teaching journey** — the seven ordered steps of My Plan rendered as numbered cards, each explaining the lesson behind it and linking to the tool that performs it, so browsing is a calm sequence rather than a pile of fifty calculators. The full catalog stays one click away via **"Browse all tools"** and the ⌘K command palette; the "Why enklayve" trust story lives on its own `#/about` page. A dedicated **All Tools index** (`#/all-tools` in-app) has a static, pre-rendered, crawlable companion at `/tools.html` generated from the registry at build time, so every tool has a stable, linkable, indexable home. axe-core covers the home, About, the index, and the Readout view with zero violations.
- **Phase 11 (first wave) — Crawlability & docs.** A pre-rendered static shell per tile (`/tools/<id>.html`), a `sitemap.xml`, and a `robots.txt` are emitted from the registry at build time (drift-tested), giving every tool an indexable URL. The documentation set lives in [`docs/`](docs): [data sources](docs/data-sources.md), [adding a state](docs/adding-a-state.md), [contributing](docs/contributing.md), and the [launch checklist](docs/launch-checklist.md).

## Develop

```sh
npm install
npm run dev            # local dev server
npm run test           # unit + data-layer tests (Vitest)
npm run typecheck      # tsc --noEmit
npm run lint           # eslint
npm run format         # prettier --write
npm run build          # production build to dist/
npm run data:manifest  # regenerate data/manifest.json + .sha256 after editing a shard
npm run golden:regen   # regenerate the tax-engine golden snapshot after an intended change
npm run deploy:dry     # wrangler dry-run deploy
```

## Project layout

| Path          | What lives here                                                    |
| ------------- | ------------------------------------------------------------------ |
| `src/engine`  | Money math, citation/provenance types (the foundation)             |
| `src/data`    | Dataset schemas, integrity check, manifest loader, fail-safe gate  |
| `src/tiles`   | One module per calculator (Take-Home Pay built; rest rolling out)  |
| `src/ui`      | Render layer, themes, result card, command palette, router         |
| `src/profile` | Your Situation — the in-memory session profile and portable export |
| `data`        | Sharded JSON datasets, sibling `.sha256` files, and the manifest   |
| `scripts`     | Data refresh adapters and the manifest builder                     |
| `worker`      | Cloudflare Worker asset router and security headers                |
| `tests`       | Unit tests and the golden correctness corpus                       |

## License

MIT — free forever, open source, auditable. See [LICENSE](LICENSE).
