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
 * `--classify` answers the question the survivors leave open. A mutation that
 * fails no test is either a real gap — a decision nobody wrote a case on — or a
 * branch whose `else` computes the same answer at that point, which no test can
 * ever hold. Roughly two thirds of the 2026-08-31 backlog turned out to be the
 * second kind, and telling them apart took a person reading each line. So this
 * runs {@link ../scripts/observe-engine} instead of the suite: the engine, at
 * and around the values its comparisons test. If any observed value moved, the
 * mutation is OBSERVABLE and a test could hold it. If none did, the report says
 * "no observed difference" and never "redundant", because absence over a finite
 * probe is evidence rather than proof. Costs ~1.5s per comparison instead of
 * eight, so the whole engine classifies in about two minutes.
 *
 *   npm run check:boundaries
 *   npm run check:boundaries -- --file src/engine/benefits.ts
 *   npm run check:boundaries -- --classify
 */
import {
  appendFileSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  statSync,
  existsSync,
  rmSync,
  mkdirSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BASELINE_FILE = join(ROOT, "scripts", "boundary-baseline.json");
/** Where an in-flight rewrite is recorded, so a run that is killed is recoverable. */
const JOURNAL_FILE = join(ROOT, "scripts", ".boundary-mutation.json");
/** The suites a boundary can plausibly be held by, and no more — this runs once per mutation. */
const SUITES = ["tests/engine", "tests/golden"];
/** The probe runner, for `--classify`. One file, so it starts in ~1.5s. */
const OBSERVE_SPEC = "tests/build/observeEngine.test.ts";

/**
 * A boundary's identity: file, operator, column, and a hash of the line itself.
 *
 * The line NUMBER used to be in here, and it made the baseline fragile in a way
 * that had nothing to do with what the baseline is for. Adding a function above
 * a comparison moved it, so every shifted boundary read as "newly unheld" — the
 * failure that means somebody added a threshold with no case on it — while its
 * twin read as "held now, remove it". On 2026-09-01 three entries did exactly
 * that after two unrelated functions were added, and accepting the report would
 * have thrown away the written reason each of them carried.
 *
 * Hashing the line instead means an edit ELSEWHERE in the file leaves the id
 * alone, and an edit to the comparison's own line changes it — which is the
 * moment a human should look again anyway. The column stays because two
 * comparisons can share one line.
 */
export function boundaryId(file: string, operator: string, column: number, line: string): string {
  const hash = createHash("sha256").update(line.trim()).digest("hex").slice(0, 8);
  return `${file}:${operator}:${column}:${hash}`;
}

/** One comparison that can be flipped, and what to flip it to. */
export interface Boundary {
  file: string;
  line: number;
  /** A stable id: see {@link boundaryId} — no line number, so it survives edits elsewhere. */
  id: string;
  /**
   * Where the operator starts on the line.
   *
   * A field rather than something parsed back out of the id. It WAS parsed out
   * — `Number(id.split(":").pop())` — which was true of the old id shape and
   * became a hash the moment the id changed, so every mutation wrote its
   * operator at column NaN, mangled the line, failed to compile, and made the
   * suite fail for a reason that had nothing to do with the flip. Every
   * boundary then reported as "held by a test", which is the most reassuring
   * answer this check can give and was completely false. An id is an identity;
   * it is not a place to keep data the code needs.
   */
  column: number;
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
            column: at,
            id: boundaryId(relPath, from, at, line),
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

/**
 * Split the unheld boundaries into the known backlog and the ones that just
 * appeared.
 *
 * `scope`, when given, is the set of files this run actually checked. Without
 * it a `--file` run reported every baseline entry from every OTHER file as
 * "held now — remove them from it": twenty-one lines of instruction that would
 * have emptied the baseline of entries nothing had re-examined, and the next
 * full run would then have failed on all of them as newly unheld. A run that
 * looked at one file can say nothing about the other sixteen, and saying
 * nothing is the correct output.
 */
export function againstBaseline(
  unheld: readonly string[],
  baseline: readonly string[],
  scope?: readonly string[],
): { fresh: string[]; recovered: string[] } {
  const known = new Set(baseline);
  const now = new Set(unheld);
  const checked = scope ? new Set(scope) : null;
  const inScope = (id: string): boolean =>
    checked === null || checked.has(id.slice(0, id.lastIndexOf(".ts:") + 3));
  return {
    fresh: unheld.filter((id) => !known.has(id)).sort(),
    recovered: baseline.filter((id) => inScope(id) && !now.has(id)).sort(),
  };
}

/** The report a person reads. */
export type Verdict = "observable" | "no-observed-difference";

/**
 * Sort classified boundaries into the two piles the reader must act on
 * differently: an OBSERVABLE survivor is a decision waiting for a test, and one
 * with no observed difference is a branch a test cannot reach.
 */
export function splitByVerdict(
  unheld: readonly Boundary[],
  verdicts: ReadonlyMap<string, Verdict>,
): { observable: Boundary[]; unobserved: Boundary[]; unclassified: Boundary[] } {
  const observable: Boundary[] = [];
  const unobserved: Boundary[] = [];
  const unclassified: Boundary[] = [];
  for (const b of unheld) {
    const v = verdicts.get(b.id);
    if (v === "observable") observable.push(b);
    else if (v === "no-observed-difference") unobserved.push(b);
    else unclassified.push(b);
  }
  return { observable, unobserved, unclassified };
}

export function renderReport(
  checked: number,
  unheld: readonly Boundary[],
  baseline: readonly string[],
  verdicts: ReadonlyMap<string, Verdict> = new Map(),
  miscalibrated: readonly Boundary[] = [],
  /** The files this run examined; omitted for a full run over the engine. */
  scope?: readonly string[],
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
    scope,
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
  if (verdicts.size > 0) {
    const { observable, unobserved, unclassified } = splitByVerdict(unheld, verdicts);
    lines.push("", "## What the survivors mean", "");
    lines.push(
      "Each unheld comparison was flipped again and the engine re-run over the values its" +
        " comparisons test (`scripts/observe-engine.ts`). A mutation that moves an observed" +
        " value is a decision a test could hold. One that moves nothing is a branch whose" +
        " `else` computes the same answer at that point — no test can hold it, and asking for" +
        " one is asking for a fixture that manufactures a difference.",
      "",
      `${observable.length} observable · ${unobserved.length} with no observed difference` +
        (unclassified.length > 0 ? ` · ${unclassified.length} unclassified` : ""),
    );
    if (miscalibrated.length > 0) {
      lines.push("", "### The probe is too weak", "");
      lines.push(
        "These are HELD by a test, so a difference exists by definition — and the probe did" +
          " not see it. Until `observe-engine.ts` reaches them, a *no observed difference*" +
          " verdict elsewhere in this report cannot be trusted.",
        "",
      );
      for (const b of miscalibrated) lines.push(`- \`${b.file}:${b.line}\` — \`${b.from}\``);
    }
    if (observable.length > 0) {
      lines.push("", "### Observable — write the case", "");
      for (const b of observable) {
        lines.push(`- \`${b.file}:${b.line}\` — \`${b.from}\` → \`${b.to}\``, `  - ${b.context}`);
      }
    }
    if (unobserved.length > 0) {
      lines.push("", "### No observed difference", "");
      lines.push(
        "Evidence, not proof: absence of a difference over a finite probe is not the same as" +
          " a guarantee that none exists.",
        "",
      );
      for (const b of unobserved) {
        lines.push(`- \`${b.file}:${b.line}\` — \`${b.from}\` → \`${b.to}\``, `  - ${b.context}`);
      }
    }
    return lines.join("\n");
  }
  if (unheld.length > 0) {
    lines.push("", "## Every unheld boundary", "");
    for (const b of unheld) {
      lines.push(`- \`${b.file}:${b.line}\` — \`${b.from}\` → \`${b.to}\``, `  - ${b.context}`);
    }
  }
  return lines.join("\n");
}

/**
 * The mutation journal.
 *
 * This check rewrites `src/engine` in place and puts it back in a `finally`,
 * which covers a throw and nothing else. A signal does not run `finally`: press
 * Ctrl-C, or let CI time the job out, and the tree is left holding a single
 * flipped comparison in a file nobody edited. It type-checks, it builds, and
 * the suite is green apart from one failure that reads like a real regression
 * somewhere unrelated — which is precisely the class of silent wrong answer the
 * check exists to hunt, planted by the hunter.
 *
 * So the path being rewritten is written down before the rewrite and erased
 * after the restore. A later run finds the note and puts the file back. That
 * covers what a handler cannot: SIGKILL, an OOM, a laptop lid.
 *
 * Recovery is `git checkout -- <the one path>`, which is safe here rather than
 * merely convenient: the run refuses to start unless `src/engine` is clean, so
 * HEAD *is* the pristine content of the only file the journal can ever name.
 */
export interface MutationJournal {
  /** Repo-relative path of the file currently rewritten. */
  file: string;
  /** The boundary id being flipped, so recovery can say what was interrupted. */
  boundary: string;
}

export function readJournal(path: string = JOURNAL_FILE): MutationJournal | null {
  if (!existsSync(path)) return null;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<MutationJournal>;
    if (typeof parsed.file !== "string" || typeof parsed.boundary !== "string") return null;
    return { file: parsed.file, boundary: parsed.boundary };
  } catch {
    // A half-written note is still evidence a run died mid-rewrite, but it does
    // not say which file. Better to report nothing than to guess at a path and
    // hand it to `git checkout`.
    return null;
  }
}

export function writeJournal(entry: MutationJournal, path: string = JOURNAL_FILE): void {
  writeFileSync(path, `${JSON.stringify(entry)}\n`);
}

export function clearJournal(path: string = JOURNAL_FILE): void {
  rmSync(path, { force: true });
}

/**
 * Put back a file an interrupted run left rewritten, if there is one.
 * Returns what it restored, so the caller can say so out loud — a repair that
 * happens silently teaches nobody that the hazard exists.
 */
export function recoverAbandonedMutation(
  root: string = ROOT,
  path: string = JOURNAL_FILE,
): MutationJournal | null {
  const entry = readJournal(path);
  if (!entry) {
    // A note that could not be read is still cleared: it names no file, so
    // leaving it would block every future run for nothing.
    clearJournal(path);
    return null;
  }
  execFileSync("git", ["checkout", "--", entry.file], { cwd: root });
  clearJournal(path);
  return entry;
}

/* c8 ignore start -- mutates files on disk and shells out to the test runner */

/**
 * Run a test command to completion and say whether it passed.
 *
 * Deliberately async rather than `execFileSync`. A synchronous child blocks the
 * event loop for the whole run, so a signal arriving mid-mutation sits in the
 * queue for the eight minutes the suite takes before the restore handler gets
 * to run — the file stays flipped on disk for as long as anyone is watching,
 * and if the shell gives up first it stays flipped for good. Awaiting keeps the
 * loop live, so the handler fires at once and takes the child with it.
 */
function run(args: string[], env: NodeJS.ProcessEnv, timeoutMs: number): Promise<boolean> {
  return new Promise((settle) => {
    const child = spawn("npx", args, { cwd: ROOT, stdio: "ignore", env });
    running.add(child);
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    const done = (ok: boolean): void => {
      clearTimeout(timer);
      running.delete(child);
      settle(ok);
    };
    child.on("error", () => done(false));
    child.on("close", (code) => done(code === 0));
  });
}

/** Children to take down when a signal arrives, so the restore is not queued behind one. */
const running = new Set<ReturnType<typeof spawn>>();

/** True when the suite still passes with the file mutated — i.e. the boundary is NOT held. */
function survives(): Promise<boolean> {
  return run(["vitest", "run", ...SUITES], process.env, 10 * 60_000);
}

/** The digest of everything the probe observes, with the tree as it stands. */
async function observe(): Promise<string | null> {
  // `.cache` is not created by every install, and a probe whose digest cannot
  // be written reports as a failed probe — which reads as "the probe fails on
  // unmutated source" and refuses the whole classify run.
  const cache = join(ROOT, "node_modules", ".cache");
  mkdirSync(cache, { recursive: true });
  const out = join(cache, "boundary-observation.json");
  const ok = await run(
    ["vitest", "run", OBSERVE_SPEC],
    { ...process.env, OBSERVE_OUT: out },
    5 * 60_000,
  );
  // A mutation can make the probe itself throw. That is a difference too --
  // the loudest kind -- so it is reported as observable rather than swallowed.
  if (!ok) return null;
  try {
    return readFileSync(out, "utf8");
  } catch {
    return null;
  }
}

/** Flags this script understands. Anything else is a typo, and typos are costly here. */
const FLAGS = new Set(["--file", "--classify", "--accept", "--help", "-h"]);

const USAGE = `check-boundaries — which inclusive/exclusive comparisons a test actually holds.

It flips every <= and >= in src/engine to its strict form, one at a time, and
re-runs the suite. A mutation that still passes is a line no test holds.

  npm run check:boundaries                     the full sweep (~25 minutes)
  npm run check:boundaries -- --file <path>    one file, e.g. src/engine/amt.ts
  npm run check:boundaries:classify            re-run the ENGINE, not the suite,
                                               over the values each survivor
                                               tests: ~1.5s a comparison
  npm run check:boundaries -- --accept         record the current survivors as
                                               the baseline (each needs a reason)

It REWRITES FILES IN src/engine while it runs, so it refuses to start unless
that tree is clean, journals the path it is about to change, and repairs
whatever an earlier killed run left behind. Recovery by hand is a git checkout
on the one path scripts/.boundary-mutation.json names.
`;

/**
 * Refuse a flag this script does not know.
 *
 * Everything here used to be `argv.includes(...)`, so an unrecognized flag was
 * simply absent and the run started anyway. `--help` was the worst of them: a
 * contributor asking a 25-minute job that rewrites source files what its
 * options are got the job instead, and killing it left a flipped comparison on
 * disk in a file they had not edited. The journal makes that recoverable; not
 * starting makes it moot.
 */
export function unknownFlags(argv: string[]): string[] {
  return argv.filter((a) => a.startsWith("-") && !FLAGS.has(a));
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    process.stdout.write(USAGE);
    return;
  }
  const unknown = unknownFlags(args);
  if (unknown.length > 0) {
    process.stderr.write(`check-boundaries: unknown option ${unknown.join(", ")}\n\n${USAGE}`);
    process.exitCode = 2;
    return;
  }

  const only = process.argv.indexOf("--file");
  const roots = [join(ROOT, "src", "engine")];
  const files = roots
    .flatMap(sourceFiles)
    .map((p) => p.slice(ROOT.length + 1).replace(/\\/g, "/"))
    .filter((p) => (only === -1 ? true : p === process.argv[only + 1]));

  // Clean up after a previous run that was killed mid-rewrite, before deciding
  // whether the tree is dirty — otherwise this check's own wreckage reads as
  // somebody's uncommitted work and refuses every run until a person notices.
  const recovered = recoverAbandonedMutation();
  if (recovered) {
    process.stderr.write(
      `recovered ${recovered.file}: an earlier run was killed while ${recovered.boundary} was flipped\n`,
    );
  }

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

  // `finally` does not run on a signal. Ctrl-C, or a CI job hitting its limit,
  // would otherwise leave the flipped comparison on disk.
  let inFlight: { abs: string; original: string } | null = null;
  const putBack = (): void => {
    if (inFlight) writeFileSync(inFlight.abs, inFlight.original);
    inFlight = null;
    clearJournal();
  };
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
    process.on(signal, () => {
      for (const child of running) child.kill("SIGKILL");
      putBack();
      process.stderr.write(`\n${signal}: restored the mutated file before exiting\n`);
      process.exit(signal === "SIGINT" ? 130 : 143);
    });
  }

  const classify = process.argv.includes("--classify");
  const clean = classify ? await observe() : null;
  if (classify && clean === null) {
    process.stderr.write("refusing to classify: the probe fails on unmutated source\n");
    process.exitCode = 1;
    return;
  }

  const unheld: Boundary[] = [];
  const verdicts = new Map<string, Verdict>();
  /** Held boundaries the probe could not see — proof it is too weak. */
  const miscalibrated: Boundary[] = [];
  let checked = 0;
  for (const rel of files) {
    const abs = join(ROOT, rel);
    const original = readFileSync(abs, "utf8");
    const boundaries = boundariesIn(rel, original);
    for (const b of boundaries) {
      const lines = original.split("\n");
      const col = b.column;
      const line = lines[b.line - 1]!;
      lines[b.line - 1] = line.slice(0, col) + b.to + line.slice(col + b.from.length);
      try {
        writeJournal({ file: rel, boundary: b.id });
        inFlight = { abs, original };
        writeFileSync(abs, lines.join("\n"));
        checked += 1;
        const notHeld = await survives();
        if (notHeld) unheld.push(b);
        let verdict = "";
        if (classify) {
          // A mutation that makes the probe throw has changed behaviour in the
          // loudest way there is, so a null digest counts as observable.
          const moved = (await observe()) !== clean;
          verdict = moved ? " observable" : " no-observed-difference";
          if (notHeld) verdicts.set(b.id, moved ? "observable" : "no-observed-difference");
          // Calibration: a held boundary MUST be observable, because a test
          // distinguishes it. One that is not proves the probe has a hole.
          else if (!moved) miscalibrated.push(b);
        }
        process.stderr.write(
          `${notHeld ? "UNHELD" : "held  "} ${b.file}:${b.line} ${b.from}${verdict}\n`,
        );
      } finally {
        writeFileSync(abs, original);
        inFlight = null;
        clearJournal();
      }
    }
    if (readFileSync(abs, "utf8") !== original) {
      throw new Error(`failed to restore ${rel} — check it before committing`);
    }
  }

  const file = JSON.parse(readFileSync(BASELINE_FILE, "utf8")) as {
    note: string[];
    recordedOn: string;
    /**
     * id → why no test holds it. An object rather than a list, because every
     * survivor now carries a verdict and a bare list of line numbers is the
     * report people stop reading. Same shape, and the same rule, as
     * `watch-coverage.json`: a reason is a decision someone can argue with
     * later, not a shrug.
     */
    unheld: Record<string, string>;
  };
  const baseline = Object.keys(file.unheld);
  // A `--file` run examined one file, so it may only speak about that file. The
  // full run passes no scope and speaks about everything.
  const scope = only === -1 ? undefined : files;
  const report = renderReport(checked, unheld, baseline, verdicts, miscalibrated, scope);
  process.stdout.write(`${report}\n`);

  // `--accept` records what this run found, the way the source watch does.
  // Recording is the deliberate act: an id written here is a boundary somebody
  // has decided not to hold yet, and the list is meant to shrink.
  if (process.argv.includes("--accept")) {
    // A reason already written survives; a newly recorded boundary arrives with
    // an empty one, which the baseline's own test rejects until a person writes
    // it. Recording is meant to cost a sentence.
    const recorded: Record<string, string> = Object.fromEntries(
      unheld
        .map((b): [string, string] => [b.id, file.unheld[b.id] ?? ""])
        .sort((x, y) => x[0].localeCompare(y[0])),
    );
    writeFileSync(BASELINE_FILE, `${JSON.stringify({ ...file, unheld: recorded }, null, 2)}\n`);
    const blank = Object.values(recorded).filter((r) => r.trim() === "").length;
    process.stderr.write(
      `recorded ${unheld.length} unheld boundaries` +
        (blank > 0 ? `, ${blank} of them still needing a written reason\n` : "\n"),
    );
    return;
  }
  const { fresh } = againstBaseline(
    unheld.map((b) => b.id),
    baseline,
    scope,
  );

  // The counts the scheduled run gates on. `fresh` is the one that fails: a
  // boundary unheld and NOT on the baseline is a threshold somebody added
  // without a case sitting exactly on it. `unheld` is the backlog, reported
  // because a list that is meant to shrink should be visible when it does not.
  //
  // This is written last, the way every other check writes it, so a crash on
  // the way here leaves the counts unset — which is why the workflow requires
  // `report` to exist before it believes them.
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(
      process.env.GITHUB_OUTPUT,
      `fresh=${fresh.length}\nunheld=${unheld.length}\nreport<<EOF\n${report}\nEOF\n`,
    );
  }

  if (fresh.length > 0) process.exitCode = 1;
}

if (process.argv[1] && process.argv[1].endsWith("check-boundaries.ts")) {
  await main();
}
/* c8 ignore stop */
