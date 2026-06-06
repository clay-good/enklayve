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
  type CapitalGainsData,
  type CpiData,
  type RmdData,
  type TreasuryBondsData,
  type SaversCreditData,
  type SnapData,
  type MedicaidData,
  type SocialSecurityData,
  type AcaData,
  type FafsaData,
  type IraDeductionData,
  type GiftTaxData,
  type AmtData,
  type ChildTaxData,
  type EducationCreditsData,
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
  /** Long-term capital-gains brackets and NIIT thresholds (BUILD-SPEC.md §3.2). */
  capitalGains(): CapitalGainsData | null;
  /** CPI-U annual averages for inflation adjustment (BUILD-SPEC.md §3.4). */
  cpi(): CpiData | null;
  /** IRS Uniform Lifetime Table for RMDs (BUILD-SPEC.md §3.4). */
  rmd(): RmdData | null;
  /** Treasury I-bond / savings-bond fixed + inflation rates (BUILD-SPEC.md §3.4). */
  treasuryBonds(): TreasuryBondsData | null;
  /** Federal Poverty Level guidelines for a region (BUILD-SPEC.md §4.1). */
  fpl(region: FplRegion): FederalPovertyLevelData | null;
  /** EITC and Child Tax Credit parameters (BUILD-SPEC.md §4.2). */
  eitcCtc(): EitcCtcData | null;
  /** Saver's Credit tiers and contribution cap (BUILD-SPEC.md §4.2). */
  saversCredit(): SaversCreditData | null;
  /** SNAP allotments, deductions, and income tests (BUILD-SPEC.md §4.3). */
  snap(): SnapData | null;
  /** Medicaid expansion status and thresholds by state (BUILD-SPEC.md §4.3). */
  medicaid(): MedicaidData | null;
  /** ACA premium-tax-credit applicable-percentage table (BUILD-SPEC.md §4.2). */
  aca(): AcaData | null;
  /** Social Security claiming-age benefit adjustment rules (BUILD-SPEC-2 §6.7). */
  socialSecurity(): SocialSecurityData | null;
  /** FAFSA Student Aid Index tables and Pell schedule (BUILD-SPEC.md §4.4). */
  fafsa(): FafsaData | null;
  /** Traditional-IRA deduction phase-out ranges (SPEC-3 §4.3). */
  iraDeduction(): IraDeductionData | null;
  /** Annual gift-tax exclusion and lifetime gift/estate exemption (SPEC-3 §4.4). */
  giftTax(): GiftTaxData | null;
  /** AMT exemption, phase-out, and rate breakpoint (SPEC-3 §4.7). */
  amt(): AmtData | null;
  /** Child-tax dependent shelter and earned-income add-on (SPEC-3 §4.5). */
  childTax(): ChildTaxData | null;
  /** AOTC / Lifetime Learning Credit parameters (SPEC-3 §4.6). */
  educationCredits(): EducationCreditsData | null;
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
    capitalGains: () => dataOf("capital-gains-2024") as CapitalGainsData | null,
    cpi: () => dataOf("cpi-u-annual") as CpiData | null,
    rmd: () => dataOf("rmd-uniform-lifetime-2024") as RmdData | null,
    treasuryBonds: () => dataOf("treasury-bonds-2024") as TreasuryBondsData | null,
    fpl: (region) =>
      dataOf(`federal-poverty-level-2024-${region}`) as FederalPovertyLevelData | null,
    eitcCtc: () => dataOf("eitc-ctc-2024") as EitcCtcData | null,
    saversCredit: () => dataOf("savers-credit-2024") as SaversCreditData | null,
    snap: () => dataOf("snap-fy2024-contiguous") as SnapData | null,
    medicaid: () => dataOf("medicaid-2024") as MedicaidData | null,
    aca: () => dataOf("aca-2024") as AcaData | null,
    socialSecurity: () => dataOf("social-security-2024") as SocialSecurityData | null,
    fafsa: () => dataOf("fafsa-2024-2025") as FafsaData | null,
    iraDeduction: () => dataOf("ira-deduction-2024") as IraDeductionData | null,
    giftTax: () => dataOf("gift-tax-2024") as GiftTaxData | null,
    amt: () => dataOf("amt-2024") as AmtData | null,
    childTax: () => dataOf("child-tax-2024") as ChildTaxData | null,
    educationCredits: () => dataOf("education-credits-2024") as EducationCreditsData | null,
    state: (code) => dataOf(`state-${code.toLowerCase()}-income-tax-2024`) as Jurisdiction | null,
    statusOf: (id) => loaded.byId.get(id)?.status ?? "missing",
    stateCodes: () =>
      loaded.datasets
        .map((d) => /^state-([a-z]{2})-income-tax/.exec(d.id)?.[1])
        .filter((c): c is string => c !== undefined),
  };
}
