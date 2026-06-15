import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadDataset, loadManifest, needsVerifyBanner } from "../src/data/loader";
import {
  FicaSchema,
  ManifestSchema,
  RetirementLimitsSchema,
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
