# Rolling the tax year

Every figure on this site is annual, so the roll is the one recurring task that touches every shard at once. It is also the task with the most one-line ways to go quietly wrong, and this page names them.

**The shape of the danger:** the year is stated in two places, and they take very different effort to change. Each of the 81 shards states its own year inside its citations — 81 files. The manifest states it again, and there it comes from **shared constants** in [`build-manifest.ts`](../scripts/build-manifest.ts) (`ANNUAL`, `SEMIANNUAL`, and the Pillar 4 group), so bumping all 81 manifest entries is a **three-line edit**.

That asymmetry is the hazard. The manifest's `effectiveYear` drives the staleness gate, so changing those three lines alone tells the app every figure is current while all 81 shards still hold last year's numbers — last year's figures reported as fresh, with no banner. A test now blocks exactly that (see step 4), and it is the reason to run the suite *before* believing a green build.

## Steps

1. **Roll each shard.** New figures, new `effectiveYear`, new `dateRetrieved`, and — where the document changed — a new `sourceUrl` and `sourceDocument`. Read the agency's own document, never a summary of it; [`data-sources.md`](data-sources.md#source-audits) records the eight wrong figures that pass found.

2. **Roll the manifest constants** in [`build-manifest.ts`](../scripts/build-manifest.ts). `cpi-u-annual` is deliberately a year behind — its latest *complete* annual average is last year's — so it carries its own value rather than the shared one.

3. **Regenerate:** `npm run data:manifest`. This rewrites `data/manifest.json` and every sibling `.sha256` from the shard bytes. Commit them with the shards; a sibling left behind is a digest a reader checking by hand will be told does not match.

4. **Run the suite,** and read the failures as a checklist rather than as noise. Each one is a different half-finished roll:

   | Failure | What is half-done |
   | --- | --- |
   | `data.test.ts` — the manifest's provenance is provenance the shard states | The manifest and the shards disagree on a year, URL, document, or retrieval date. This is the three-line-edit hazard above. |
   | `proseYears.test.ts` | A sentence still names last year beside a figure that moved. The numbers rolled; the words explaining them did not. |
   | `states.test.ts`, `federal.test.ts`, and the rest of `tests/golden/` | Hand-computed expectations, which must be **recomputed by hand** against the new schedules. Regenerating them is not an option; that is the point of them. |
   | `snapshot.test.ts` | The drift guard. Once the hand-verified cases above are right, `npm run golden:regen` and read the diff line by line. |
   | `readmeCounts.test.ts` | A count in the README moved. |

5. **Repoint the parked adapters.** Five wait on a document their state has not published — `npm run check:adapters` lists them under "Settled" with the year each is waiting for. A parked adapter pointed at a closed year reports agreement forever, which is worse than being parked.

6. **Check the zero-window shards.** Six carry `staleAfterYears: 0` (the Pillar 4 group and free filing): they lapse the instant their year does, and they are the highest-harm figures here — a COBRA election window that is wrong is coverage that is simply gone. They want their own sourcing pass, not a copy-forward.

## What the roll cannot tell you

An adapter reporting agreement means its parser found something shaped like its figure, **not that the value is right**. The refresh pipeline proposes; the golden suite gates; a person reads. Nothing in this file replaces reading the agency's document.
