import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readFileSync, writeFileSync, existsSync, mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import {
  againstBaseline,
  boundariesIn,
  renderReport,
  readJournal,
  writeJournal,
  clearJournal,
  recoverAbandonedMutation,
  unknownFlags,
} from "../../scripts/check-boundaries";

/**
 * The boundary check.
 *
 * Every figure on this site passes through comparisons that decide which side
 * of a line someone is on, and the statutes write those lines "at or below" —
 * so `<=` and `<` are different answers to a real person. A suite can be large
 * and green and hold none of them, because an exact threshold is measure-zero
 * for an arbitrary input and appears only in a case somebody wrote on purpose.
 *
 * On 2026-08-30, forty-seven of sixty-eight comparisons in `src/engine` could
 * be flipped without failing one of 1,820 tests. These cover the pure parts —
 * finding the comparisons and reporting on them; the mutation itself rewrites
 * files and runs the suite once per boundary, so it runs on demand, never here.
 */
const ROOT = resolve(__dirname, "..", "..");

describe("finding the comparisons worth flipping", () => {
  it("finds both the Money methods and the bare operators", () => {
    const found = boundariesIn(
      "x.ts",
      ["if (a.lessThanOrEqual(b)) return 0;", "if (pct >= limit) return true;"].join("\n"),
    );
    expect(found.map((b) => `${b.from}->${b.to}`)).toEqual([
      "lessThanOrEqual(->lessThan(",
      ">=->>",
    ]);
  });

  it("does not mistake an arrow function for a comparison", () => {
    // `=>` contains `>=` read backwards only if you are careless, but `x =>` and
    // `x >= y` both contain a `>` preceded by `=`. Mutating an arrow produces a
    // syntax error, which fails every test and reports the boundary as held —
    // a false green on something that was never a boundary.
    expect(boundariesIn("x.ts", "const f = (n) => n + 1;")).toEqual([]);
  });

  it("skips a method declaration, which is a rename rather than a boundary", () => {
    // Renaming `lessThanOrEqual` where it is declared deletes the method and
    // breaks every caller. That tells you nothing about any threshold.
    const decl = "  lessThanOrEqual(other: MoneyInput): boolean {";
    expect(boundariesIn("money.ts", decl)).toEqual([]);
  });

  it("gives each comparison an id that survives an edit elsewhere in the file", () => {
    // This test's NAME was true and its assertion was not: it pinned
    // "x.ts:1:<=:6", a line number, and so asserted precisely the fragility the
    // name promised was absent. That is why nobody noticed until an edit above
    // a comparison broke the baseline. The id is file, operator, column, and a
    // hash of the line's own text now.
    const [a] = boundariesIn("x.ts", "if (a <= b && c <= d) return 0;");
    expect(a?.id).toMatch(/^x\.ts:<=:6:[0-9a-f]{8}$/);
  });

  it("reports a column that actually indexes to the operator", () => {
    // The mutation writes `to` at this column. It used to read the column back
    // out of the id's last segment, which was true of the old id shape and
    // became a hash the moment the id changed — so every flip was written at
    // column NaN, mangling the line, breaking the build, and failing the suite
    // for a reason that had nothing to do with the comparison. Every boundary
    // then reported as "held by a test": the most reassuring answer this check
    // can give, and entirely false. Caught by flipping one line by hand and
    // finding the suite green where the report said it should be red.
    const source = "if (a <= b && c >= d) return x <= y;\n  if (m.lessThanOrEqual(n)) return 0;";
    const lines = source.split("\n");
    const found = boundariesIn("x.ts", source);
    expect(found.length).toBeGreaterThan(3);
    for (const b of found) {
      expect(lines[b.line - 1]!.slice(b.column, b.column + b.from.length)).toBe(b.from);
    }
  });

  it("finds every comparison on a line, not just the first", () => {
    expect(boundariesIn("x.ts", "if (a <= b && c <= d) return 0;")).toHaveLength(2);
  });
});

describe("the baseline", () => {
  const baseline = JSON.parse(
    readFileSync(resolve(ROOT, "scripts", "boundary-baseline.json"), "utf8"),
  ) as { unheld: Record<string, string>; note: string[] };

  it("fails only on a boundary that was not already known to be unheld", () => {
    // The backlog is a backlog, not a monthly alarm. Only something newly
    // unheld is worth failing on: that is somebody adding a threshold without a
    // case that sits exactly on it.
    const known = ["a.ts:1:<=:0", "b.ts:2:>=:0"];
    expect(againstBaseline(known, known).fresh).toEqual([]);
    expect(againstBaseline([...known, "c.ts:3:<=:0"], known).fresh).toEqual(["c.ts:3:<=:0"]);
  });

  it("survives an edit somewhere else in the same file", () => {
    // The line NUMBER used to be part of the id, so adding a function above a
    // comparison moved it: the shifted boundary read as "newly unheld" — which
    // means somebody added a threshold with no case on it — and its twin read
    // as "held now, remove it". Accepting that report would have deleted the
    // written reason each entry carries. Three entries did exactly this on
    // 2026-09-01 after two unrelated functions were added to the engine.
    const line = "  if (a <= b) return 0;";
    const before = boundariesIn("src/engine/x.ts", `${line}\n`);
    const after = boundariesIn("src/engine/x.ts", `// a new comment\nfunction f() {}\n${line}\n`);
    expect(after[0]?.id).toBe(before[0]?.id);
    expect(after[0]?.line).not.toBe(before[0]?.line);
    // And an edit to the comparison's own line DOES change it, which is the
    // moment a person should look at it again.
    const edited = boundariesIn("src/engine/x.ts", "  if (a <= c) return 0;\n");
    expect(edited[0]?.id).not.toBe(before[0]?.id);
  });

  it("says nothing about files a scoped run did not look at", () => {
    // `--file` checks one file. Reporting every other file's baseline entries
    // as "held now — remove them from it" is an instruction to empty the
    // baseline of lines nothing re-examined, after which the next full run
    // fails on all of them as newly unheld. A run that looked at one file can
    // say nothing about the others, and saying nothing is the right output.
    const baseline = ["src/engine/a.ts:1:<=:0", "src/engine/b.ts:2:>=:0"];
    const scoped = againstBaseline([], baseline, ["src/engine/a.ts"]);
    expect(scoped.recovered).toEqual(["src/engine/a.ts:1:<=:0"]);
    // With no scope — the full run — both are genuinely held now.
    expect(againstBaseline([], baseline).recovered).toEqual(baseline);
  });

  it("still fails on something newly unheld inside the scope it did check", () => {
    // Scoping narrows what the run may CLAIM, not what it may catch.
    const fresh = againstBaseline(["src/engine/a.ts:9:<=:0"], [], ["src/engine/a.ts"]).fresh;
    expect(fresh).toEqual(["src/engine/a.ts:9:<=:0"]);
  });

  it("notices a boundary that is now held, so the list can shrink", () => {
    expect(againstBaseline(["a.ts:1:<=:0"], ["a.ts:1:<=:0", "b.ts:2:>=:0"]).recovered).toEqual([
      "b.ts:2:>=:0",
    ]);
  });

  it("names the ones that are statutory thresholds rather than defensive guards", () => {
    // The list mixes real eligibility lines with `if (amount <= 0) return 0`.
    // Both belong in it — deciding which is which is a reading, and a list
    // pre-filtered by someone's reading hides the one they got wrong — but the
    // note has to say so, or the next reader treats all forty-seven as noise.
    const note = baseline.note.join(" ");
    expect(note).toMatch(/should SHRINK/);
    expect(note).toMatch(/400% FPL/);
    expect(note).toMatch(/defensive guards/);
    // Since the classifier landed, the note must do more than mix the two kinds
    // together and say so: every survivor carries a verdict, and the note has to
    // state which verdict and on what evidence. A list of line numbers with no
    // verdicts is the report people stop reading, which is what this whole
    // check exists to avoid.
    expect(note).toMatch(/no observed difference|no-observed-difference/i);
    expect(note).toMatch(/calibrat/i);
    // The verdict is evidence, not proof, and the note must not overclaim it.
    expect(note).toMatch(/evidence, not proof/i);
  });

  it("gives every unheld boundary a written reason, not just a verdict", () => {
    // "No observed difference" is the classifier's evidence; it is not an
    // explanation, and a reader who wants to shrink this list needs to know
    // whether a line is unholdable because the other arm computes the same
    // value, because the branch cannot be entered, or because nothing this
    // engine exposes can reach it. Same rule watch-coverage.json applies to an
    // unwatched dataset: a reason is a decision someone can argue with later.
    const missing = Object.entries(baseline.unheld)
      .filter(([, reason]) => reason.trim().length < 40)
      .map(([id]) => id);
    expect(
      missing,
      `these boundaries are recorded with no reason (or too short a one) for going unheld: ${missing.join(", ")}`,
    ).toEqual([]);
  });

  it("holds ids in the shape the checker produces", () => {
    for (const id of Object.keys(baseline.unheld)) {
      expect(id, `${id} is not file:operator:column:hash`).toMatch(
        /^src\/engine\/[\w/.]+\.ts:(<=|>=|lessThanOrEqual\(|greaterThanOrEqual\():\d+:[0-9a-f]{8}$/,
      );
    }
  });
});

describe("the report", () => {
  const boundary = {
    file: "src/engine/benefits.ts",
    line: 10,
    id: "src/engine/benefits.ts:10:<=:4",
    column: 4,
    from: "<=",
    to: "<",
    context: "if (pct <= threshold) return true;",
  };

  it("says what 'held' means, because the word does not explain itself", () => {
    const report = renderReport(2, [boundary], [boundary.id]);
    expect(report).toContain("1 are held by a test · 1 are not");
    expect(report).toMatch(/telling a household at exactly the limit/);
  });

  it("separates a new one from the known backlog", () => {
    const fresh = renderReport(2, [boundary], []);
    expect(fresh).toContain("## Newly unheld");
    expect(renderReport(2, [boundary], [boundary.id])).not.toContain("## Newly unheld");
  });
});

/**
 * The mutation journal.
 *
 * The check rewrites `src/engine` in place and restores it in a `finally`,
 * which a signal does not run. Killing a run — Ctrl-C, a CI timeout — used to
 * leave one flipped comparison sitting in a file nobody edited: it type-checks,
 * it builds, and the suite shows a single failure that reads like a regression
 * somewhere else entirely. That happened on 2026-09-01, and the symptom was a
 * goal-plan test failing over a mutation left behind in `socialSecurity.ts`.
 *
 * These exercise recovery against a scratch git repo rather than this one, so a
 * bug here can never call `git checkout` on real work.
 */
describe("recovering from a run that was killed mid-rewrite", () => {
  let dir: string;
  let journal: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "boundary-journal-"));
    journal = join(dir, "journal.json");
    // The fixture repo must not inherit the developer's git config. This one
    // failed intermittently on a machine with `commit.gpgsign = true` set
    // globally: `git commit` in the throwaway repo tried to reach a signing
    // key, and under concurrency the agent sometimes did not answer — a test
    // about restoring a file, failing because of somebody's GPG setup, and
    // passing in CI where no key is configured. Pointing the global and system
    // config at /dev/null makes the fixture depend on nothing but git itself,
    // which also settles hooks paths, commit templates and autocrlf.
    const git = (...args: string[]) =>
      execFileSync("git", args, {
        cwd: dir,
        stdio: "ignore",
        env: {
          ...process.env,
          GIT_CONFIG_GLOBAL: "/dev/null",
          GIT_CONFIG_SYSTEM: "/dev/null",
          GIT_TERMINAL_PROMPT: "0",
        },
      });
    git("init", "-q");
    git("config", "user.email", "t@example.com");
    git("config", "user.name", "t");
    mkdirSync(join(dir, "src", "engine"), { recursive: true });
    writeFileSync(join(dir, "src", "engine", "b.ts"), "if (a <= b) return 0;\n");
    git("add", "-A");
    git("commit", "-qm", "seed");
  });

  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("puts the file back exactly as HEAD has it", () => {
    // The state a killed run leaves behind: the flip on disk, the note beside it.
    writeFileSync(join(dir, "src", "engine", "b.ts"), "if (a < b) return 0;\n");
    writeJournal({ file: "src/engine/b.ts", boundary: "src/engine/b.ts:1:<=:6" }, journal);

    const recovered = recoverAbandonedMutation(dir, journal);

    expect(recovered?.boundary).toBe("src/engine/b.ts:1:<=:6");
    expect(readFileSync(join(dir, "src", "engine", "b.ts"), "utf8")).toBe(
      "if (a <= b) return 0;\n",
    );
    expect(existsSync(journal)).toBe(false);
  });

  it("does nothing at all when no run was interrupted", () => {
    expect(recoverAbandonedMutation(dir, journal)).toBeNull();
    expect(readFileSync(join(dir, "src", "engine", "b.ts"), "utf8")).toBe(
      "if (a <= b) return 0;\n",
    );
  });

  it("does not hand a guessed path to git when the note is half-written", () => {
    // A process killed between opening the note and finishing it. The note
    // names no file, so there is nothing to restore and nothing to guess at —
    // but it must still be cleared, or it blocks every later run for nothing.
    writeFileSync(journal, '{"file":"src/eng');
    expect(recoverAbandonedMutation(dir, journal)).toBeNull();
    expect(existsSync(journal)).toBe(false);
  });

  it("round-trips the note, so recovery reads what the run wrote", () => {
    const entry = { file: "src/engine/benefits.ts", boundary: "src/engine/benefits.ts:10:<=:4" };
    writeJournal(entry, journal);
    expect(readJournal(journal)).toEqual(entry);
    clearJournal(journal);
    expect(readJournal(journal)).toBeNull();
  });

  it("clearing a note that is not there is not an error", () => {
    expect(() => clearJournal(journal)).not.toThrow();
  });
});

describe("the flags this check accepts", () => {
  /**
   * Every option used to be read with `argv.includes(...)`, so an unrecognized
   * one was simply absent and the run started regardless. `--help` was the
   * expensive case: asking a 25-minute job that rewrites files in `src/engine`
   * what its options are got the job, and killing it left a flipped comparison
   * on disk in a file nobody had edited. The journal makes that recoverable.
   * Refusing to start makes it moot, which is better — this happened.
   */
  it("names an unknown option instead of starting a 25-minute rewrite", () => {
    expect(unknownFlags(["--help"])).toEqual([]);
    expect(unknownFlags(["--file", "src/engine/amt.ts"])).toEqual([]);
    expect(unknownFlags(["--classify"])).toEqual([]);
    expect(unknownFlags(["--accept"])).toEqual([]);
    expect(unknownFlags(["--halp"])).toEqual(["--halp"]);
    expect(unknownFlags(["--file", "x.ts", "--clasify"])).toEqual(["--clasify"]);
  });

  it("does not mistake a --file argument for a flag", () => {
    // The path is a bare value, and a path never starts with a dash here.
    expect(unknownFlags(["--file", "src/engine/dueDates.ts"])).toEqual([]);
  });
});
