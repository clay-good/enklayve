/**
 * How long since anybody re-read a jurisdiction against its own document.
 *
 * The refresh adapters watch a source for movement; they do not re-read it
 * against the shipped shard. Manual **source audits** do that, and
 * `docs/data-sources.md`'s Source audits table is the record of them. Every
 * jurisdiction now appears in it at least once — `readmeCounts.test.ts` gates
 * that — which means the coverage question is answered forever and the useful
 * question has become a different one: *how old is that answer?*
 *
 * Arkansas is why it matters. Act 2 of the 2026 First Extraordinary Session cut
 * the top rate to 3.7% on May 6, and the state's own 2026 AR1000ES — stamped
 * October 2025, seven months earlier — still prints 3.9%. An audit performed
 * against that form would have been correct on the day and wrong by summer, and
 * nothing here would have said so: the adapter watched a page that had not
 * changed, the shard's year had not lapsed, and the audit table recorded a tick
 * with no expiry.
 *
 * The roster is **every shard**, not only the 51 states. The federal figures are
 * the most-read on this site and they move on the same annual cycle, so scoping
 * the question to `state-*.json` would have been the narrowing this project keeps
 * finding one directory over. States resolve to the table by name or postal code;
 * everything else resolves through {@link SUBJECTS}, which maps the phrase a row
 * writes ("Federal benefits and screeners") to the shards it covers. A shard no
 * route reaches has never been audited, and the check says so rather than
 * omitting it.
 *
 * So this check gives an audit a shelf life. {@link STALE_DAYS} is half a year,
 * chosen not from any legislature's calendar — they vary from a 45-day session
 * to a permanent one — but because half a year is long enough that a session's
 * worth of enactments has certainly passed behind the reading, and short enough
 * that the two natural sweeps land in it: after the spring sessions adjourn,
 * and again in the autumn once the special sessions are done.
 *
 * Out of the unit CI, like every other scheduled check, and for the reason
 * peculiar to the two calendar ones: a test that starts failing on a date turns
 * `main` red for work that has nothing to do with it.
 *
 * Usage: `npm run check:audits [-- --days 240] [-- --today 2027-03-01]`
 */
import { appendFileSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");

/** How long an audit stands before it wants re-reading. See the note above. */
export const STALE_DAYS = 180;

/** One shard the site ships figures for, and how the audit table names it. */
export interface Subject {
  /** The manifest dataset id. */
  id: string;
  /** What to call it in the report — a state's name, or the dataset id. */
  label: string;
  /** The phrases in a Jurisdiction cell that count as naming this shard. */
  aliases: string[];
}

/** A shard and when it was last read against its own document. */
export interface AuditAge {
  id: string;
  label: string;
  /** ISO date of the most recent audit, or `undefined` if never audited. */
  lastAudited?: string;
  /** Days since that audit; `Infinity` when never audited. */
  daysSince: number;
}

/**
 * The jurisdictions a row names.
 *
 * Cells are comma-separated, and the table writes a jurisdiction three ways:
 * by name (`Vermont`), by name with a qualifier the row is about
 * (`New York (Yonkers)`, `Utah (second pass)`), and — for the one row covering
 * seven conformity states at once — by postal code (`CO, ID, IA, MT, ND, NM, DC`).
 * Bold survives from rows whose subject is a federal shard rather than a state.
 *
 * Split-and-compare rather than substring, deliberately. `"Kansas"` is inside
 * `"Arkansas"` and `"Virginia"` inside `"West Virginia"`, so a substring test
 * reports a jurisdiction as audited off the back of a row about a different
 * one — a coverage check that silently grants coverage, which is worse than
 * not having one.
 */
export function jurisdictionsNamedBy(cell: string): string[] {
  return cell
    .split(",")
    .map((part) =>
      part
        .replace(/\*\*/g, "")
        .replace(/\([^)]*\)/g, "")
        .trim(),
    )
    .filter((part) => part.length > 0);
}

/** Every `| YYYY-MM-DD | jurisdictions | …` row of the Source audits table. */
export function auditRows(doc: string): { date: string; named: string[] }[] {
  const start = doc.indexOf("### Source audits");
  if (start < 0) return [];
  return doc
    .slice(start)
    .split("\n")
    .filter((line) => /^\| 20\d\d-\d\d-\d\d /.test(line))
    .map((line) => {
      const cells = line.split("|");
      return {
        date: (cells[1] ?? "").trim(),
        named: jurisdictionsNamedBy(cells[2] ?? ""),
      };
    });
}

/**
 * What a row's subject phrase covers, for the shards a state name cannot reach.
 *
 * The table writes a federal row by its topic — "Federal benefits and
 * screeners", "Enrollment windows" — because that is what a person reading the
 * record wants to see. This is the one place that says which shards each of
 * those phrases is a claim about, and it is held to the table from both
 * directions by `checkAudits.test.ts`: every id here exists in the manifest, and
 * every phrase here appears in a real row. A dead key would grant an audit to a
 * shard nobody has read, which is the failure mode a stale allowlist has.
 *
 * A shard reached by no route is not an error here — it is a shard nobody has
 * audited, and the report is where that belongs.
 */
export const SUBJECTS: Record<string, string[]> = {
  Federal: ["federal-income-tax-2024", "fica-2024", "capital-gains-2024"],
  "Federal benefits and screeners": [
    "amt-2024",
    "gift-tax-2024",
    "eitc-ctc-2024",
    "child-tax-2024",
    "education-credits-2024",
    "ira-deduction-2024",
    "savers-credit-2024",
  ],
  "Federal poverty level": [
    "federal-poverty-level-2024-contiguous",
    "federal-poverty-level-2024-alaska",
    "federal-poverty-level-2024-hawaii",
  ],
  ACA: ["aca-2024"],
  SNAP: ["snap-fy2024-contiguous"],
  "Social Security claiming": ["social-security-2024"],
  AMT: ["amt-2024"],
  "Social Security benefit taxation": ["social-security-taxation-2024"],
  "Retirement limits": ["retirement-limits-2024"],
  "Enrollment windows": ["enrollment-windows-2026"],
  "No Surprises": ["no-surprises-2026"],
};

/**
 * Every shard the site ships, with the phrases that count as naming it.
 *
 * A state shard is named by its own `name` or its postal code, both derived
 * from the shard. Everything else is named by whichever {@link SUBJECTS}
 * phrases point at it — possibly none, which is how a never-audited shard
 * reaches the report instead of falling out of the roster.
 */
export function subjects(dataDir: string, datasetIds: string[]): Subject[] {
  const states = new Map<string, { name: string; code: string }>();
  for (const f of readdirSync(dataDir)) {
    if (!/^state-[a-z]{2}-income-tax-.*\.json$/.test(f)) continue;
    const shard = JSON.parse(readFileSync(resolve(dataDir, f), "utf8")) as {
      id: string;
      name: string;
    };
    states.set(f.replace(/\.json$/, ""), { name: shard.name, code: shard.id.replace(/^US-/, "") });
  }
  return datasetIds.map((id) => {
    const state = states.get(id);
    if (state) return { id, label: state.name, aliases: [state.name, state.code] };
    const aliases = Object.entries(SUBJECTS)
      .filter(([, ids]) => ids.includes(id))
      .map(([phrase]) => phrase);
    return { id, label: id, aliases };
  });
}

/** Days between two ISO dates, whole days, UTC. */
function daysBetween(fromIso: string, today: Date): number {
  const from = Date.parse(`${fromIso}T00:00:00Z`);
  const startOfToday = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  return Math.round((startOfToday - from) / 86_400_000);
}

/**
 * Each shard's most recent audit. A row counts when it names any of the
 * shard's aliases — its state name, its postal code, or a subject phrase.
 */
export function auditAges(
  places: Subject[],
  rows: { date: string; named: string[] }[],
  today: Date,
): AuditAge[] {
  return places.map((place) => {
    const dates = rows
      .filter((row) => row.named.some((n) => place.aliases.includes(n)))
      .map((row) => row.date)
      .sort();
    const lastAudited = dates[dates.length - 1];
    return {
      id: place.id,
      label: place.label,
      lastAudited,
      daysSince: lastAudited === undefined ? Infinity : daysBetween(lastAudited, today),
    };
  });
}

/** Everything unread for longer than `days`, longest first. */
export function staleAudits(ages: AuditAge[], days: number): AuditAge[] {
  return ages
    .filter((a) => a.daysSince > days)
    .sort((a, b) => b.daysSince - a.daysSince || a.id.localeCompare(b.id));
}

/** The report a person reads. */
export function renderAuditReport(stale: AuditAge[], total: number, days: number): string {
  if (stale.length === 0) {
    return `All ${total} shards were read against their own document within the last ${days} days. Nothing to do.`;
  }
  // A state carries a name and an id; everything else is only its id, and
  // printing that twice reads like a bug in the report.
  const naming = (a: AuditAge): string =>
    a.label === a.id ? `\`${a.id}\`` : `**${a.label}** (\`${a.id}\`)`;
  const never = stale.filter((a) => a.lastAudited === undefined);
  const old = stale.filter((a) => a.lastAudited !== undefined);
  const out: string[] = [];
  if (never.length > 0) {
    out.push(
      `${never.length} shard(s) have never been read against their own document:`,
      "",
      ...never.map((a) => `- ${naming(a)} — no row in the Source audits table`),
      "",
    );
  }
  if (old.length > 0) {
    out.push(
      `${old.length} shard(s) were last read more than ${days} days ago:`,
      "",
      ...old.map((a) => `- ${naming(a)} — last audited ${a.lastAudited}, ${a.daysSince} days ago`),
      "",
    );
  }
  out.push(
    "A source audit is a reading task: the agency's own document for the year, never",
    "a summary of one, and never an adapter's agreement — an adapter watches a page",
    "for movement and cannot see a figure transcribed wrong or a rate its legislature",
    "cut in May. Arkansas is the case: Act 2 of the 2026 First Extraordinary Session",
    "cut the top rate on May 6, and the state's own 2026 AR1000ES, printed the",
    "previous October, still says the old one. Record the result in the Source audits",
    "table in [docs/data-sources.md](docs/data-sources.md#source-audits) — including",
    "the audits that change nothing, which are most of them and are still audits.",
  );
  return out.join("\n");
}

/* c8 ignore start — the CLI shell: argv, files, and output only. */
function main(): void {
  const argv = process.argv.slice(2);
  const at = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const days = Number(at("--days") ?? STALE_DAYS);
  const todayArg = at("--today");
  const today = todayArg ? new Date(`${todayArg}T00:00:00Z`) : new Date();

  const doc = readFileSync(resolve(ROOT, "docs", "data-sources.md"), "utf8");
  const manifest = JSON.parse(readFileSync(resolve(ROOT, "data", "manifest.json"), "utf8")) as {
    datasets: { id: string }[];
  };
  const places = subjects(
    resolve(ROOT, "data"),
    manifest.datasets.map((d) => d.id),
  );
  const stale = staleAudits(auditAges(places, auditRows(doc), today), days);
  const report = renderAuditReport(stale, places.length, days);
  process.stdout.write(`${report}\n`);

  const out = process.env.GITHUB_OUTPUT;
  if (out) {
    appendFileSync(out, `stale=${stale.length}\n`);
    appendFileSync(out, `report<<EOF\n${report}\nEOF\n`);
  }
  if (stale.length > 0) process.exitCode = 1;
}

if (process.argv[1] && process.argv[1].endsWith("check-audits.ts")) main();
/* c8 ignore stop */
