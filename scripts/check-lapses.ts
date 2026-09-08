/**
 * The countdown to the annual roll.
 *
 * Every figure here is annual, and the manifest says how long each may go on
 * being stated: `staleAfterYears`. Six shards carry **zero** — the Pillar 4
 * group and free filing — so they lapse the instant their year does, and
 * `docs/annual-roll.md` calls them "the highest-harm figures here: a COBRA
 * election window that is wrong is coverage that is simply gone."
 *
 * The lapse itself is handled: the loader marks the dataset stale and the tile
 * shows its verify banner rather than a confident wrong number. What was not
 * handled is everything *before* it. The roll is a manual runbook with no
 * trigger, so the first signal that six crisis-side tools had gone to banners
 * would be a reader seeing one on January 1st — and the sourcing pass those six
 * want takes reading six agency documents, not an afternoon.
 *
 * So this is a calendar, and it is the only check here whose input is the date.
 * It reports every shard whose stated year expires within {@link WARN_DAYS} and
 * says which runbook step it belongs to. It is deliberately loud early rather
 * than accurate late: 90 days puts the first warning in early October, by which
 * time the IRS has normally published the next year's revenue procedure, and
 * leaves a quarter to read documents in.
 *
 * Out of the unit CI, like every other scheduled check, and for a reason
 * peculiar to this one: a test that starts failing on a date turns `main` red
 * for work that has nothing to do with the roll. A monthly issue is the right
 * volume for a task measured in weeks.
 *
 * Usage: `npm run check:lapses [-- --days 120] [-- --today 2026-12-01]`
 */
import { appendFileSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");

/** How far ahead to look. See the note above on why it is a quarter. */
export const WARN_DAYS = 90;

interface Dataset {
  id: string;
  effectiveYear: number;
  staleAfterYears: number;
}

/** One shard, and the day the loader will start calling it stale. */
export interface Lapse {
  id: string;
  effectiveYear: number;
  staleAfterYears: number;
  /** ISO date of the first day the shard is stale. */
  lapsesOn: string;
  daysLeft: number;
}

/**
 * The first day a shard is stale, from the rule the loader actually applies.
 *
 * `loadDataset` marks it stale when `asOfYear - effectiveYear > staleAfterYears`,
 * so the first year that is true is `effectiveYear + staleAfterYears + 1`, and
 * the first day of it is January 1st. Derived from the manifest rather than
 * written down, so a shard whose window changes moves its own deadline.
 */
export function lapseFor(d: Dataset, today: Date): Lapse {
  const year = d.effectiveYear + d.staleAfterYears + 1;
  const lapsesOn = Date.UTC(year, 0, 1);
  const startOfToday = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  return {
    id: d.id,
    effectiveYear: d.effectiveYear,
    staleAfterYears: d.staleAfterYears,
    lapsesOn: new Date(lapsesOn).toISOString().slice(0, 10),
    daysLeft: Math.round((lapsesOn - startOfToday) / 86_400_000),
  };
}

/** Every shard lapsing within `days`, soonest first, then by id. */
export function lapsingWithin(datasets: Dataset[], today: Date, days: number): Lapse[] {
  return datasets
    .map((d) => lapseFor(d, today))
    .filter((l) => l.daysLeft <= days)
    .sort((a, b) => a.daysLeft - b.daysLeft || a.id.localeCompare(b.id));
}

/** The report a person reads. */
export function renderLapseReport(due: Lapse[], days: number): string {
  if (due.length === 0) {
    return `No bundled figure expires within ${days} days. Nothing to do.`;
  }
  const already = due.filter((l) => l.daysLeft <= 0);
  const soon = due.filter((l) => l.daysLeft > 0);
  const line = (l: Lapse): string =>
    `- \`${l.id}\` — states ${l.effectiveYear}, window ${l.staleAfterYears} year(s), ` +
    (l.daysLeft > 0
      ? `lapses **${l.lapsesOn}**, in ${l.daysLeft} days`
      : `**lapsed ${l.lapsesOn}**, ${-l.daysLeft} days ago`);

  const out: string[] = [];
  if (already.length > 0) {
    out.push(
      `${already.length} bundled figure(s) have already lapsed and are showing a verify banner to readers:`,
      "",
      ...already.map(line),
      "",
    );
  }
  if (soon.length > 0) {
    out.push(
      `${soon.length} bundled figure(s) expire within ${days} days:`,
      "",
      ...soon.map(line),
      "",
    );
  }
  out.push(
    "This is the annual roll, and it is a reading task rather than an edit: every",
    "figure comes off the agency's own document, never a summary of it. The steps,",
    "the half-finished states each test failure means, and the reason the zero-window",
    "shards want their own sourcing pass rather than a copy-forward are in",
    "[docs/annual-roll.md](docs/annual-roll.md).",
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
  const days = Number(at("--days") ?? WARN_DAYS);
  const todayArg = at("--today");
  const today = todayArg ? new Date(`${todayArg}T00:00:00Z`) : new Date();

  const manifest = JSON.parse(readFileSync(resolve(ROOT, "data", "manifest.json"), "utf8")) as {
    datasets: Dataset[];
  };
  const due = lapsingWithin(manifest.datasets, today, days);
  const report = renderLapseReport(due, days);
  process.stdout.write(`${report}\n`);

  const out = process.env.GITHUB_OUTPUT;
  if (out) {
    appendFileSync(out, `due=${due.length}\n`);
    appendFileSync(out, `report<<EOF\n${report}\nEOF\n`);
  }
  if (due.length > 0) process.exitCode = 1;
}

if (process.argv[1] && process.argv[1].endsWith("check-lapses.ts")) main();
/* c8 ignore stop */
