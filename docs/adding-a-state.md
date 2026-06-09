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

## The jurisdiction shape

```jsonc
{
  "id": "US-GA",                 // "US-XX"
  "name": "Georgia",
  "taxYear": 2024,
  "hasIncomeTax": true,          // false → a first-class no-income-tax record (TX, FL)
  "supportedFilingStatuses": ["single", "married_jointly", "head_of_household"],
  "bracketsByFilingStatus": {    // ordered, ascending lowerBound; a flat tax is one bracket
    "single": [{ "lowerBound": 0, "rate": 0.0539 }]
    // ... one entry per supported filing status
  },
  "standardDeductionByFilingStatus": { "single": 12000, "married_jointly": 24000, "head_of_household": 12000 },
  "citation": {                  // required — the no-orphan-numbers rule (SPEC §9)
    "sourceUrl": "https://dor.georgia.gov/taxes/individual-taxes",
    "sourceDocument": "Georgia DOR, 5.39% flat tax (2024); standard deduction $12,000/$24,000",
    "effectiveYear": 2024,
    "dateRetrieved": "2024-02-01"
  },
  "effectiveDateRange": { "start": "2024-01-01", "end": "2024-12-31" }
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

A **high-income benefit recapture** (the Arkansas bracket-adjustment pattern) **is** supported via the optional `incomeRecapture` block: `{ thresholdLow, thresholdHigh, amount }`. The evaluator *adds* a flat amount to the bracket tax — `0` at or below `thresholdLow`, ramping linearly to `amount` at `thresholdHigh`, and `amount` (constant) above — so a high earner forfeits the benefit of the lower brackets (Ark. Code §26-51-201, the AR1000F "bracket adjustment"). Because the recapture is `0` below the band and a published constant above it, the model is *exact* outside the band; only inside the narrow phase-in band does the continuous ramp differ from the official $100-step worksheet, by a small documented amount. The schema rejects a `thresholdHigh` that does not exceed `thresholdLow`. See [`data/state-ar-income-tax-2024.json`](../data/state-ar-income-tax-2024.json) (the 50th jurisdiction).

When a state's data is stale past its refresh window, only that state shows the "verify before relying" banner; the other jurisdictions keep working (fail-safe is per jurisdiction).
