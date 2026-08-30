# Adding a state

The fifty-state tax engine is the moat, and it is built so **adding a state is adding data, not code** (SPEC §8). One generic evaluator consumes any number of typed jurisdiction shards; a new state is a new JSON file plus one line in the manifest builder. No engine, tile, or UI change is needed — the take-home and tax tiles discover bundled states automatically.

## Steps

1. **Create the shard** `data/state-XX-income-tax-2024.json`, where `XX` is the lowercase two-letter code. Copy an existing flat-tax state ([`state-ga-income-tax-2024.json`](../data/state-ga-income-tax-2024.json)) or a bracketed one ([`state-ca-income-tax-2024.json`](../data/state-ca-income-tax-2024.json)) as a template.

2. **Add the code** to `STATE_CODES` in [`scripts/build-manifest.ts`](../scripts/build-manifest.ts):

   ```ts
   const STATE_CODES = ["ca", "ny", "tx", "fl", "pa", "il", "oh", "ga", "nc", "mi", "dc", "xx"];
   ```

3. **Regenerate the manifest and hashes:** `npm run data:manifest`. This computes the shard's SHA-256, pins it in `data/manifest.json`, and writes the sibling `.sha256`. Commit the regenerated manifest alongside the shard.

4. **Add a golden case** in `tests/` (cross-checked against a published state worked example), then run `npm test`. The take-home and federal/state tiles will now offer the new state with no further wiring — `BundledData.availableStates()` reads it straight from the manifest.

5. **Write its refresh adapter** in [`scripts/refresh/adapters.ts`](../scripts/refresh/adapters.ts), so the shard is *watched* rather than left to go quietly stale behind a citation that still looks live. That is how Illinois, Michigan, Missouri and Georgia sat a year or two out of date until the August 2026 audit.

## Writing the adapter

An adapter fetches one page and pulls one figure out of it. The whole risk is that it pulls the wrong one, so these rules are the ones that were learned the expensive way — every line below has a state's name behind it.

| Rule | Why |
|---|---|
| **Watch what you cite.** Point `sourceUrl` at the document the shard's `citation` names, not at the department's landing page. | A landing page is a menu. Twenty-one adapters were watching one, and a menu never states a figure, so the report said "the source moved" forever. |
| **Dry-run before you trust it.** `node scripts/refresh/run.ts --adapter <id> --dry-run` and read the diff. | "Anchored" means the parser found something *shaped* like its figure, never that the value is right. Nine adapters anchored the wrong number the first time anyone looked — California's standard deduction read `2019`, Delaware's `2014`. |
| **A page that does not name its year cannot be dated.** | Missouri's page prints an eight-tier ladder with no year on it, and that ladder is last year's. It parsed cleanly and would have rolled every threshold in the state back a year. An undated schedule may *confirm* the shard; it may not change it. |
| **Read the trailing figure, not the leading one.** | Where a row states its floor twice ("Over $10,000 but not over $25,000 … 2.81% of the excess over $10,000"), only the one inside the rate's own clause is the pairing. |
| **Check which way round the page states it.** | Georgia and South Carolina write the amount first ("$30,000 for taxpayers filing Married Filing Jointly"). Read label-first, every status lands one row down. They share [`parseAmountThenStatusDeductions`](../scripts/refresh/adapters.ts). |
| **If the form carries a year in its URL, make the parser insist on the year.** | Form 446, Form 1-ES and the Missouri withholding formula are reissued annually, and a stale one states last year's figures *perfectly*. |
| **When the answer is no, say which no.** Set `settled: true` on the refusal when it is a decision rather than a defect. | A figure that is statutory and does not index, a state that has not published the shard's year, a page whose numbers mean something else — these need nobody. Filed as ordinary failures they open a fail-safe pull request every month, and a pull request that always opens is not a pull request. |
| **Do not parse a chart.** | Alabama's deduction is the corner of a 200-row grid; Delaware's statute is a history of periods. A parser that needs table geometry should be a reviewer step, or a fingerprint in [`source-watch.json`](../scripts/refresh/source-watch.json). |

Then run `npm run check:adapters`, and if the adapter agrees with its shard, add its id to [`adapter-baseline.json`](../scripts/refresh/adapter-baseline.json) — that list is the gate, and an adapter falling out of it fails the check.

## The jurisdiction shape

```jsonc
{
  "id": "US-GA",                 // "US-XX"
  "name": "Georgia",
  "taxYear": 2026,
  "hasIncomeTax": true,          // false → a first-class no-income-tax record (TX, FL)
  "supportedFilingStatuses": ["single", "married_jointly", "head_of_household"],
  "bracketsByFilingStatus": {    // ordered, ascending lowerBound; a flat tax is one bracket
    "single": [{ "lowerBound": 0, "rate": 0.0499 }]
    // ... one entry per supported filing status
  },
  "standardDeductionByFilingStatus": { "single": 12000, "married_jointly": 24000, "head_of_household": 12000 },
  "citation": {                  // required — the no-orphan-numbers rule (SPEC §9)
    "sourceUrl": "https://dor.georgia.gov/taxes/taxes-individuals",
    "sourceDocument": "Georgia DOR / HB 463, 4.99% flat individual income tax effective Jan 1, 2026; standard deduction $12,000/$24,000 (rises in 2027)",
    "effectiveYear": 2026,
    "dateRetrieved": "2026-06-02"
  },
  "effectiveDateRange": { "start": "2026-01-01", "end": "2026-12-31" }
}
```

The full schema (including optional `localAddOns` such as NYC/Yonkers and `specialRules` such as the California mental-health surtax) is the zod source of truth in [`src/data/schemas.ts`](../src/data/schemas.ts); a malformed shard fails the build rather than shipping a wrong number.

## A no-income-tax state

States like Texas and Florida are **first-class records, not omissions**: set `"hasIncomeTax": false` and omit the bracket/deduction maps. The engine returns zero state tax for them, with the citation still present.

## Scope notes (intentionally deferred)

State-level itemized deductions, Yonkers' percent-of-state-tax surcharge, and state AMT are deferred — keep new shards to brackets, the standard deduction, and documented local add-ons until those land.

A **taxpayer tax credit** (the Utah pattern — a nonrefundable credit that substitutes for a standard deduction) **is** supported: set `standardDeductionByFilingStatus` to 0 (the state taxes federal AGI directly) and add the optional `taxpayerCredit` block — `{ creditRate, phaseOutRate, basePhaseOutByFilingStatus }`. The evaluator credits `creditRate` of the *federal* deduction back, phased out at `phaseOutRate` of taxable income above the filing-status base, floored at zero. Per-dependent exemptions that would enlarge the credit are modeled as zero (the engine's no-dependent assumption), so the figure errs slightly high. See [`data/state-ut-income-tax-2024.json`](../data/state-ut-income-tax-2024.json).

A **sliding standard deduction** (a deduction that phases down as income rises) **is** supported via the optional `standardDeductionPhaseOut` block in two equivalent linear forms, exactly one per filing-status entry:

- **`divisor`** (the South Carolina pattern): the deduction is reduced by `standardDeduction × (AGI − agiThreshold) / divisor`, full at or below the threshold and zero once AGI exceeds it by `divisor`. `roundReductionDownTo` rounds the reduction down to a multiple of that many dollars when the statute requires it (SC: the next-lowest $10). See [`data/state-sc-income-tax-2024.json`](../data/state-sc-income-tax-2024.json) (H.4216, S.C. Code §12-6-1140(15)). Maine's standard-deduction phase-out is the same form read straight from statute — `divisor` = $75,000 / $112,500 / $150,000 (single / HoH / MFJ), thresholds indexed annually ([`state-me-income-tax-2024.json`](../data/state-me-income-tax-2024.json), 36 M.R.S. §5124-C(2)).
- **`reductionRate`** (the Wisconsin pattern): the deduction is reduced by `reductionRate × (AGI − agiThreshold)` — a flat percentage of income above the threshold, *independent* of the deduction's size (single 12%, joint 19.778%), reaching zero once that reduction equals the deduction. See [`data/state-wi-income-tax-2024.json`](../data/state-wi-income-tax-2024.json) (Wis. Stat. §71.05(23)(a)).

The shape is `{ byFilingStatus: { single: { agiThreshold, divisor | reductionRate, floor? }, … }, roundReductionDownTo? }`; the schema enforces that exactly one of `divisor`/`reductionRate` is present per entry. The optional per-status **`floor`** is the **Alabama** form (Ala. Code §40-18-15(b), the Form 40 standard-deduction chart): the deduction slides down but stops at a non-zero minimum — $5,000 married-jointly, $2,500 single/MFS/head-of-family — rather than reaching zero. Every Alabama status phases over the same $25,500→$35,500 AGI band at its own `reductionRate` (single 5%, MFS 17.5%, head-of-family 27%, joint 35% of AGI over $25,500), landing on its `floor` at exactly $35,500. See [`data/state-al-income-tax-2024.json`](../data/state-al-income-tax-2024.json). Wisconsin's true head-of-household deduction has a two-segment phase-out (22.515% until it converges with the single curve, then 12%) — that variant is mapped to the single schedule at launch fidelity (conservative), not yet modeled.

A **federal-income-tax deduction** (the "federal tax paid" subtraction) **is** supported via the optional `federalTaxDeduction` block. The evaluator subtracts `min(federal income tax, cap)` from state taxable income before the brackets — using the engine's own computed federal income tax for the same filer, so the marginal-rate probe picks up the interaction automatically. Two shapes:

- **Uncapped** (the Alabama pattern, Ala. Code §40-18-15(a)(1)): the filer's full federal liability is deductible — set `federalTaxDeduction: {}` (omit both `capByFilingStatus` and `phaseOut`).
- **Capped + AGI-phased** (the Oregon pattern, ORS §316.680/§316.695): set `capByFilingStatus` (the per-status dollar cap, ≈ $8,250 in 2024) and an optional `phaseOut: { byFilingStatus: { single: { agiThreshold, agiZero } } }` that slides the cap linearly from full (at or below `agiThreshold`) to zero (at or above `agiZero`). The schema rejects a `phaseOut` with no cap (an uncapped subtraction cannot phase out) and an `agiZero` that does not exceed `agiThreshold`.

The cap and phase-out resolve through the same filing-status fallback the brackets do (MFS → single, QSS → married-jointly). **Alabama (the 46th jurisdiction) and Oregon (the 47th) now ship this capability in production data:** Alabama uses the uncapped form over its sliding-to-a-floor standard deduction ([`state-al-income-tax-2024.json`](../data/state-al-income-tax-2024.json)); Oregon uses the capped + AGI-phased form ($8,500 cap, ORS §316.695 / OR-40 Table 4), with its exemption *credit* omitted at launch fidelity ([`state-or-income-tax-2024.json`](../data/state-or-income-tax-2024.json)). Both are golden-tested to the cent in [`tests/golden/states.test.ts`](../tests/golden/states.test.ts); the synthetic shape/fallback/schema cases stay in [`tests/engine/federalTaxDeduction.test.ts`](../tests/engine/federalTaxDeduction.test.ts).

A **mandatory residence-based local tax** (the Maryland county pattern) **is** supported via the optional `residenceLocalTax` block. Where the opt-in `localAddOns` (NYC, Yonkers, Ohio municipalities) are a multi-checkbox set a resident *chooses*, Maryland's county / Baltimore-City tax is mandatory and set by county of residence — exactly one applies. Set `residenceLocalTax: { label, defaultId }` and list the counties as `localAddOns` (a `flatRate`, or — Anne Arundel and Frederick — income-tiered `brackets`); the take-home tile then renders a required single-select dropdown labeled `label`, defaulting to `defaultId`, and the evaluator applies the chosen county's rate to the state's taxable income (no engine change — the local-add-on machinery already applies the selected id). The marginal-rate and optimizer tiles omit all local taxes by design (as they do NYC), so only the take-home tile carries the county tax. See [`data/state-md-income-tax-2024.json`](../data/state-md-income-tax-2024.json) (the 49th jurisdiction).

A **high-income benefit recapture** (the Arkansas / Connecticut pattern) **is** supported via the optional `incomeRecapture` block. The evaluator *adds* one or more ramps to the bracket tax — each ramp is a stage `{ thresholdLow, thresholdHigh, amount }` contributing `0` at or below `thresholdLow`, ramping linearly to `amount` at `thresholdHigh`, and `amount` (constant) above; the stage contributions sum, so several stacked stages reproduce a multi-step schedule with flat holds. Two shapes (at least one required): `stages` applies to **every** filing status (Arkansas's bracket adjustment, one ramp); `byFilingStatus` gives per-status stage lists resolved through the filing-status fallback (Connecticut's 2% phase-out add-back + tax recapture, several stacked ramps per status). The schema rejects a stage whose `thresholdHigh` does not exceed `thresholdLow`. See [`data/state-ar-income-tax-2024.json`](../data/state-ar-income-tax-2024.json) and [`data/state-ct-income-tax-2024.json`](../data/state-ct-income-tax-2024.json).

A **percent-of-tax personal credit** (Connecticut's Table E) **is** supported via the optional `personalCreditRate` block: `{ byFilingStatus: { single: [{ agiUpTo, rate }], … } }`, an ascending-by-`agiUpTo` step table per status. The evaluator looks up the rate for the filer's AGI (the first row whose `agiUpTo` is at or above the AGI, or 0 above every row) and applies `tax × (1 − rate)` **after** any recapture — so a low-to-middle earner's credit reduces the recapture-inclusive tax, exactly as the CT-1040 worksheet does. See [`data/state-ct-income-tax-2024.json`](../data/state-ct-income-tax-2024.json) (the 51st jurisdiction — the last U.S. income-tax state).

When a state's data is stale past its refresh window, only that state shows the "verify before relying" banner; the other jurisdictions keep working (fail-safe is per jurisdiction).
