import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ADAPTERS } from "../../scripts/refresh/adapters";
import { ManifestSchema } from "../../src/data/schemas";

/**
 * Every bundled dataset is watched, or says why it is not.
 *
 * The adapter check reports on the adapters that exist. It has nothing to say
 * about a shard that has *no* adapter, so a dataset watched by nothing is
 * invisible to the one report that would name it — and on 2026-08-30 that was
 * twenty-three of eighty, a number nobody could have produced from the repo.
 * Nine are the no-income-tax states, which genuinely have nothing to index.
 * Five cite the exact revenue procedure the federal income-tax adapter already
 * fetches and parses every month.
 *
 * A shard sitting at whatever year it was authored in behind a citation that
 * still looks live is the failure this whole pipeline exists to prevent. This
 * makes the set explicit and stops it growing quietly: a new dataset with no
 * watch fails here until somebody writes down why.
 */
const ROOT = resolve(__dirname, "..", "..");
const read = (p: string): unknown => JSON.parse(readFileSync(resolve(ROOT, p), "utf8"));

const manifest = ManifestSchema.parse(read("data/manifest.json"));
const coverage = read("scripts/refresh/watch-coverage.json") as {
  unwatched: Record<string, string>;
};
const changeWatch = (read("scripts/refresh/source-watch.json") as { entries: { shard: string }[] })
  .entries;

const watched = new Set([...ADAPTERS.map((a) => a.id), ...changeWatch.map((e) => e.shard)]);

describe("watch coverage over the bundled datasets", () => {
  it("accounts for every dataset, by a watch or by a written reason", () => {
    const unaccounted = manifest.datasets
      .map((d) => d.id)
      .filter((id) => !watched.has(id) && !(id in coverage.unwatched));
    expect(
      unaccounted,
      `these datasets are watched by nothing and say nothing about it: ${unaccounted.join(", ")}` +
        " — add an adapter, add a change-watch entry, or record why neither fits in" +
        " scripts/refresh/watch-coverage.json",
    ).toEqual([]);
  });

  it("lists only datasets that exist", () => {
    const known = new Set(manifest.datasets.map((d) => d.id));
    for (const id of Object.keys(coverage.unwatched)) {
      expect(known.has(id), `${id} is exempted but is not a bundled dataset`).toBe(true);
    }
  });

  it("drops an id the moment something starts watching it", () => {
    // The list is meant to shrink. Leaving an id here after an adapter lands
    // would let the next reader believe a watched shard is unwatched, which is
    // the same lie as the reverse.
    for (const id of Object.keys(coverage.unwatched)) {
      expect(watched.has(id), `${id} is watched now — remove it from watch-coverage.json`).toBe(
        false,
      );
    }
  });

  it("gives a reason someone can argue with, not a shrug", () => {
    for (const [id, reason] of Object.entries(coverage.unwatched)) {
      expect(reason.length, `${id}'s reason is too short to be one`).toBeGreaterThan(60);
    }
  });

  it("says out loud which of these are gaps rather than decisions", () => {
    // Five shards cite rp-25-32.pdf, which the federal adapter already fetches
    // and parses every month for the brackets. Nothing reads their figures out
    // of it. That is not a shard that cannot be watched; it is one nobody has
    // written yet, and the reason has to say so or the list becomes a place
    // where work goes to be forgotten.
    const gaps = Object.entries(coverage.unwatched).filter(([, r]) => r.includes("THE REAL GAP"));
    expect(gaps.length).toBeGreaterThanOrEqual(7);
    for (const [, reason] of gaps) expect(reason).toMatch(/wants an adapter/);
  });
});
