# Contributing

Thanks for helping. enklayve is a free public utility, and contributions that keep it **accurate, private, and verifiable** are exactly the kind it wants. The non-negotiables below are not style preferences — they are the product.

## Reporting something, without publishing your own figures

Three paths, and the difference matters:

| What you found | Where it goes |
|---|---|
| A figure that disagrees with the agency that publishes it | [**A figure is wrong**](https://github.com/clay-good/enklayve/issues/new?template=wrong-figure.yml) — a public issue, with the agency's own document. This is the most useful report this project gets. |
| A page that will not load, a control that does nothing, a wrong answer from figures that are right | [**Something is broken**](https://github.com/clay-good/enklayve/issues/new?template=broken.yml) |
| Data leaving the device, an input that persists, a weakened header, a flaw in the encrypted ledger | The [Security tab](https://github.com/clay-good/enklayve/security), privately. See [SECURITY.md](../SECURITY.md) — not a public issue. |

**One warning worth repeating here.** Every result on this site is deep-linkable, which is deliberate and which means a permalink encodes what you typed — your income, your balances. An issue is public and permanent. Reproduce the problem with round figures and paste *that* link. A wrong bracket is wrong at $50,000 the same as it is at yours.

The labels those forms apply live in [`.github/labels.yml`](../.github/labels.yml), not in a web UI. A label an issue form names and the repository does not have is dropped on the way in silently — the issue is created, the triage signal is not, and nothing anywhere says so. `.github/workflows/sync-labels.yml` writes the file to the repository on every push that touches it, and [`tests/build/issueTemplates.test.ts`](../tests/build/issueTemplates.test.ts) holds every label a template applies to that list. Adding a label is an edit to the file. Run `npm run labels:sync -- --dry-run` to see what a push would do.

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
npm run audit          # the release gate — run after build (it refuses a stale dist/)
npm run deploy:dry     # wrangler dry-run
```

Before opening a PR, make the whole gate green locally: `format:check`, `lint`, `typecheck`, `test`, `build`, and `audit`. CI runs exactly these on Node 24; Cloudflare's Git integration deploys on merge to `main`.

Four more checks run on a **schedule** rather than per-commit, because each needs the network and a government site having a bad afternoon must not fail a build — a suite that fails for reasons outside the change is one people learn to ignore. You can run any of them on demand, and you should run the relevant one when your change touches what it watches:

```sh
npm run check:links          # every external link the repo ships, monthly
npm run check:adapters       # every refresh adapter still finds its figure, monthly
npm run check:advisories     # every npm advisory has a reviewed reason, monthly
npm run check:boundaries     # which inclusive/exclusive comparisons a test actually holds
npm run check:boundaries -- --help   # it rewrites src/engine in place; read this first
```

`check:advisories` is the one most likely to surprise you: it does **not** fail on an advisory, it fails on an advisory nobody has looked at — or on one somebody accepted while a fix was on the shelf. If it stops you, the fix is an upgrade where one exists, and a triage entry in [`scripts/advisory-triage.json`](../scripts/advisory-triage.json) naming the vulnerable entry point and what calls it where one does not. Both halves are checked now: an entry standing over an advisory npm reports as fixable fails the run, because "there is no fix" is a fact with an expiry date and npm already knows the answer. **Take the upgrade before writing the reason.**

## Adding a tile (calculator)

A tile is a self-contained module in [`src/tiles/`](../src/tiles) implementing the `TileDefinition` contract ([`src/tiles/types.ts`](../src/tiles/types.ts)). The shell knows tiles only through that interface, so adding one is registering data + a mount function — never editing the shell. Each tile must:

- read defaults from and write entries back to **My Situation** (the shared session profile) where relevant, so a value entered once flows everywhere;
- **encode its state in the URL fragment** so every result is deep-linkable and copyable;
- include a **worked example** ("Try an example") and a plain-English **"How this works"** explainer with trusted U.S. resource links;
- carry a **citation on every rule-based figure** (labeled assumptions are fine for user-supplied rates);
- ship **golden cases** for the math and be added to the axe sweep.

Register it in [`src/tiles/registry.ts`](../src/tiles/registry.ts). The static `/tools.html` index, the per-tile crawlable shells, and the sitemap are generated from the registry at build time, and drift tests assert they list exactly the registry's tiles — so a new tile is picked up automatically once registered.

### What the gates will ask you for

Registering the tile is one line; the suite will then stop you six more times, each with a message naming the file to edit. This is the order they fire in, written down after adding the 69th calculator, so the next person can do the work up front instead of discovering it one red test at a time.

| The gate | What it wants | Where |
|---|---|---|
| `readmeCounts` | The calculator count, in **every** phrasing the README uses — a table row, a headline, a mermaid label, the layout table, the bundle note, and the axe line in the launch checklist. It reads them out of the prose and compares against the registry. | `README.md`, `docs/launch-checklist.md` |
| `watchCoverage` | If you added a **shard**: an adapter, a change-watch entry, or a written reason it needs neither. Nothing may be unwatched silently. | `scripts/refresh/source-watch.json` or `watch-coverage.json` |
| `observeEngine` | If you added a file under `src/engine`: a probe that exercises it at and around the values its comparisons test. A boundary in an unprobed file cannot be classified. | `scripts/observe-engine.ts` |
| `numericConstants` | A verdict for every new named numeric constant — a **bound** the code owns, a **figure** somebody legislates, or an **assumption** this site chose. | `tests/build/numericConstants.test.ts` |
| `toolsIndex` | A `related` link must name a hub that exists and a tool that hub actually holds. A calculator is not a route: it lives at `#/<hub>?tool=<id>`. | your tile's `related` |
| `audit` | The gzipped precached shell, still inside its budget. A tile with a long explainer and a shard with a long `sourceNote` both cost real bytes. | `npm run audit` |

A new shard is its own short chain, in this order: the JSON in `data/`, a schema in [`src/data/schemas.ts`](../src/data/schemas.ts) **and** an entry in the `SHARD_SCHEMAS` map beside it, a row in [`scripts/build-manifest.ts`](../scripts/build-manifest.ts), then `npm run data:manifest` to write the hash and the manifest, and finally an accessor on [`src/data/browser.ts`](../src/data/browser.ts) so a tile can read it. Miss the accessor and the tile compiles and shows its verify-before-relying banner forever.

## Adding or refreshing data

See [`adding-a-state.md`](adding-a-state.md) for a jurisdiction, [`annual-roll.md`](annual-roll.md) for rolling every figure to a new tax year, and [`data-sources.md`](data-sources.md) for the source list and the fail-safe refresh contract. The rule of thumb: **never ship a number you cannot cite to a public source.** When a figure is too large or too local to bundle, have the user supply that one local number rather than guess — that is why the per-county ACA benchmark (second-lowest-cost silver) premium and the Social Security PIA are user-supplied, not bundled. (The FAFSA SAI + Pell tables *are* now bundled and cited from the ED SAI Formula Guide; only the independent-student variant and per-state aid stay out of scope.)

## Voice

Warm, plain-English, encouraging, never scolding — "here is where you stand," never "you are behind." Red is reserved for genuine warnings. American English and standard numeric formats (`$1,500`, `25%`, ISO dates in code). US-only today; correctness before coverage.
