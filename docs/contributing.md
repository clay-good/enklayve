# Contributing

Thanks for helping. enklayve is a free public utility, and contributions that keep it **accurate, private, and verifiable** are exactly the kind it wants. The non-negotiables below are not style preferences — they are the product.

## The non-negotiable principles (SPEC §2)

1. **Deterministic.** Every output is a pure function of the inputs and the bundled dataset version. No AI, no inference, no randomness, no market prediction. Where an assumption is needed (a rate of return, an inflation rate), the user supplies it or accepts a clearly labeled default, and the math is shown.
2. **No runtime network calls.** The CSP sets `connect-src 'none'`. Datasets are bundled at build time. Do not add a fetch, a CDN font, an analytics snippet, or any third-party request.
3. **Every rule cites its source.** A bracket, a limit, a poverty line — each carries its value, source URL, document name, effective year, retrieval date, and content hash. The release audit fails the build on any orphan number.
4. **Sensitive inputs never persist.** Income, balances, and similar figures live only in memory and clear on unload. Only the theme/locale preference may touch `localStorage` (enforced by the audit).
5. **Accessible by default.** WCAG 2.2 AA — axe-core runs in CI with zero violations, full keyboard navigation, and respect for reduced motion.

## Local workflow

```sh
npm install
npm run dev            # local dev server
npm run test           # Vitest: unit, golden corpus, and axe checks
npm run typecheck      # tsc --noEmit (strict)
npm run lint           # eslint
npm run format         # prettier --write  (format:check in CI)
npm run build          # production build to dist/
npm run audit          # the release gate — run after build
npm run deploy:dry     # wrangler dry-run
```

Before opening a PR, make the whole gate green locally: `format:check`, `lint`, `typecheck`, `test`, `build`, and `audit`. CI runs exactly these on Node 24; Cloudflare's Git integration deploys on merge to `main`.

## Adding a tile (calculator)

A tile is a self-contained module in [`src/tiles/`](../src/tiles) implementing the `TileDefinition` contract ([`src/tiles/types.ts`](../src/tiles/types.ts)). The shell knows tiles only through that interface, so adding one is registering data + a mount function — never editing the shell. Each tile must:

- read defaults from and write entries back to **My Situation** (the shared session profile) where relevant, so a value entered once flows everywhere;
- **encode its state in the URL fragment** so every result is deep-linkable and copyable;
- include a **worked example** ("Try an example") and a plain-English **"How this works"** explainer with trusted U.S. resource links;
- carry a **citation on every rule-based figure** (labeled assumptions are fine for user-supplied rates);
- ship **golden cases** for the math and be added to the axe sweep.

Register it in [`src/tiles/registry.ts`](../src/tiles/registry.ts). The static `/tools.html` index, the per-tile crawlable shells, and the sitemap are generated from the registry at build time, and drift tests assert they list exactly the registry's tiles — so a new tile is picked up automatically once registered.

## Adding or refreshing data

See [`adding-a-state.md`](adding-a-state.md) for a jurisdiction and [`data-sources.md`](data-sources.md) for the source list and the fail-safe refresh contract. The rule of thumb: **never ship a number you cannot cite to a public source.** When accurate source data isn't available yet, defer the tool (or have the user supply the one local figure) rather than guess — that is why the FAFSA SAI tables and per-county ACA benchmark are not bundled.

## Voice

Warm, plain-English, encouraging, never scolding — "here is where you stand," never "you are behind." Red is reserved for genuine warnings. American English and standard numeric formats (`$1,500`, `25%`, ISO dates in code). US-only today; correctness before coverage.
