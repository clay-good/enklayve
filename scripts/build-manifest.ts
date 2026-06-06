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

// Adding a state is a data file plus one code here — no engine change
// (BUILD-SPEC.md §8). The roster grows through the staggered annual refresh
// (§14.3), in three layers:
//   1. The ten most populous states + DC, seeded at launch (CA, NY, TX, FL, PA,
//      IL, OH, GA, NC, MI, DC).
//   2. Every no-income-tax state as a first-class record (AK, NV, NH, SD, TN,
//      WA, WY join TX and FL) so a resident sees their state by name with $0
//      confirmed, not a generic "no state tax modeled".
//   3. "Fill in the rest": additional income-tax states as their 2024 schedules
//      are transcribed and golden-tested. The flat-rate wave — AZ, CO, IN, KY,
//      MA (5% + the 4% surtax over $1,053,750), MS (4.7% over $10,000) — is in,
//      plus ID (5.3% flat, HB 40 2025, federal-conformity standard deduction),
//      UT (4.45% flat, SB 60 2026, with the taxpayer tax credit standing in for
//      a standard deduction), LA (3% flat, Act 11 2024, with a $12,875 / $25,750
//      standard deduction, CPI-indexed for 2026), and IA (3.8% flat, SF 2442
//      2024, federal-conformity standard deduction like ID).
const STATE_CODES = [
  "ca",
  "ny",
  "tx",
  "fl",
  "pa",
  "il",
  "oh",
  "ga",
  "nc",
  "mi",
  "dc",
  "ak",
  "nv",
  "nh",
  "sd",
  "tn",
  "wa",
  "wy",
  "az",
  "co",
  "in",
  "ky",
  "ma",
  "ms",
  "id",
  "ut",
  "la",
  "ia",
  "va",
  "mo",
  "nj",
  "mn",
  "ks",
  "de",
];

const ANNUAL = { effectiveYear: 2026, expectedRefreshMonths: 12, staleAfterYears: 2 } as const;
// Treasury I-bond rates reset every six months (BUILD-SPEC.md §7.2: May and
// November). The semiannual cadence is the only difference from ANNUAL.
const SEMIANNUAL = { effectiveYear: 2026, expectedRefreshMonths: 6, staleAfterYears: 2 } as const;

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
  {
    id: "retirement-limits-2024",
    kind: "retirement-limits",
    shard: "retirement-limits-2024.json",
    ...ANNUAL,
  },
  {
    id: "capital-gains-2024",
    kind: "capital-gains",
    shard: "capital-gains-2024.json",
    ...ANNUAL,
  },
  {
    id: "rmd-uniform-lifetime-2024",
    kind: "rmd",
    shard: "rmd-uniform-lifetime-2024.json",
    ...ANNUAL,
  },
  // Treasury I-bond / savings-bond rates (BUILD-SPEC.md §3.4, §7.2; Pillars 1 & 3).
  {
    id: "treasury-bonds-2024",
    kind: "treasury-bonds",
    shard: "treasury-bonds-2024.json",
    ...SEMIANNUAL,
  },
  // CPI-U refreshes monthly (BUILD-SPEC.md §7.2); the latest annual average is
  // effective for the current year and stays usable for prior-year adjustments.
  {
    id: "cpi-u-annual",
    kind: "cpi",
    shard: "cpi-u-annual.json",
    effectiveYear: 2025,
    expectedRefreshMonths: 1,
    staleAfterYears: 2,
  },
  ...STATE_CODES.map((code) => ({
    id: `state-${code}-income-tax-2024`,
    kind: "state-income-tax",
    shard: `state-${code}-income-tax-2024.json`,
    ...ANNUAL,
  })),
  // Pillar 2 — What You're Owed (§4).
  ...(["contiguous", "alaska", "hawaii"] as const).map((region) => ({
    id: `federal-poverty-level-2024-${region}`,
    kind: "federal-poverty-level",
    shard: `federal-poverty-level-2024-${region}.json`,
    ...ANNUAL,
  })),
  { id: "eitc-ctc-2024", kind: "eitc-ctc", shard: "eitc-ctc-2024.json", ...ANNUAL },
  {
    id: "savers-credit-2024",
    kind: "savers-credit",
    shard: "savers-credit-2024.json",
    ...ANNUAL,
  },
  { id: "snap-fy2024-contiguous", kind: "snap", shard: "snap-fy2024-contiguous.json", ...ANNUAL },
  { id: "medicaid-2024", kind: "medicaid", shard: "medicaid-2024.json", ...ANNUAL },
  { id: "aca-2024", kind: "aca", shard: "aca-2024.json", ...ANNUAL },
  { id: "fafsa-2024-2025", kind: "fafsa", shard: "fafsa-2024-2025.json", ...ANNUAL },
  // Pillar 3 / long-horizon (§6.7) — Social Security claiming.
  {
    id: "social-security-2024",
    kind: "social-security",
    shard: "social-security-2024.json",
    ...ANNUAL,
  },
  // SPEC-3 §4 next-wave tools — deterministic screeners over cited IRS figures.
  {
    id: "ira-deduction-2024",
    kind: "ira-deduction",
    shard: "ira-deduction-2024.json",
    ...ANNUAL,
  },
  { id: "gift-tax-2024", kind: "gift-tax", shard: "gift-tax-2024.json", ...ANNUAL },
  { id: "amt-2024", kind: "amt", shard: "amt-2024.json", ...ANNUAL },
  { id: "kiddie-tax-2024", kind: "kiddie-tax", shard: "kiddie-tax-2024.json", ...ANNUAL },
  {
    id: "education-credits-2024",
    kind: "education-credits",
    shard: "education-credits-2024.json",
    ...ANNUAL,
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
