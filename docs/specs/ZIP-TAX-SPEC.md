# ZIP-Code Tax Resolution — Build Spec

Status: **proposed (not yet built).** This is a step-by-step plan to add ZIP-code
precision to enklayve's tax math without breaking the two promises everything
else rests on: every number is **computed on-device** (`connect-src 'none'`) and
every number **cites a public source**.

Today the user picks a **state**. enklayve computes federal + FICA + state income
tax, plus any **local income tax add-ons** that state defines, selected by
checkbox in the Take-Home tool (`localJurisdictionIds`). The gap: which local
add-on applies is a function of **where you live inside the state**, and the user
has to know that. A ZIP code resolves it automatically and unlocks the ~16 states
where local income tax is non-trivial.

This spec is income-tax-only. **Sales and property tax vary by locality too, but
they are spending, not paycheck withholding**, so they belong in budget expense
rows, never the "Taxes" line. (Tracked as a non-goal in §3.)

---

## 0. Goal & acceptance criteria

**Goal:** a user types a 5-digit ZIP and the tax engine automatically applies the
correct state **and** local income taxes for that location, with a citation on
each line, computed entirely on-device.

**Acceptance criteria:**

1. `resolveZip("45202")` → `{ state: "oh", localJurisdictionIds: ["cincinnati", "oh-sd-…"] }`, deterministic, offline.
2. `evaluateTaxes` produces the same local lines it produces today when those
   `localJurisdictionIds` are passed by hand — i.e. **no change to the core
   engine math**, only to how the local ids are *chosen*.
3. Every ZIP in the 50 states + DC resolves to *at least* a state (graceful
   fallback when sub-state local data is missing — §10).
4. The added on-device payload for the ZIP crosswalk is **lazy-loaded same-origin**
   and does not regress first-paint (§7); `connect-src 'none'` is preserved on
   every page (the ZIP assets get their own scoped carve-out exactly like `/ocr/*`).
5. The data ships through the **existing refresh pipeline** (adapter → diff →
   golden test gate → PR), never hand-edited (§6).
6. Full golden coverage: a fixed corpus of `(ZIP → expected jurisdictions →
   expected tax)` cases passes (§12).

---

## 1. What already exists (build on this, do not reinvent)

| Concern | Where | Reuse |
| --- | --- | --- |
| Jurisdiction shard schema (`brackets`, `localAddOns`, `citation`, `effectiveDateRange`) | `src/data/schemas.ts` (`JurisdictionSchema`, `LocalAddOnSchema`) | Extend, don't replace |
| Tax evaluator (federal + FICA + state + **local by id**) | `src/engine/tax/evaluate.ts` (`evaluateTaxes`, `input.localJurisdictionIds`) | Unchanged |
| Per-state shards `data/state-XX-income-tax-2024.json` | `data/`, loaded via `BundledData.state(code)` (`src/data/browser.ts`) | Add localAddOns here |
| Data refresh contract (fetch → diff → golden gate → PR) | `scripts/refresh/{adapters,contract,run}.ts` | Add a `zip-crosswalk` job |
| Manifest gating + hashing of every shard | `scripts/build-manifest.ts`, `data/manifest.json` | ZIP shards go through it |
| On-device, same-origin, lazy heavy asset + scoped CSP | `worker/index.ts` (`/ocr/*` carve-out), `public/ocr/`, the `ocrAssets` Vite plugin | Copy the pattern for `/zip/*` |
| Local add-on selection UI (checkboxes) | `src/tiles/takeHome.ts` (`renderLocalAddOns`) | Replace manual checkboxes with ZIP-derived defaults |

**Key fact:** `evaluateTaxes` already does local tax correctly. The *only* new
logic is **ZIP → the set of `localJurisdictionIds`** plus the **data** describing
each local jurisdiction. Keep that boundary clean.

---

## 2. The accuracy this unlocks (which states actually have local income tax)

Local **income/earnings** taxes that change a paycheck exist in roughly these
states (verify each against its DOR during build):

- **Ohio** — municipal income tax (hundreds of cities/villages) **and** school
  district income tax. The biggest single win; ZIP→municipality+SD is essential.
- **Pennsylvania** — local Earned Income Tax (EIT) + Local Services Tax (LST),
  resolved by municipality/school district (PSD codes).
- **Kentucky** — county/city occupational license (payroll) taxes.
- **Maryland** — county income tax (a surcharge on the state return), by county.
- **Michigan** — city income taxes (Detroit, Grand Rapids, etc.).
- **Missouri** — Kansas City & St. Louis 1% earnings tax.
- **New York** — NYC resident tax, Yonkers.
- **Indiana** — county income tax (LIT), by county of residence.
- **Iowa** — school district surtax (a % of state tax), by district.
- **Oregon** — Portland Metro / Multnomah County / transit district taxes.
- **Alabama, Delaware (Wilmington), West Virginia, Colorado, New Jersey (Newark)** — narrower/occupational; lower priority.

ZIP precision matters most in **OH, PA, KY, MD, MI, MO, NY, IN, IA, OR**. Phase the
build around those (§11).

---

## 3. Scope & non-goals

**In scope:** ZIP → (state, local income-tax jurisdiction ids) → existing engine.

**Non-goals (state explicitly, so reviewers don't expect them):**

- Sales tax, property tax, transfer tax — these are spending, modeled in budget
  expense rows, not the Taxes line. A separate `sales-tax-by-zip` dataset could
  feed a *different* tool later; out of scope here.
- ZIP+4 rooftop accuracy. We resolve at the 5-digit ZIP level and, where a ZIP
  straddles jurisdictions, we surface the ambiguity (§10) rather than guess.
- Non-resident / multi-state allocation (work in one city, live in another). The
  budget assumes residence == work location; note it in the UI.

---

## 4. Data model

### 4.1 New: ZIP → jurisdiction crosswalk

One compact, queryable dataset mapping each ZIP to its state and the ids of any
local income-tax jurisdictions. Add to `src/data/schemas.ts`:

```ts
export const ZipEntrySchema = z.object({
  // 5-digit ZIP (string to preserve leading zeros, e.g. "01001").
  zip: z.string().regex(/^\d{5}$/),
  state: z.string().length(2),                 // lowercase code, matches state shard id
  // Ids into the resolved state shard's localAddOns (may be empty).
  localJurisdictionIds: z.array(z.string()).default([]),
  // When a ZIP spans >1 local jurisdiction, list the alternates so the UI can ask.
  ambiguousAmong: z.array(z.string()).optional(),
});

export const ZipCrosswalkSchema = z.object({
  id: z.string(),                              // e.g. "zip-crosswalk-2024"
  taxYear: z.number().int(),
  // Stored as a sorted array (binary-searchable) OR sharded by ZIP3 prefix (§7).
  entries: z.array(ZipEntrySchema),
  citation: CitationSchema,
  effectiveDateRange: z.object({ start: z.string(), end: z.string() }),
});
```

### 4.2 Extend: local jurisdiction rules (already mostly there)

`LocalAddOnSchema` already supports `flatRate` **or** `brackets`. Add the few
fields real local taxes need:

```ts
// add to LocalAddOnSchema in src/data/schemas.ts
base: z.enum(["taxable_income", "wages", "state_tax"]).default("taxable_income"),
// Ohio school districts and PA EIT differ in base; Iowa surtax is % of STATE tax.
residentOnly: z.boolean().default(true),       // most local income taxes are residence-based
citation: CitationSchema.optional(),           // per-locality source, falls back to the state's
```

`evaluate.ts` must learn to honor `base: "state_tax"` (Iowa surtax) and
`base: "wages"` (some city earnings taxes) — a small, well-tested extension to
`computeLocalLines`. This is the **only** engine change.

### 4.3 Shard layout

- `data/zip-crosswalk-2024-<zip3>.json` — **sharded by 3-digit ZIP prefix** (000–999,
  ~900 real files) so the browser loads only the ~1/900th it needs (§7). Each
  validates against `ZipCrosswalkSchema` (its `entries` limited to that prefix).
- Local add-ons stay **inside the existing state shards** (`data/state-oh-…json`),
  so Ohio's hundreds of municipalities live with Ohio. No new per-locality files.

---

## 5. Authoritative sources (cite every one)

The hard part is that **ZIP ≠ ZCTA ≠ jurisdiction boundary**. Build the crosswalk
by composing public relationship files:

1. **HUD–USPS ZIP Crosswalk Files** (ZIP→county, ZIP→place, ZIP→tract; updated
   quarterly, with residential address ratios to pick the dominant area when a
   ZIP spans many). Primary key for ZIP→county/place.
   `https://www.huduser.gov/portal/datasets/usps_crosswalk.html`
2. **Census ZCTA relationship files** (ZCTA→county, ZCTA→county subdivision/place)
   as a cross-check and for places HUD lacks.
   `https://www.census.gov/geographies/reference-files.html`
3. **Per-state DOR locality tables** (the rates + which place/SD owns which area):
   - Ohio: The Finder / municipal income tax & school district lists (Ohio Dept. of Taxation).
   - Pennsylvania: DCED **PSD codes** + EIT/LST rate register (the official municipality↔rate map).
   - Maryland, Indiana, Iowa, Kentucky, Michigan, Missouri, NY, Oregon: each DOR's local-rate publication.
4. **Tax Foundation** "Local Income Taxes" survey — a sanity cross-check, never the primary citation.

Each shard's `citation` points at the **government** source (DOR / Census / HUD),
not the aggregator. PA and OH should cite the PSD/Finder tables directly.

---

## 6. Build & retrieval pipeline (step by step)

Mirror the proven refresh contract in `scripts/refresh/` (`contract.ts` doc
block: fetch → diff → golden gate → PR, never auto-commit a wrong number).

**Step 1 — Adapters** (`scripts/refresh/adapters.ts`, new functions):
- `parseHudZipCrosswalk(raw)` → `{ zip, county, place, resRatio }[]`.
- `parseStateLocalRates(state, raw)` → `LocalAddOn[]` keyed by place/SD id.
- `buildZipCrosswalk(hud, census, stateRateTables)` → `ZipEntry[]`:
  for each ZIP, pick the dominant residential area (max `resRatio`), map it to the
  local jurisdiction ids defined in that state's shard; if two areas exceed a
  threshold (e.g. both > 35% residential ratio) set `ambiguousAmong`.

**Step 2 — Generators** (`scripts/refresh/run.ts` job `zip-crosswalk`):
- Fetch HUD + Census + each state DOR table (the runner owns I/O).
- Produce the 900 `zip-crosswalk-2024-<zip3>.json` shards + updated state shards.
- Stamp `citation.dateRetrieved`, `effectiveDateRange`, `taxYear`.

**Step 3 — Diff & gate** (reuse `contract.ts`):
- `diffShards` the new vs committed shards; append to `docs/source-diff-log.md`.
- Run `npm run test` (golden corpus, §12). **PR only if green and changed**;
  otherwise open an *alert* PR. Same rule as every existing source.

**Step 4 — Manifest** (`scripts/build-manifest.ts`):
- Hash + register every `zip-crosswalk-*` shard in `data/manifest.json` so the
  browser integrity-gates them exactly like tax shards.

**Step 5 — CI**: add `.github/workflows/refresh-zip-crosswalk.yml` on the same
cadence as HUD's quarterly release.

---

## 7. Bundle size & privacy (the real engineering challenge)

~42,000 ZIPs. Naively bundling kills first paint, and `connect-src 'none'`
forbids fetching from a CDN. Solve it the way OCR was solved:

1. **Shard by ZIP3** (§4.3). A lookup loads one ~10–50 KB file (the ZIPs sharing
   the first 3 digits), not the whole table. Most users hit one shard.
2. **Same-origin, lazy, scoped CSP.** Emit shards under `/zip/` via a Vite plugin
   modeled on `ocrAssets`. Add a `/zip/*` response-header carve-out in
   `worker/index.ts` (`connect-src 'self'` scoped to `/zip/*`), exactly the
   second-carve-out justification used for `/ocr/*`: same-origin only, no server
   endpoint, never touches in-memory user data. **Every page keeps `connect-src 'none'`.**
3. **Service-worker runtime cache** the loaded ZIP shard so repeat lookups and
   offline use work (same pattern as the OCR model).
4. **Compress**: store entries as a tight columnar form (parallel arrays) or a
   trie keyed by ZIP suffix; gzip at build. Target < 30 KB gzipped per ZIP3 shard.

If a future requirement is "fully offline before first lookup," ship a
**minimal embedded ZIP3→state table** (~900 rows, < 20 KB) in the main bundle for
the state-only fallback, and lazy-load the local-jurisdiction detail per ZIP3.

---

## 8. Runtime resolution logic

New module `src/engine/tax/zip.ts`:

```ts
export interface ZipResolution {
  zip: string;
  state: string;                 // "" if unknown
  localJurisdictionIds: string[];
  ambiguousAmong?: string[];     // present → UI should ask which locality
  modeled: boolean;              // false → state-only fallback (§10)
}

// Pure given the loaded shard; the loader (browser.ts) handles the lazy fetch.
export function resolveZip(zip: string, shard: ZipCrosswalk): ZipResolution;
```

Wire into `BundledData` (`src/data/browser.ts`):
`zipCrosswalk(zip3: string): Promise<ZipCrosswalk | null>` — lazy, integrity-gated,
SW-cached. Tiles call `await data.resolveZip(zip)` then feed the result into the
existing `evaluateTaxes({ ..., localJurisdictionIds })`.

Validation: the UI input is `inputmode="numeric"`, `maxlength=5`, `pattern=\d{5}`,
rejected unless it matches `/^\d{5}$/` (the user's "5-digit integer validation").

---

## 9. UI integration & which tools to extend (similar scope)

The ZIP→jurisdiction resolver is shared infrastructure. Extend every tool whose
result depends on **state + locality** of income tax:

- **Take-Home Pay** (`src/tiles/takeHome.ts`) — replace the manual local add-on
  checkboxes with a ZIP field that auto-selects them; keep the checkboxes as an
  override when `ambiguousAmong` is set.
- **Home budget** (`src/ui/shell.ts` `homeBudgetWidget`) — optional ZIP field
  beside/instead of the state dropdown (state stays the default per the product
  decision; ZIP is the power-user upgrade).
- **W-4 Withholding**, **Paycheck Optimizer**, **Marginal Rate Explorer**,
  **Quarterly Taxes**, **Self-Employment Tax**, **Contract vs Salary**,
  **Capital Gains** — all run through `evaluateTaxes`; each gains the same ZIP
  field and passes the resolved `localJurisdictionIds`.
- **Take-home of the Readout** and **My Plan** inputs that carry `stateCode` in
  the shared profile (`SituationStore`) should also carry an optional `zip`, so a
  ZIP entered once flows everywhere (same precedence rule: URL > profile > default).

Add `zip` to `SituationValues` so it round-trips like `stateCode`.

---

## 10. Edge cases (handle each explicitly)

| Case | Behavior |
| --- | --- |
| ZIP spans 2+ local jurisdictions | `ambiguousAmong` set → UI shows a small "which town?" picker; default to the highest-residential-ratio one and say so. |
| ZIP has no local income tax (most of the US) | `localJurisdictionIds: []`, state tax only. Correct, no note. |
| State whose locals aren't modeled yet | `modeled: false` → state-only, show the existing honest note ("we don't model X's local income tax yet"). Mirrors the budget's current state-not-modeled note. |
| Invalid / non-existent ZIP | reject at input; if shard lookup misses, fall back to state-only and flag it. |
| PO-box-only or military ZIP (no residential population) | resolve to state from the ZIP3; `localJurisdictionIds: []`. |
| ZCTA vs ZIP mismatch (Census has no ZCTA for a ZIP) | HUD crosswalk is primary; Census is the fallback, not the reverse. |
| Ohio school district + municipality both apply | both ids in `localJurisdictionIds`; engine sums them (already supported). |
| Leading-zero ZIPs (01001) | stored and compared as strings throughout. Never parse to number. |

---

## 11. Phasing

1. **Phase A — plumbing, no data risk.** Schema (`ZipEntry`, extend `LocalAddOn`),
   `resolveZip`, engine `base` extension + golden tests, the `/zip/*` CSP carve-out
   and lazy loader. Ship behind a feature flag with a hand-built 3-ZIP fixture.
2. **Phase B — the high-value states.** Crosswalk + local rates for OH, PA, NY, MD,
   MI, MO (the states where ZIP changes the answer most). Take-Home tool first.
3. **Phase C — remaining local-tax states** (KY, IN, IA, OR, AL, DE, WV, CO, NJ).
4. **Phase D — fan out** the ZIP field to the other `evaluateTaxes` tools (§9) and
   add `zip` to the shared profile so it flows everywhere.
5. **Phase E — automation.** The quarterly HUD refresh job + per-state DOR jobs in CI.

Each phase ships independently; state-only behavior is always the safe fallback.

---

## 12. Testing & acceptance

- **Golden corpus** `tests/golden/zip.test.ts`: a fixed table of `ZIP → expected
  {state, localJurisdictionIds}` and, for a sample, `→ expected total tax` at a
  reference income/filing status. Hand-verified against each DOR. Include: NYC
  (10001), Yonkers, a Cincinnati ZIP (45202) with city+SD, a PA PSD ZIP, a
  Maryland county ZIP, a no-local ZIP (e.g. 99501 AK), a leading-zero ZIP (01001),
  an ambiguous ZIP, and a PO-box ZIP.
- **Determinism test**: `resolveZip` is pure; same input → same output.
- **Engine extension tests**: `base: "state_tax"` (Iowa surtax) and `base: "wages"`
  produce hand-checked numbers.
- **Privacy test** (extend the release audit, `scripts/audit-release.ts`): assert
  the `/zip/*` carve-out is the *only* new CSP exception and every page still
  declares `connect-src 'none'`.
- **Size test**: assert each `zip-crosswalk-*` shard is under the gzip budget.
- **Build test** (`tests/build/dataRefresh.test.ts` style): the adapter turns
  synthetic HUD + DOR fixtures into a valid shard; `diffShards` flags a changed
  rate; the gate blocks a malformed shard.

---

## 13. Risks & open questions

- **Boundaries are fuzzy.** ZIPs are postal routes, not legal boundaries; a ZIP
  can cross a city line. The residential-ratio heuristic + `ambiguousAmong` is the
  honest mitigation, but some addresses will resolve to the wrong town. The UI
  must let the user override, and copy must say "based on your ZIP" not "exact."
- **Maintenance load.** Local rates change yearly and there are thousands of OH/PA
  localities. This only stays correct because it goes through the **gated refresh
  pipeline**; do not hand-edit shards.
- **Residence vs work location.** Earnings taxes (KY, MO, OH, MI) are often
  work-location based; the budget assumes residence. Decide per tool whether to
  ask for a separate work ZIP (probably Phase D+).
- **Source licensing.** HUD/Census/DOR data is public domain; confirm each state's
  table is freely redistributable before bundling.

---

### TL;DR for the implementer

1. Add `ZipEntry`/`ZipCrosswalk` schemas; extend `LocalAddOn` with `base`/`residentOnly`.
2. Teach `evaluate.ts` the new `base` values (the only engine change).
3. Write `resolveZip(zip, shard)` (pure) + a lazy, SW-cached, `/zip/*`-scoped loader.
4. Build the ZIP3-sharded crosswalk through the existing adapter→diff→golden→PR pipeline; cite HUD/Census/DOR.
5. Swap Take-Home's manual local checkboxes for ZIP-derived defaults; fan out to the other `evaluateTaxes` tools; add `zip` to the shared profile.
6. State-only is always the safe fallback; never ship a wrong local number — gate on the golden corpus.
