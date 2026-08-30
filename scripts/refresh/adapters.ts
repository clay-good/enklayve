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
 * refresh. The sixth set adds the one remaining seeded Pillar 1/3 source — the
 * TreasuryDirect Series I savings-bond rates (semiannual, May and November) —
 * anchoring the currently-published fixed rate and semiannual inflation rate
 * and refreshing the latest period's figures in place. Appending a newly-issued
 * rate period (a structural roll) stays the reviewer's data-only step, exactly
 * like the graduated bracket table and the new-effective-year roll.
 *
 * The seventh set finishes the state coverage by giving the remaining seeded
 * income-tax states their own refresh adapter — the flat-rate "fill in the rest"
 * states (§14.3) that previously shipped data-only: Arizona, Colorado, Indiana,
 * Kentucky, and Idaho (single-rate flat taxes, the PA/IL/MI flat parser reused
 * verbatim, with IN's personal exemption overlaid like IL's), Mississippi (a two-
 * tier "0% then a flat rate over a floor" schedule, the Ohio graduated parser
 * reused), and Massachusetts (a 5% base rate plus the constitutional 4% surtax
 * over an inflation-adjusted threshold — the one seeded state whose shape fits
 * neither existing parser, so it gets a small dedicated parser that anchors the
 * two figures that actually move: the base rate and the surtax threshold).
 *
 * The eighth set adds Utah — a clean flat tax (4.45%, SB 60 2026) whose rate is
 * the figure that moves, so the PA/IL/MI flat parser is reused verbatim (like
 * ID). Utah has no standard deduction; its relief is the nonrefundable taxpayer
 * tax credit, whose inflation-indexed phase-out base amounts roll the same way a
 * bracket table does — the reviewer's data-only step on the resulting PR.
 *
 * The ninth set adds Louisiana — another clean flat tax (3%, Act 11 2024), so
 * the same flat parser is reused once more. Its $12,875 / $25,750 standard
 * deduction is inflation-indexed from 2026; that annual roll stays the reviewer's
 * data-only step (the rate is the legislatively-fixed figure the parser anchors).
 *
 * The tenth set adds Iowa — a flat 3.8% tax (SF 2442 2024) over the federal
 * standard deduction (the Idaho pattern), so the flat parser is reused again; the
 * federal-conformity deduction rolls with the IRS refresh, not Iowa's.
 *
 * The eleventh set lands the two "federal tax deduction" states the engine was
 * extended for — Alabama (uncapped, Ala. Code §40-18-15(a)(1), a sliding
 * standard deduction that floors at $2,500/$5,000) and Oregon (capped + AGI-
 * phased, ORS §316.680/§316.695). Both publish a standard deduction the refresh
 * can anchor (the MN/RI pattern); Alabama's is the figure last raised by statute
 * and Oregon's indexes annually, while the brackets, the federal-tax cap, and
 * Oregon's Table 4 phase-out roll alongside as the reviewer's data-only step.
 *
 * The twelfth set adds Nebraska — a clean per-status three-bracket schedule
 * (2.46% / 3.51% / 4.55% for 2026) over an indexed standard deduction, the figure
 * the refresh anchors (the MN/RI pattern); the statutory LB 754 rate path (the
 * 2027 cut to 3.99%), the indexed bracket thresholds, and the ~$171 exemption
 * credit stay the reviewer's data-only step.
 *
 * The thirteenth set adds Maryland — a per-status ten-rate state schedule PLUS a
 * mandatory residence-based county/Baltimore-City local tax (24 jurisdictions,
 * two of them — Anne Arundel and Frederick — income-tiered). The state brackets
 * are statutory and the county rates are set annually per county, so the refresh
 * anchors the standard deduction (the 2025 session moved it to a fixed
 * $3,350/$6,700; the MN/RI pattern); the per-status bracket tables, the county
 * local-rate chart, and the $3,200 exemption roll alongside it as the reviewer's
 * data-only step.
 *
 * The fourteenth set adds Arkansas — a uniform graduated schedule (0/2/3/3.4/3.9%)
 * with a high-income "bracket adjustment" that recaptures the lower-bracket
 * benefit (modeled via the engine's `incomeRecapture` capability). The rates are
 * statutory and the brackets index annually, so the refresh anchors the standard
 * deduction (the MN/RI pattern); the bracket thresholds, the recapture band, and
 * the $29 personal credit are the reviewer's data-only step.
 *
 * The fifteenth set adds Connecticut — the last U.S. income-tax state — the
 * deepest single computation the engine models: a seven-rate schedule, a
 * dollar-for-dollar exemption phase-out, two stacked high-income recaptures (the
 * 2% phase-out add-back and the tax recapture, via the per-status `incomeRecapture`
 * stages), and a percent-of-tax personal credit (the per-status `personalCreditRate`
 * step table). All are statutory; the adapter anchors the personal exemption (the
 * MN/RI pattern) as the change-watch, the rest the reviewer's data-only step. With
 * it, *every* seeded jurisdiction with an income tax has a refresh adapter, and
 * every one of the 50 states + DC is modeled.
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
  | "state-az"
  | "state-co"
  | "state-in"
  | "state-ky"
  | "state-id"
  | "state-ut"
  | "state-la"
  | "state-ia"
  | "state-va"
  | "state-mo"
  | "state-nj"
  | "state-mn"
  | "state-ks"
  | "state-de"
  | "state-nm"
  | "state-ri"
  | "state-sc"
  | "state-ok"
  | "state-wv"
  | "state-wi"
  | "state-hi"
  | "state-mt"
  | "state-me"
  | "state-nd"
  | "state-ms"
  | "state-ma"
  | "state-vt"
  | "state-al"
  | "state-or"
  | "state-ne"
  | "state-md"
  | "state-ar"
  | "state-ct"
  | "treasurydirect"
  | "usda-snap"
  | "cms-medicaid";

export type ParseOutcome =
  | { ok: true; shard: Record<string, unknown> }
  /**
   * `denied` says the source answered and its answer was a refusal to serve
   * rather than data — a rate limit, a quota, a challenge page. That is not the
   * same failure as "the page came back and the figure has moved", and calling
   * it one is how the CPI adapter spent a month reporting that the BLS API had
   * changed shape when the API was fine and the quota was spent. The adapter
   * check reports these as unreachable, alongside a page that never arrived.
   */
  /**
   * `settled` says the refusal is a considered decision rather than a defect.
   * Delaware's deduction is statutory and has not moved since 2000; Oregon,
   * Vermont, Nebraska, Hawaii and Kansas are waiting on a state to publish the
   * shard's year; Connecticut has no standard deduction at all. Every one of
   * those used to read "could not anchor any standard-deduction figure by
   * filing status" — the same sentence a genuinely broken parser prints. Mixing
   * the two is how a report earns being skimmed: a reader who opens it and
   * finds six entries needing nothing does not open the seventh. The adapter
   * check lists these apart from the ones that want fixing.
   */
  | { ok: false; reason: string; denied?: true; settled?: boolean };

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

/**
 * Convert an anchored percentage to a decimal rate, rounding away IEEE-754 dust
 * (e.g. `2.95 / 100 === 0.029500000000000002`). A tax rate never needs more than
 * ten decimal places, so this loses no real precision; without it a clean source
 * read (Indiana's 2.95%) would diff against the committed `0.0295` and open a
 * spurious PR every run. Rates that already divide cleanly (PA 3.07 → 0.0307)
 * round to themselves, so the existing flat/graduated parsers are unaffected.
 */
function pctToRate(percent: number): number {
  return Math.round((percent / 100) * 1e10) / 1e10;
}

/** Shallow-clone the current shard so a parser can overlay fields immutably. */
function clone(current: Record<string, unknown>): Record<string, unknown> {
  return JSON.parse(JSON.stringify(current)) as Record<string, unknown>;
}

/**
 * Reduce a fetched page to the text a reader actually sees.
 *
 * The adapters regex over whatever `fetchSource` returns, which for an HTML page
 * is the markup. That was survivable while every figure sat in a sentence, and
 * it stops being survivable the moment a figure sits in a table — which is where
 * flat-rate states put theirs. Illinois publishes its rate as a table row whose
 * label cell says "Individual Income Tax" and whose value cell says "4.95 percent
 * of net income": in prose those are eleven words apart, and in markup they are
 * separated by a hundred characters of `<td valign="top" class="soi-rteTableOddCol-0">`
 * that no bounded bridge can cross without also crossing half the page.
 *
 * Stripping tags is also what removes the *noise* that made bridging dangerous.
 * A page's `<style>` block is full of percentages (Idaho's mega-menu carries
 * `33.3333333333%`), and its `<meta name="description">` repeats the body text
 * inside an attribute, so a page could state one rate and match it four times.
 * Both disappear here, which makes the ambiguity guard below mean what it says:
 * two different matches are two different figures on the page, not the same
 * figure counted twice.
 *
 * This is not a renderer. Text hidden by CSS still shows up, and table geometry
 * is gone — a parser that needs to know which column a cell is in is a parser
 * that should be a reviewer step instead.
 */
export function visibleText(raw: string): string {
  return (
    raw
      .replace(/<(script|style|noscript)\b[\s\S]*?<\/\1>/gi, " ")
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/gi, " ")
      // Numeric character references, decoded rather than left alone. New York
      // numbers its table rows with circled digits — `&#9312;` — and a reference
      // left as literal text is four digits sitting where an amount goes, which a
      // status label will happily bridge to. That read `9312` as a deduction.
      .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
      .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
      .replace(/&amp;/gi, "&")
      .replace(/\s+/g, " ")
  );
}

// --- BLS CPI-U (machine-readable JSON API) -----------------------------------

/**
 * The BLS public timeseries API returns JSON with annual-average rows (period
 * "M13" / periodName "Annual"). We merge those into the shard's `byYear` map.
 * This is the only fully machine-readable source in the first set, so the
 * parser is robust rather than anchored-to-prose.
 *
 * It is also the source most likely to answer without answering. The v2 API is
 * usable without a registration key, at a small daily quota counted per IP — and
 * a CI runner shares its IP with everyone else on that runner. When the quota is
 * spent BLS replies **200 OK** with `{"status":"REQUEST_NOT_PROCESSED",
 * "message":["...the daily threshold ... has been reached"],"Results":{}}`.
 * Valid JSON, no series, nothing wrong with the source and nothing wrong with
 * this parser. Reported as a parse failure it reads as "the BLS API changed
 * shape", which sends a reader to rewrite a parser that is fine.
 *
 * So the envelope is checked before the shape. BLS states its own status and its
 * own message, and repeating them is more useful than anything this code could
 * infer — the message is what names the quota, and the quota is what a
 * registration key would fix.
 */
function parseCpi(raw: string, current: Record<string, unknown>): ParseOutcome {
  let api: unknown;
  try {
    api = JSON.parse(raw);
  } catch {
    return { ok: false, reason: "BLS response was not JSON" };
  }
  const envelope = api as { status?: unknown; message?: unknown };
  if (typeof envelope?.status === "string" && envelope.status !== "REQUEST_SUCCEEDED") {
    const said = Array.isArray(envelope.message)
      ? envelope.message.map(String).join(" ").trim()
      : "";
    return {
      ok: false,
      denied: true,
      reason: `BLS declined the request (${envelope.status})${said ? `: ${said}` : ""}`,
    };
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
 * The HHS poverty guidelines, read out of the ASPE page that states all three.
 *
 * This figure is the most load-bearing on the site — the premium tax credit,
 * Medicaid eligibility, SNAP's income limits and every benefit-cliff answer are
 * a percentage of it — and it is issued as **three separate guidelines**: the 48
 * contiguous states and DC, a higher one for Alaska, a higher one for Hawaii.
 * The page prints all three, one after another, in the same shape:
 *
 *   2026 POVERTY GUIDELINES FOR THE 48 CONTIGUOUS STATES AND THE DISTRICT OF
 *   COLUMBIA / Persons in family/household / Poverty guideline / 1 $15,960 ...
 *   For families/households with more than 8 persons, add $5,680 for each
 *   additional person. / 2026 POVERTY GUIDELINES FOR ALASKA / 1 $19,950 ...
 *
 * The parser this replaces read "for each additional person" and the first "1"
 * row from anywhere on the page, so it was taking Alaska's or Hawaii's figures
 * on nothing but the order HHS happened to print them in, and would have kept
 * doing so silently. Using the wrong region's guideline is a failure the shard's
 * own note calls out by name: "a program that uses the wrong one for the
 * household's state gets every downstream answer wrong."
 *
 * So each shard says which `region` and which `year` it is, and those select the
 * heading. Nothing outside that region's section is read, and a page that does
 * not carry the shard's year is refused rather than parsed against whatever it
 * does carry. It also means Alaska and Hawaii can be watched at all: they had no
 * adapter, because a region-blind parser could only ever have served one of the
 * three shards.
 */
const POVERTY_REGION_HEADINGS: Record<string, RegExp> = {
  contiguous: /POVERTY GUIDELINES FOR THE 48 CONTIGUOUS STATES/i,
  alaska: /POVERTY GUIDELINES FOR ALASKA\b/i,
  hawaii: /POVERTY GUIDELINES FOR HAWAII\b/i,
};

function parsePovertyGuidelines(raw: string, current: Record<string, unknown>): ParseOutcome {
  const region = String(current.region ?? "");
  const heading = POVERTY_REGION_HEADINGS[region];
  if (!heading) {
    return { ok: false, reason: `shard names no known poverty region (got "${region}")` };
  }
  const text = visibleText(raw);
  const year = Number(current.year);
  if (Number.isInteger(year) && !new RegExp(`${year} POVERTY GUIDELINES`, "i").test(text)) {
    return {
      ok: false,
      reason: `the page states no ${year} poverty guidelines — HHS issues these each January, so this is last year's page or the shard is ahead of it`,
    };
  }
  const at = heading.exec(text);
  if (!at) {
    return { ok: false, reason: `could not find the ${region} guidelines heading on the page` };
  }
  // From this region's heading to the next region's, so the increment sentence
  // that closes the section can never be read out of the section below it.
  const rest = text.slice(at.index + at[0].length);
  const nextHeading = /POVERTY GUIDELINES FOR/i.exec(rest);
  const section = nextHeading ? rest.slice(0, nextHeading.index) : rest.slice(0, 600);

  const oneMatch = /\b1\s+\$([\d,]{4,})/.exec(section);
  const perMatch = /add\s+\$([\d,]{3,})\s+for each additional person/i.exec(section);
  if (!oneMatch || !perMatch) {
    return {
      ok: false,
      reason: `could not anchor the ${region} one-person guideline and per-additional-person increment`,
    };
  }
  const base = parseAmount(oneMatch[1] as string);
  const perAdditionalPerson = parseAmount(perMatch[1] as string);
  for (const [label, committed, anchored] of [
    ["one-person guideline", current.base, base],
    ["per-additional-person increment", current.perAdditionalPerson, perAdditionalPerson],
  ] as const) {
    const drift = implausibleDrift(committed as number, anchored);
    if (drift) {
      return {
        ok: false,
        reason: `the ${region} ${label} ${drift}; refusing — either the page moved or this is not the figure`,
      };
    }
  }
  const shard = clone(current);
  shard.base = base;
  shard.perAdditionalPerson = perAdditionalPerson;
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

/**
 * How far a filing-status label may be from its amount.
 *
 * These bridges were unbounded, which meant a label could reach across a whole
 * page to the next dollar sign. North Carolina's page states "Married Filing
 * Jointly/Qualifying Widow(er)/Surviving Spouse $25,500" — 39 characters — and
 * then, several paragraphs later, an unrelated cap: "the total home mortgage
 * interest and real estate taxes claimed by both spouses combined may not exceed
 * $20,000". The unbounded bridge found both and the ambiguity guard refused, so
 * the page that states all three of North Carolina's deductions was unreadable
 * because of a sentence about mortgages.
 *
 * 80 characters is a table row with a long label in it and nothing else. It is
 * the same reasoning as the flat parser's 48: a bridge wide enough for real
 * agency phrasing and too narrow to reach the next sentence.
 */
const LABEL_TO_AMOUNT = 80;

/**
 * How each filing status names itself, and how it reaches its amount.
 *
 * The label is kept separate from the bridge because two parsers want different
 * halves of it: the table readers want "this label, then an amount", and
 * Georgia's reader wants "an amount, then the statuses it applies to" — the same
 * words, on the other side of the number.
 */
const FILING_LABEL_SOURCES: { key: string; label: string }[] = [
  { key: "married_jointly", label: `married(?:[^.]{0,40}?)(?:filing )?jointly` },
  { key: "head_of_household", label: `heads?\\s+of\\s+household` },
  { key: "single", label: `\\bsingle(?:[^$]{0,40}?taxpayers?)?` },
];

const FILING_LABELS: { key: string; label: RegExp; pattern: RegExp }[] = FILING_LABEL_SOURCES.map(
  ({ key, label }) => ({
    key,
    label: new RegExp(label, "i"),
    pattern: new RegExp(`${label}[^$]{0,${LABEL_TO_AMOUNT}}\\$?([\\d,]{4,})`, "i"),
  }),
);

/**
 * How far an anchored figure may move from the committed one before the parser
 * refuses and asks a person.
 *
 * An indexed figure moves a few percent a year. A figure that moves by half is
 * either a real reform — which deserves a human transcribing it, since a reform
 * usually changes brackets and credits the parser does not touch — or the parser
 * has grabbed the wrong number off the page. A dry run of every adapter on
 * 2026-08-29 found six of the second kind, including California's standard
 * deduction anchoring `2019` and Delaware's `2014`: page furniture, read as
 * dollars.
 *
 * 25% is chosen so ordinary indexation always passes and nothing else does.
 * Refusing a genuine reform costs an alert PR and a reviewer's transcription,
 * which is the boundary this pipeline already draws everywhere else. Shipping a
 * wrong figure under a live citation costs the thing the project is for.
 */
const MAX_PLAUSIBLE_DRIFT = 0.25;

/** Reject an anchored amount that moved implausibly far from the committed one. */
export function implausibleDrift(current: number, anchored: number): string | null {
  if (!Number.isFinite(current) || current <= 0) return null;
  const drift = Math.abs(anchored - current) / current;
  if (drift <= MAX_PLAUSIBLE_DRIFT) return null;
  return `${anchored} is ${(drift * 100).toFixed(0)}% away from the committed ${current}`;
}

/**
 * Overlay the standard deduction by filing status for a jurisdiction shard
 * (federal IRS Rev. Proc. and the CA FTB schedule both state these plainly).
 * Bracket bounds are intentionally NOT scraped here — transcribing a full
 * bracket table stays the reviewer's data-only step on the PR (the diff and the
 * golden gate make it safe). Returns failure if no deduction can be anchored,
 * so a layout change routes to the fail-safe alert instead of a silent no-op.
 */
/**
 * Drop the rows that state a DEPENDENT's standard deduction.
 *
 * A dependent's deduction is a different figure with the same status label
 * beside it, and it is always the smaller one, so a parser that reaches it does
 * not read a number that looks wrong — it reads a number that looks like a
 * state with a stingier deduction. New York's page states both:
 *
 *   Single (and can be claimed as a dependent on another taxpayer's federal
 *   return) $3,100
 *   Single (and cannot be claimed as a dependent on another taxpayer's federal
 *   return) $8,000
 *
 * The shard models a filer who is nobody's dependent — the same assumption it
 * makes about dependents of its own — so the first row is not this shard's
 * figure under any reading, and dropping it is not a guess. What is left is one
 * single amount, which is what the ambiguity guard is there to require.
 *
 * "cannot be claimed" does not contain "can be claimed", so the row that is
 * wanted survives this untouched.
 */
function withoutDependentRows(raw: string): string {
  return raw.replace(/\(\s*(?:and\s+)?can be claimed as a dependent[^)]*\)\s*\$?[\d,]{3,}/gi, " ");
}

/**
 * Narrow a page to the standard-deduction table, when it announces one.
 *
 * Bounding the label-to-amount bridge stops a status label reaching across a
 * page, and it is not enough on a page that discusses deductions at length.
 * North Carolina's states its table plainly —
 *
 *   If your filing status is: Your standard deduction is:
 *   Single $12,750  Married Filing Jointly/... $25,500  Head of Household $19,125
 *
 * — and then spends several paragraphs on ITEMIZED deductions, where "a single
 * return, or a return as head of household may not deduct more than $10,000 of
 * real estate taxes" puts a status label 43 characters from a dollar amount that
 * is not a standard deduction at all. No bridge width separates those.
 *
 * A page that says "your standard deduction is" is telling the parser where to
 * look, so it looks there and nowhere else. A page that says no such thing is
 * read whole, exactly as before — this narrows, it never widens.
 *
 * Three things a document does that the first version of this got wrong, all
 * three of them on one page — Maine's 2026 Individual Income Tax Rates, the
 * document that states Maine's figures and the one its adapter now watches.
 *
 * **A lead-in can be a bare colon.** Maine's table is introduced by
 * "Standard Deduction: Single - $15,700 Married Filing Jointly - $31,400 …",
 * with no "amounts", no "table", and no "your". A colon after the words is a
 * document announcing a list as plainly as a heading does.
 *
 * **A page can MENTION the phrase before it STATES the table.** Maine's talks
 * about the inflation adjustment first — "The Maine standard deduction and
 * personal exemption amounts are adjusted by multiplying …" — some 1,500
 * characters above the figures. Taking the first lead-in narrowed the page to
 * prose containing no figure at all, and the adapter reported "could not anchor"
 * about a document that states all three amounts in one line. So the region is
 * the first lead-in that is actually followed by a status label and an amount;
 * a lead-in with no table under it is a mention, and mentions are skipped.
 *
 * **The table ends where the ADDITIONAL amounts begin.** Every state that
 * states a standard deduction states the extra amount for age and blindness
 * right underneath it, and Maine's $1,650/$3,300/$6,600 sit inside 400
 * characters of its table, in a sentence containing the words "married" and
 * "filing jointly". That is a different figure wearing the same label — the
 * dependent-row lesson in a second shape — so the region stops where it starts.
 */
const DEDUCTION_TABLE_LEADIN =
  /(?:your standard deduction is|standard deduction (?:amounts?|table)|filing status\s+standard deduction|standard deduction[^.:;]{0,80}:)\s*:?/gi;

/** Where the age/blindness ADD-ON begins, which is where the base table ends. */
const ADDITIONAL_AGE_BLIND =
  /additional\s+(?:standard\s+deduction|amounts?|deductions?)?[^.]{0,40}?\b(?:age|blind)/i;

/** Does this slice hold a status label with an amount after it — a table? */
function statesATable(region: string): boolean {
  return FILING_LABELS.some(({ pattern }) => pattern.test(region));
}

export function deductionTableRegion(text: string): string {
  for (const at of text.matchAll(DEDUCTION_TABLE_LEADIN)) {
    // Long enough for the four or five rows a table has, short enough that it
    // cannot reach the prose underneath it.
    let region = text.slice(at.index, at.index + 400);
    const addOn = ADDITIONAL_AGE_BLIND.exec(region);
    if (addOn && addOn.index > 0) region = region.slice(0, addOn.index);
    if (statesATable(region)) return region;
  }
  return text;
}

/**
 * Which column of a by-year table is this shard's, if the table says.
 *
 * A side-by-side table is only ambiguous while nothing says which column is
 * which. Rhode Island's inflation advisory says it, in a header directly above
 * the rows:
 *
 *   Rhode Island standard deduction amounts by Tax Year
 *   Filing status   2025      2026
 *   Single          $10,900   $11,200
 *   Married filing jointly*   $21,800   $22,400
 *
 * The shard knows its own tax year, so the shard picks the column — the same
 * anchor the federal revenue procedure and the SNAP region tables already use,
 * and the reason those two are watched instead of refused. Without a header
 * this returns null and the caller refuses exactly as before: this reads an
 * answer the document gives, it never guesses one.
 *
 * The header must be a run of two or more consecutive years, and it must sit
 * above the first row — a year mentioned in prose underneath the table is not a
 * column heading.
 */
const YEAR_HEADER = /\b(20\d{2})(?:\s+(?:20\d{2}))+\b/;

export function yearColumnIndex(region: string, taxYear: unknown, before: number): number | null {
  if (typeof taxYear !== "number" || !Number.isFinite(taxYear)) return null;
  const head = region.slice(0, before);
  const at = YEAR_HEADER.exec(head);
  if (!at) return null;
  const years = (at[0].match(/20\d{2}/g) ?? []).map(Number);
  const index = years.indexOf(taxYear);
  return index < 0 ? null : index;
}

/** The run of amounts a label introduces: `$10,900 $11,200` is two, not one. */
function amountRun(text: string, from: number): number[] {
  const run: number[] = [];
  let at = from;
  for (;;) {
    const next = /^\s*\$?([\d,]{4,})\b/.exec(text.slice(at, at + 24));
    if (!next) break;
    const amount = parseAmount(next[1] as string);
    if (!Number.isFinite(amount) || amount <= 0) break;
    run.push(amount);
    at += next[0].length;
  }
  return run;
}

/**
 * The tax years a deduction table says out loud about itself.
 *
 * Hawaii's tax-year-information page introduces its figures with the sentence
 * "For tax year 2025, the standard deduction amounts are the same as in tax year
 * 2024: $8,800 for Joint or Surviving Spouse; $6,424 for Head of Household" —
 * and the shard is on 2026, where Act 46 (2023) steps the amounts up to
 * $16,000 / $12,000 / $8,000. The drift guard caught that, at 45%, which is
 * luck: it is the size of the gap that saved the shard, not anything the parser
 * understood, and two adjacent years of ordinary indexation differ by 3%.
 *
 * A table that names its own year is the easiest thing in this file to check
 * and the least excusable to ignore. Both years are collected, because "the
 * same as in tax year 2024" is a real sentence and 2024 is a year this table
 * genuinely states.
 *
 * The window reaches back before the region because the year is usually in the
 * sentence that INTRODUCES the table, which the narrowing has already cut away.
 *
 * It only applies to a NARROWED region. On a page with no table on it the
 * region is the whole document, and a "for tax year 2025" anywhere in a
 * department's news column would refuse a page for a year its deduction table
 * never claimed — a refusal whose sentence would not be true. A page that
 * states no table has a different problem, and it already has its own message.
 */
const STATED_TAX_YEAR = /\b(?:for|in)\s+tax\s+years?\s+((?:19|20)\d{2})/gi;
const YEAR_LEAD_IN = 80;

export function statedTaxYears(full: string, region: string): number[] {
  if (region === full) return [];
  const at = full.indexOf(region);
  const window = full.slice(Math.max(0, at - YEAR_LEAD_IN), at + region.length);
  return [...window.matchAll(STATED_TAX_YEAR)].map((m) => Number(m[1]));
}

function parseStandardDeductions(raw: string, current: Record<string, unknown>): ParseOutcome {
  const full = withoutDependentRows(visibleText(raw));
  raw = deductionTableRegion(full);
  const taxYear = Number(current.taxYear);
  const stated = statedTaxYears(full, raw);
  if (Number.isInteger(taxYear) && stated.length > 0 && !stated.includes(taxYear)) {
    return {
      ok: false,
      reason:
        `this table states tax year ${[...new Set(stated)].join(" and ")} and this shard is ` +
        `${taxYear}; refusing — a page that names its own year has said it is not this one`,
      // The page is fine and the parser is fine; the year has not arrived.
      settled: Math.max(...stated) < taxYear,
    };
  }
  const shard = clone(current);
  const deductions = {
    ...((shard.standardDeductionByFilingStatus as Record<string, number>) ?? {}),
  };
  let anchored = 0;
  for (const { key, pattern } of FILING_LABELS) {
    if (!(key in deductions)) continue;
    // Two ways a page can hand back the wrong number, both seen in the wild.
    //
    // 1. A SIDE-BY-SIDE table. Rhode Island's inflation advisory prints
    //    "Filing status 2025 2026 / Single $10,900 $11,200" — last year beside
    //    this one. The pattern stops at the first `$`, so it takes 2025's and
    //    rolls the shard BACKWARDS a year. The tell is a second amount sitting
    //    immediately after the first.
    // 2. The label stated more than once with different amounts elsewhere on
    //    the page.
    //
    // (2) is always a refusal. (1) is a refusal only while the table declines to
    // say which column is which — where it says so in a year header, the shard's
    // own tax year picks the column, because a document that labels its columns
    // is not ambiguous and refusing it would be the parser's failure, not the
    // page's. Everything else refuses: a wrong figure with a live citation is
    // the failure this project cannot tolerate, and "could not parse" costs only
    // an alert.
    const values = new Set<number>();
    let sideBySide: string | null = null;
    for (const match of raw.matchAll(new RegExp(pattern.source, pattern.flags + "g"))) {
      const amount = parseAmount(match[1] as string);
      if (!Number.isFinite(amount) || amount <= 0) continue;
      // The whole row, not just the first cell: the label's own amount plus any
      // sitting beside it.
      const amountAt = match.index + match[0].length - (match[1] as string).length;
      const run = amountRun(raw, amountAt);
      if (run.length > 1) {
        const column = yearColumnIndex(raw, shard.taxYear, match.index);
        if (column !== null && column < run.length) {
          values.add(run[column]!);
          continue;
        }
        // Kansas' book runs a whole tax table into one row, so say how wide the
        // run is and show its head rather than printing two hundred numbers at
        // a reader who stopped at the third.
        const head = run.slice(0, 3).join(", ");
        sideBySide = run.length > 3 ? `${run.length} amounts: ${head}, …` : head;
        continue;
      }
      values.add(amount);
    }
    if (sideBySide !== null) {
      return {
        ok: false,
        reason:
          `the ${key} standard deduction is followed immediately by more amounts ` +
          `(${sideBySide}) — a table row, and no year header above it says which column ` +
          `is this shard's; refusing to guess`,
      };
    }
    if (values.size > 1) {
      return {
        ok: false,
        reason:
          `the page states more than one ${key} standard deduction ` +
          `(${[...values].sort((a, b) => a - b).join(", ")}); refusing to guess which one is this shard's`,
      };
    }
    if (values.size === 1) {
      const amount = [...values][0]!;
      const drift = implausibleDrift(deductions[key] as number, amount);
      if (drift !== null) {
        return {
          ok: false,
          reason: `the ${key} standard deduction ${drift}; refusing — either the page moved or this is not the figure`,
        };
      }
      deductions[key] = amount;
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

// --- Georgia (an amount, then the statuses it applies to) --------------------

/**
 * Georgia's standard deduction, from the sentence Georgia actually publishes.
 *
 * Every pattern above reads label-then-amount, and Georgia states it the other
 * way round — in its Employer's Withholding Tax Guide and, in nearly the same
 * words, on its Important Tax Updates page:
 *
 *   Georgia standard deductions have increased to $30,000 for taxpayers filing
 *   Married Filing Jointly and $15,000 for Single, Head of Household, and
 *   Married Filing Separate taxpayers.
 *
 * This is the California failure with no way out. There, the FTB stated the
 * figures backwards in one document ("$5,706 single … $11,412 married/RDP
 * filing jointly", where `single` reaches past its own figure) and the right way
 * round in another, so the adapter was pointed at the other one. Georgia states
 * it backwards in both of its documents, so there is nothing to repoint to.
 *
 * Reading it needs a different unit than "label, then the next amount". The
 * sentence's unit is **an amount and the list of statuses it applies to**, and
 * that list is what makes Georgia unusual anyway: the deduction does NOT double
 * for head of household there — head of household takes the single amount, like
 * married filing separately. A parser that assumed the federal 1.5× shape would
 * be wrong about Georgia by $7,500 while looking perfectly healthy, so it reads
 * the list instead of assuming it.
 *
 * Adding this as a general fallback was the other option and is the worse one:
 * on a page that states things label-first, an amount-first pattern reads every
 * figure off by one row, which is exactly how California's 540-ES turns $5,706
 * into $11,412. The two readings disagree on Georgia's own sentence — read
 * label-first, "Married Filing Jointly" reaches forward to $15,000 — so there is
 * no both-must-agree rule that keeps Georgia. It is a shape, it gets a parser.
 *
 * The guide's own year is checked against the shard's, the Form 446 rule: it is
 * reissued annually at a URL carrying the year, and a stale one states last
 * year's figures perfectly.
 */
function parseAmountThenStatusDeductions(
  raw: string,
  current: Record<string, unknown>,
  /**
   * A masthead the document must carry, for a source reissued annually at a URL
   * that carries the year — Georgia's guide, the Form 446 rule. A one-off
   * document (South Carolina's H. 4216 announcement) has no such masthead and
   * passes none.
   */
  mustState?: { pattern: (taxYear: number) => RegExp; reason: (taxYear: number) => string },
): ParseOutcome {
  const text = visibleText(raw);
  const taxYear = Number(current.taxYear);
  if (mustState && Number.isInteger(taxYear) && !mustState.pattern(taxYear).test(text)) {
    return { ok: false, reason: mustState.reason(taxYear) };
  }
  const shard = clone(current);
  const deductions = {
    ...((shard.standardDeductionByFilingStatus as Record<string, number>) ?? {}),
  };
  const claimed = new Map<string, number>();
  // "$30,000 for taxpayers filing Married Filing Jointly and " — the span runs
  // to the next amount, which is where the next status list begins.
  for (const match of text.matchAll(/\$([\d,]{4,})\s+for\s+([^$]{0,80})/gi)) {
    const amount = parseAmount(match[1] as string);
    if (!Number.isFinite(amount) || amount <= 0) continue;
    const applies = match[2] as string;
    for (const { key, label } of FILING_LABELS) {
      if (!(key in deductions)) continue;
      if (!label.test(applies)) continue;
      const already = claimed.get(key);
      if (already !== undefined && already !== amount) {
        return {
          ok: false,
          reason: `two amounts claim the ${key} standard deduction (${already} and ${amount}); refusing to guess which`,
        };
      }
      claimed.set(key, amount);
    }
  }
  if (claimed.size === 0) {
    return {
      ok: false,
      reason: "could not anchor an amount followed by the filing statuses it applies to",
    };
  }
  for (const [key, amount] of claimed) {
    const drift = implausibleDrift(deductions[key] as number, amount);
    if (drift !== null) {
      return {
        ok: false,
        reason: `the ${key} standard deduction ${drift}; refusing — either the page moved or this is not the figure`,
      };
    }
    deductions[key] = amount;
  }
  shard.standardDeductionByFilingStatus = deductions;
  return { ok: true, shard };
}

// --- Wisconsin (a deduction that is the third cell of a phase-out schedule) ---

/**
 * Wisconsin's standard deduction, from Form 1-ES's schedules.
 *
 * Wisconsin does not state a standard deduction as a figure. It states four
 * phase-out schedules, one per filing status, and the number this shard wants is
 * the *maximum* — the amount that applies before the phase-out starts biting,
 * which is the third cell of the first row:
 *
 *   Schedule for Single Taxpayers
 *   If Wisconsin income is:  but over –  not over –  The 2026 Standard Deduction is:
 *                            $ 0        $ 20,119    $ 13,960
 *                              20,119     136,453     13,960 less 12% of ...
 *
 * No label-then-amount pattern reaches that. "Single" is 85 characters and a
 * column heading away from anything shaped like dollars, and the first thing it
 * would reach is the `$ 0` that starts the income band. Worse, the same document
 * carries "Schedule for Married Filing Separately" ($12,280) directly under
 * "Married Filing Jointly" ($25,840), and a shared pattern for `married ...
 * jointly` has nothing to keep it out of the wrong schedule.
 *
 * So the schedules are addressed by name and the row is read positionally: the
 * band that begins at $0, its ceiling, then the deduction. The document's own
 * year gates it — Form 1-ES is reissued annually at a URL carrying the year
 * (TaxForms2026/), and its schedules say "The 2026 Standard Deduction is",
 * which is the Form 446 rule and the reason a stale one cannot read as current.
 */
const WISCONSIN_SCHEDULES: { key: string; heading: RegExp }[] = [
  { key: "single", heading: /Schedule for Single\b/i },
  { key: "head_of_household", heading: /Schedule for Head of Household\b/i },
  { key: "married_jointly", heading: /Schedule for Married Filing Jointly\b/i },
];

function parseWisconsinDeduction(raw: string, current: Record<string, unknown>): ParseOutcome {
  const text = visibleText(raw);
  const taxYear = Number(current.taxYear);
  if (
    Number.isInteger(taxYear) &&
    !new RegExp(`The ${taxYear} Standard Deduction is`, "i").test(text)
  ) {
    return {
      ok: false,
      reason: `this document does not state "The ${taxYear} Standard Deduction" — Form 1-ES is reissued each year at a URL carrying the year, and a stale one states last year's schedules perfectly`,
      settled: true,
    };
  }
  const shard = clone(current);
  const deductions = {
    ...((shard.standardDeductionByFilingStatus as Record<string, number>) ?? {}),
  };
  for (const { key, heading } of WISCONSIN_SCHEDULES) {
    if (!(key in deductions)) continue;
    const at = heading.exec(text);
    if (!at) {
      return { ok: false, reason: `could not find Wisconsin's ${key} deduction schedule` };
    }
    const row = /\$\s*0\s+\$\s*([\d,]{4,})\s+\$\s*([\d,]{4,})/.exec(
      text.slice(at.index, at.index + 260),
    );
    if (!row) {
      return {
        ok: false,
        reason: `Wisconsin's ${key} schedule does not open with the $0 band and its deduction`,
      };
    }
    const amount = parseAmount(row[2] as string);
    const drift = implausibleDrift(deductions[key] as number, amount);
    if (drift !== null) {
      return {
        ok: false,
        reason: `the ${key} standard deduction ${drift}; refusing — either the form moved or this is not the figure`,
      };
    }
    deductions[key] = amount;
  }
  shard.standardDeductionByFilingStatus = deductions;
  return { ok: true, shard };
}

// --- Missouri (a ladder split across a rate row and a payroll row) -----------

/**
 * Missouri's brackets, from the withholding formula the shard already cites.
 *
 * The page this adapter used to watch — dor.mo.gov's year-changes page — prints
 * an eight-tier ladder under "Tax Rate Changes – Indexed for Inflation" with no
 * year anywhere near it, and that ladder is last year's. Reading it proposed
 * rolling every threshold in the state back a year, which the undated-schedule
 * rule in the graduated parser now refuses.
 *
 * The Withholding Tax Formula states the same ladder and states its year. It
 * splits it across two rows, because it is a form a payroll clerk works down:
 *
 *   Rates            0.00%  2.00%  2.50%  3.00%  3.50%  4.00%  4.50%  4.70%
 *   Annual Payroll   $ 0.00 to $1,348.00   1,348.01 to 2,696.00   ...
 *                    ...  8,088.01 to 9,436.00   9,436.01 and over
 *
 * so the rate and the threshold it applies to are four hundred characters and
 * four other payroll frequencies apart, and no "rate in excess of a threshold"
 * pattern can pair them. They are read as two rows and zipped, which is only
 * safe because the count is checked twice over: the rates and the bounds must
 * agree with each other AND with the committed schedule, or a reviewer owns the
 * reshape — the same boundary the graduated parser draws.
 *
 * A band's opening cent is its predecessor's ceiling plus a penny ($1,348.01
 * follows $1,348.00), so bounds are deduped on the dollar and the ladder comes
 * out as 0 / 1,348 / 2,696 / … / 9,436.
 */
function parseMissouriWithholdingFormula(
  raw: string,
  current: Record<string, unknown>,
): ParseOutcome {
  const text = visibleText(raw);
  const taxYear = Number(current.taxYear);
  if (
    Number.isInteger(taxYear) &&
    !new RegExp(`${taxYear} Missouri Withholding Tax Formula`, "i").test(text)
  ) {
    return {
      ok: false,
      reason: `this is not the ${taxYear} Missouri Withholding Tax Formula — it is reissued each year, and a stale one states last year's ladder perfectly`,
      settled: true,
    };
  }
  const ratesRow = /\bRates\b((?:\s*[\d.]+\s*%){4,})/i.exec(text);
  const annualRow = /\bAnnual Payroll\b([\s\S]{0,400}?)(?:Note:|$)/i.exec(text);
  if (!ratesRow || !annualRow) {
    return {
      ok: false,
      reason: "could not find the formula's Rates row and its Annual Payroll bands",
    };
  }
  const rates = [...(ratesRow[1] as string).matchAll(/([\d.]+)\s*%/g)].map((m) =>
    pctToRate(Number(m[1])),
  );
  const bounds: number[] = [];
  for (const m of (annualRow[1] as string).matchAll(/([\d,]+)\.\d{2}/g)) {
    const dollars = parseAmount(m[1] as string);
    if (Number.isFinite(dollars) && !bounds.includes(dollars)) bounds.push(dollars);
  }
  bounds.sort((a, b) => a - b);
  if (rates.length !== bounds.length) {
    return {
      ok: false,
      reason: `the formula states ${rates.length} rates and ${bounds.length} annual bands; refusing to zip rows that do not line up`,
    };
  }
  const shard = clone(current);
  const brackets = shard.bracketsByFilingStatus as
    | Record<string, { lowerBound: number; rate: number }[]>
    | undefined;
  if (!brackets) {
    return { ok: false, reason: "shard has no bracketsByFilingStatus to overlay" };
  }
  const assembled = rates.map((rate, i) => ({ lowerBound: bounds[i]!, rate }));
  let overlaid = 0;
  for (const status of Object.keys(brackets)) {
    const arr = brackets[status];
    if (!Array.isArray(arr) || arr.length !== assembled.length) continue;
    brackets[status] = assembled.map((tier) => ({ ...tier }));
    overlaid += 1;
  }
  if (overlaid === 0) {
    return {
      ok: false,
      reason: `the formula states ${assembled.length} tiers and the committed schedule has a different count; a reshape is the reviewer's step`,
    };
  }
  return { ok: true, shard };
}

// --- West Virginia (a published tax table, read as rows) ---------------------

/**
 * West Virginia's schedule, from the rate-cut page's own table.
 *
 * The generic graduated parser cannot read this page, and the reason is worth
 * keeping: three different things on it anchor at $10,000. The SB 392 headline
 * ("a 5% income tax cut for all West Virginians"), the base tier ("Not over
 * $10,000 2.11% of taxable income"), and the second tier ("$211.00 plus 2.81%
 * of the excess over $10,000"). A generic rate-then-threshold pattern reaches
 * all three and the collision guard, rightly, refuses the lot.
 *
 * The page states the ladder unambiguously all the same, as the table a filer
 * reads down:
 *
 *   If the WV Taxable Income is:      The tax is:
 *   Not over $10,000                  2.11% of taxable income
 *   Over $10,000 but not over $25,000 $211.00 plus 2.81% of the excess over $10,000
 *   Over $25,000 but not over $40,000 $632.50 plus 3.16% of excess over $25,000
 *   ...
 *
 * Every row states its own floor twice — once to open the band, once as "of the
 * excess over" — and the second one is the authoritative pairing, because it
 * sits inside the same clause as its rate. Reading the trailing figure rather
 * than the leading one is what keeps the base rate out of the second bracket.
 *
 * The page also carries a SECOND schedule, for married individuals filing
 * separate returns, whose bands are half as wide ($5,000 / $12,500 / …). That
 * status is not modelled here, and a ladder assembled from both is thirteen
 * tiers of nonsense, so the read stops where that schedule begins.
 */
function parseWestVirginiaTable(raw: string, current: Record<string, unknown>): ParseOutcome {
  const text = visibleText(raw);
  const separate = /For married individuals filing separate returns/i.exec(text);
  const scope = separate ? text.slice(0, separate.index) : text;

  const base = /Not over \$?([\d,]+)\s*([\d.]+)\s*%/i.exec(scope);
  const tiers: { lowerBound: number; rate: number }[] = [];
  for (const m of scope.matchAll(/([\d.]+)\s*%\s*of\s*(?:the\s*)?excess\s*over\s*\$?([\d,]+)/gi)) {
    const rate = pctToRate(Number(m[1]));
    const lowerBound = parseAmount(m[2] as string);
    if (!(rate > 0 && rate <= 0.15) || !(lowerBound > 0)) continue;
    const clash = tiers.find((t) => t.lowerBound === lowerBound);
    if (clash) {
      if (clash.rate === rate) continue;
      return {
        ok: false,
        reason: `two rates claim the $${lowerBound} band (${(clash.rate * 100).toFixed(2)}% and ${(rate * 100).toFixed(2)}%); refusing`,
      };
    }
    tiers.push({ lowerBound, rate });
  }
  if (!base || tiers.length === 0) {
    return { ok: false, reason: "could not read West Virginia's tax table as rows" };
  }
  tiers.sort((a, b) => a.lowerBound - b.lowerBound);
  const assembled = [{ lowerBound: 0, rate: pctToRate(Number(base[2])) }, ...tiers];

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
    if (!Array.isArray(arr) || arr.length !== assembled.length) continue;
    brackets[status] = assembled.map((tier) => ({ ...tier }));
    overlaid += 1;
  }
  if (overlaid === 0) {
    return {
      ok: false,
      reason: `the table states ${assembled.length} tiers and the committed schedule has a different count; a reshape is the reviewer's step`,
    };
  }
  return { ok: true, shard };
}

// --- A source that is behind its own state's law -----------------------------

/**
 * Wrap a parser so that when it cannot read a page whose figures are KNOWN to be
 * superseded, the refusal says which law superseded them.
 *
 * This is the one failure a plausibility guard cannot reach: a page that is
 * reachable, parseable, and wrong. Iowa was the first — its provisions page
 * still described a flat 3.9% that SF 2442 repealed before it took effect — and
 * the honest outcome was a refusal naming the bill, because 3.8 to 3.9 is
 * exactly the size of a real rate cut and nothing generic separates them.
 *
 * Utah is the same shape with the direction reversed. SB 60 was signed
 * 2026-03-23 and cut the individual rate from 4.50% to 4.45% for tax years
 * beginning on or after 2026-01-01 — the enrolled bill amends §59-10-104 to
 * "(b) 4.45%" over a struck "[(b) 4.5%.]" — and the Tax Commission's own pages
 * have not caught up: the rate schedule's newest row still reads "January 1,
 * 2025 – current, 4.5%" and the line-by-line instructions still say "multiply
 * line 9 by 4.5 percent". The shard carries the law. The page carries the year
 * before it.
 *
 * The wrapper is deliberately not a flat refusal, which is what Iowa's was and
 * what had to be deleted by hand once its source was replaced. The real parser
 * runs first: the day Utah adds a 2026 row to that table, the by-year reader
 * finds it, the rate agrees, and this explanation stops being printed without
 * anyone having to notice. A refusal that clears itself is worth more than one
 * someone has to remember.
 *
 * Which is why it takes a predicate rather than just refusing on failure. The
 * first version returned the refusal only when the parser could not read the
 * page — so a page that was rewritten into a shape the parser CAN read, still
 * carrying the old figure, would have sailed through and proposed the rollback
 * this exists to prevent. What is known here is not "this page is unreadable",
 * it is "this page states X and X is superseded", so that is what is checked.
 */
function refuseWhileSourceIsBehind(
  parse: (raw: string, current: Record<string, unknown>) => ParseOutcome,
  /** True when the parsed shard still carries the figure known to be superseded. */
  stillSuperseded: (shard: Record<string, unknown>) => boolean,
  reason: string,
): (raw: string, current: Record<string, unknown>) => ParseOutcome {
  return (raw, current) => {
    const outcome = parse(raw, current);
    if (!outcome.ok) return { ok: false, reason, settled: true };
    return stillSuperseded(outcome.shard) ? { ok: false, reason, settled: true } : outcome;
  };
}

/**
 * The other reason a source cannot be read, and the one "could not anchor any
 * standard-deduction figure by filing status" hides: **the state has not
 * published the shard's year yet.**
 *
 * Those two refusals look identical in the report and mean opposite things. One
 * says a parser is broken and someone should fix it. The other says nothing is
 * wrong with anything — the figure does not exist yet, and the shard says so
 * itself. Reporting the second as the first sends a reader to repair a parser
 * that is fine, which is how a report earns being ignored.
 *
 * Oregon and Vermont are both in the second state today, and both shards are
 * explicit about it in their own notes: Oregon carries the 2025 Form OR-40
 * indexed standard deduction because the 2026 booklet is not out, Vermont
 * carries the 2025 IN-111 schedule because the department has posted only 2026
 * *withholding* charts. Deliberately a year behind and documented, not stale by
 * accident.
 *
 * The tempting fix is to point each adapter at the document the shard cites —
 * both parse perfectly, and Oregon's 2025 booklet returns exactly the shard's
 * $2,835 / $5,670 / $4,560. That is the Rev. Proc. 2023-34 mistake with a
 * different number on it: a document for a year that has already closed can
 * never change, so it reports agreement forever and a change never, and it
 * would go on doing that long after the state published the year the shard is
 * actually labelled. A watch of nothing, wearing the same green as a working
 * one.
 *
 * So the real parser still runs first — the day the state's page states the
 * shard's year, it anchors and this explanation stops being printed, with
 * nobody having to remember to delete it.
 */
/**
 * The third reason a source cannot be read, after "the parser broke" and "the
 * year is not out yet": **there is no annual figure, because the figure is
 * statutory.**
 *
 * Delaware's standard deduction has been $3,250 / $6,500 since tax year 2000.
 * 30 Del. C. §1108 sets it and nothing indexes it, so an adapter asking a page
 * for this year's Delaware deduction is asking a question with no annual answer,
 * and reporting the absence as "could not anchor" says a parser is broken when
 * the truth is that nothing moved and nothing was ever going to.
 *
 * The section is also a genuinely bad parse target, which is the second half of
 * the argument. It states the amounts as a HISTORY of periods — "$1,300 ...
 * before January 1, 1999", then "$3,250 ... before January 1, 2000", then
 * "$3,250 ... after December 31, 1999" — the Colorado trap, where every pattern
 * reaches the first row and each row is a real Delaware figure. And it never
 * uses a filing-status label the parser knows: it says "resident spouses ... if
 * they file a joint return".
 *
 * So it moves to the other half of the guarantee, the one already carrying six
 * hand-authored shards: a fingerprint of the statute in
 * `scripts/refresh/source-watch.json`, checked on a schedule, which asks a
 * person to read any change rather than parsing an amendment. That is the same
 * remedy the adapter check's own report recommends, taken.
 */
/**
 * A refusal that does NOT run the parser first, because the parser succeeding is
 * the danger.
 *
 * Every other wrapper here puts the real parser in front, so the explanation
 * clears itself the day the page starts stating the figure. Connecticut is the
 * case where that reasoning inverts. Connecticut has **no standard deduction**;
 * the shard's `standardDeductionByFilingStatus` carries the CT-1040 Table A
 * *personal exemption*, which is the subtraction Connecticut actually makes.
 * The DRS page the adapter watches states neither phrase. What it states is the
 * gross-income filing thresholds:
 *
 *   ... exceeds: $12,000 and you are married filing separately; $15,000 and you
 *   are filing single; $19,000 and you are filing head of household; or $24,000
 *   and you are married filing jointly ...
 *
 * Those are $15,000 / $24,000 / $19,000 — the exemption amounts, exactly. They
 * coincide today and they are different things, so an anchor there is right by
 * accident, and the accident ends silently the first year Connecticut moves one
 * and not the other. A guard that lets the parser try and accepts a plausible
 * answer is precisely the wrong shape for a page whose wrong answer is
 * plausible.
 *
 * So this refuses outright and says why. Connecticut having no standard
 * deduction is statutory (Conn. Gen. Stat. §12-701 defines Connecticut taxable
 * income without one), so unlike Iowa's flat refusal this premise does not go
 * stale quietly — and if Connecticut ever enacts one, that is a reform a person
 * transcribes, not a figure a scrape rolls forward.
 */
function refuseBecauseThePageMeansSomethingElse(
  reason: string,
): (raw: string, current: Record<string, unknown>) => ParseOutcome {
  return () => ({ ok: false, reason, settled: true });
}

function refuseBecauseTheFigureIsStatutory(
  parse: (raw: string, current: Record<string, unknown>) => ParseOutcome,
  reason: string,
): (raw: string, current: Record<string, unknown>) => ParseOutcome {
  return refuseWhileSourceIsBehind(parse, () => false, reason);
}

function refuseUntilTheStatePublishes(
  parse: (raw: string, current: Record<string, unknown>) => ParseOutcome,
  reason: string,
): (raw: string, current: Record<string, unknown>) => ParseOutcome {
  return refuseWhileSourceIsBehind(parse, () => false, reason);
}

// --- Michigan (its rate is on page one of a withholding guide) ----------------

/**
 * Michigan's flat rate and personal exemption, from Form 446.
 *
 * The michigan.gov individual-income page states neither figure — it is a menu,
 * and the adapter had been asking it for a rate for a year. Form 446, the
 * withholding guide, states both in its masthead:
 *
 *   446 (Rev. 02-26) 2026 Michigan Income Tax Withholding Guide
 *   Withholding Rate: 4.25%   Personal Exemption Amount: $5,900
 *
 * Which needs a word of justification, because "withholding rate" is not
 * generally the same figure as an income-tax rate — plenty of states withhold
 * supplemental wages at a rate that appears nowhere in their bracket schedule,
 * and a generic pattern for it would quietly import that error into every state
 * that has one. Michigan is a case where they are the same by statute: MCL
 * 206.51 sets one rate on all taxable income and MCL 206.351 withholds at it.
 * So this is a dedicated parser rather than another pattern in the shared list,
 * the same way Massachusetts' surtax and New Jersey's top bracket are.
 *
 * The document's own year is checked against the shard's. Form 446 is reissued
 * annually at a URL that carries the tax year, so the day this one goes stale it
 * will still parse perfectly and state last year's rate — the Iowa failure, and
 * the only defence against it is to insist the document says which year it is.
 */
function parseMichigan(raw: string, current: Record<string, unknown>): ParseOutcome {
  const text = visibleText(raw);
  const taxYear = Number(current.taxYear);
  if (
    Number.isInteger(taxYear) &&
    !new RegExp(`${taxYear} Michigan Income Tax Withholding Guide`, "i").test(text)
  ) {
    return {
      ok: false,
      reason: `this is not the ${taxYear} Michigan Income Tax Withholding Guide — Form 446 is reissued each year at a URL carrying the year, and a stale one states last year's rate perfectly`,
    };
  }
  const rateMatch = /Withholding Rate:\s*([\d.]+)\s*%/i.exec(text);
  if (!rateMatch) {
    return { ok: false, reason: "could not anchor Form 446's stated withholding rate" };
  }
  const percent = Number(rateMatch[1]);
  if (!(percent > 0 && percent <= 15)) {
    return { ok: false, reason: `anchored an implausible flat rate (${rateMatch[1]}%)` };
  }

  const shard = clone(current);
  const brackets = shard.bracketsByFilingStatus as
    | Record<string, { lowerBound: number; rate: number }[]>
    | undefined;
  if (!brackets) {
    return { ok: false, reason: "shard has no bracketsByFilingStatus to overlay" };
  }
  const rate = pctToRate(percent);
  for (const arr of Object.values(brackets)) {
    if (!Array.isArray(arr)) continue;
    const taxed = arr.filter((b) => b && b.rate > 0);
    if (taxed.length === 1 && taxed[0]) taxed[0].rate = rate;
  }

  // The exemption is stated beside the rate, and the paired statuses stay for
  // the reviewer exactly as they do in the shared flat parser.
  const exemptions = shard.personalExemptionByFilingStatus as Record<string, number> | undefined;
  const exMatch = /Personal Exemption Amount:\s*\$([\d,]{3,})/i.exec(text);
  if (exemptions && "single" in exemptions && exMatch) {
    const amount = parseAmount(exMatch[1] as string);
    const drift = implausibleDrift(exemptions.single as number, amount);
    if (drift) {
      return {
        ok: false,
        reason: `the personal exemption ${drift}; refusing — either the form moved or this is not the figure`,
      };
    }
    exemptions.single = amount;
  }
  return { ok: true, shard };
}

// --- IRS revenue procedure (statutory-cite anchored) --------------------------

/**
 * The federal standard deduction, read out of the IRS annual revenue procedure.
 *
 * This one needs its own parser rather than the generic prose one, for a reason
 * the generic one cannot fix: **a revenue procedure states more than one year.**
 * Rev. Proc. 2025-32 carries the 2026 table and, a few pages earlier, the 2025
 * table it is replacing (the OBBBA amounts, $15,750 / $23,625 / $31,500). Both
 * are real federal standard deductions, they are labelled identically, and the
 * generic parser reaches whichever comes first — so pointed at the right
 * document it would have proposed rolling the federal shard back a year.
 *
 * Two anchors, both taken from the document rather than guessed at:
 *
 * **The year.** The section opens "For taxable years beginning in 2026, the
 * standard deduction amounts under § 63(c)(2) are as follows", and the shard
 * says which year it is. So the shard's own `taxYear` selects the table, and
 * nothing else on the page is even read. A document that does not state the
 * shard's year is refused by name — which is what next October looks like, when
 * the shard rolls to 2027 and this URL is last year's revenue procedure. That
 * refusal is the point. The adapter had been watching Rev. Proc. **2023-34** for
 * a 2026 shard: a document frozen in 2023, which will report agreement forever
 * and can never report a change, the most silent form of not watching.
 *
 * **The row.** Each row names its statutory subsection — "(§ 1(j)(2)(A))" for
 * joint and surviving spouses, (B) heads of households, (C) unmarried, (D)
 * married filing separately. A statutory cite is a better anchor than a prose
 * label: it is what the table is organised by, it does not vary with the
 * drafter, and it distinguishes the two $16,100 rows that prose cannot.
 */
function parseIrsStandardDeductions(raw: string, current: Record<string, unknown>): ParseOutcome {
  const text = raw.replace(/\s+/g, " ");
  const year = Number(current.taxYear);
  if (!Number.isInteger(year)) {
    return { ok: false, reason: "shard has no taxYear to select the revenue procedure's table" };
  }
  const opener = new RegExp(
    `taxable years? beginning in ${year}, the standard deduction amounts? under`,
    "i",
  );
  const at = opener.exec(text);
  if (!at) {
    return {
      ok: false,
      reason:
        `this revenue procedure states no standard-deduction table for ${year} — it is ` +
        "probably the previous year's, and the adapter should be pointed at the current one",
    };
  }
  // Long enough for the four rows, short enough that it cannot reach the next
  // section's figures (the dependent and aged-or-blind amounts follow it).
  const table = text.slice(at.index, at.index + 600);

  const rows: { key: string; subsection: string }[] = [
    { key: "married_jointly", subsection: "A" },
    { key: "qualifying_surviving_spouse", subsection: "A" },
    { key: "head_of_household", subsection: "B" },
    { key: "single", subsection: "C" },
    { key: "married_separately", subsection: "D" },
  ];
  const deductions = {
    ...((current.standardDeductionByFilingStatus as Record<string, number>) ?? {}),
  };
  let anchored = 0;
  for (const { key, subsection } of rows) {
    if (!(key in deductions)) continue;
    const row = new RegExp(
      `§ ?1\\(j\\)\\(2\\)\\(${subsection}\\)\\)?\\s*\\$([\\d,]{4,})`,
      "i",
    ).exec(table);
    if (!row) continue;
    const amount = parseAmount(row[1] as string);
    const drift = implausibleDrift(deductions[key] as number, amount);
    if (drift) {
      return {
        ok: false,
        reason: `the ${key} standard deduction ${drift}; refusing — either the table moved or this is not the figure`,
      };
    }
    deductions[key] = amount;
    anchored += 1;
  }
  if (anchored === 0) {
    return {
      ok: false,
      reason: `found the ${year} table but no row anchored to its § 1(j)(2) subsection cite`,
    };
  }
  const shard = clone(current);
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
/**
 * Anchor the one income-tax rate a page states, or say why not.
 *
 * Real agency prose does not read "the income tax rate is 4.95%". It reads "The
 * Indiana Individual adjusted gross income tax rate for 2026 is 2.95%" and
 * "Pennsylvania personal income tax is levied at the rate of 3.07 percent" —
 * the words "tax", "rate" and the number separated by a clause. So the pattern
 * bridges a bounded run of characters between them, stopping at a sentence end
 * or a percent sign so it can never reach across into a neighbouring figure.
 *
 * Bridging widens what matches, which is the danger: a page that also carries a
 * sales-tax rate, an interest rate, or last year's income-tax rate could hand
 * back a plausible wrong number, and an adapter that anchors the WRONG figure is
 * far worse than one that anchors none. So this collects EVERY match and refuses
 * unless they all agree. Disagreement routes to the fail-safe alert and a human,
 * which is the same posture the rest of the pipeline takes.
 */
/**
 * A rate whose number is introduced by a bare four-digit year is a row in a
 * by-year table, not a statement of the current rate.
 *
 * Colorado's Individual Income Tax Guide prints "Colorado Income Tax Rates / Tax
 * Year / Tax Rate / 2019 4.5% / 2020 4.55% / 2021 4.5% / 2022 4.4% / 2023 4.4% /
 * 2024 4.25% / 2025 4.4%". Every pattern here reaches the first row, so the
 * guide would have proposed rolling Colorado to its 2019 rate — the same failure
 * as the standard-deduction parser's two-column table, in a different shape. And
 * a rate history is the one table where the wrong row is always plausible: these
 * are all real Colorado rates, they differ by tenths, and 2024's 4.25% was a
 * one-year reduction, so nothing about the value itself says which row it is.
 *
 * The year has to be adjacent. Indiana's "income tax rate for 2026 is 2.95%"
 * names a year too, but with "is" between it and the number, which is the
 * difference between a sentence about this year and a column heading.
 *
 * The refusal is a second choice, not the first. A table labelled by year can be
 * asked for a year, and the shard says which one it is — so the row for the
 * shard's own tax year is read when there is one, exactly as the federal revenue
 * procedure is. Only when there is no such row does this refuse, and then it
 * says which year the rows stop at, because a table that ends before the shard
 * begins is the state not having published yet, which is a different thing from
 * a parser that cannot read.
 */
const YEAR_LABELLED = /(?:19|20)\d{2}\s{0,3}$/;

export type FlatRateAnchor =
  | number
  | "none"
  | "ambiguous"
  /** Only by-year table rows matched, and none of them was the shard's year. */
  | { historical: true; latestYear: number | null };

export function anchorFlatRate(raw: string, taxYear?: number): FlatRateAnchor {
  const text = visibleText(raw);

  // A by-year rate table, read for the year the shard is actually about. This
  // runs first because it is the most specific thing a page can say: Colorado's
  // guide prints "Tax Year / Tax Rate / 2019 4.5% ... 2025 4.4%", and asking it
  // for one row by year is exact where reaching for "the current one" is a
  // guess. It is also how a table that has not caught up announces itself —
  // there is no 2026 row, so nothing matches and the refusal below can say the
  // rows stop at 2025 rather than that the page is unreadable.
  // A RUN of at least three year-then-rate pairs, not a single one. One "2026
  // 8%" anywhere in a document is a coincidence — Colorado's guide has several,
  // and the first draft of this read one of them and proposed an 8% flat tax.
  // Three in a row is a table; nothing else in agency prose looks like that.
  const yearRows: { year: number; rate: number }[] = [];
  for (const run of text.matchAll(/(?:(?:19|20)\d{2}\s{1,3}[\d.]+\s*%\s{0,3}){3,}/g)) {
    for (const pair of run[0].matchAll(/((?:19|20)\d{2})\s{1,3}([\d.]+)\s*%/g)) {
      const rate = Number(pair[2]);
      if (rate > 0 && rate <= 15) yearRows.push({ year: Number(pair[1]), rate });
    }
  }
  // The same table in the other layout: a heading per year with a whole rate
  // schedule under it, rather than one row per year. Idaho's is
  //
  //   Year 2025  Single  At least  No more than  Tax rate
  //              $1      $4,811    0.0%
  //              $4,812            5.3%
  //   Year 2024  ...
  //
  // which the row form cannot see — the year and its rate are forty characters
  // and two dollar amounts apart. A block is only read when it states exactly
  // ONE non-zero rate: Idaho repeats 5.3% for single and married, and a block
  // stating two different rates is a graduated schedule this parser has no
  // business reading. Two headings are required, because one "Year 2026" over a
  // percentage is a sentence, and several in sequence are a table.
  const headings = [...text.matchAll(/\bYear\s+((?:19|20)\d{2})\b/g)];
  if (headings.length >= 2) {
    for (const [i, heading] of headings.entries()) {
      const from = heading.index + heading[0].length;
      const to = headings[i + 1]?.index ?? Math.min(text.length, from + 400);
      const rates = new Set<number>();
      for (const hit of text.slice(from, to).matchAll(/([\d.]+)\s*%/g)) {
        const rate = Number(hit[1]);
        if (rate > 0 && rate <= 15) rates.add(rate);
      }
      if (rates.size === 1) yearRows.push({ year: Number(heading[1]), rate: [...rates][0]! });
    }
  }
  if (yearRows.length > 0 && taxYear !== undefined) {
    const mine = new Set(yearRows.filter((r) => r.year === taxYear).map((r) => r.rate));
    if (mine.size === 1) return [...mine][0]!;
    if (mine.size > 1) return "ambiguous";
  }
  const patterns = [
    // "income tax rate for 2026 is 2.95%", "income tax rate is 4.95%"
    /income[- ]?tax\s+rate[^.;%]{0,48}?([\d.]+)\s*(?:percent|%)/gi,
    // "personal income tax is levied at the rate of 3.07 percent"
    /income[- ]?tax\b[^.;%]{0,60}?\brate\s+of\s+([\d.]+)\s*(?:percent|%)/gi,
    // "a flat 3.07% tax"
    /\b([\d.]+)\s*(?:percent|%)\s+flat\b/gi,
    // "flat rate of 4.99%", "flat tax rate of 2.5%", "flat income tax rate of..."
    // — Arizona's is the middle one, and the words between "flat" and "rate"
    // are the only thing that was keeping it unread.
    /\bflat\s+(?:\w+\s+){0,2}?rate\s+of\s+([\d.]+)\s*(?:percent|%)/gi,
    // The table row: a label cell reading "Individual Income Tax" and a value
    // cell reading "4.95 percent of net income", with no "rate" between them
    // because the column heading already said it (Illinois, Louisiana's RIB).
    //
    // This is the loosest pattern here, so it is last, and its label carries
    // the word that keeps it honest: "individual". Illinois' page states four
    // rates in one table — corporate 7%, trusts 4.95%, replacement 2.5%/1.5%,
    // individual 4.95% — and "income tax" alone would match the first row it
    // reached. "Individual income tax" matches one row, and if a page ever has
    // two that disagree the guard below refuses rather than picks.
    /\bindividual\s+income[- ]?tax\b[^%]{0,120}?([\d.]+)\s*(?:percent|%)/gi,
  ];
  for (const pattern of patterns) {
    const found = new Set<number>();
    const historical = new Set<number>();
    for (const match of text.matchAll(pattern)) {
      const value = Number(match[1]);
      if (!Number.isFinite(value) || value <= 0 || value > 15) continue;
      // Where the captured number starts, so the words immediately before it
      // can be read. `match.index` is the start of the whole bridge, which for
      // these patterns is a clause or a table label away.
      const at = (match.index ?? 0) + match[0].lastIndexOf(match[1] as string);
      if (YEAR_LABELLED.test(text.slice(Math.max(0, at - 8), at))) historical.add(value);
      else found.add(value);
    }
    // Patterns are ordered most- to least-specific. The first that matches at
    // all decides, so a precise phrasing is never diluted by a looser one
    // elsewhere on the page.
    if (found.size === 1) return [...found][0]!;
    if (found.size > 1) return "ambiguous";
    if (historical.size > 0) {
      const years = yearRows.map((r) => r.year);
      return { historical: true, latestYear: years.length > 0 ? Math.max(...years) : null };
    }
  }
  // Nothing in prose, but the page did offer a by-year table and none of its
  // rows is this shard's year. That is the state not having published yet, and
  // it is a different fact from a page the parser cannot read — Idaho's
  // schedule stops at 2025 while its shard is on 2026, and reporting that as
  // "could not anchor the flat income-tax rate" sends a reader to fix a parser
  // that is working. The prose patterns run first, because Colorado's guide
  // carries BOTH a rate history and a sentence stating the current year.
  if (yearRows.length > 0 && taxYear !== undefined) {
    return { historical: true, latestYear: Math.max(...yearRows.map((r) => r.year)) };
  }
  return "none";
}

function parseFlatRateJurisdiction(raw: string, current: Record<string, unknown>): ParseOutcome {
  const taxYear = Number.isInteger(Number(current.taxYear)) ? Number(current.taxYear) : undefined;
  const percent = anchorFlatRate(raw, taxYear);
  if (percent === "none") {
    return { ok: false, reason: "could not anchor the flat income-tax rate" };
  }
  if (percent === "ambiguous") {
    return {
      ok: false,
      reason: "the page states more than one income-tax rate; refusing to guess which is current",
    };
  }
  if (typeof percent === "object") {
    const stops =
      percent.latestYear === null
        ? ""
        : ` The rows stop at ${percent.latestYear}${taxYear === undefined ? "" : `, and this shard is ${taxYear}`}, so the state has probably not published the shard's year yet.`;
    return {
      ok: false,
      reason:
        "the only rates on the page sit in a by-year table and none of them is this shard's" +
        ` year; refusing to guess which row is the current one.${stops}`,
      // A table whose rows stop before the shard's year is the state not having
      // published yet, which is a decision to wait rather than a parser to fix.
      settled: percent.latestYear !== null && taxYear !== undefined && percent.latestYear < taxYear,
    };
  }
  if (!Number.isFinite(percent) || percent <= 0 || percent > 15) {
    return { ok: false, reason: `anchored an implausible flat rate (${percent}%)` };
  }
  const rate = pctToRate(percent);

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
    if (!Array.isArray(arr)) continue;
    // A "flat" state is one with a single taxed rate. That is usually a
    // one-element ladder, but Idaho's schedule puts a 0% band underneath its one
    // rate (0% to $4,811 single, then 5.3% of the excess), and the rate is still
    // the only thing this parser anchors. So overlay whenever exactly one bracket
    // carries a non-zero rate, and leave the 0% band's threshold — which indexes
    // on its own schedule — for the reviewer.
    const taxed = arr.filter((b) => b && b.rate > 0);
    if (taxed.length === 1 && taxed[0]) {
      taxed[0].rate = rate;
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
  const text = visibleText(raw);
  // A schedule stated once per year, which is how a department publishes a
  // reform. Ohio prints "For taxable years beginning in 2025:" over a three-tier
  // schedule and "For taxable years beginning in 2024:" over the one before it,
  // and its 2026 schedule — two tiers, after HB 96 collapses the top rate — is
  // simply not up yet. Reading the page whole mixes years into one ladder and
  // then reports "count or shape changed", which is true of the mixture and
  // false of the page. The shard says which year it is, so the shard picks the
  // block; if its year is not there, the state has not published it.
  const years = [...text.matchAll(/for\s+taxable\s+years?\s+beginning\s+in\s+((?:19|20)\d{2})/gi)];
  const taxYear = Number(current.taxYear);
  let scope = text;
  if (years.length > 0 && Number.isInteger(taxYear)) {
    const mine = years.findIndex((y) => Number(y[1]) === taxYear);
    if (mine < 0) {
      const newest = Math.max(...years.map((y) => Number(y[1])));
      return {
        ok: false,
        reason:
          `the page states a schedule per year and none of them is ${taxYear}; the schedules ` +
          `stop at ${newest}, so the state has probably not published the shard's year yet`,
        settled: newest < taxYear,
      };
    }
    const from = years[mine]!.index;
    scope = text.slice(from, years[mine + 1]?.index ?? text.length);
  }
  const tierRe =
    /([\d.]+)\s*(?:percent|%)[^%$]*?(?:in excess of|over|above|exceeding)\s*\$?([\d,]{3,})/gi;
  const seen = new Map<number, number>();
  const tiers: { lowerBound: number; rate: number }[] = [];
  let match: RegExpExecArray | null;
  while ((match = tierRe.exec(scope)) !== null) {
    const rate = pctToRate(Number(match[1]));
    const lowerBound = parseAmount(match[2] as string);
    if (!Number.isFinite(rate) || rate <= 0 || rate > 0.15) continue;
    if (!Number.isFinite(lowerBound) || lowerBound <= 0) continue;
    // Two rates claiming the same threshold used to be resolved by keeping
    // whichever the regex reached first, silently. West Virginia shows what
    // that costs: its base tier reads "Not over $10,000 2.11% of taxable
    // income", and the next reads "Over $10,000 but not over $25,000 $211.00
    // plus 2.81% of the excess over $10,000" — so 2.11% and 2.81% both anchor
    // at $10,000, and first-wins writes the base rate into the second bracket.
    // A ladder assembled from a collision is wrong in a way nothing downstream
    // can see: it has the right shape, the right thresholds, and one rate off.
    const clash = seen.get(lowerBound);
    if (clash !== undefined) {
      if (clash === rate) continue;
      return {
        ok: false,
        reason:
          `two rates claim the same bracket threshold ($${lowerBound}: ` +
          `${(clash * 100).toFixed(2)}% and ${(rate * 100).toFixed(2)}%); refusing — a ladder ` +
          "assembled from a collision has the right shape and one wrong rate",
      };
    }
    seen.set(lowerBound, rate);
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
    // A schedule with NO year on it may CONFIRM the shard and may not change it.
    //
    // Missouri proved why the moment this parser started reading visible text
    // instead of markup. Its year-changes page prints an eight-tier ladder under
    // "Tax Rate Changes – Indexed for Inflation", with no year anywhere near it,
    // and that ladder is 2025's: $1,313 steps where the 2026 shard carries
    // $1,348. Read whole it parsed cleanly and proposed rolling every threshold
    // in the state back a year, under a live citation. An indexed schedule that
    // does not say which year it is cannot be told from one that is a year
    // stale — the Colorado lesson with brackets instead of a rate.
    //
    // Refusing every unlabelled schedule would be the wrong correction, because
    // a schedule that does not index has no year to state: Mississippi's 4%
    // over $10,000 is statutory and has read correctly for years. So the test is
    // not "is there a year" but "is this a change I cannot date". Confirming is
    // always safe; changing on an undated page never is.
    if (years.length === 0) {
      const differs = assembled.find(
        (tier, i) => tier.lowerBound !== arr[i]?.lowerBound || tier.rate !== arr[i]?.rate,
      );
      if (differs) {
        return {
          ok: false,
          reason:
            "the page states a bracket schedule with no tax year attached to it and it does " +
            `not match the committed one (${differs.lowerBound} at ${(differs.rate * 100).toFixed(2)}%); ` +
            "refusing — an undated indexed schedule cannot be told from one that is a year stale",
        };
      }
    }
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

// --- Massachusetts 5% base rate + 4% surtax (anchored prose) -----------------

/**
 * Massachusetts is the one seeded income-tax state whose schedule fits neither
 * the flat-rate parser (it has two brackets, not one) nor the graduated parser
 * (its upper bracket's rate is the *combined* base-plus-surtax figure, not a
 * standalone "rate in excess of" the source ever states). So it gets a small
 * dedicated parser that anchors the two figures that actually move year to year:
 * the 5% Part B base rate, and the surtax *threshold* — the "millionaire's tax"
 * floor is inflation-adjusted every year ($1,053,750 in 2024 → $1,107,750 in
 * 2026), which is precisely the kind of annual drift a refresh should catch.
 *
 * The 4% surtax rate is fixed in the state constitution, but we anchor it too
 * and combine it onto the upper bracket (`base + surtax`, e.g. 5% + 4% = 9%),
 * so a constitutional change would flow through rather than silently keep 9%.
 * The committed shard stores the two-element schedule `[{0, base}, {threshold,
 * base+surtax}]`; we overlay exactly those three figures and leave everything
 * else (deductions, exemptions) for the reviewer, the same boundary as the
 * other state parsers. A plausibility guard on both percentages and a positive
 * threshold routes a garbled read to the fail-safe alert rather than a guess.
 *
 * Two things had to change before it could read the page it watches.
 *
 * **It demanded the 5% base rate, which this page does not state.** DOR's
 * surtax page is about the surtax; the only "5%" on it is the elective
 * pass-through excise in an FAQ answer explaining that the excise is NOT the
 * surtax. Requiring a figure a source was never going to state, and reporting
 * the absence as a moved source, is the failure four other adapters were fixed
 * for. The base rate is statutory (M.G.L. c. 62 §4, 5% since 2020) and is taken
 * from the shard's own first bracket, which is what the shard is for.
 *
 * **The threshold is a by-year list, not a clause.** The page states it as
 *
 *   The surtax threshold for:
 *   Tax year 2026 is $1,107,750
 *   Tax year 2025 is $1,083,150
 *   Tax year 2024 is $1,053,750
 *
 * and the old pattern wanted "4% surtax ... in excess of $X" on one line. The
 * shard says which year it is, so the shard picks the row — the anchor the
 * revenue procedure, the Rhode Island columns and the Idaho blocks all use. A
 * list whose newest year is older than the shard's is the state not having
 * published yet, and says so.
 */
/**
 * Mississippi's rate, from the by-year table the DOR publishes on the page the
 * shard already cites.
 *
 * Mississippi is on a statutory step-down — HB 1 (2025) — so this is a rate that
 * genuinely moves every January, and the page states the whole path at once:
 *
 *   Tax Year 2025 Excess of $10,000 of Taxable Income is taxed @ 4.4%
 *   Tax Year 2026 Excess of $10,000 of Taxable Income is taxed @ 4%
 *   Tax Year 2027 Excess of $10,000 of Taxable Income is taxed @ 3.75%
 *
 * Two things on that page read as this figure and are not it, which is why the
 * generic graduated parser cannot be pointed here. The section opens "In 2026,
 * the graduated 2025 tax year income tax rate is: 0% on the first $10,000 of
 * taxable income. 4.4% on the remaining taxable income in excess of $10,000" —
 * a sentence whose first two words are the shard's year and whose rate is the
 * previous one, describing the return filed during 2026 for 2025. Reading it
 * would roll Mississippi's rate back UP a year under a live citation, and the
 * arithmetic would look perfectly well-formed. The other is "The 4% rate is
 * eliminated for tax year 2024 and forward", where "4%" names the abolished
 * bracket BELOW $10,000 — the same characters as the shard's rate, meaning its
 * opposite.
 *
 * So only the by-year table is read, and the shard's own year picks the row:
 * the anchor the federal revenue procedure, Massachusetts, Ohio and Idaho all
 * already use. Two rows are required, because one "Tax Year … taxed @ …" is a
 * sentence and a sequence of them is a table. A table that stops short of the
 * shard's year is a state that has not published it, not a broken parser.
 */
function parseMississippiRateByYear(raw: string, current: Record<string, unknown>): ParseOutcome {
  const text = visibleText(raw);
  const taxYear = Number(current.taxYear);

  const rows = new Map<number, { threshold: number; pct: number }>();
  for (const m of text.matchAll(
    /tax\s+year\s+((?:19|20)\d{2})\s+excess\s+of\s+\$?([\d,]+)\s+of\s+taxable\s+income\s+is\s+taxed\s*@?\s*([\d.]+)\s*%/gi,
  )) {
    rows.set(Number(m[1]), { threshold: parseAmount(m[2] as string), pct: Number(m[3]) });
  }
  if (rows.size < 2) {
    return {
      ok: false,
      reason:
        `found ${rows.size} by-year rate row(s) and a table needs at least two; ` +
        "refusing, because a lone row is a sentence and this page states two rates that are not this figure",
    };
  }
  if (!rows.has(taxYear)) {
    const newest = Math.max(...rows.keys());
    return {
      ok: false,
      reason:
        `the by-year rate table runs to tax year ${newest} and this shard is ${taxYear}, ` +
        "so Mississippi has probably not published the shard's year yet",
      settled: newest < taxYear,
    };
  }

  const { threshold, pct } = rows.get(taxYear)!;
  if (!(pct > 0 && pct <= 15)) {
    return { ok: false, reason: `anchored an implausible rate for ${taxYear} (${pct}%)` };
  }
  if (!(threshold > 0)) {
    return { ok: false, reason: "anchored a non-positive zero-band ceiling" };
  }

  const shard = clone(current);
  const brackets = shard.bracketsByFilingStatus as
    | Record<string, { lowerBound: number; rate: number }[]>
    | undefined;
  if (!brackets) return { ok: false, reason: "shard has no bracketsByFilingStatus to overlay" };

  let overlaid = 0;
  for (const status of Object.keys(brackets)) {
    const arr = brackets[status];
    // The 0% band is not stated by the table, only by the prose above it, so it
    // is left as the shard carries it — and a schedule that is not the
    // zero-band-then-one-rate shape this reads is not overlaid at all.
    if (!Array.isArray(arr) || arr.length !== 2 || !arr[0] || !arr[1] || arr[0].rate !== 0)
      continue;
    const drift = implausibleDrift(arr[1].lowerBound, threshold);
    if (drift !== null) {
      return {
        ok: false,
        reason: `the zero-band ceiling ${drift}; refusing — either the page moved or this is not the figure`,
      };
    }
    arr[1].lowerBound = threshold;
    arr[1].rate = pctToRate(pct);
    overlaid += 1;
  }
  if (overlaid === 0) {
    return { ok: false, reason: "no zero-band-over-one-rate schedule to overlay" };
  }
  return { ok: true, shard };
}

function parseMassachusettsSurtax(raw: string, current: Record<string, unknown>): ParseOutcome {
  const text = visibleText(raw);
  const taxYear = Number(current.taxYear);

  const surtaxRates = new Set<number>();
  for (const m of text.matchAll(/\b([\d.]+)\s*(?:percent|%)\s+surtax\b/gi)) {
    const pct = Number(m[1]);
    if (pct > 0 && pct <= 15) surtaxRates.add(pct);
  }
  if (surtaxRates.size > 1) {
    return {
      ok: false,
      reason: `the page states more than one surtax rate (${[...surtaxRates].sort((a, b) => a - b).join(", ")}%); refusing to guess which is current`,
    };
  }

  // "Tax year 2026 is $1,107,750" — the shard's own year picks the row.
  const rows = new Map<number, number>();
  for (const m of text.matchAll(/tax\s+year\s+((?:19|20)\d{2})\s+is\s+\$?([\d,]{7,})/gi)) {
    rows.set(Number(m[1]), parseAmount(m[2] as string));
  }
  if (surtaxRates.size === 0 || rows.size === 0) {
    return {
      ok: false,
      reason: "could not anchor the MA surtax rate and its by-year threshold list",
    };
  }
  if (!rows.has(taxYear)) {
    const newest = Math.max(...rows.keys());
    return {
      ok: false,
      reason:
        `the surtax-threshold list stops at tax year ${newest} and this shard is ${taxYear}, ` +
        "so Massachusetts has probably not published the shard's year yet",
      settled: newest < taxYear,
    };
  }

  // The 5% base is statutory (M.G.L. c. 62 §4) and is not on this page, so it
  // comes from the shard rather than being demanded of a source that has it not.
  const committed = (current.bracketsByFilingStatus as Record<string, { rate: number }[]>)?.single;
  const basePct = Number(committed?.[0]?.rate) * 100;
  const surtaxPct = [...surtaxRates][0]!;
  const threshold = rows.get(taxYear)!;
  const drift = implausibleDrift(Number(committed?.[1]?.["lowerBound" as never]), threshold);
  if (drift !== null) {
    return {
      ok: false,
      reason: `the surtax threshold ${drift}; refusing — either the page moved or this is not the figure`,
    };
  }
  if (!(basePct > 0 && basePct <= 15)) {
    return { ok: false, reason: `the shard's base rate is implausible (${basePct}%)` };
  }
  if (!(threshold > 0)) {
    return { ok: false, reason: "anchored a non-positive surtax threshold" };
  }
  const baseRate = pctToRate(basePct);
  const topRate = pctToRate(basePct + surtaxPct);

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
    if (Array.isArray(arr) && arr.length === 2 && arr[0] && arr[1]) {
      arr[0].rate = baseRate;
      arr[1].rate = topRate;
      arr[1].lowerBound = threshold;
      overlaid += 1;
    }
  }
  if (overlaid === 0) {
    return { ok: false, reason: "no two-bracket (base + surtax) schedule to overlay" };
  }
  return { ok: true, shard };
}

// --- New Jersey graduated rates (per filing status; anchored prose) ----------

/**
 * New Jersey is the first seeded state whose graduated tiers differ by filing
 * status — the Single / married-filing-separately schedule has seven brackets,
 * the married-filing-jointly / head-of-household schedule eight — so the generic
 * graduated parser (one schedule overlaid onto all statuses with a matching
 * bracket count) cannot serve it. The lower brackets (1.4% through 6.37%) have
 * been fixed in statute (N.J.S.A. 54A:2-1) for years; the figures that actually
 * move are the top marginal rate and the income it begins at — the 10.75%
 * "millionaire's" bracket over $1,000,000 added in 2020, a politically live
 * number. So this dedicated parser (the Massachusetts-surtax precedent) anchors
 * exactly those two and overlays them onto the top bracket of every status's
 * schedule (both top out at the same rate and threshold). The threshold pattern
 * demands a millions figure, so it can never mis-anchor the $500,000 tier below
 * it; a plausibility guard routes a garbled read to the fail-safe alert. The
 * rest of each schedule stays the reviewer's data-only step, the same boundary
 * as every other state parser.
 */
function parseNewJerseyTopRate(raw: string, current: Record<string, unknown>): ParseOutcome {
  const text = visibleText(raw);
  // Prose: "10.75% on taxable income in excess of $1,000,000".
  const prose =
    /([\d.]+)\s*(?:percent|%)[^$%]*?(?:in excess of|over|above|exceeding)\s*\$?(\d{1,3}(?:,\d{3}){2,}|\d{7,})/i.exec(
      text,
    );
  // The schedule itself, which states it the other way round and in decimals —
  // "$1,000,000 and over __________ .1075 = __________ – $ 32,926.25". Both of
  // NJ's tables carry the same top tier, so the two matches must agree; a page
  // where they do not is one this parser has stopped understanding.
  let pct = prose ? Number(prose[1]) : NaN;
  let threshold = prose ? parseAmount(prose[2] as string) : NaN;
  if (!prose) {
    const tiers = new Set<string>();
    for (const row of text.matchAll(
      /\$\s*(\d{1,3}(?:,\d{3}){2,}|\d{7,})\s+and over[^%$]{0,40}?\.(\d{3,5})\b/gi,
    )) {
      tiers.add(`${parseAmount(row[1] as string)}@${row[2]}`);
    }
    if (tiers.size > 1) {
      return {
        ok: false,
        reason: `the schedule's tables state different top tiers (${[...tiers].join(", ")}); refusing to guess which`,
      };
    }
    const only = [...tiers][0];
    if (only) {
      const [amount, decimal] = only.split("@");
      threshold = Number(amount);
      pct = Number(`0.${decimal}`) * 100;
    }
  }
  if (!Number.isFinite(pct) || !Number.isFinite(threshold)) {
    return {
      ok: false,
      reason: "could not anchor the NJ top rate and its (>= $1,000,000) threshold",
    };
  }
  if (!(pct > 0 && pct <= 15)) {
    return { ok: false, reason: `anchored an implausible NJ top rate (${pct}%)` };
  }
  if (!(threshold >= 1000000)) {
    return { ok: false, reason: "anchored a NJ top-bracket threshold below $1,000,000" };
  }
  const topRate = pctToRate(pct);
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
    if (!Array.isArray(arr) || arr.length < 2) continue;
    const top = arr[arr.length - 1]!;
    top.rate = topRate;
    top.lowerBound = threshold;
    overlaid += 1;
  }
  if (overlaid === 0) {
    return { ok: false, reason: "no multi-bracket schedule to overlay the NJ top rate onto" };
  }
  return { ok: true, shard };
}

// --- USDA FNS SNAP cost-of-living adjustment (anchored prose) ----------------

/**
 * The USDA FNS SNAP cost-of-living tables, read by column.
 *
 * FNS publishes one table for the whole country: household size down the side,
 * and a column per region across the top — 48 States and DC, Alaska (Urban),
 * Alaska (Rural 1), Alaska (Rural 2), Guam, Hawaii, Virgin Islands. A row reads
 * `1 $298 $385 $491 $598 $439 $506 $383`, so the figure this shard wants is the
 * first of seven and the others are three to twice as large.
 *
 * The parser this replaces anchored `1 $...` and an each-additional-person
 * amount, which on this page would take the first column by position and no
 * more. It never got the chance, for a reason that is a page and not a host:
 * the adapter watched `/snap/allotment/cola/fy26`, the per-year page, which
 * renders its tables client-side and arrives as a title and nothing else. The
 * August 2026 audit had already noticed — it recorded the allotments as
 * unverifiable, "stand as authored" — and read that as a limit of the source
 * rather than of the URL. The COLA index one level up states the same tables in
 * the markup, and its address carries no year, so next October's figures arrive
 * at it too.
 *
 * Reading a column is more than this file usually does, and the reason it is
 * safe here is that the table says which column is which. The header row is
 * parsed first, the shard's region picks an index out of it, and every data row
 * must carry exactly as many amounts as the header has columns — otherwise the
 * shape has changed underneath and the parser refuses rather than counting into
 * the wrong region. Structure is never invented either: only household sizes the
 * committed shard already carries are filled, and every one of them must be
 * present or nothing is written.
 *
 * Scope: Table 1, the maximum allotments, which is what a benefit estimate is
 * built from. The standard-deduction and excess-shelter tables below it stay the
 * reviewer's data-only step — the diff on an allotment move is what prompts it.
 */
const SNAP_REGION_COLUMNS: Record<string, RegExp> = {
  contiguous: /^48 States and District of Columbia$/i,
};

function parseSnap(raw: string, current: Record<string, unknown>): ParseOutcome {
  const region = String(current.region ?? "");
  const column = SNAP_REGION_COLUMNS[region];
  if (!column) {
    return { ok: false, reason: `shard names no known SNAP region (got "${region}")` };
  }
  const text = visibleText(raw);
  const fiscalYear = Number(current.fiscalYear);
  if (Number.isInteger(fiscalYear) && !new RegExp(`FY ?${fiscalYear}\\b`, "i").test(text)) {
    return {
      ok: false,
      reason: `the page states no FY ${fiscalYear} figures — SNAP's COLA takes effect each October, so this is a prior year's page or the shard is ahead of it`,
    };
  }

  const table = /Table 1\. Maximum Monthly Allotment([\s\S]*?)(?:Table 2\.|Deductions\b)/i.exec(
    text,
  );
  if (!table) {
    return { ok: false, reason: "could not find Table 1 (maximum monthly allotment) on the page" };
  }
  const body = table[1] as string;

  // The header runs from "Household Size" to the first data row ("1 $...").
  const header = /Household Size([\s\S]*?)\b1\s+\$/i.exec(body);
  if (!header) {
    return { ok: false, reason: "Table 1 has no readable header row of region columns" };
  }
  const columns = (header[1] as string)
    .split(
      /\s{2,}|(?<=\))\s+(?=[A-Z48])|(?<=[a-z])\s+(?=48 States)|\s+(?=Alaska|Guam|Hawaii|Virgin)/,
    )
    .map((c) => c.trim())
    .filter(Boolean);
  const index = columns.findIndex((c) => column.test(c));
  if (index === -1) {
    return {
      ok: false,
      reason: `Table 1 no longer has a "${region}" column (header reads: ${columns.join(" | ")})`,
    };
  }

  /** The `index`-th amount of a row, refusing if the row is not the header's width. */
  function cell(label: string, row: string | undefined): number | string {
    if (row === undefined) return `Table 1 has no "${label}" row`;
    const amounts = [...row.matchAll(/\$([\d,]+)/g)].map((m) => parseAmount(m[1] as string));
    if (amounts.length !== columns.length) {
      return `the "${label}" row carries ${amounts.length} amounts for ${columns.length} columns — the table's shape changed, and counting into it would read another region`;
    }
    return amounts[index] as number;
  }

  const allotments = { ...((current.maxAllotmentByHouseholdSize as Record<string, number>) ?? {}) };
  const rows = new Map<string, string>();
  for (const m of body.matchAll(/(?:^|\s)(\d+|Each Additional Member)((?:\s+\$[\d,]+)+)/gi)) {
    rows.set(String(m[1]).toLowerCase(), m[2] as string);
  }
  const parsed: Record<string, number> = {};
  for (const size of Object.keys(allotments)) {
    const value = cell(size, rows.get(size));
    if (typeof value === "string") return { ok: false, reason: value };
    const drift = implausibleDrift(allotments[size] as number, value);
    if (drift) {
      return {
        ok: false,
        reason: `the household-size-${size} maximum allotment ${drift}; refusing — either the table moved or this is not the figure`,
      };
    }
    parsed[size] = value;
  }
  const additional = cell("Each Additional Member", rows.get("each additional member"));
  if (typeof additional === "string") return { ok: false, reason: additional };
  const additionalDrift = implausibleDrift(current.additionalPersonAllotment as number, additional);
  if (additionalDrift) {
    return {
      ok: false,
      reason: `the each-additional-member allotment ${additionalDrift}; refusing — either the table moved or this is not the figure`,
    };
  }

  const shard = clone(current);
  shard.maxAllotmentByHouseholdSize = parsed;
  shard.additionalPersonAllotment = additional;
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
 *
 * Worth stating plainly, because it is the whole reason this adapter looked
 * healthier than the shard was: the threshold has not moved since 2014, and the
 * MAP is what changes. NFIB v. Sebelius made expansion optional, so a ballot
 * measure or a legislature can flip a state, and telling a household in a
 * non-expansion state that it may qualify is the worst answer this shard can
 * give. That map was watched by nothing at all — the shard's own citation note
 * said "which is what the refresh watch is for", and no watch covered it. It is
 * covered now, by fingerprint rather than by parser, for the reason the watch
 * list records: the only CMS page that states the map row by row is dated
 * "as of December 1, 2023", so a parser reading it would confirm a 2026 shard
 * forever and could never report a change. The map was verified against that
 * table for all 51 jurisdictions on 2026-08-30 and agrees.
 */
function parseMedicaidThreshold(raw: string, current: Record<string, unknown>): ParseOutcome {
  const match = /(\d{2,3}(?:\.\d+)?)\s*(?:percent|%)\s+of the (?:federal )?poverty/i.exec(raw);
  if (!match) {
    return {
      ok: false,
      reason: "could not anchor the expansion eligibility threshold (% of the poverty line)",
    };
  }
  const anchored = Number(match[1]);
  const committed = Number(current.expansionThresholdPctFpl);
  // The statutory / effective trap. CMS writes "133 percent of the federal
  // poverty line", which is the STATUTORY figure; the number that decides
  // eligibility is that plus the 5-point income disregard, an effective 138%,
  // and 138 is what the shard carries and what every tile computes against.
  // A dry run on 2026-08-29 showed this adapter proposing 138 -> 133: five
  // points of the poverty line, about $800 of annual income for a household of
  // one, silently narrowing who this site tells that they qualify.
  //
  // Both numbers are correct statements about the same rule, so no amount of
  // pattern-tightening lets a scrape choose between them. It refuses instead.
  if (Number.isFinite(committed) && anchored !== committed) {
    return {
      ok: false,
      reason:
        `the page states ${anchored}% of the poverty line where the shard carries ${committed}% — ` +
        "the statutory figure against the effective one: §1902(a)(10)(A)(i)(VIII) says 133%, " +
        "§1902(e)(14)(I) adds a 5-percentage-point income disregard, and 138% is what decides " +
        "eligibility. Two correct statements of one rule, which no pattern can choose between. " +
        "The threshold is also not what moves here — the per-state expansion map is, and it is " +
        "fingerprinted in scripts/refresh/source-watch.json against the CMS eligibility-levels " +
        "table so a state changing position reaches a person",
      // Settled only for the pair this comment is about. 133 against 138 is two
      // correct statements of one rule and needs nobody; ANY other disagreement
      // is a surprise that wants a person now, and must not be filed under
      // "nothing to do here".
      settled: anchored === 133 && committed === 138,
    };
  }
  const shard = clone(current);
  shard.expansionThresholdPctFpl = anchored;
  return { ok: true, shard };
}

/**
 * The Series I savings-bond rate, read the way TreasuryDirect states it.
 *
 * The page leads with the number savers care about and the shard does not
 * store: "Current Interest Rate Series I Savings Bonds **4.26%** This includes a
 * fixed rate of **0.90%** For I bonds issued **May 1, 2026 to October 31,
 * 2026**." The shard stores the two components, fixed and semiannual inflation,
 * because that is what determines a bond's return for the rest of its life.
 *
 * So exactly one of the shard's two numbers is stated on the page. The parser
 * this replaces looked for both and found the same 4.26% twice — `fixed rate`
 * and `semiannual inflation rate` each bridging to the composite figure the page
 * opens with — and was left refusing on a collision guard. The guard was right
 * and the premise was wrong: the inflation rate is not on the page.
 *
 * What the page does give is enough to CHECK it. Treasury's composite formula,
 * which the page states and works an example of, is
 *
 *   composite = fixed + 2 × semiannual + fixed × semiannual
 *
 * so the committed inflation rate either reproduces the published composite or
 * it does not. It is used that way and no other: the fixed rate is written
 * because the page says it, and the inflation rate is only ever verified. If the
 * two disagree by more than the page's own rounding, both figures are named in a
 * refusal, because which of them moved is a reviewer's call and the arithmetic
 * cannot say.
 *
 * The period is anchored too, and this is the part that was quietly dangerous.
 * The old parser wrote into `rates[rates.length - 1]` whatever period the page
 * happened to describe — so on the morning Treasury announces a new six months,
 * the new rates would be written OVER the last period rather than after it,
 * silently rewriting history in a series whose whole purpose is to be a history.
 * Appending a period stays the reviewer's step, as it always was; the parser now
 * refuses by name instead of overwriting.
 */
function parseTreasuryBonds(raw: string, current: Record<string, unknown>): ParseOutcome {
  const text = visibleText(raw);

  const compositeMatch = /Series I Savings Bonds\s+([\d.]+)\s*%/i.exec(text);
  const fixedMatch = /includes a fixed rate of\s+([\d.]+)\s*%/i.exec(text);
  const periodMatch = /For I bonds issued\s+(May|November)\s+1,\s*(\d{4})/i.exec(text);
  if (!compositeMatch || !fixedMatch || !periodMatch) {
    return {
      ok: false,
      reason:
        "could not anchor the current I-bond rate block (composite, fixed rate, and issue period)",
    };
  }
  // pctToRate, not `/ 100`: 0.90 / 100 is 0.009000000000000001, which diffs
  // against the committed 0.009 and opens a pull request every single run.
  const composite = pctToRate(Number(compositeMatch[1]));
  const fixedRate = pctToRate(Number(fixedMatch[1]));
  if (!(fixedRate >= 0 && fixedRate <= 0.05)) {
    return { ok: false, reason: `implausible I-bond fixed rate ${fixedMatch[1]}%` };
  }
  if (!(composite >= 0 && composite <= 0.2)) {
    return { ok: false, reason: `implausible I-bond composite rate ${compositeMatch[1]}%` };
  }
  const period = `${periodMatch[2]}-${/^may$/i.test(periodMatch[1] as string) ? "05" : "11"}`;

  const shard = clone(current);
  const rates = shard.rates as
    | { period: string; fixedRate: number; inflationRate: number }[]
    | undefined;
  if (!Array.isArray(rates) || rates.length === 0) {
    return { ok: false, reason: "committed shard has no rate periods to refresh" };
  }
  const entry = rates.find((r) => r.period === period);
  if (!entry) {
    return {
      ok: false,
      reason: `the page publishes the ${period} period and this shard's history ends at ${rates[rates.length - 1]!.period} — a new six months to append, which is the reviewer's step, not an overwrite of the last one`,
    };
  }

  // Treasury's own composite formula, used only to check the one figure the page
  // does not state. The composite is published to two decimal places, so a
  // half-basis-point of slack is the page's rounding, not a real disagreement.
  const impliedComposite = fixedRate + 2 * entry.inflationRate + fixedRate * entry.inflationRate;
  if (Math.abs(impliedComposite - composite) > 0.0001) {
    return {
      ok: false,
      reason:
        `the committed ${period} semiannual inflation rate (${(entry.inflationRate * 100).toFixed(2)}%) ` +
        `with the published fixed rate (${fixedMatch[1]}%) implies a composite of ` +
        `${(impliedComposite * 100).toFixed(2)}%, and the page publishes ${compositeMatch[1]}% — ` +
        "one of them moved, and which is a reviewer's call",
    };
  }

  entry.fixedRate = fixedRate;
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
    parse: parsePovertyGuidelines,
  },
  {
    id: "federal-poverty-level-2024-alaska",
    group: "hhs-poverty",
    source: "HHS Poverty Guidelines (Alaska)",
    sourceUrl: "https://aspe.hhs.gov/topics/poverty-economic-mobility/poverty-guidelines",
    cadence: "Annual, January",
    parse: parsePovertyGuidelines,
  },
  {
    id: "federal-poverty-level-2024-hawaii",
    group: "hhs-poverty",
    source: "HHS Poverty Guidelines (Hawaii)",
    sourceUrl: "https://aspe.hhs.gov/topics/poverty-economic-mobility/poverty-guidelines",
    cadence: "Annual, January",
    parse: parsePovertyGuidelines,
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
    // Rev. Proc. 2025-32, which states the 2026 table this shard carries. It had
    // been Rev. Proc. 2023-34 — the 2024 one, frozen since 2023, which could
    // report agreement forever and a change never.
    sourceUrl: "https://www.irs.gov/pub/irs-drop/rp-25-32.pdf",
    cadence: "Annual, October-November",
    parse: parseIrsStandardDeductions,
  },
  {
    id: "state-ca-income-tax-2024",
    group: "state-ca",
    source: "California FTB tax-rate schedules",
    // The deductions page, which states the chart. NOT the tax-calculator page
    // (rate schedules, no deduction) and NOT the 2026 Form 540-ES instructions,
    // which state the right figures in the wrong order — "$5,706 single or
    // married/RDP filing separately $11,412 married/RDP filing jointly" — where
    // a label-then-amount pattern reads single's deduction as $11,412.
    sourceUrl: "https://www.ftb.ca.gov/file/personal/deductions/index.html",
    cadence: "Annual",
    parse: parseStandardDeductions,
  },
  {
    id: "state-ny-income-tax-2024",
    group: "state-ny",
    source: "New York State Department of Taxation and Finance standard deductions",
    // The standard-deduction page, not the tax tables: the tables state
    // brackets, which are the reviewer's step, and never the deduction.
    sourceUrl: "https://www.tax.ny.gov/pit/file/standard_deductions.htm",
    cadence: "Annual",
    parse: parseStandardDeductions,
  },
  {
    id: "state-ga-income-tax-2024",
    group: "state-ga",
    source: "Georgia DOR Employer's Withholding Tax Guide (HB 463 rate and standard deduction)",
    // The guide, not dor.georgia.gov/taxes/taxes-individuals: that is a menu.
    // The guide states both HB 463 figures on its "what changed" page, which is
    // what the shard's own note cites.
    sourceUrl:
      "https://dor.georgia.gov/document/document/2026-employers-tax-guide-updated-june-2026/download",
    cadence: "Annual",
    parse: (raw, current) =>
      parseAmountThenStatusDeductions(raw, current, {
        pattern: (year) => new RegExp(`withholding tax guide\\s+${year}\\b`, "i"),
        reason: (year) =>
          `this is not the ${year} Employer's Withholding Tax Guide — Georgia reissues it each year at a URL carrying the year, and a stale one states last year's deduction perfectly`,
      }),
  },
  {
    id: "state-nc-income-tax-2024",
    group: "state-nc",
    source: "North Carolina Department of Revenue individual income tax rates",
    // The deduction page the shard cites, not the rate schedules: the schedules
    // state brackets, which are the reviewer's step.
    sourceUrl:
      "https://www.ncdor.gov/taxes-forms/individual-income-tax/filing-topics/north-carolina-standard-deduction-or-north-carolina-itemized-deductions",
    cadence: "Annual",
    parse: parseStandardDeductions,
  },
  {
    id: "state-dc-income-tax-2024",
    group: "state-dc",
    source: "DC Office of Tax and Revenue individual income tax rates",
    // A federal-conformity deduction: this state does not publish a standard
    // deduction, it uses the federal one, so the IRS revenue procedure is its
    // source and its own DOR page never stated the figure this adapter was
    // asking that page for. Rolls with the IRS refresh by construction.
    sourceUrl: "https://www.irs.gov/pub/irs-drop/rp-25-32.pdf",
    cadence: "Annual",
    parse: parseIrsStandardDeductions,
  },
  {
    id: "state-pa-income-tax-2024",
    group: "state-pa",
    source: "Pennsylvania DOR personal income tax (flat rate)",
    sourceUrl:
      "https://www.pa.gov/agencies/revenue/resources/tax-types-and-information/personal-income-tax",
    cadence: "Annual",
    parse: parseFlatRateJurisdiction,
  },
  {
    id: "state-il-income-tax-2024",
    group: "state-il",
    source: "Illinois DOR individual income tax (flat rate + personal exemption)",
    sourceUrl: "https://tax.illinois.gov/research/taxrates/income.html",
    cadence: "Annual",
    parse: parseFlatRateJurisdiction,
  },
  {
    id: "state-mi-income-tax-2024",
    group: "state-mi",
    source: "Michigan Treasury individual income tax (flat rate + personal exemption)",
    // Form 446's masthead states both figures; michigan.gov/taxes/iit, which
    // this watched before, states neither. The URL carries the tax year, which
    // the parser checks against the shard rather than trusting.
    sourceUrl:
      "https://www.michigan.gov/taxes/-/media/Project/Websites/taxes/Forms/SUW/TY2026/446_Withholding-Guide_2026.pdf",
    cadence: "Annual",
    parse: parseMichigan,
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
    id: "state-az-income-tax-2024",
    group: "state-az",
    source: "Arizona DOR individual income tax (flat rate)",
    sourceUrl: "https://azdor.gov/forms/individual",
    cadence: "Annual",
    parse: parseFlatRateJurisdiction,
  },
  {
    id: "state-co-income-tax-2024",
    group: "state-co",
    source: "Colorado DOR individual income tax (flat rate)",
    // The DOR's landing page renders its rate through a widget, so nothing in the
    // markup states it. The guide the shard cites does state it — in a by-year
    // table the parser refuses to read a row out of (see YEAR_LABELLED). That is
    // still the better source to watch: the refusal names the real obstacle, and
    // the day Colorado states its current rate in prose the adapter reads it.
    sourceUrl:
      "https://tax.colorado.gov/sites/tax/files/documents/Individual_Income_Tax_Guide_January_2026.pdf",
    cadence: "Annual",
    parse: parseFlatRateJurisdiction,
  },
  {
    id: "state-in-income-tax-2024",
    group: "state-in",
    source: "Indiana DOR individual income tax (flat rate + personal exemption)",
    sourceUrl: "https://www.in.gov/dor/resources/tax-rates-and-reports/rates-fees-and-penalties/",
    cadence: "Annual",
    parse: parseFlatRateJurisdiction,
  },
  {
    id: "state-ky-income-tax-2024",
    group: "state-ky",
    source: "Kentucky DOR individual income tax (flat rate)",
    // The DOR's individual-income landing page states no rate at all — it is a
    // menu — so this watches the withholding formula, which opens with "2026
    // Kentucky Tax Rate: 3.5% of taxable income". Kentucky's withholding rate and
    // its flat income-tax rate are the same figure (KRS 141.020), which is why
    // the formula is a legitimate place to read it and not merely a parseable one.
    sourceUrl: "https://revenue.ky.gov/Forms/2026%20Withholding%20Formula.pdf",
    cadence: "Annual",
    parse: parseFlatRateJurisdiction,
  },
  {
    id: "state-id-income-tax-2024",
    group: "state-id",
    source: "Idaho State Tax Commission individual income tax rate schedule",
    // The rate schedule the shard cites, not the individual-income landing page:
    // the landing page is a menu. The schedule is a year-headed table, so the
    // day a 2026 block appears the by-year reader finds it; until then the
    // refusal says the rows stop at 2025.
    sourceUrl:
      "https://tax.idaho.gov/taxes/income-tax/individual-income/individual-income-tax-rate-schedule/",
    cadence: "Annual",
    parse: parseFlatRateJurisdiction,
  },
  {
    id: "state-ut-income-tax-2024",
    group: "state-ut",
    source: "Utah State Tax Commission individual income tax (flat rate + taxpayer tax credit)",
    sourceUrl: "https://incometax.utah.gov/file-pay/tax-rates/",
    cadence: "Annual",
    // Left pointed at the Tax Commission's rate schedule on purpose: the day it
    // grows a 2026 row the by-year reader will find it and this refusal clears
    // itself. See refuseWhileSourceIsBehind.
    parse: refuseWhileSourceIsBehind(
      parseFlatRateJurisdiction,
      (shard) =>
        (shard.bracketsByFilingStatus as Record<string, { rate: number }[]>)?.single?.[0]?.rate ===
        0.045,
      "Utah's own rate pages still state 4.5% — the rate schedule's newest row reads " +
        '"January 1, 2025 - current" and the line-by-line instructions say "multiply line 9 ' +
        'by 4.5 percent". SB 60, signed 2026-03-23, cut the individual rate to 4.45% for tax ' +
        "years beginning on or after 2026-01-01 (enrolled bill, amending Utah Code " +
        "§59-10-104), which is what this shard carries. Parsing this page would roll Utah " +
        "back to a superseded rate, so it is refused until the Commission updates it",
    ),
  },
  {
    id: "state-la-income-tax-2024",
    group: "state-la",
    source:
      "Louisiana Department of Revenue individual income tax (flat rate + standard deduction)",
    sourceUrl: "https://revenue.louisiana.gov/individuals/general-resources/individual-income-tax/",
    cadence: "Annual",
    parse: parseFlatRateJurisdiction,
  },
  {
    id: "state-ia-income-tax-2024",
    group: "state-ia",
    source:
      "Iowa Department of Revenue individual income tax (flat rate, federal-conformity deduction)",
    // NOT the IDR's "Individual Income Tax Provisions" page, which this adapter
    // watched until it was caught proposing 3.9% — the 2022 reform's rate, which
    // SF 2442 (2024) superseded with 3.8% before it ever took effect. That page
    // parses cleanly and says a repealed number, so the adapter had to refuse it
    // outright. The IDR's own rate announcement says 3.8%, and reading it is the
    // resolution the refusal was holding the place for.
    sourceUrl:
      "https://revenue.iowa.gov/press-release/2025-10-21/idr-announces-2026-individual-income-tax-and-interest-rates",
    cadence: "Annual",
    parse: parseFlatRateJurisdiction,
  },
  {
    id: "state-va-income-tax-2024",
    group: "state-va",
    source: "Virginia Tax individual income tax (standard deduction; statutory brackets)",
    sourceUrl: "https://www.tax.virginia.gov/deductions",
    cadence: "Annual",
    // Virginia's 2%/3%/5%/5.75% brackets are fixed in statute (§58.1-320,
    // unchanged since 1990), so the figure that actually moves is the standard
    // deduction — and it carries a 2027 sunset back to $3,000/$6,000 worth
    // catching. Anchor the deduction by filing status (the CA/NY/GA/NC/DC
    // pattern); the brackets stay the reviewer's data-only step.
    parse: parseStandardDeductions,
  },
  {
    id: "state-mo-income-tax-2024",
    group: "state-mo",
    source: "Missouri DOR individual income tax rate schedule (eight-tier, top 4.7%)",
    // The withholding formula the shard cites, not the year-changes page: that
    // page prints an eight-tier ladder with no year on it, and the ladder is
    // last year's.
    sourceUrl: "https://dor.mo.gov/forms/Withholding%20Formula_2026.pdf",
    cadence: "Annual",
    // Missouri's eight tiers are the same for every filing status, so the
    // graduated parser (OH/MS pattern) overlays one anchored schedule onto all
    // — anchoring the indexed thresholds and any SB 3 trigger-based rate cut.
    // The federal-conformity standard deduction rolls with the IRS refresh.
    parse: parseMissouriWithholdingFormula,
  },
  {
    id: "state-ks-income-tax-2024",
    group: "state-ks",
    source: "Kansas DOR individual income tax standard deduction (SB 1 brackets statutory)",
    // The annual income booklet, which is the only Kansas page that states the
    // figure at all: perstaxtypesii.html is a menu and taxnotices.html is a
    // stub. Its URL carries the tax year, so this one has to be bumped by hand
    // each January — until it is, the booklet says "in tax year 2025" and the
    // year check refuses it by name rather than rolling the shard backwards.
    // ksrevenue.gov/incomebook26.html answers 200 with 1,530 characters of
    // nothing today, so pointing at it early would trade a true refusal for a
    // vague one.
    sourceUrl: "https://www.ksrevenue.gov/incomebook25.html",
    cadence: "Annual",
    // KS's two rates, thresholds, and the personal exemption are statutory
    // (SB 1, 2024 special session); the lightly-indexed standard deduction is the
    // figure that moves, so anchor it (the VA pattern). The per-status brackets
    // stay the reviewer's data-only step.
    parse: parseStandardDeductions,
  },
  {
    id: "state-wv-income-tax-2024",
    group: "state-wv",
    source:
      "West Virginia Tax Division individual income tax rate schedule (HB 2526 / SB 2033 cuts)",
    sourceUrl: "https://tax.wv.gov/Individuals/Pages/PersonalIncomeTaxReductionBill.aspx",
    cadence: "Annual",
    // WV's one schedule applies to single/MFJ/HoH alike (a uniform graduated
    // table, the OH/MO/MS shape), so the generic graduated parser overlays the
    // anchored rate/threshold tiers onto every status. WV's figures that move are
    // the rates (a trigger can cut them again from 2027); the $10k/$25k/$40k/$60k
    // thresholds and the $2,000 exemption are statutory. A full-schedule cut stays
    // the reviewer's data-only step.
    parse: parseWestVirginiaTable,
  },
  {
    id: "state-wi-income-tax-2024",
    group: "state-wi",
    source:
      "Wisconsin Department of Revenue individual income tax (rates, brackets, standard deduction)",
    // Form 1-ES's instructions, which state all four sliding schedules; the
    // individuals landing page is a menu. This is the document the shard cites.
    sourceUrl: "https://www.revenue.wi.gov/TaxForms2026/2026-Form1-ES-Inst.pdf",
    cadence: "Annual",
    // WI's four rates (3.50% / 4.40% / 5.30% / 7.65%) are uniform across statuses
    // but its thresholds differ by filing status, and its standard deduction is a
    // sliding one (a max reduced by a flat % of AGI) that indexes annually — so
    // the generic graduated parser can't overlay it. Anchor the standard-deduction
    // maximum (the MN pattern); the per-status bracket thresholds and the
    // sliding-deduction parameters roll alongside it as the reviewer's data-only
    // step, as do any 2025 Act 15 successor's bracket-widening changes. That step
    // now includes the head-of-household schedule's own maximum and its steeper
    // first-segment rate, which index on the same annual cycle as the single and
    // joint maxima the parser anchors.
    parse: parseWisconsinDeduction,
  },
  {
    id: "state-hi-income-tax-2024",
    group: "state-hi",
    source:
      "Hawaii Department of Taxation individual income tax (12-bracket schedule, standard deduction)",
    sourceUrl: "https://tax.hawaii.gov/tax-year-information/",
    cadence: "Annual",
    // HI's twelve rates (1.40%→11.00%) are uniform across statuses and the
    // thresholds derive by a fixed statutory ratio (MFJ 2× single, HoH 1.5×), so
    // the generic graduated parser can't overlay the per-status tables. Anchor the
    // standard deduction (the MN pattern) — the figure Act 46 steps on its
    // 2024/2026/2028/2030/2031 schedule; the 12 per-status bracket tables and the
    // next Act 46 bracket-widening (2027) roll alongside as the reviewer's
    // data-only step.
    parse: parseStandardDeductions,
  },
  {
    id: "state-mt-income-tax-2024",
    group: "state-mt",
    source: "Montana Department of Revenue individual income tax (HB 337 two-rate schedule)",
    // A federal-conformity deduction: this state does not publish a standard
    // deduction, it uses the federal one, so the IRS revenue procedure is its
    // source and its own DOR page never stated the figure this adapter was
    // asking that page for. Rolls with the IRS refresh by construction.
    sourceUrl: "https://www.irs.gov/pub/irs-drop/rp-25-32.pdf",
    cadence: "Annual",
    // MT computes on federal taxable income (the conformity pattern), so its
    // standard deduction IS the federal one — it rolls with the IRS refresh, not a
    // Montana source. The two rates (4.70% / 5.65%) and per-status thresholds are
    // statutory (HB 337); the rate steps down again to 5.40% in 2027. Anchor the
    // (federal-conformity) standard deduction as the change-watch (the NM pattern);
    // the scheduled 2027 rate cut and the indexed thresholds stay the reviewer's
    // data-only step.
    parse: parseIrsStandardDeductions,
  },
  {
    id: "state-me-income-tax-2024",
    group: "state-me",
    source:
      "Maine Revenue Services individual income tax rate schedule (annual inflation adjustment)",
    // The rate-schedule PDF, not the tax division's landing page: the landing
    // page is a menu and states no figure at all. This document states all
    // three amounts in one line, under the cost-of-living factors that produced
    // them and the statute (36 M.R.S. §5403) that requires them.
    sourceUrl:
      "https://www.maine.gov/revenue/sites/maine.gov.revenue/files/2026-05/ind_tax_rate_sched_2026_rev.pdf",
    cadence: "Annual",
    // ME's three rates (5.8% / 6.75% / 7.15%) and the 2% surtax are statutory
    // (36 M.R.S. §5111), but the bracket thresholds, the standard deduction, the
    // standard-deduction phase-out thresholds, and the $5,300 exemption all index
    // together each year (§5403). Anchor the indexed standard deduction (the
    // MN/RI pattern); the per-status bracket tables and the phase-out thresholds
    // roll alongside it as the reviewer's data-only step.
    parse: parseStandardDeductions,
  },
  {
    id: "state-nd-income-tax-2024",
    group: "state-nd",
    source:
      "North Dakota Office of State Tax Commissioner individual income tax (SB 2034 three-band schedule)",
    // A federal-conformity deduction: this state does not publish a standard
    // deduction, it uses the federal one, so the IRS revenue procedure is its
    // source and its own DOR page never stated the figure this adapter was
    // asking that page for. Rolls with the IRS refresh by construction.
    sourceUrl: "https://www.irs.gov/pub/irs-drop/rp-25-32.pdf",
    cadence: "Annual",
    // ND computes on federal taxable income (the conformity pattern), so its
    // standard deduction IS the federal one — it rolls with the IRS refresh, not a
    // North Dakota source. The three bands (0% / 1.95% / 2.50%) are statutory
    // (SB 2034); the per-status thresholds index annually. Anchor the
    // (federal-conformity) standard deduction as the change-watch (the MT pattern);
    // the indexed thresholds stay the reviewer's data-only step.
    parse: parseIrsStandardDeductions,
  },
  {
    id: "state-vt-income-tax-2024",
    group: "state-vt",
    source:
      "Vermont Department of Taxes individual income tax rate schedules (IN-111; annual indexing)",
    sourceUrl: "https://tax.vermont.gov/individuals/personal-income-tax/rates",
    cadence: "Annual",
    // VT's four rates (3.35% / 6.60% / 7.60% / 8.75%) are statutory (32 V.S.A.
    // §5822), but the per-status bracket thresholds, the standard deduction, and
    // the $5,300 exemption all index together each year. Anchor the indexed
    // standard deduction (the MN/RI pattern); the per-status bracket tables and
    // the exemption roll alongside it as the reviewer's data-only step on each
    // new annual rate schedule.
    //
    // Vermont has posted 2026 WITHHOLDING charts and no 2026 annual schedule,
    // so there is nothing here to watch yet and the refusal says so.
    parse: refuseUntilTheStatePublishes(
      parseStandardDeductions,
      "Vermont has not published its 2026 annual rate schedules — this page's newest entry is " +
        '"2025 Vermont Rate Schedules", and the 2026 documents the department has posted are ' +
        "the wage-bracket WITHHOLDING charts, which state no standard deduction at all. This " +
        "shard is on 2026 and deliberately carries the 2025 IN-111 figures forward, which its " +
        "own note records; the 2025 schedule is a closed year and would report agreement " +
        "forever. Repoint this adapter the day a 2026 schedule is listed",
    ),
  },
  {
    id: "state-ok-income-tax-2024",
    group: "state-ok",
    source: "Oklahoma Tax Commission individual income tax (HB 2764 three-bracket schedule)",
    sourceUrl: "https://oklahoma.gov/tax/individuals.html",
    cadence: "Annual",
    // OK's per-status three-bracket thresholds and its frozen standard deduction
    // and $1,000 exemption are statutory (HB 2764 / §2358). The figure that moves
    // is the rate, which a revenue trigger can cut 0.25% in future years. Anchor
    // the standard deduction (the change-watch); a trigger-based rate cut stays
    // the reviewer's data-only step.
    parse: refuseBecauseTheFigureIsStatutory(
      parseStandardDeductions,
      "Oklahoma's standard deduction does not index \u2014 68 O.S. \u00a72358 froze it at the 2017 " +
        "federal amounts ($6,350 / $12,700 / $9,350) and it has not moved since, so there is " +
        "no annual figure here to anchor and a change would be an act of the legislature. The " +
        "Tax Commission's individuals page is a menu, and its Legislative Update states the " +
        "year's bills rather than the standing figures",
    ),
  },
  {
    id: "state-sc-income-tax-2024",
    group: "state-sc",
    source: "South Carolina Department of Revenue individual income tax (H.4216; SCIAD)",
    sourceUrl: "https://dor.sc.gov/news/information-about-h-4216",
    cadence: "Annual",
    // SC's two rates (1.99% / 5.21%), the $30,000 breakpoint, and the SCIAD
    // amounts and phase-out are all statutory (H.4216, 2026). Anchor the SCIAD
    // base amounts as the standard deduction (the change-watch); a future
    // trigger-based top-rate cut and any SCIAD/phase-out change stay the
    // reviewer's data-only step.
    // SCIAD is stated amount-first, the Georgia shape: "$15,000 for taxpayers
    // who file as single or married filing separately". Label-first, "married
    // filing separately" reaches forward past its own figure.
    parse: parseAmountThenStatusDeductions,
  },
  {
    id: "state-ri-income-tax-2024",
    group: "state-ri",
    source:
      "Rhode Island Division of Taxation annual inflation-adjustment advisory (standard deduction)",
    sourceUrl:
      "https://tax.ri.gov/sites/g/files/xkgbur541/files/2025-11/ADV_2025_22_Inflation_Adjustments.pdf",
    cadence: "Annual",
    // RI's three rates are uniform across filing statuses, but its brackets,
    // standard deduction, and personal exemption all index together each year
    // (one advisory, ADV 2025-22). Anchor the standard deduction (the MN/VA
    // pattern); the uniform bracket thresholds and the exemption roll alongside
    // it as the reviewer's data-only step.
    parse: parseStandardDeductions,
  },
  {
    id: "state-nm-income-tax-2024",
    group: "state-nm",
    source: "New Mexico Taxation & Revenue personal income tax rate schedules (standard deduction)",
    // A federal-conformity deduction: this state does not publish a standard
    // deduction, it uses the federal one, so the IRS revenue procedure is its
    // source and its own DOR page never stated the figure this adapter was
    // asking that page for. Rolls with the IRS refresh by construction.
    sourceUrl: "https://www.irs.gov/pub/irs-drop/rp-25-32.pdf",
    cadence: "Annual",
    // NM's six-rate schedule is statutory and fixed (HB 252, 2024; thresholds not
    // indexed) and differs by filing status — heads of household share the joint
    // schedule — so the generic graduated parser can't overlay it. Anchor the
    // standard deduction (the MN pattern); since NM's deduction is federal-
    // conformity it rolls with the IRS refresh, and the per-status bracket tables
    // stay the reviewer's data-only step on any HB 252 successor.
    parse: parseIrsStandardDeductions,
  },
  {
    id: "state-de-income-tax-2024",
    group: "state-de",
    source:
      "Delaware Division of Revenue tax-rate schedule (standard deduction; statutory brackets)",
    sourceUrl: "https://revenue.delaware.gov/software-developer/tax-rate-changes/",
    cadence: "Annual",
    // Delaware's seven-tier schedule (30 Del. C. §1102) and standard deduction
    // (§1108) are both statutory and unindexed — the rates have held since 2014
    // and the deduction since 2000 — so nothing moves on the usual cadence.
    // Anchoring a figure that does not index is the wrong instrument, so this
    // is watched for CHANGE instead, in scripts/refresh/source-watch.json. A
    // bracket restructure (e.g. the pending HB 13) still lands as the
    // reviewer's data-only step.
    parse: refuseBecauseTheFigureIsStatutory(
      parseStandardDeductions,
      "Delaware's standard deduction does not index \u2014 30 Del. C. \u00a71108 has set it at " +
        "$3,250 / $6,500 for every taxable period beginning after December 31, 1999, so there " +
        "is no annual figure here to anchor. The section states the amounts as a history of " +
        'periods and never uses a filing-status label ("resident spouses ... if they file a ' +
        'joint return"), so it is a bad parse target as well as a still one. It is watched for ' +
        "change instead: scripts/refresh/source-watch.json fingerprints the statute, and an " +
        "amendment asks a person to read it",
    ),
  },
  {
    id: "state-mn-income-tax-2024",
    group: "state-mn",
    source: "Minnesota Department of Revenue standard deduction (indexed)",
    sourceUrl: "https://www.revenue.state.mn.us/minnesota-standard-deduction",
    cadence: "Annual",
    // MN's brackets and standard deduction index together each year, but its
    // tiers differ by filing status (three distinct schedules), so the generic
    // graduated parser can't overlay them. Anchor the cleanly-stated indexed
    // standard deduction; the per-status bracket tables roll alongside it as the
    // reviewer's data-only step (the standard-deduction PR is the annual prompt).
    // Left pointed at the DOR's standard-deduction page on purpose: the day it
    // turns over to 2026 the parser reads it and this refusal clears itself.
    // See refuseWhileSourceIsBehind.
    parse: refuseWhileSourceIsBehind(
      parseStandardDeductions,
      (shard) =>
        (shard.standardDeductionByFilingStatus as Record<string, number>)?.single === 14950,
      "the DOR's standard-deduction page still states the 2025 amounts ($14,950 single, " +
        "$29,900 married jointly). Its own 2025-12-16 announcement gives the 2026 figures this " +
        "shard carries — $15,300 single, $30,600 married jointly, $23,000 head of household — " +
        "so parsing this page would roll Minnesota back a year",
    ),
  },
  {
    id: "state-nj-income-tax-2024",
    group: "state-nj",
    source: "New Jersey Division of Taxation gross income tax rate schedules",
    // The rate schedules themselves, not the page that links to them: that page
    // is a menu of PDFs by year and states no bracket. This URL is NJ's stable
    // "current" one, and the schedule has not moved since 2020.
    sourceUrl: "https://www.nj.gov/treasury/taxation/pdf/current/njtaxratesch.pdf",
    cadence: "Annual",
    // NJ's tiers differ by filing status (the only such seeded state), so the
    // generic graduated parser can't serve it. The lower brackets are statutory
    // and stable; the dedicated parser anchors the live top "millionaire's" rate
    // and its $1,000,000 threshold (the 2020 addition), the figures that move.
    parse: parseNewJerseyTopRate,
  },
  {
    id: "state-ms-income-tax-2024",
    group: "state-ms",
    source: "Mississippi DOR General Information — individual income tax rates by year",
    // Watch what you cite: this is the page the shard's citation already names,
    // and the FAQ this used to watch states the rate only inside worked
    // examples. Every *.ms.gov host serves an incomplete certificate chain, so
    // nothing here was reachable at all until the fetch learned to repair one.
    sourceUrl: "https://www.dor.ms.gov/general-information",
    cadence: "Annual",
    parse: parseMississippiRateByYear,
  },
  {
    id: "state-ma-income-tax-2024",
    group: "state-ma",
    source: "Massachusetts DOR individual income tax (5% base rate + 4% surtax)",
    sourceUrl: "https://www.mass.gov/info-details/massachusetts-4-surtax-on-taxable-income",
    cadence: "Annual",
    parse: parseMassachusettsSurtax,
  },
  {
    id: "state-al-income-tax-2024",
    group: "state-al",
    source: "Alabama Department of Revenue Form 40 standard-deduction chart",
    // The Form 40 booklet, which contains the chart. The FAQ this used to watch —
    // titled "How much is the Alabama standard deduction?" — answers the question
    // by pointing at the chart without reproducing a single figure from it, so
    // the parser reached into the "Related FAQs" block below and read Alabama's
    // 2%/4%/5% RATE brackets as dollars.
    sourceUrl: "https://www.revenue.alabama.gov/wp-content/uploads/2026/01/25f40bk.pdf",
    cadence: "Annual",
    // Alabama's 2%/4%/5% brackets and its $1,500/$3,000 exemption are statutory
    // and unindexed (Ala. Code §40-18-5/-19), and the federal-tax deduction is
    // uncapped — so the figure most likely to move is the sliding standard-
    // deduction maximum (last raised by Act 2022-292). Anchor the deduction
    // maximums by filing status (the change-watch); the chart's per-$500
    // reduction steps and floors stay the reviewer's data-only step.
    parse: refuseBecauseThePageMeansSomethingElse(
      "Alabama states no standard-deduction figure anywhere — it states a CHART, two hundred " +
        "AGI bands deep and four statuses wide, and the shard carries the maximum of each " +
        "column. Nothing labels those maximums: they are the first cell of a column in a wall " +
        "of numbers, so reading them needs table geometry, and a parser that needs table " +
        "geometry is a parser that should be a reviewer step instead. The amounts are " +
        "statutory and unindexed (Ala. Code \u00a740-18-15, last raised by Act 2022-292), so " +
        "there is no annual figure to chase; a change is an act of the legislature. The FAQ " +
        'this adapter used to watch is titled "How much is the Alabama standard deduction?" ' +
        "and answers it by pointing at the chart, which is how the parser came to read " +
        "Alabama's 2%/4%/5% rate brackets out of the Related FAQs block as dollars",
    ),
  },
  {
    id: "state-or-income-tax-2024",
    group: "state-or",
    source: "Oregon Department of Revenue Form OR-40 instructions (rate charts, Table 4)",
    sourceUrl: "https://www.oregon.gov/dor/programs/individuals/pages/pit.aspx",
    cadence: "Annual",
    // Oregon indexes its brackets, standard deduction, and the federal-tax
    // subtraction cap annually. The cleanly-stated indexed figure is the standard
    // deduction (the MN/RI pattern); the per-status bracket tables, the $8,500
    // federal-subtraction cap, and the Table 4 phase-out roll alongside it as the
    // reviewer's data-only step on each new annual OR-40 rate chart.
    //
    // Oregon has not published a 2026 OR-40 booklet, and this shard is on 2026,
    // so there is nothing here to watch yet and the refusal says so rather than
    // reporting a broken parser.
    parse: refuseUntilTheStatePublishes(
      parseStandardDeductions,
      "Oregon has not published its 2026 Form OR-40 instructions — the newest is 2025 " +
        "(form-or-40-inst_101-040-1_2025.pdf, 404 for 2026), and this shard is on 2026. " +
        "It deliberately carries the 2025 indexed standard deduction forward, which its own " +
        "note records; pointing this adapter at the 2025 booklet would parse perfectly and " +
        "report agreement forever, because a closed year's document can never change. " +
        "Repoint it at the 2026 instructions the day they appear",
    ),
  },
  {
    id: "state-ne-income-tax-2024",
    group: "state-ne",
    source: "Nebraska DOR Tax Calculation Schedule + Form 1040N standard deduction",
    sourceUrl: "https://revenue.nebraska.gov/about/forms/individual-income-tax-forms",
    cadence: "Annual",
    // Nebraska's rates follow the statutory LB 754 path (top rate 4.55% in 2026,
    // 3.99% in 2027) and its brackets index annually; the cleanly-stated indexed
    // figure is the standard deduction (the MN/RI pattern). The per-status bracket
    // tables, the scheduled 2027 rate cut, and the ~$171 exemption credit roll
    // alongside it as the reviewer's data-only step on each new Tax Calculation
    // Schedule.
    //
    // Nebraska has not posted a 2026 Tax Calculation Schedule and this shard is
    // on 2026, so there is nothing to watch here yet.
    parse: refuseUntilTheStatePublishes(
      parseStandardDeductions,
      "Nebraska has not published its 2026 Tax Calculation Schedule — the newest is 2025 " +
        "(the 2026 URL 404s, and the 2026 final-forms page lists only the payment voucher and " +
        "1040N-EB), and this shard is on 2026. Its 2026 Circular EN states withholding tables " +
        "and no standard deduction at all. The shard deliberately carries the 2025 indexed " +
        "figures forward, which its own note records; the 2025 schedule is a closed year and " +
        "would report agreement forever. Repoint this adapter the day the 2026 schedule appears",
    ),
  },
  {
    id: "state-md-income-tax-2024",
    group: "state-md",
    source:
      "Comptroller of Maryland State & Local Income Tax Withholding memo (Central Payroll Bureau)",
    sourceUrl: "https://www.marylandcomptroller.gov/individuals/tax-services.html",
    cadence: "Annual",
    // Maryland's per-status state brackets are statutory (the FY2026 budget bill
    // added the 6.25%/6.5% top brackets) and the 24 county local rates are set
    // annually by each county; the cleanly-stated figure the refresh anchors is
    // the standard deduction (the MN/RI pattern; the 2025 session moved it to a
    // fixed $3,350/$6,700). The per-status bracket tables, the county local-rate
    // chart (including the Anne Arundel / Frederick income-tiered schedules), and
    // the $3,200 exemption are the reviewer's data-only step on each new memo.
    parse: refuseBecauseTheFigureIsStatutory(
      parseStandardDeductions,
      "Maryland's standard deduction is a statutory CAP, not an indexed figure: the deduction " +
        "is the lesser of 15% of Maryland AGI or $3,350 single / $6,700 joint, and the 2025 " +
        "session set those caps. There is no annual amount for an adapter to read, and the " +
        "Comptroller's tax-services page is a menu that states neither the cap nor the " +
        "percentage. A change is an act of the General Assembly, which a person reads",
    ),
  },
  {
    id: "state-ar-income-tax-2024",
    group: "state-ar",
    source: "Arkansas DFA AR1000F instructions (Regular Income Tax Table + standard deduction)",
    sourceUrl:
      "https://www.dfa.arkansas.gov/office/taxes/income-tax-administration/individual-income-tax/",
    cadence: "Annual",
    // Arkansas's rates (0/2/3/3.4/3.9%) are statutory and its brackets index
    // annually; the cleanly-stated indexed figure the refresh anchors is the
    // standard deduction (the MN/RI pattern). The graduated bracket thresholds,
    // the bracket-adjustment recapture band/amount, and the $29 personal credit
    // roll alongside it as the reviewer's data-only step on each new AR1000F.
    parse: refuseUntilTheStatePublishes(
      parseStandardDeductions,
      "Arkansas has not published its 2026 individual income tax forms \u2014 DFA's newest is the " +
        "2025 set, and this shard is on 2026. It deliberately carries the 2025 AR1000F " +
        "figures forward, which its own note records ($2,470 / $4,940). The 2025 booklet is a " +
        "closed year and would report agreement forever; repoint this adapter the day the " +
        "2026 forms appear",
    ),
  },
  {
    id: "state-ct-income-tax-2024",
    group: "state-ct",
    source: "Connecticut DRS Form CT-1040 Tax Calculation Schedule (Tables A–E)",
    sourceUrl: "https://portal.ct.gov/drs/individuals/resident-income-tax/tax-information",
    cadence: "Annual",
    // Connecticut's seven-rate schedule, its 2% phase-out add-back, its tax
    // recapture, and its personal-credit table are all statutory and rarely
    // change; the figure most likely to move is the personal exemption, which the
    // adapter anchors as the standard deduction (the MN/RI pattern). The brackets,
    // the per-status recapture stages, and the Table E credit steps are the
    // reviewer's data-only step on each new CT-1040 Tax Calculation Schedule.
    //
    // Which this page cannot supply, and would appear to: see
    // refuseBecauseThePageMeansSomethingElse.
    parse: refuseBecauseThePageMeansSomethingElse(
      "Connecticut has no standard deduction \u2014 this shard's " +
        "standardDeductionByFilingStatus carries the CT-1040 Table A personal exemption, and " +
        "this page states neither phrase. The $15,000 / $19,000 / $24,000 on it are the " +
        "gross-income FILING THRESHOLDS, which equal the exemption amounts today and are a " +
        "different figure; anchoring them would be right by accident and would diverge " +
        "silently the first year Connecticut moves one and not the other. Table A lives in " +
        "Form CT-1040 TCS, whose URL carries the year (Rev. 12/25 is the newest), so the " +
        "exemption stays the reviewer's transcription alongside Tables B\u2013E",
    ),
  },
  {
    id: "treasury-bonds-2024",
    group: "treasurydirect",
    source: "U.S. Treasury (TreasuryDirect) Series I savings bond rates",
    sourceUrl: "https://www.treasurydirect.gov/savings-bonds/i-bonds/i-bonds-interest-rates/",
    cadence: "Semiannual, May and November",
    parse: parseTreasuryBonds,
  },
  {
    id: "snap-fy2024-contiguous",
    group: "usda-snap",
    source: "USDA FNS SNAP cost-of-living adjustment (48 contiguous states and DC)",
    // The COLA index, not /cola/fy26: the per-year page renders its tables
    // client-side and arrives empty, and this address carries no year. The host
    // is `fna` because FNS became the Food and Nutrition Administration on
    // 2026-06-01 and fns.usda.gov redirects here — a redirect the link check
    // counts as a failure, correctly.
    sourceUrl: "https://www.fna.usda.gov/snap/allotment/cola",
    cadence: "Annual, October",
    parse: parseSnap,
  },
  {
    id: "medicaid-2024",
    group: "cms-medicaid",
    source: "CMS / Medicaid.gov MAGI eligibility and expansion status",
    sourceUrl: "https://www.medicaid.gov/medicaid/eligibility-policy",
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
