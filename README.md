# enklayve

> Your private financial enclave. Every number is computed on your device. Nothing is ever sent anywhere.

enklayve is a deterministic personal finance utility: a calm, fast place to answer real money questions — your actual take-home pay, what you owe in taxes, how much is enough, and what public benefits you're owed. Zero accounts, zero telemetry, zero AI, zero runtime network calls. Every figure is reproducible from public data bundled into the site, and every rule cites its source.

The Content-Security-Policy sets `connect-src 'none'`: the browser physically cannot send your data out, even if a bug tried to.

See [BUILD-SPEC.md](BUILD-SPEC.md) and [BUILD-SPEC-2.md](BUILD-SPEC-2.md) for the full vision and the phased build plan.

## Status

Foundation phases are complete:

- **Phase 0 — Scaffold & tooling.** TypeScript (strict), Vite, Vitest, ESLint, Prettier, a Cloudflare Worker asset router with the strict CSP, and CI.
- **Phase 1 — Money & citation primitives.** [`src/engine`](src/engine) — exact decimal money math (decimal.js) and the citation/provenance types that guarantee no orphan numbers ship.
- **Phase 2 — Data layer.** [`src/data`](src/data) — zod schemas for every bundled dataset kind, content-hash integrity verification, and the per-dataset fail-safe gate. Seeded with the 2024 federal and California tax jurisdictions.

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
npm run deploy:dry     # wrangler dry-run deploy
```

## Project layout

| Path          | What lives here                                                    |
| ------------- | ------------------------------------------------------------------ |
| `src/engine`  | Money math, citation/provenance types (the foundation)             |
| `src/data`    | Dataset schemas, integrity check, manifest loader, fail-safe gate  |
| `src/tiles`   | One module per calculator (later phases)                           |
| `src/ui`      | Render layer, theme, result card, command palette (later phases)   |
| `data`        | Sharded JSON datasets, sibling `.sha256` files, and the manifest   |
| `scripts`     | Data refresh adapters and the manifest builder                     |
| `worker`      | Cloudflare Worker asset router and security headers                |
| `tests`       | Unit tests and the golden correctness corpus                       |

## License

MIT — free forever, open source, auditable. See [LICENSE](LICENSE).
