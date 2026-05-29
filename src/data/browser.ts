/**
 * Browser-side dataset bundling (BUILD-SPEC.md §2 principle 2, §7).
 *
 * The strict CSP sets `connect-src 'none'`: the page physically cannot fetch
 * data at runtime. So every shard is inlined into the build at compile time via
 * Vite's `?raw` glob, then run through the SAME integrity + schema + staleness
 * gate (`loadManifest`) the tests use. The raw text is the exact bytes the
 * manifest hash was computed over, so the hash check is meaningful in the browser.
 */
import { loadManifest, type LoadedManifest, type DatasetStatus } from "./loader";
import {
  ManifestSchema,
  type FicaData,
  type Jurisdiction,
  type RetirementLimitsData,
  type EitcCtcData,
  type FederalPovertyLevelData,
} from "./schemas";

/** Federal Poverty Level region (BUILD-SPEC.md §4.1). */
export type FplRegion = "contiguous" | "alaska" | "hawaii";

// Inlined at build time. The keys are repo-relative paths; the values are the
// exact file contents. eager so the data is available synchronously after import.
const rawFiles = import.meta.glob("../../data/*.json", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

function basename(path: string): string {
  const segments = path.split("/");
  return segments[segments.length - 1] ?? path;
}

/** Typed, gated accessors over the bundled datasets for the tiles. */
export interface BundledData {
  readonly manifest: LoadedManifest;
  federal(): Jurisdiction | null;
  fica(): FicaData | null;
  /** IRS retirement / HSA / FSA contribution limits (BUILD-SPEC.md §3.4). */
  retirementLimits(): RetirementLimitsData | null;
  /** Federal Poverty Level guidelines for a region (BUILD-SPEC.md §4.1). */
  fpl(region: FplRegion): FederalPovertyLevelData | null;
  /** EITC and Child Tax Credit parameters (BUILD-SPEC.md §4.2). */
  eitcCtc(): EitcCtcData | null;
  /** A state jurisdiction by two-letter code (e.g. "ca"); null if unavailable. */
  state(code: string): Jurisdiction | null;
  /** Status for a dataset id, for the fail-safe verify banner. */
  statusOf(id: string): DatasetStatus | "missing";
  /** Two-letter codes of every bundled state jurisdiction, in manifest order. */
  stateCodes(): string[];
}

let cache: Promise<BundledData> | null = null;

/** Load and gate every bundled dataset. Cached after the first call. */
export function loadBundledData(): Promise<BundledData> {
  if (cache) return cache;
  cache = build();
  return cache;
}

async function build(): Promise<BundledData> {
  const byName = new Map<string, string>();
  for (const [path, text] of Object.entries(rawFiles)) byName.set(basename(path), text);

  const manifestText = byName.get("manifest.json");
  if (manifestText === undefined) throw new Error("manifest.json was not bundled");
  const manifest = ManifestSchema.parse(JSON.parse(manifestText));

  const shards: Record<string, string> = {};
  for (const entry of manifest.datasets) {
    const text = byName.get(entry.shard);
    if (text !== undefined) shards[entry.id] = text;
  }

  const loaded = await loadManifest(manifest, shards);

  const dataOf = (id: string): unknown => {
    const ds = loaded.byId.get(id);
    return ds && ds.status !== "invalid" ? ds.data : null;
  };

  return {
    manifest: loaded,
    federal: () => dataOf("federal-income-tax-2024") as Jurisdiction | null,
    fica: () => dataOf("fica-2024") as FicaData | null,
    retirementLimits: () => dataOf("retirement-limits-2024") as RetirementLimitsData | null,
    fpl: (region) =>
      dataOf(`federal-poverty-level-2024-${region}`) as FederalPovertyLevelData | null,
    eitcCtc: () => dataOf("eitc-ctc-2024") as EitcCtcData | null,
    state: (code) => dataOf(`state-${code.toLowerCase()}-income-tax-2024`) as Jurisdiction | null,
    statusOf: (id) => loaded.byId.get(id)?.status ?? "missing",
    stateCodes: () =>
      loaded.datasets
        .map((d) => /^state-([a-z]{2})-income-tax/.exec(d.id)?.[1])
        .filter((c): c is string => c !== undefined),
  };
}
