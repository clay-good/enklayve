/**
 * Source-specific refresh adapters (BUILD-SPEC.md §7.3 step 1, §8 "one adapter
 * per source"). Each adapter knows one source's published shape and maps it to
 * the normalized shard the data layer already validates — by *anchoring* to
 * known labels, never by inference, exactly like the Readout extractors (§2.2).
 *
 * The first set called for in the Phase 9 prompt is the IRS annual notice, the
 * BLS CPI database, the SSA fact sheet, the HHS poverty guidelines, and the
 * California state source. The second set extends the same anchored pattern to
 * the two remaining Pillar 2 benefit sources with seeded shards: the USDA FNS
 * SNAP cost-of-living adjustment and the CMS / Medicaid.gov expansion status.
 * The third set adds the remaining *state income-tax* sources that publish a
 * standard deduction by filing status — New York, Georgia, North Carolina, and
 * DC — reusing the same generic standard-deduction parser as California (one
 * adapter per state, the CA workflow is the template). The fourth set covers
 * the flat-rate states whose anchorable figure is the rate, not a deduction —
 * Pennsylvania, Illinois, and Michigan — via a flat-rate parser (and the
 * personal exemption where IL/MI carry one). The fifth set adds the graduated
 * bracket-table parser the others deferred, landing the last seeded state with
 * an income tax — Ohio — whose schedule is a multi-tier marginal table (no flat
 * rate and no standard deduction). With it, every seeded state with an income
 * tax has a refresh adapter; the no-income-tax states (TX, FL) have nothing to
 * refresh.
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
export type RefreshGroup =
  | "irs"
  | "ssa"
  | "hhs-poverty"
  | "cpi"
  | "state-ca"
  | "state-ny"
  | "state-ga"
  | "state-nc"
  | "state-dc"
  | "state-pa"
  | "state-il"
  | "state-mi"
  | "state-oh"
  | "usda-snap"
  | "cms-medicaid";

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

// --- Flat-rate state income tax (anchored prose) -----------------------------

/**
 * Overlay the single flat income-tax rate (and the personal exemption where the
 * shard carries one) for a flat-tax jurisdiction. PA, IL, and MI each levy one
 * rate for every filing status, stored as a one-element bracket per status, so
 * the cleanly-anchorable figure is the rate itself — exactly the figure that
 * actually moves when a state cuts or raises its flat tax.
 *
 * The rate is anchored from prose like "the income tax rate is 4.95%" / "4.95
 * percent" / "a flat 3.07% tax" and overlaid onto every single-element bracket
 * (which is what a flat tax is). A graduated schedule (OH) has multi-element
 * brackets, so nothing is overlaid and the parser fails to anchor — transcribing
 * a full bracket table stays the reviewer's data-only step, the same honesty
 * boundary as the standard-deduction parser. A plausibility guard rejects an
 * out-of-range percentage so a stray figure routes to the fail-safe alert.
 */
function parseFlatRateJurisdiction(raw: string, current: Record<string, unknown>): ParseOutcome {
  const rateMatch =
    /income[- ]?tax rate(?:\s+(?:is|of))?\s*:?\s*([\d.]+)\s*(?:percent|%)/i.exec(raw) ??
    /\btax rate(?:\s+(?:is|of))?\s*:?\s*([\d.]+)\s*(?:percent|%)/i.exec(raw) ??
    /\b([\d.]+)\s*(?:percent|%)\s+flat\b/i.exec(raw);
  if (!rateMatch) {
    return { ok: false, reason: "could not anchor the flat income-tax rate" };
  }
  const percent = Number(rateMatch[1]);
  if (!Number.isFinite(percent) || percent <= 0 || percent > 15) {
    return { ok: false, reason: `anchored an implausible flat rate (${rateMatch[1]}%)` };
  }
  const rate = percent / 100;

  const shard = clone(current);
  const brackets = shard.bracketsByFilingStatus as
    | Record<string, { lowerBound: number; rate: number }[]>
    | undefined;
  if (!brackets) {
    return { ok: false, reason: "shard has no bracketsByFilingStatus to overlay" };
  }
  let overlaid = 0;
  for (const status of Object.keys(brackets)) {
    const arr = brackets[status];
    if (Array.isArray(arr) && arr.length === 1 && arr[0]) {
      arr[0].rate = rate;
      overlaid += 1;
    }
  }
  if (overlaid === 0) {
    return { ok: false, reason: "no single-rate bracket to overlay (graduated schedule?)" };
  }

  // Personal exemption (IL, MI): overlay the single-filer amount when the source
  // states it; the paired statuses stay for the reviewer, like a bracket table.
  const exemptions = shard.personalExemptionByFilingStatus as Record<string, number> | undefined;
  if (exemptions && "single" in exemptions) {
    const exMatch = /personal exemption[^$\d]*\$?([\d,]{3,})/i.exec(raw);
    if (exMatch) exemptions.single = parseAmount(exMatch[1] as string);
  }
  return { ok: true, shard };
}

// --- Graduated bracket-table state income tax (anchored prose) ---------------

/**
 * Overlay a graduated marginal schedule for a multi-tier jurisdiction (Ohio is
 * the seeded case). Unlike a flat tax, the figures that move are the per-tier
 * marginal *rate* and the *threshold* it kicks in at, so this parser anchors
 * each taxable tier as a `(rate)% … in excess of $(threshold)` pair — exactly
 * how a published rate schedule states it ("2.75% of the amount in excess of
 * $26,050; 3.50% of the amount in excess of $100,000"). The lowest bracket
 * (income from $0) is preserved from the committed shard, since its rate is the
 * stable, often-zero base tier rather than an "in excess of" figure.
 *
 * Honesty boundaries, the same as the other state parsers:
 *   - The gap between a rate and its threshold may not cross another `%` or `$`,
 *     so a `0%` base-tier mention can never wrongly pair with a higher tier's
 *     dollar figure.
 *   - A plausibility guard rejects any rate outside (0%, 15%], and the assembled
 *     schedule must match the committed shard's bracket *count* and stay
 *     strictly ascending. A structural change — a tier added or removed — anchors
 *     nothing and routes to the fail-safe alert, leaving the reviewer to
 *     transcribe a reshaped table (the same data-only step as adding a state).
 *   - One prose schedule is overlaid onto every graduated filing status, which
 *     is correct for Ohio (one schedule for all statuses). A state whose tiers
 *     differ by filing status would need per-status parsing; that stays deferred,
 *     the same boundary as the flat-rate parser's paired-exemption handling.
 */
function parseGraduatedBracketJurisdiction(
  raw: string,
  current: Record<string, unknown>,
): ParseOutcome {
  const tierRe =
    /([\d.]+)\s*(?:percent|%)[^%$]*?(?:in excess of|over|above|exceeding)\s*\$?([\d,]{3,})/gi;
  const seen = new Set<number>();
  const tiers: { lowerBound: number; rate: number }[] = [];
  let match: RegExpExecArray | null;
  while ((match = tierRe.exec(raw)) !== null) {
    const rate = Number(match[1]) / 100;
    const lowerBound = parseAmount(match[2] as string);
    if (!Number.isFinite(rate) || rate <= 0 || rate > 0.15) continue;
    if (!Number.isFinite(lowerBound) || lowerBound <= 0) continue;
    if (seen.has(lowerBound)) continue;
    seen.add(lowerBound);
    tiers.push({ lowerBound, rate });
  }
  if (tiers.length === 0) {
    return {
      ok: false,
      reason: "could not anchor any graduated bracket tier (rate in excess of a threshold)",
    };
  }
  tiers.sort((a, b) => a.lowerBound - b.lowerBound);

  const shard = clone(current);
  const brackets = shard.bracketsByFilingStatus as
    | Record<string, { lowerBound: number; rate: number }[]>
    | undefined;
  if (!brackets) {
    return { ok: false, reason: "shard has no bracketsByFilingStatus to overlay" };
  }
  let overlaid = 0;
  for (const status of Object.keys(brackets)) {
    const arr = brackets[status];
    // A single-element bracket is a flat tax, not this parser's job.
    if (!Array.isArray(arr) || arr.length <= 1) continue;
    const base = arr[0];
    if (!base || base.lowerBound !== 0) continue;
    const assembled = [{ lowerBound: 0, rate: base.rate }, ...tiers.map((t) => ({ ...t }))];
    // Same count as the committed schedule, or a reviewer owns the reshape.
    if (assembled.length !== arr.length) continue;
    let ascending = true;
    for (let i = 1; i < assembled.length; i += 1) {
      if (assembled[i]!.lowerBound <= assembled[i - 1]!.lowerBound) ascending = false;
    }
    if (!ascending) continue;
    brackets[status] = assembled;
    overlaid += 1;
  }
  if (overlaid === 0) {
    return {
      ok: false,
      reason:
        "no graduated schedule matched the committed bracket structure (count or shape changed)",
    };
  }
  return { ok: true, shard };
}

// --- USDA FNS SNAP cost-of-living adjustment (anchored prose) ----------------

/**
 * The USDA FNS annual SNAP COLA memo states the maximum allotment table by
 * household size and an each-additional-person increment. Like the HHS poverty
 * parser (the same table-plus-increment shape) we anchor the two cleanest single
 * figures — the one-person maximum allotment and the each-additional-person
 * amount — and overlay them. Rolling the full size-2-through-8 allotment table
 * stays the reviewer's data-only step on the resulting PR (the diff surfaces the
 * size-1 move to prompt it), exactly like a jurisdiction's full bracket table.
 */
function parseSnap(raw: string, current: Record<string, unknown>): ParseOutcome {
  // "Each additional person ... $219" or "$219 for each additional person".
  const perMatch =
    /each additional person[^$\d]*\$?([\d,]{2,})/i.exec(raw) ??
    /\$?([\d,]{2,})\s+for each additional person/i.exec(raw);
  // The one-person maximum allotment is the smallest household line: "1 $292".
  const oneMatch = /(?:^|\n)\s*1\s+\$?([\d,]{3,})/.exec(raw);
  if (!perMatch || !oneMatch) {
    return {
      ok: false,
      reason: "could not anchor the one-person maximum allotment and each-additional-person amount",
    };
  }
  const shard = clone(current);
  const allotments = {
    ...((shard.maxAllotmentByHouseholdSize as Record<string, number>) ?? {}),
  };
  allotments["1"] = parseAmount(oneMatch[1] as string);
  shard.maxAllotmentByHouseholdSize = allotments;
  shard.additionalPersonAllotment = parseAmount(perMatch[1] as string);
  return { ok: true, shard };
}

// --- CMS / Medicaid.gov expansion status (anchored prose) --------------------

/**
 * Adult Medicaid MAGI eligibility in expansion states is "133% of the poverty
 * line" plus a statutory 5-point income disregard, i.e. an effective 138% FPL.
 * We anchor that effective threshold percentage; the per-state expansion map
 * changes only when a state expands, so flipping a state stays the reviewer's
 * deliberate data-only step (the same honesty boundary as a full bracket table),
 * not a prose scrape. Failure here routes to the fail-safe alert.
 */
function parseMedicaidThreshold(raw: string, current: Record<string, unknown>): ParseOutcome {
  const match = /(\d{2,3}(?:\.\d+)?)\s*(?:percent|%)\s+of the (?:federal )?poverty/i.exec(raw);
  if (!match) {
    return {
      ok: false,
      reason: "could not anchor the expansion eligibility threshold (% of the poverty line)",
    };
  }
  const shard = clone(current);
  shard.expansionThresholdPctFpl = Number(match[1]);
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
  {
    id: "state-ny-income-tax-2024",
    group: "state-ny",
    source: "New York State Department of Taxation and Finance tax-rate schedules",
    sourceUrl: "https://www.tax.ny.gov/pit/file/tax-tables/nys-tax-rate-schedule.htm",
    cadence: "Annual",
    parse: parseStandardDeductions,
  },
  {
    id: "state-ga-income-tax-2024",
    group: "state-ga",
    source: "Georgia Department of Revenue individual income tax",
    sourceUrl: "https://dor.georgia.gov/taxes/individual-taxes",
    cadence: "Annual",
    parse: parseStandardDeductions,
  },
  {
    id: "state-nc-income-tax-2024",
    group: "state-nc",
    source: "North Carolina Department of Revenue individual income tax rates",
    sourceUrl:
      "https://www.ncdor.gov/taxes-forms/individual-income-tax/north-carolina-individual-income-tax-rates",
    cadence: "Annual",
    parse: parseStandardDeductions,
  },
  {
    id: "state-dc-income-tax-2024",
    group: "state-dc",
    source: "DC Office of Tax and Revenue individual income tax rates",
    sourceUrl: "https://otr.cfo.dc.gov/page/dc-individual-and-fiduciary-income-tax-rates",
    cadence: "Annual",
    parse: parseStandardDeductions,
  },
  {
    id: "state-pa-income-tax-2024",
    group: "state-pa",
    source: "Pennsylvania DOR personal income tax (flat rate)",
    sourceUrl:
      "https://www.pa.gov/agencies/revenue/forms-and-publications/pa-personal-income-tax-guide.html",
    cadence: "Annual",
    parse: parseFlatRateJurisdiction,
  },
  {
    id: "state-il-income-tax-2024",
    group: "state-il",
    source: "Illinois DOR individual income tax (flat rate + personal exemption)",
    sourceUrl: "https://tax.illinois.gov/individuals/rates.html",
    cadence: "Annual",
    parse: parseFlatRateJurisdiction,
  },
  {
    id: "state-mi-income-tax-2024",
    group: "state-mi",
    source: "Michigan Treasury individual income tax (flat rate + personal exemption)",
    sourceUrl: "https://www.michigan.gov/taxes/iit/tax-time/whats-new-for-tax-year-2024",
    cadence: "Annual",
    parse: parseFlatRateJurisdiction,
  },
  {
    id: "state-oh-income-tax-2024",
    group: "state-oh",
    source: "Ohio Department of Taxation annual income tax rate schedule (graduated)",
    sourceUrl: "https://tax.ohio.gov/individual/resources/annual-tax-rates",
    cadence: "Annual",
    parse: parseGraduatedBracketJurisdiction,
  },
  {
    id: "snap-fy2024-contiguous",
    group: "usda-snap",
    source: "USDA FNS SNAP cost-of-living adjustment (48 contiguous states and DC)",
    sourceUrl: "https://www.fns.usda.gov/snap/allotment/COLA",
    cadence: "Annual, October",
    parse: parseSnap,
  },
  {
    id: "medicaid-2024",
    group: "cms-medicaid",
    source: "CMS / Medicaid.gov MAGI eligibility and expansion status",
    sourceUrl: "https://www.medicaid.gov/medicaid/eligibility/index.html",
    cadence: "Annual",
    parse: parseMedicaidThreshold,
  },
];

/** Adapters belonging to one workflow group. */
export function adaptersForGroup(group: RefreshGroup): RefreshAdapter[] {
  return ADAPTERS.filter((adapter) => adapter.group === group);
}

/** All distinct groups, for the workflow matrix / docs. */
export const REFRESH_GROUPS: RefreshGroup[] = [...new Set(ADAPTERS.map((a) => a.group))];
