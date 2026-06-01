# Data sources

Every number enklayve shows is computed from a **bundled, versioned dataset** with a full citation — never fetched at runtime (the CSP sets `connect-src 'none'`) and never guessed. This document lists the sources, their refresh cadence, and how the data layer keeps them honest.

The authoritative, machine-readable record is [`data/manifest.json`](../data/manifest.json): every shard is pinned there to a version, an effective year, a source URL, a source document name, a retrieval date, and a SHA-256 content hash. The build embeds the manifest so the running app knows exactly what it is computing from, and the release audit (`npm run audit`) fails the build if any shard is missing a citation (the no-orphan-numbers rule, SPEC §9).

## Refresh cadence by source group

| Dataset | Source | Cadence | Pillar |
| --- | --- | --- | --- |
| Federal income tax brackets, standard deduction, capital-gains thresholds | IRS annual revenue procedure / inflation-adjustment notice | Annual, Oct–Nov | 1 |
| Retirement, HSA, and FSA limits, catch-up amounts | IRS annual notice | Annual | 1 |
| FICA wage base and rates; Social Security adjustment fractions | Social Security Administration fact sheets | Annual, Oct | 1 & 3 |
| CPI-U (inflation) annual averages | Bureau of Labor Statistics public database (no key) | Monthly, 2nd week | 1 & 3 |
| RMD Uniform Lifetime Table | IRS Publication 590-B | As revised | 1 |
| Treasury I savings-bond fixed + semiannual inflation rates | U.S. Treasury (TreasuryDirect) | Semiannual, May & Nov | 1 & 3 |
| Fifty-state income tax brackets, standard deductions, local add-ons | State Department of Revenue publications, one adapter per state | Annual, staggered | 1 |
| Federal Poverty Level guidelines (contiguous / Alaska / Hawaii) | Department of Health & Human Services | Annual, Jan | 2 |
| EITC and Child Tax Credit parameters | IRS annual revenue procedure | Annual | 2 |
| Saver's Credit tiers | IRS annual revenue procedure | Annual | 2 |
| ACA applicable-percentage table | IRS / ARPA-IRA schedule | Annual | 2 |
| SNAP cost-of-living adjustment, deductions, allotments | USDA Food & Nutrition Service | Annual, Oct | 2 |
| Medicaid MAGI expansion status by state | CMS / Medicaid.gov and state publications | Annual | 2 |

> The ACA **county benchmark (second-lowest-cost silver) premium** and a Social Security **PIA** are deliberately *not* bundled — the per-county SLCSP table is enormous and changes annually. Those tools have the user supply that one local figure (pointed to HealthCare.gov / their SSA statement) so every *shipped* number stays verifiable. The **FAFSA Student Aid Index + Pell Grant** tables (ED SAI Formula Guide) are now seeded for the 2024-25 dependent-student methodology and cited; the tools frame the result as an estimate to verify against the official guide and the user's FAFSA Submission Summary (the independent-student variant and per-state aid stay out of scope).

## Currently seeded shards

The 2024 tax year is seeded. Federal: income tax, FICA, retirement limits, capital gains, RMD Uniform Lifetime, CPI-U annual series, Social Security adjustment table, Treasury I-bond rate history (TreasuryDirect, semiannual). Benefits: Federal Poverty Level (×3 region variants), EITC/CTC, Saver's Credit, SNAP (contiguous), Medicaid expansion map, ACA applicable percentages, FAFSA SAI + Pell schedule (2024-25 dependent-student). State income tax: the ten most populous states plus DC — CA, NY, TX, FL, PA, IL, OH, GA, NC, MI, DC (no-income-tax states are first-class records, not omissions).

Each shard has a sibling `.sha256` and an entry in the manifest. See [`adding-a-state.md`](adding-a-state.md) to add a jurisdiction and [`contributing.md`](contributing.md) for the workflow.

## The fail-safe contract (SPEC §7.3)

A refresh job fetches the source, parses it with a source-specific adapter, emits normalized JSON plus a content hash, appends a human-readable diff, and runs the full golden suite. It opens a PR **only if tests pass and values changed**; if a source 404s or fails schema validation it opens an *alert* PR that flips the affected rules into fail-safe mode rather than shipping a wrong number. Data is never auto-committed to `main` without passing the test gate. At runtime, a shard whose effective year is older than its refresh window — or whose hash fails — is marked **stale**, and the tiles that depend on it surface a "verify before relying" banner instead of presenting a number as current.

This contract is implemented under [`scripts/refresh/`](../scripts/refresh/): a pure, unit-tested harness (`contract.ts`: the diff and the open-PR-vs-alert decision), the source adapters (`adapters.ts`: IRS, BLS CPI, SSA, HHS, the standard-deduction states California / New York / Georgia / North Carolina / DC, the flat-rate states Pennsylvania / Illinois / Michigan, the graduated bracket-table state Ohio, the TreasuryDirect I-bond rates, USDA SNAP, and CMS Medicaid — each anchoring to known labels and flagging rather than guessing when a layout changes), and the runner (`run.ts`). One GitHub Actions workflow per source group (`.github/workflows/refresh-*.yml`) runs on the cadence above and on manual dispatch, gates every data PR on the golden suite, and writes each change to the [source diff log](source-diff-log.md). The adapters refresh the committed figures in place; rolling a shard to a new effective year and transcribing a full bracket table remain the reviewer's data-only step on the resulting PR (see [`adding-a-state.md`](adding-a-state.md)).
