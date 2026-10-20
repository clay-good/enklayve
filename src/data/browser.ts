/**
 * Browser-side dataset bundling (BUILD-SPEC.md §2 principle 2, §7).
 *
 * The strict CSP sets `connect-src 'none'`: the page physically cannot fetch
 * data at runtime. So every shard is inlined into the build at compile time via
 * Vite's `?raw` glob, then run through the SAME integrity + schema + staleness
 * gate (`loadManifest`) the tests use. The raw text is the exact bytes the
 * manifest hash was computed over, so the hash check is meaningful in the browser.
 */
import {
  loadDataset,
  loadManifest,
  pastWindow,
  type LoadedDataset,
  type LoadedManifest,
  type DatasetStatus,
} from "./loader";
import {
  ManifestSchema,
  type ManifestEntry,
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
  type FplKeyedProgramsData,
  type BillTriageData,
  type FreeFilingData,
  type NoSurprisesData,
  type GarnishmentLimitsData,
  type StateUiData,
  type EnrollmentWindowsData,
  type LifeEventsData,
  type SocialSecurityData,
  type SocialSecurityTaxationData,
  type AcaData,
  type FafsaData,
  type IraDeductionData,
  type GiftTaxData,
  type TrumpAccountData,
  type PmiCancellationData,
  type HomeSaleExclusionData,
  type EarlyDistributionData,
  type SeparationRulesData,
  type SupplementalWithholdingData,
  type UiTaxationData,
  type MedicareCostsData,
  type SsEarningsTestData,
  type SsFamilyBenefitsData,
  type SsiData,
  type MedicareSavingsData,
  type DependentCareData,
  type AmtData,
  type ChildTaxData,
  type EducationCreditsData,
} from "./schemas";

/** Federal Poverty Level region (BUILD-SPEC.md §4.1). */
export type FplRegion = "contiguous" | "alaska" | "hawaii";

function basename(path: string): string {
  const segments = path.split("/");
  return segments[segments.length - 1] ?? path;
}

// Inlined at build time. The keys are repo-relative paths; the values are the
// exact file contents. eager so the data is available synchronously after import.
// The exclusions are exactly the deferred list below; a test holds the two
// together, since a shard in neither would be silently missing and a shard in
// both would be paid for twice.
const rawFiles = import.meta.glob(
  ["../../data/*.json", "!../../data/state-ui-*.json", "!../../data/pmi-cancellation-2026.json",
    "!../../data/home-sale-exclusion-2026.json",
    "!../../data/early-distribution-2026.json",
    "!../../data/separation-rules-2026.json",
    "!../../data/supplemental-withholding-2026.json",
    "!../../data/ui-taxation-2026.json",
    "!../../data/medicare-costs-2026.json",
    "!../../data/ss-earnings-test-2026.json",
    "!../../data/ss-family-benefits-2026.json",
    "!../../data/ssi-2026.json",
    "!../../data/medicare-savings-2026.json",
    "!../../data/dependent-care-2026.json",
    "!../../data/fpl-keyed-programs-2026.json"],
  { query: "?raw", import: "default", eager: true },
) as Record<string, string>;

// Shards a reader needs only after choosing a tool or a state, one chunk each,
// imported on first request rather than precached with the shell: the
// unemployment rules (SPEC-4-safety-net §B5) and SPEC-5's tools (§7.5). Each is
// a same-origin script chunk, so `connect-src 'none'` still holds, and each is
// the shard's exact text, so the manifest hash is checked over the bytes that
// were reviewed, exactly as for an inlined shard. The service worker caches a
// chunk on first use, so a shard opened once works offline afterwards.
const deferredFiles = import.meta.glob(
  ["../../data/state-ui-*.json", "../../data/pmi-cancellation-2026.json",
    "../../data/home-sale-exclusion-2026.json",
    "../../data/early-distribution-2026.json",
    "../../data/separation-rules-2026.json",
    "../../data/supplemental-withholding-2026.json",
    "../../data/ui-taxation-2026.json",
    "../../data/medicare-costs-2026.json",
    "../../data/ss-earnings-test-2026.json",
    "../../data/ss-family-benefits-2026.json",
    "../../data/ssi-2026.json",
    "../../data/medicare-savings-2026.json",
    "../../data/dependent-care-2026.json",
    "../../data/fpl-keyed-programs-2026.json",
  ],
  { query: "?raw", import: "default" },
) as Record<string, () => Promise<string>>;

/** The data files each path loads by, for the test that holds them together. */
export const EAGER_SHARD_FILES = Object.keys(rawFiles).map(basename);
export const DEFERRED_SHARD_FILES = Object.keys(deferredFiles).map(basename);

const UI_ID = /^state-ui-([a-z]{2})-\d{4}$/;


/** Typed, gated accessors over the bundled datasets for the tiles. */
export interface BundledData {
  readonly manifest: LoadedManifest;
  /**
   * Datasets whose effective year has fallen outside their staleness window.
   * The loader has always computed this; nothing consumed it, so a shard could
   * pass its window and keep rendering as though it were current. It matters
   * most for the Pillar 4 shards pinned at `staleAfterYears: 0` — a COBRA
   * election window or a garnishment ceiling is exactly the figure that must
   * degrade loudly rather than quietly (SPEC-3 §2.5, SPEC-4 §10.5).
   */
  staleDatasets(): { id: string; effectiveYear: number }[];
  /**
   * Datasets that failed their integrity or schema gate — a content hash that
   * does not match the manifest, or a shard that no longer parses. `dataOf`
   * already refuses to compute from these, so a tile shows its "unavailable"
   * banner; nothing said *why*, which for a hash mismatch is the single most
   * important fact on the page. A stale figure is old. An invalid one may have
   * been altered.
   */
  invalidDatasets(): { id: string; problems: string[] }[];
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
  fplKeyedPrograms(): FplKeyedProgramsData | null;
  /** Bill-triage consequence rules (SPEC-4 §A3). */
  billTriage(): BillTriageData | null;
  /** Free tax-filing channels and their eligibility tests (SPEC-4 §A5). */
  freeFiling(): FreeFilingData | null;
  noSurprises(): NoSurprisesData | null;
  garnishmentLimits(): GarnishmentLimitsData | null;
  enrollmentWindows(): EnrollmentWindowsData | null;
  lifeEvents(): LifeEventsData | null;
  /** ACA premium-tax-credit applicable-percentage table (BUILD-SPEC.md §4.2). */
  aca(): AcaData | null;
  /** Social Security claiming-age benefit adjustment rules (BUILD-SPEC-2 §6.7). */
  socialSecurity(): SocialSecurityData | null;
  /** Social Security benefit taxation base amounts (IRC §86, Pub. 915). */
  socialSecurityTaxation(): SocialSecurityTaxationData | null;
  /** FAFSA Student Aid Index tables and Pell schedule (BUILD-SPEC.md §4.4). */
  fafsa(): FafsaData | null;
  /** Traditional-IRA deduction phase-out ranges (SPEC-3 §4.3). */
  iraDeduction(): IraDeductionData | null;
  /** Annual gift-tax exclusion and lifetime gift/estate exemption (SPEC-3 §4.4). */
  giftTax(): GiftTaxData | null;
  /** IRC §530A accounts and the §6434 pilot contribution. */
  trumpAccounts(): TrumpAccountData | null;
  /** The Homeowners Protection Act's PMI cancellation lines (SPEC-5 Phase 28).
   * Deferred: null until `loadDeferred("pmi-cancellation-2026")` has resolved. */
  pmiCancellation(): PmiCancellationData | null;
  /** IRC §121's home-sale exclusion (SPEC-5 Phase 28). Deferred, as above. */
  homeSaleExclusion(): HomeSaleExclusionData | null;
  /** IRC §72(t) and §3405(c) for an early cash-out (SPEC-5 Phase 28). Deferred. */
  earlyDistribution(): EarlyDistributionData | null;
  /** COBRA's premium ceilings (SPEC-5 Phase 28). Deferred. */
  separationRules(): SeparationRulesData | null;
  /** Supplemental-wage withholding, Pub. 15 §7 (SPEC-5 layoff-month J4). Deferred. */
  supplementalWithholding(): SupplementalWithholdingData | null;
  /** How unemployment benefits are taxed, federally and by state (SPEC-5 J3). Deferred. */
  uiTaxation(): UiTaxationData | null;
  /** Medicare's Part B premium and IRMAA tiers (SPEC-5 Phase 29). Deferred. */
  medicareCosts(): MedicareCostsData | null;
  /** Social Security's retirement earnings test (SPEC-5 later-life L3). Deferred. */
  ssEarningsTest(): SsEarningsTestData | null;
  /** Spousal and survivor reductions (SPEC-5 later-life L4). Deferred. */
  ssFamilyBenefits(): SsFamilyBenefitsData | null;
  /** The federal SSI payment and exclusions (SPEC-5 later-life L6). Deferred. */
  ssi(): SsiData | null;
  medicareSavings(): MedicareSavingsData | null;
  dependentCare(): DependentCareData | null;
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
  /**
   * One state's unemployment-insurance rules (SPEC-4-safety-net §B5), loaded on
   * first request and gated like every other shard: null where no rule set is
   * bundled, otherwise the dataset with its status, so an altered shard is
   * reported as one rather than as a state with no rules.
   */
  loadStateUi(code: string): Promise<LoadedDataset<StateUiData> | null>;
  /** The same, synchronously, once loaded; undefined while it has not been. */
  loadedStateUi(code: string): LoadedDataset<StateUiData> | null | undefined;
  /** Codes of the states with a bundled unemployment-insurance rule set. */
  stateUiCodes(): string[];
  /**
   * Any deferred shard by dataset id, loaded on first request and gated like
   * every other shard (SPEC-5 §7.5): null where the id is not deferred.
   */
  loadDeferred(id: string): Promise<LoadedDataset | null>;
  /** The same, synchronously, once loaded; undefined while it has not been. */
  loadedDeferred(id: string): LoadedDataset | null | undefined;
}

/**
 * The screener's and the Report's programs keyed to the poverty line (SPEC-5
 * F4). Deferred like a tool's shard, to keep 1.7 kB out of the shell, but
 * started as soon as the app has its data rather than when a tool opens: two
 * surfaces read it, and the Report and the Readout wait for it so that a
 * ledger is never written or compared with it half loaded.
 */
export const FPL_KEYED_PROGRAMS = "fpl-keyed-programs-2026";

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

  // The deferred shards are gated when they load, so the eager gate leaves them
  // out rather than reporting them missing. Their staleness needs only the
  // manifest, so the site-wide banner still names a stale one before it loads.
  const deferredNames = new Set(DEFERRED_SHARD_FILES);
  const deferred = new Map<string, ManifestEntry>();
  for (const entry of manifest.datasets)
    if (deferredNames.has(entry.shard)) deferred.set(entry.id, entry);
  const uiIds = new Map<string, string>();
  for (const id of deferred.keys()) {
    const code = UI_ID.exec(id)?.[1];
    if (code !== undefined) uiIds.set(code, id);
  }
  const loaded = await loadManifest(
    { ...manifest, datasets: manifest.datasets.filter((e) => !deferred.has(e.id)) },
    shards,
  );
  const deferredLoads = new Map<string, Promise<LoadedDataset>>();
  const deferredLoaded = new Map<string, LoadedDataset>();

  const loadDeferred = (id: string): Promise<LoadedDataset | null> => {
    const entry = deferred.get(id);
    if (entry === undefined) return Promise.resolve(null);
    let pending = deferredLoads.get(id);
    if (pending === undefined) {
      const importer = deferredFiles[`../../data/${entry.shard}`];
      pending = (
        importer === undefined
          ? Promise.reject(new Error(`shard "${entry.shard}" not bundled`))
          : importer().then((text) => loadDataset(entry, text))
      ).then(
        (ds) => ds,
        (err: unknown): LoadedDataset => ({
          id: entry.id,
          kind: entry.kind,
          version: entry.version,
          status: "invalid",
          effectiveYear: entry.effectiveYear,
          data: null,
          problems: [`could not load: ${(err as Error).message}`],
        }),
      );
      pending.then((ds) => deferredLoaded.set(id, ds));
      deferredLoads.set(id, pending);
    }
    return pending;
  };
  const loadedDeferred = (id: string): LoadedDataset | null | undefined =>
    deferred.has(id) ? deferredLoaded.get(id) : null;
  /** Data from a loaded deferred shard, or null when it is unloaded or invalid. */
  const deferredDataOf = (id: string): unknown => {
    const ds = deferredLoaded.get(id);
    return ds && ds.status !== "invalid" ? ds.data : null;
  };

  const dataOf = (id: string): unknown => {
    const ds = loaded.byId.get(id);
    return ds && ds.status !== "invalid" ? ds.data : null;
  };

  return {
    manifest: loaded,
    staleDatasets: () => [
      ...loaded.datasets
        .filter((d) => d.status === "stale")
        .map((d) => ({ id: d.id, effectiveYear: d.effectiveYear })),
      ...[...deferred.values()]
        .filter((e) => pastWindow(e))
        .map((e) => ({ id: e.id, effectiveYear: e.effectiveYear })),
    ],
    invalidDatasets: () =>
      [...loaded.datasets, ...deferredLoaded.values()]
        .filter((d) => d.status === "invalid")
        .map((d) => ({ id: d.id, problems: d.problems })),
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
    fplKeyedPrograms: () =>
      deferredDataOf(FPL_KEYED_PROGRAMS) as FplKeyedProgramsData | null,
    billTriage: () => dataOf("bill-triage-2026") as BillTriageData | null,
    freeFiling: () => dataOf("free-filing-2026") as FreeFilingData | null,
    noSurprises: () => dataOf("no-surprises-2026") as NoSurprisesData | null,
    garnishmentLimits: () => dataOf("garnishment-limits-2026") as GarnishmentLimitsData | null,
    loadDeferred,
    loadedDeferred,
    loadStateUi: (code) => {
      const id = uiIds.get(code.toLowerCase());
      return id === undefined
        ? Promise.resolve(null)
        : (loadDeferred(id) as Promise<LoadedDataset<StateUiData>>);
    },
    loadedStateUi: (code) => {
      const id = uiIds.get(code.toLowerCase());
      return id === undefined ? null : (loadedDeferred(id) as LoadedDataset<StateUiData> | undefined);
    },
    stateUiCodes: () => [...uiIds.keys()],
    enrollmentWindows: () => dataOf("enrollment-windows-2026") as EnrollmentWindowsData | null,
    lifeEvents: () => dataOf("life-events-2026") as LifeEventsData | null,
    aca: () => dataOf("aca-2024") as AcaData | null,
    socialSecurity: () => dataOf("social-security-2024") as SocialSecurityData | null,
    socialSecurityTaxation: () =>
      dataOf("social-security-taxation-2024") as SocialSecurityTaxationData | null,
    fafsa: () => dataOf("fafsa-2024-2025") as FafsaData | null,
    iraDeduction: () => dataOf("ira-deduction-2024") as IraDeductionData | null,
    giftTax: () => dataOf("gift-tax-2024") as GiftTaxData | null,
    trumpAccounts: () => dataOf("trump-accounts-2026") as TrumpAccountData | null,
    pmiCancellation: () => deferredDataOf("pmi-cancellation-2026") as PmiCancellationData | null,
    ssi: () => deferredDataOf("ssi-2026") as SsiData | null,
    medicareSavings: () =>
      deferredDataOf("medicare-savings-2026") as MedicareSavingsData | null,
    dependentCare: () => deferredDataOf("dependent-care-2026") as DependentCareData | null,
    ssFamilyBenefits: () =>
      deferredDataOf("ss-family-benefits-2026") as SsFamilyBenefitsData | null,
    ssEarningsTest: () => deferredDataOf("ss-earnings-test-2026") as SsEarningsTestData | null,
    medicareCosts: () => deferredDataOf("medicare-costs-2026") as MedicareCostsData | null,
    uiTaxation: () => deferredDataOf("ui-taxation-2026") as UiTaxationData | null,
    supplementalWithholding: () =>
      deferredDataOf("supplemental-withholding-2026") as SupplementalWithholdingData | null,
    separationRules: () =>
      deferredDataOf("separation-rules-2026") as SeparationRulesData | null,
    earlyDistribution: () =>
      deferredDataOf("early-distribution-2026") as EarlyDistributionData | null,
    homeSaleExclusion: () =>
      deferredDataOf("home-sale-exclusion-2026") as HomeSaleExclusionData | null,
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
