/**
 * The boundary check.
 *
 * Every figure this site shows passes through a handful of comparisons that
 * decide which side of a line someone is on: which bracket a dollar falls in,
 * whether a household at exactly 130% of the poverty line gets food assistance,
 * whether an AGI landing precisely on a cliff keeps the better rate. The rules
 * are written "at or below" in the statutes, so `<=` and `<` are different
 * answers to a real person — and a suite can be large and green and hold none of
 * them, because an exact threshold is measure-zero for an arbitrary input and
 * never appears in a case nobody wrote on purpose.
 *
 * That is not hypothetical. On 2026-08-30 seven boundaries in the tax and
 * benefits engines could each be flipped without failing one of 1,820 tests:
 * the marginal-rate comparison, `bracketTax`'s band base, SNAP's gross and net
 * income tests, Medicaid's expansion threshold, and the saver's credit tier
 * ceiling — the last of which its own shard describes as "a CLIFF, not a
 * phase-out".
 *
 * So this flips each one and runs the suite. A comparison whose mutation still
 * passes is a line the tests do not hold, and the report says which.
 *
 * It gates on a committed baseline rather than on the raw count, the same way
 * the adapter check does and for the same reason: a report that lists the same
 * known gaps every run is one people stop reading. Only a NEW unheld boundary
 * fails, which is the case that matters — somebody adding a threshold without a
 * case that sits on it.
 *
 * Slow by nature (one full suite run per comparison), so it runs on a schedule
 * and on demand, never in the unit suite.
 *
 *   npm run check:boundaries
 *   npm run check:boundaries -- --file src/engine/benefits.ts
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BASELINE_FILE = join(ROOT, "scripts", "boundary-baseline.json");
/** The suites a boundary can plausibly be held by, and no more — this runs once per mutation. */
const SUITES = ["tests/engine", "tests/golden"];

/** One comparison that can be flipped, and what to flip it to. */
export interface Boundary {
  file: string;
  line: number;
  /** A stable id: file:line:from, so the baseline survives reformatting of other lines. */
  id: string;
  from: string;
  to: string;
  /** The source line, for a report someone can act on. */
  context: string;
}

/**
 * The inclusive/exclusive pairs worth flipping.
 *
 * Deliberately only these. `===` or `!==` mutations produce nonsense rather than
 * a plausible alternative reading of a statute, and the point here is not
 * mutation coverage in general — it is the specific question of whether "at or
 * below" is held anywhere.
 */
const PAIRS: [string, string][] = [
  ["greaterThanOrEqual(", "greaterThan("],
  ["lessThanOrEqual(", "lessThan("],
  [">=", ">"],
  ["<=", "<"],
];

/** Every `.ts` under a directory, sorted, so a run is reproducible. */
export function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...sourceFiles(p));
    else if (name.endsWith(".ts")) out.push(p);
  }
  return out;
}

/**
 * Find the flippable comparisons in one file's text.
 *
 * A method *definition* is skipped. Renaming `lessThanOrEqual` where it is
 * declared does not ask "is this boundary held" — it deletes the method and
 * every caller breaks, which tells you nothing about any threshold.
 */
export function boundariesIn(relPath: string, text: string): Boundary[] {
  const found: Boundary[] = [];
  const lines = text.split("\n");
  lines.forEach((line, i) => {
    // A declaration, not a use: `lessThanOrEqual(other: MoneyInput): boolean {`
    if (/^\s{0,4}(?:export )?(?:private |public )?\w+\(.*\)\s*:\s*\w+\s*\{?\s*$/.test(line)) {
      if (PAIRS.some(([from]) => line.trimStart().startsWith(from.replace("(", "")))) return;
    }
    for (const [from, to] of PAIRS) {
      let at = line.indexOf(from);
      while (at !== -1) {
        // `>=` inside `=>` is an arrow, and `<=` inside `<=>` is nothing here.
        const before = line[at - 1] ?? "";
        if (!(from === ">=" && before === "=")) {
          found.push({
            file: relPath,
            line: i + 1,
            id: `${relPath}:${i + 1}:${from}:${line.slice(0, at).length}`,
            from,
            to,
            context: line.trim().slice(0, 120),
          });
        }
        at = line.indexOf(from, at + 1);
      }
    }
  });
  return found;
}

/** Split the unheld boundaries into the known backlog and the ones that just appeared. */
export function againstBaseline(
  unheld: readonly string[],
  baseline: readonly string[],
): { fresh: string[]; recovered: string[] } {
  const known = new Set(baseline);
  const now = new Set(unheld);
  return {
    fresh: unheld.filter((id) => !known.has(id)).sort(),
    recovered: baseline.filter((id) => !now.has(id)).sort(),
  };
}

/** The report a person reads. */
export function renderReport(
  checked: number,
  unheld: readonly Boundary[],
  baseline: readonly string[],
): string {
  const lines = [
    `Flipped ${checked} inclusive/exclusive comparisons in the engine.`,
    `${checked - unheld.length} are held by a test · ${unheld.length} are not.`,
    "",
    'A comparison is "held" when changing `<=` to `<` (or `>=` to `>`) makes a test fail.' +
      " One that is not held is a line nobody has written a case on, and `<=` versus `<` is" +
      " the difference between telling a household at exactly the limit that it qualifies and" +
      " telling it that it does not.",
  ];
  const { fresh, recovered } = againstBaseline(
    unheld.map((b) => b.id),
    baseline,
  );
  if (fresh.length > 0) {
    lines.push("", "## Newly unheld", "");
    lines.push(
      "These are not on the committed baseline. Something added a threshold without a case" +
        " that sits exactly on it. This is what fails the check.",
      "",
    );
    for (const id of fresh) {
      const b = unheld.find((x) => x.id === id)!;
      lines.push(`- \`${b.file}:${b.line}\` — \`${b.from}\` → \`${b.to}\``, `  - ${b.context}`);
    }
  }
  if (recovered.length > 0) {
    lines.push("", "## Held now", "");
    lines.push("On the baseline and held by a test. Remove them from it.", "");
    for (const id of recovered) lines.push(`- \`${id}\``);
  }
  if (unheld.length > 0) {
    lines.push("", "## Every unheld boundary", "");
    for (const b of unheld) {
      lines.push(`- \`${b.file}:${b.line}\` — \`${b.from}\` → \`${b.to}\``, `  - ${b.context}`);
    }
  }
  return lines.join("\n");
}

/* c8 ignore start -- mutates files on disk and shells out to the test runner */

/** True when the suite still passes with the file mutated — i.e. the boundary is NOT held. */
function survives(): boolean {
  try {
    execFileSync("npx", ["vitest", "run", ...SUITES], {
      cwd: ROOT,
      stdio: "ignore",
      timeout: 10 * 60_000,
    });
    return true;
  } catch {
    return false;
  }
}

async function main(): Promise<void> {
  const only = process.argv.indexOf("--file");
  const roots = [join(ROOT, "src", "engine")];
  const files = roots
    .flatMap(sourceFiles)
    .map((p) => p.slice(ROOT.length + 1).replace(/\\/g, "/"))
    .filter((p) => (only === -1 ? true : p === process.argv[only + 1]));

  // Refuse to run against uncommitted work: this rewrites source files, and a
  // crash between mutate and restore would take an edit with it.
  const dirty = execFileSync("git", ["status", "--porcelain", "--", "src/engine"], {
    cwd: ROOT,
    encoding: "utf8",
  }).trim();
  if (dirty) {
    process.stderr.write(
      `refusing to run: src/engine has uncommitted changes, and this rewrites files in place\n${dirty}\n`,
    );
    process.exitCode = 1;
    return;
  }

  const unheld: Boundary[] = [];
  let checked = 0;
  for (const rel of files) {
    const abs = join(ROOT, rel);
    const original = readFileSync(abs, "utf8");
    const boundaries = boundariesIn(rel, original);
    for (const b of boundaries) {
      const lines = original.split("\n");
      const col = Number(b.id.split(":").pop());
      const line = lines[b.line - 1]!;
      lines[b.line - 1] = line.slice(0, col) + b.to + line.slice(col + b.from.length);
      try {
        writeFileSync(abs, lines.join("\n"));
        checked += 1;
        const notHeld = survives();
        if (notHeld) unheld.push(b);
        process.stderr.write(`${notHeld ? "UNHELD" : "held  "} ${b.file}:${b.line} ${b.from}\n`);
      } finally {
        writeFileSync(abs, original);
      }
    }
    if (readFileSync(abs, "utf8") !== original) {
      throw new Error(`failed to restore ${rel} — check it before committing`);
    }
  }

  const file = JSON.parse(readFileSync(BASELINE_FILE, "utf8")) as {
    note: string[];
    recordedOn: string;
    unheld: string[];
  };
  const baseline = file.unheld;
  const report = renderReport(checked, unheld, baseline);
  process.stdout.write(`${report}\n`);

  // `--accept` records what this run found, the way the source watch does.
  // Recording is the deliberate act: an id written here is a boundary somebody
  // has decided not to hold yet, and the list is meant to shrink.
  if (process.argv.includes("--accept")) {
    writeFileSync(
      BASELINE_FILE,
      `${JSON.stringify({ ...file, unheld: unheld.map((b) => b.id).sort() }, null, 2)}\n`,
    );
    process.stderr.write(`recorded ${unheld.length} unheld boundaries\n`);
    return;
  }
  const { fresh } = againstBaseline(
    unheld.map((b) => b.id),
    baseline,
  );
  if (fresh.length > 0) process.exitCode = 1;
}

if (process.argv[1] && process.argv[1].endsWith("check-boundaries.ts")) {
  await main();
}
/* c8 ignore stop */
