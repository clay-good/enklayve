/**
 * Generate data/manifest.json and the sibling .sha256 files from the shard
 * sources. The manifest is the single source of truth for dataset provenance
 * and integrity (BUILD-SPEC.md §7.1): this script computes the sha256 of each
 * shard's exact bytes and pins it. Run with `npm run data:manifest` whenever a
 * shard changes, then commit the regenerated manifest and .sha256 files.
 *
 * Node 20+/25 runs this .ts file directly via native type stripping.
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const DATA_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..", "data");

interface ShardDef {
  id: string;
  kind: string;
  version: string;
  effectiveYear: number;
  expectedRefreshMonths: number;
  staleAfterYears: number;
  shard: string;
  sourceUrl: string;
  sourceDocument: string;
  dateRetrieved: string;
}

// The bundled shards. Add an entry here when seeding a new dataset.
const SHARDS: ShardDef[] = [
  {
    id: "federal-income-tax-2024",
    kind: "federal-income-tax",
    version: "2024.0",
    effectiveYear: 2024,
    expectedRefreshMonths: 12,
    staleAfterYears: 2,
    shard: "federal-income-tax-2024.json",
    sourceUrl: "https://www.irs.gov/pub/irs-drop/rp-23-34.pdf",
    sourceDocument: "IRS Revenue Procedure 2023-34 (2024 inflation adjustments)",
    dateRetrieved: "2024-02-01",
  },
  {
    id: "state-ca-income-tax-2024",
    kind: "state-income-tax",
    version: "2024.0",
    effectiveYear: 2024,
    expectedRefreshMonths: 12,
    staleAfterYears: 2,
    shard: "state-ca-income-tax-2024.json",
    sourceUrl: "https://www.ftb.ca.gov/forms/2024/2024-540-tax-rate-schedules.html",
    sourceDocument: "California FTB 2024 Tax Rate Schedules",
    dateRetrieved: "2024-02-01",
  },
];

function sha256Hex(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

const datasets = SHARDS.map((def) => {
  const shardPath = resolve(DATA_DIR, def.shard);
  const bytes = readFileSync(shardPath);
  const contentHash = sha256Hex(bytes);
  // Sibling hash file, per BUILD-SPEC.md §7.1.
  writeFileSync(`${shardPath}.sha256`, `${contentHash}\n`, "utf8");
  return { ...def, contentHash };
});

const manifest = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString().slice(0, 10),
  datasets,
};

writeFileSync(resolve(DATA_DIR, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

console.log(`Wrote manifest with ${datasets.length} datasets:`);
for (const d of datasets) {
  console.log(`  ${d.id}  ${d.contentHash.slice(0, 16)}…`);
}
