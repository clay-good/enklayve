import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadDataset, loadManifest, needsVerifyBanner } from "../src/data/loader";
import {
  FicaSchema,
  ManifestSchema,
  RetirementLimitsSchema,
  JurisdictionSchema,
  type Jurisdiction,
  type ManifestEntry,
} from "../src/data/schemas";

const DATA_DIR = resolve(__dirname, "..", "data");

function readShard(file: string): string {
  return readFileSync(resolve(DATA_DIR, file), "utf8");
}

const manifest = ManifestSchema.parse(JSON.parse(readShard("manifest.json")));
const shards: Record<string, string> = Object.fromEntries(
  manifest.datasets.map((d) => [d.id, readShard(d.shard)]),
);
const fedEntry = manifest.datasets.find((d) => d.id === "federal-income-tax-2024") as ManifestEntry;
const fedShard = shards["federal-income-tax-2024"]!;

describe("manifest loading (BUILD-SPEC §7, §8)", () => {
  it("loads every seeded shard as ok when fresh", async () => {
    const loaded = await loadManifest(manifest, shards, 2024);
    expect(loaded.hasFailSafe).toBe(false);
    for (const d of loaded.datasets) {
      expect(d.status).toBe("ok");
      expect(d.data).not.toBeNull();
    }
    const fed = loaded.byId.get("federal-income-tax-2024")!;
    const data = fed.data as Jurisdiction;
    expect(data.id).toBe("US");
    expect(data.bracketsByFilingStatus.single?.[0]?.rate).toBe(0.1);
  });

  it("marks a dataset invalid when the shard is missing", async () => {
    const loaded = await loadManifest(manifest, {}, 2024);
    expect(loaded.hasFailSafe).toBe(true);
    expect(loaded.datasets.every((d) => d.status === "invalid")).toBe(true);
  });
});

describe("integrity fail-safe", () => {
  it("triggers fail-safe when the content hash does not match", async () => {
    // Corrupt one digit of the body so sha256 no longer matches the manifest.
    const corrupted = fedShard.replace('"rate": 0.1', '"rate": 0.11');
    const result = await loadDataset(fedEntry, corrupted, 2024);
    expect(result.status).toBe("invalid");
    expect(result.data).toBeNull();
    expect(result.problems.join(" ")).toMatch(/content hash mismatch/);
    expect(needsVerifyBanner(result.status)).toBe(true);
  });

  it("triggers fail-safe when the pinned hash is wrong", async () => {
    const badEntry: ManifestEntry = { ...fedEntry, contentHash: "0".repeat(64) };
    const result = await loadDataset(badEntry, fedShard, 2024);
    expect(result.status).toBe("invalid");
  });
});

describe("schema fail-safe", () => {
  it("rejects malformed data even when the hash matches", async () => {
    // A rate above 1 violates the bracket schema. Re-pin the hash so the
    // failure is attributable to schema validation, not integrity.
    const malformed = fedShard.replace('"rate": 0.1', '"rate": 9');
    const { createHash } = await import("node:crypto");
    const hash = createHash("sha256").update(malformed).digest("hex");
    const entry: ManifestEntry = { ...fedEntry, contentHash: hash };
    const result = await loadDataset(entry, malformed, 2024);
    expect(result.status).toBe("invalid");
    expect(result.problems.join(" ")).toMatch(/schema validation failed/);
  });

  it("requires every named retirement limit the tiles read (SPEC-3 §A4, no stale literal)", () => {
    // The real shard, with all named limits present, validates.
    const real = JSON.parse(readShard("retirement-limits-2024.json"));
    expect(RetirementLimitsSchema.safeParse(real).success).toBe(true);
    // Dropping a consumed key fails validation, so the tile falls back to the
    // verify-before-relying banner rather than substituting a magic number.
    for (const key of [
      "elective_deferral_401k",
      "catch_up_401k_50plus",
      "defined_contribution_415c",
      "ira_contribution",
      "hsa_self_only",
    ]) {
      const missing = JSON.parse(readShard("retirement-limits-2024.json"));
      delete missing.limits[key];
      expect(RetirementLimitsSchema.safeParse(missing).success).toBe(false);
    }
  });

  it("requires every filing-status Additional Medicare threshold (SPEC-3 §A6, no stale literal)", () => {
    // The real FICA shard defines the threshold for all five statuses, so it
    // validates. (Note the surtax-specific value: qualifying surviving spouse is
    // $200,000, not the $250,000 it would get under the income-tax MFJ mapping.)
    const real = JSON.parse(readShard("fica-2024.json"));
    expect(FicaSchema.safeParse(real).success).toBe(true);
    // Dropping any status fails validation, so the loader marks FICA invalid and
    // the take-home / SE-tax tiles show the verify-before-relying banner rather
    // than the engine substituting the $200,000 single threshold for an MFJ
    // filer (whose real threshold is $250,000) — the §A6 magic-number rule.
    for (const status of [
      "single",
      "married_jointly",
      "married_separately",
      "head_of_household",
      "qualifying_surviving_spouse",
    ]) {
      const missing = JSON.parse(readShard("fica-2024.json"));
      delete missing.additionalMedicareThresholdByFilingStatus[status];
      expect(FicaSchema.safeParse(missing).success).toBe(false);
    }
  });

  it("every shipped shard says what it leaves out", () => {
    // `sourceNote` is the prose the result card's "What these figures leave out"
    // disclosure renders. A shard without one shows a reader a number with no
    // indication of its limits — that a state's city income taxes are outside
    // this engine, that a credit could zero the figure out, that a $0 state
    // income tax says nothing about that state's sales and property taxes. Every
    // shard carries one as of the 2026-08-29 source audit; this keeps it true.
    const missing = manifest.datasets
      .filter((d) => {
        const shard = JSON.parse(shards[d.id]!) as { citation?: { sourceNote?: string } };
        return !shard.citation?.sourceNote?.trim();
      })
      .map((d) => d.id);
    expect(missing).toEqual([]);
  });

  it("keeps the sliding-deduction forms from being mixed (SC divisor vs WI rate vs WI two-segment)", () => {
    // Wisconsin is the shard that exercises every branch: two one-line statuses and
    // the two-segment head-of-household line. It must validate as shipped.
    const wi = JSON.parse(readShard("state-wi-income-tax-2024.json"));
    expect(JurisdictionSchema.safeParse(wi).success).toBe(true);

    // A status may carry the SC `divisor` form or the WI `reductionRate` form, never
    // both and never neither — otherwise the evaluator would silently pick a branch.
    const both = JSON.parse(readShard("state-wi-income-tax-2024.json"));
    both.standardDeductionPhaseOut.byFilingStatus.single.divisor = 116333;
    expect(JurisdictionSchema.safeParse(both).success).toBe(false);
    const neither = JSON.parse(readShard("state-wi-income-tax-2024.json"));
    delete neither.standardDeductionPhaseOut.byFilingStatus.single.reductionRate;
    expect(JurisdictionSchema.safeParse(neither).success).toBe(false);

    // The second segment is the WI head-of-household form: it is a flatter line
    // measured from the same threshold, so it is meaningless without a first rate.
    const orphanSegment = JSON.parse(readShard("state-wi-income-tax-2024.json"));
    const hoh = orphanSegment.standardDeductionPhaseOut.byFilingStatus.head_of_household;
    delete hoh.reductionRate;
    hoh.divisor = 80000;
    expect(JurisdictionSchema.safeParse(orphanSegment).success).toBe(false);
  });
});

describe("staleness fail-safe", () => {
  it("marks a dataset stale past its refresh window but keeps the data", async () => {
    // effectiveYear 2024, staleAfterYears 2 → stale once asOf > 2026.
    const result = await loadDataset(fedEntry, fedShard, 2030);
    expect(result.status).toBe("stale");
    expect(result.data).not.toBeNull();
    expect(needsVerifyBanner(result.status)).toBe(true);
  });

  it("is not stale within the window", async () => {
    const result = await loadDataset(fedEntry, fedShard, 2026);
    expect(result.status).toBe("ok");
  });
});

/**
 * The manifest's `effectiveYear` and the shard's own citation must name the
 * same year.
 *
 * The year lives in two places, and only one of them is the number a reader
 * ever sees. A shard states its year inside its citation — "Ohio Rev. Code
 * §5747.02(A)(3)(c) … for taxable years beginning in 2026" — while the manifest
 * entry that pins that shard states it again, from a separate table in
 * `scripts/build-manifest.ts`. Nothing compared them.
 *
 * The manifest's copy is what drives the **staleness gate**: `staleAfterYears`
 * is measured from it, so it decides whether a figure degrades loudly or keeps
 * rendering as current. Bump the table without rolling the shard and the site
 * reports last year's numbers as fresh — a silent wrong-figure failure, which is
 * the one class this repo is built to prevent. Roll the shard without the table
 * and a current figure lapses for no reason, which teaches people to ignore the
 * banner. Both are one-line mistakes, and the annual roll is the one recurring
 * maintenance task that touches every shard in the repo.
 *
 * They agreed across all 81 when this was written. Nothing had made them.
 */
describe("the year the manifest pins is the year the shard states", () => {
  /** Every `effectiveYear` that sits beside a `sourceUrl` — a real citation. */
  function citedYears(value: unknown, into = new Set<number>()): Set<number> {
    if (Array.isArray(value)) {
      for (const v of value) citedYears(v, into);
    } else if (value && typeof value === "object") {
      const record = value as Record<string, unknown>;
      if (typeof record.effectiveYear === "number" && typeof record.sourceUrl === "string") {
        into.add(record.effectiveYear);
      }
      for (const v of Object.values(record)) citedYears(v, into);
    }
    return into;
  }

  it("agrees for every shard the manifest pins", () => {
    const disagreements: string[] = [];
    for (const entry of manifest.datasets) {
      const years = citedYears(JSON.parse(shards[entry.id]!));
      if (years.size === 0) {
        disagreements.push(`${entry.id}: no cited effectiveYear anywhere in the shard`);
        continue;
      }
      // A shard may cite several documents — a state's brackets and its
      // standard deduction can be published separately — so the manifest's year
      // has to be one of them, not the only one.
      if (!years.has(entry.effectiveYear)) {
        disagreements.push(
          `${entry.id}: manifest says ${entry.effectiveYear}, shard cites ${[...years].sort().join(", ")}`,
        );
      }
    }
    expect(disagreements).toEqual([]);
    expect(manifest.datasets.length).toBeGreaterThan(80);
  });
});

/**
 * The sibling `.sha256` files are a published claim, and nothing checked them.
 *
 * Each shard ships beside a `data/<shard>.json.sha256`, and the README says so.
 * They exist for a reader who does not trust us: `shasum -a 256 -c` on a file
 * they downloaded, against a digest in the same repository, without running any
 * of our code. The runtime integrity gate does not use them — the loader
 * recomputes each shard's hash against the MANIFEST — so a sibling could drift
 * from the bytes beside it and every test here would stay green while the one
 * artifact a skeptic reaches for told them the file had been altered.
 *
 * Written by `npm run data:manifest` together with the manifest, so drift takes
 * a hand edit. The annual roll is exactly when hand edits happen, across all 81
 * at once. All three agreed when this was written.
 */
describe("every shard's published digest matches the bytes and the manifest", () => {
  it("agrees three ways: the file, its .sha256 sibling, and the manifest entry", () => {
    const problems: string[] = [];
    for (const entry of manifest.datasets) {
      const bytes = readFileSync(resolve(DATA_DIR, entry.shard));
      const actual = createHash("sha256").update(bytes).digest("hex");
      // `contentHash` is optional in the schema — a shard cannot contain its
      // own hash — but every entry the repo ships carries one, and an entry
      // that lost it would lose the runtime integrity gate silently.
      if (entry.contentHash === undefined) {
        problems.push(`${entry.id}: manifest entry pins no contentHash`);
      } else if (actual !== entry.contentHash) {
        problems.push(`${entry.id}: bytes hash ${actual}, manifest pins ${entry.contentHash}`);
      }
      let sibling: string;
      try {
        sibling = readFileSync(resolve(DATA_DIR, `${entry.shard}.sha256`), "utf8").trim();
      } catch {
        problems.push(`${entry.id}: no ${entry.shard}.sha256 beside the shard`);
        continue;
      }
      if (sibling !== actual) {
        problems.push(`${entry.id}: ${entry.shard}.sha256 says ${sibling}, bytes hash ${actual}`);
      }
    }
    expect(problems).toEqual([]);
  });
});
