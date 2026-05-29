# enklayve

> Your private financial enclave. Every number is computed on your device. Nothing is ever sent anywhere.

enklayve is a deterministic personal finance utility: a calm, fast place to answer real money questions — your actual take-home pay, what you owe in taxes, how much is enough, and what public benefits you're owed. Zero accounts, zero telemetry, zero AI, zero runtime network calls. Every figure is reproducible from public data bundled into the site, and every rule cites its source.

The Content-Security-Policy sets `connect-src 'none'`: the browser physically cannot send your data out, even if a bug tried to.

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
