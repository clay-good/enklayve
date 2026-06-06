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

A **sliding standard deduction** (the South Carolina pattern — a deduction that phases down as income rises) **is** supported via the optional `standardDeductionPhaseOut` block: `{ byFilingStatus: { single: { agiThreshold, divisor }, … }, roundReductionDownTo? }`. The evaluator reduces the standard deduction by `standardDeduction × (AGI − agiThreshold) / divisor`, leaving it full at or below the threshold and zero once AGI exceeds it by `divisor`; `roundReductionDownTo` rounds the reduction down to a multiple of that many dollars when the statute requires it (SC: the next-lowest $10). See [`data/state-sc-income-tax-2024.json`](../data/state-sc-income-tax-2024.json) (H.4216, S.C. Code §12-6-1140(15)). Wisconsin's sliding deduction (a flat percentage of income over a threshold) is a *different* form and stays deferred until its variant is added.

When a state's data is stale past its refresh window, only that state shows the "verify before relying" banner; the other jurisdictions keep working (fail-safe is per jurisdiction).
