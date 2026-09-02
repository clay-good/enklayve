import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadManifest } from "../../src/data/loader";
import {
  ManifestSchema,
  type FicaData,
  type Jurisdiction,
  type CapitalGainsData,
  type CpiData,
  type RmdData,
  type SocialSecurityData,
  type TreasuryBondsData,
} from "../../src/data/schemas";

/**
 * Load every bundled dataset through the real loader (hash + schema + staleness
 * gate) and expose typed accessors for the tax engine tests. A fixed `asOfYear`
 * keeps staleness from flipping the suite red as wall-clock time advances.
 */
const DATA_DIR = resolve(__dirname, "..", "..", "data");
const read = (file: string): string => readFileSync(resolve(DATA_DIR, file), "utf8");

const manifest = ManifestSchema.parse(JSON.parse(read("manifest.json")));
const shards: Record<string, string> = Object.fromEntries(
  manifest.datasets.map((d) => [d.id, read(d.shard)]),
);

export interface Datasets {
  federal: Jurisdiction;
  fica: FicaData;
  state(code: string): Jurisdiction;
  capitalGains: CapitalGainsData;
  cpi: CpiData;
  rmd: RmdData;
  socialSecurity: SocialSecurityData;
  treasuryBonds: TreasuryBondsData;
}

let cached: Datasets | null = null;

/**
 * Which jurisdictions a suite actually asked for.
 *
 * The hand-verified state cases cover all 51 today because somebody kept them
 * covered, and nothing said so. A 52nd shard could arrive with no case, or a
 * refactor could drop the only case a state had, and every test would stay
 * green — the README would go on claiming the fifty-state moat is golden-tested
 * while one jurisdiction was computed by nobody. Recording the requests is what
 * lets `states.test.ts` end by asserting its own completeness, structurally,
 * rather than by a list someone has to remember to extend.
 */
export const jurisdictionsRequested = new Set<string>();

/** Every state shard the repo ships, by two-letter code. */
export function shippedStateCodes(): string[] {
  return manifest.datasets
    .map((d) => /^state-([a-z]{2})-income-tax-/.exec(d.id)?.[1])
    .filter((c): c is string => c !== undefined)
    .sort();
}

export async function loadDatasets(): Promise<Datasets> {
  if (cached) return cached;
  const loaded = await loadManifest(manifest, shards, 2025);
  if (loaded.hasFailSafe) {
    const bad = loaded.datasets
      .filter((d) => d.status !== "ok")
      .map((d) => `${d.id} (${d.status}): ${d.problems.join(", ")}`);
    throw new Error(`dataset fail-safe triggered:\n${bad.join("\n")}`);
  }
  const get = (id: string): unknown => loaded.byId.get(id)?.data;
  cached = {
    federal: get("federal-income-tax-2024") as Jurisdiction,
    fica: get("fica-2024") as FicaData,
    state: (code: string) => {
      jurisdictionsRequested.add(code);
      return get(`state-${code}-income-tax-2024`) as Jurisdiction;
    },
    capitalGains: get("capital-gains-2024") as CapitalGainsData,
    cpi: get("cpi-u-annual") as CpiData,
    rmd: get("rmd-uniform-lifetime-2024") as RmdData,
    socialSecurity: get("social-security-2024") as SocialSecurityData,
    treasuryBonds: get("treasury-bonds-2024") as TreasuryBondsData,
  };
  return cached;
}
