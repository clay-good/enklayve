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

interface ShardSource {
  id: string;
  kind: string;
  shard: string;
  effectiveYear: number;
  expectedRefreshMonths: number;
  staleAfterYears: number;
}

// The ten most populous states plus DC (BUILD-SPEC.md §14). Adding a state is a
// data file plus one code here — no engine change.
const STATE_CODES = ["ca", "ny", "tx", "fl", "pa", "il", "oh", "ga", "nc", "mi", "dc"];

const ANNUAL = { effectiveYear: 2024, expectedRefreshMonths: 12, staleAfterYears: 2 } as const;

// The bundled shards. Source citation metadata is read from each shard's own
// `citation` block below, so it is never duplicated here.
const SHARDS: ShardSource[] = [
  {
    id: "federal-income-tax-2024",
    kind: "federal-income-tax",
    shard: "federal-income-tax-2024.json",
    ...ANNUAL,
  },
  { id: "fica-2024", kind: "fica", shard: "fica-2024.json", ...ANNUAL },
  ...STATE_CODES.map((code) => ({
    id: `state-${code}-income-tax-2024`,
    kind: "state-income-tax",
    shard: `state-${code}-income-tax-2024.json`,
    ...ANNUAL,
  })),
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
  const parsed = JSON.parse(bytes.toString("utf8")) as {
    citation: { sourceUrl: string; sourceDocument: string; dateRetrieved: string };
  };
  return {
    id: def.id,
    kind: def.kind,
    version: `${def.effectiveYear}.0`,
    effectiveYear: def.effectiveYear,
    expectedRefreshMonths: def.expectedRefreshMonths,
    staleAfterYears: def.staleAfterYears,
    shard: def.shard,
    sourceUrl: parsed.citation.sourceUrl,
    sourceDocument: parsed.citation.sourceDocument,
    dateRetrieved: parsed.citation.dateRetrieved,
    contentHash,
  };
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
