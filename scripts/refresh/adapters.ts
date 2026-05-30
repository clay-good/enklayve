/**
 * Source-specific refresh adapters (BUILD-SPEC.md §7.3 step 1, §8 "one adapter
 * per source"). Each adapter knows one source's published shape and maps it to
 * the normalized shard the data layer already validates — by *anchoring* to
 * known labels, never by inference, exactly like the Readout extractors (§2.2).
 *
 * This is the first set called for in the Phase 9 prompt: the IRS annual
 * notice, the BLS CPI database, the SSA fact sheet, the HHS poverty guidelines,
 * and the California state source.
 *
 * Honesty boundaries (kept narrow on purpose, per the family's "be right before
 * being everywhere"):
 *   - A parser anchors to the values it can verify and returns `{ ok: false }`
 *     when the expected anchors are absent — which routes to the fail-safe
 *     alert PR rather than guessing (§7.3 step 4). It never invents a number.
 *   - These adapters refresh the *figures* in the latest committed shard in
 *     place (e.g. the FICA wage base, the CPI annual average). Rolling a shard
 *     to a new effective year, and transcribing a full bracket table, stay the
 *     reviewer's step on the resulting PR — the same data-only flow as
 *     docs/adding-a-state.md. The diff log and the test gate make that review
 *     concrete and safe.
 *   - Authoritative zod validation against the §7.2 schemas runs in the test
 *     gate (`npm run test` -> tests/data.test.ts loads every shard through the
 *     loader). The adapters build structurally and the gate blocks anything
 *     that does not conform, so a malformed parse can never reach `main`.
 *
 * No import from src/ at runtime: the build scripts run under Node's native
 * type-stripping, which does not resolve extensionless TS paths, so these
 * adapters stay self-contained. The adapter tests import the real src schemas
 * (under Vitest) and assert every parsed fixture validates.
 */

/** Which workflow runs an adapter; one group == one .github/workflows file. */
export type RefreshGroup = "irs" | "ssa" | "hhs-poverty" | "cpi" | "state-ca";

export type ParseOutcome =
  | { ok: true; shard: Record<string, unknown> }
  | { ok: false; reason: string };

export interface RefreshAdapter {
  /** The manifest shard id and `${id}.json` filename. */
  id: string;
  /** The workflow group whose schedule runs this adapter. */
  group: RefreshGroup;
  /** Human-readable source name for the diff-log entry. */
  source: string;
  /** The canonical source URL the workflow fetches. */
  sourceUrl: string;
  /** Human-readable cadence (matches docs/data-sources.md). */
  cadence: string;
  /**
   * Map fetched source text onto a normalized shard, overlaying the parsed
   * figures on the currently committed shard so structure and citation are
   * preserved. Returns a reason on failure (anchors missing) for the alert path.
   */
  parse(raw: string, current: Record<string, unknown>): ParseOutcome;
}

/** Parse a US dollar/integer string like "176,100" or "$176,100" to a number. */
function parseAmount(text: string): number {
  return Number(text.replace(/[$,]/g, ""));
}

/** Shallow-clone the current shard so a parser can overlay fields immutably. */
function clone(current: Record<string, unknown>): Record<string, unknown> {
  return JSON.parse(JSON.stringify(current)) as Record<string, unknown>;
}

// --- BLS CPI-U (machine-readable JSON API) -----------------------------------

/**
 * The BLS public timeseries API returns JSON with annual-average rows (period
 * "M13" / periodName "Annual"). We merge those into the shard's `byYear` map.
 * This is the only fully machine-readable source in the first set, so the
 * parser is robust rather than anchored-to-prose.
 */
function parseCpi(raw: string, current: Record<string, unknown>): ParseOutcome {
  let api: unknown;
  try {
    api = JSON.parse(raw);
  } catch {
    return { ok: false, reason: "BLS response was not JSON" };
  }
  const series = (api as { Results?: { series?: { data?: unknown }[] } })?.Results?.series?.[0]
    ?.data;
  if (!Array.isArray(series)) {
    return { ok: false, reason: "unexpected BLS API shape (no Results.series[0].data)" };
  }
  const annual = (series as Record<string, unknown>[]).filter(
    (row) => row.period === "M13" || row.periodName === "Annual",
  );
  if (annual.length === 0) {
    return { ok: false, reason: "no annual-average (M13) rows in the BLS response" };
  }
  const shard = clone(current);
  const byYear = { ...((shard.byYear as Record<string, number>) ?? {}) };
  for (const row of annual) {
    const year = String(row.year);
    const value = Number(row.value);
    if (Number.isFinite(value)) byYear[year] = value;
  }
  shard.byYear = byYear;
  return { ok: true, shard };
}

// --- HHS Federal Poverty Guidelines (anchored prose) -------------------------

/**
 * The HHS guidelines state a one-person amount and a per-additional-person
 * increment ("add $5,380 for each additional person"). We anchor both and
 * overlay `base` / `perAdditionalPerson`.
 */
function parsePovertyContiguous(raw: string, current: Record<string, unknown>): ParseOutcome {
  const perMatch = /\$?([\d,]{3,})\s+for each additional person/i.exec(raw);
  // The one-person guideline is the smallest household line; anchor "1" + dollars.
  const oneMatch = /(?:^|\n)\s*1\s+\$?([\d,]{4,})/.exec(raw);
  if (!perMatch || !oneMatch) {
    return {
      ok: false,
      reason: "could not anchor the one-person guideline and per-additional-person increment",
    };
  }
  const shard = clone(current);
  shard.base = parseAmount(oneMatch[1] as string);
  shard.perAdditionalPerson = parseAmount(perMatch[1] as string);
  return { ok: true, shard };
}

// --- SSA fact sheet (anchored prose) -----------------------------------------

/**
 * The SSA COLA fact sheet states the new taxable maximum ("maximum amount of
 * earnings subject to the Social Security tax ... $176,100"). We anchor the
 * wage base; the 6.2% / 1.45% rates are statutory and stable, so a change to
 * them would show in the diff for the reviewer rather than being scraped.
 */
function parseFica(raw: string, current: Record<string, unknown>): ParseOutcome {
  const match =
    /(?:taxable maximum|maximum taxable earnings|earnings subject to (?:the )?social security tax)[^$]*\$?([\d,]{5,})/i.exec(
      raw,
    );
  if (!match) {
    return {
      ok: false,
      reason: "could not anchor the Social Security taxable maximum (wage base)",
    };
  }
  const shard = clone(current);
  shard.socialSecurityWageBase = parseAmount(match[1] as string);
  return { ok: true, shard };
}

// --- Jurisdiction standard deductions (IRS + CA, anchored prose) -------------

const FILING_LABELS: { key: string; pattern: RegExp }[] = [
  { key: "married_jointly", pattern: /married(?:[^.]*?)(?:filing )?jointly[^$]*\$?([\d,]{4,})/i },
  {
    key: "head_of_household",
    pattern: /heads?\s+of\s+household[^$]*\$?([\d,]{4,})/i,
  },
  { key: "single", pattern: /\bsingle(?:[^$]*?taxpayers?)?[^$]*\$?([\d,]{4,})/i },
];

/**
 * Overlay the standard deduction by filing status for a jurisdiction shard
 * (federal IRS Rev. Proc. and the CA FTB schedule both state these plainly).
 * Bracket bounds are intentionally NOT scraped here — transcribing a full
 * bracket table stays the reviewer's data-only step on the PR (the diff and the
 * golden gate make it safe). Returns failure if no deduction can be anchored,
 * so a layout change routes to the fail-safe alert instead of a silent no-op.
 */
function parseStandardDeductions(raw: string, current: Record<string, unknown>): ParseOutcome {
  const shard = clone(current);
  const deductions = {
    ...((shard.standardDeductionByFilingStatus as Record<string, number>) ?? {}),
  };
  let anchored = 0;
  for (const { key, pattern } of FILING_LABELS) {
    if (!(key in deductions)) continue;
    const match = pattern.exec(raw);
    if (match) {
      deductions[key] = parseAmount(match[1] as string);
      anchored += 1;
    }
  }
  if (anchored === 0) {
    return { ok: false, reason: "could not anchor any standard-deduction figure by filing status" };
  }
  // Mirror separately/surviving-spouse to single/jointly when present (federal
  // convention) only if the source did not state them and the shard already
  // pairs them that way — otherwise leave them for review.
  shard.standardDeductionByFilingStatus = deductions;
  return { ok: true, shard };
}

/** The first set of adapters (Phase 9 prompt). */
export const ADAPTERS: RefreshAdapter[] = [
  {
    id: "cpi-u-annual",
    group: "cpi",
    source: "BLS CPI-U public API",
    sourceUrl: "https://api.bls.gov/publicAPI/v2/timeseries/data/CUUR0000SA0?annualaverage=true",
    cadence: "Monthly, 2nd week",
    parse: parseCpi,
  },
  {
    id: "federal-poverty-level-2024-contiguous",
    group: "hhs-poverty",
    source: "HHS Poverty Guidelines (48 contiguous states and DC)",
    sourceUrl: "https://aspe.hhs.gov/topics/poverty-economic-mobility/poverty-guidelines",
    cadence: "Annual, January",
    parse: parsePovertyContiguous,
  },
  {
    id: "fica-2024",
    group: "ssa",
    source: "SSA Contribution and Benefit Base / COLA fact sheet",
    sourceUrl: "https://www.ssa.gov/oact/cola/cbb.html",
    cadence: "Annual, October",
    parse: parseFica,
  },
  {
    id: "federal-income-tax-2024",
    group: "irs",
    source: "IRS annual revenue procedure (inflation adjustments)",
    sourceUrl: "https://www.irs.gov/pub/irs-drop/rp-23-34.pdf",
    cadence: "Annual, October-November",
    parse: parseStandardDeductions,
  },
  {
    id: "state-ca-income-tax-2024",
    group: "state-ca",
    source: "California FTB tax-rate schedules",
    sourceUrl: "https://www.ftb.ca.gov/forms/2024/2024-california-tax-rates-and-exemptions.html",
    cadence: "Annual",
    parse: parseStandardDeductions,
  },
];

/** Adapters belonging to one workflow group. */
export function adaptersForGroup(group: RefreshGroup): RefreshAdapter[] {
  return ADAPTERS.filter((adapter) => adapter.group === group);
}

/** All distinct groups, for the workflow matrix / docs. */
export const REFRESH_GROUPS: RefreshGroup[] = [...new Set(ADAPTERS.map((a) => a.group))];
