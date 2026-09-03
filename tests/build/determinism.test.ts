import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

/**
 * The clock is an input, not something the code reads.
 *
 * "Every figure is reproducible" is the first principle of the spec and a badge
 * on the README, and the modules that carry the highest-harm figures say so
 * repeatedly in prose — `enrollmentWindows.ts`, `lifeEvents.ts`, `deadline.ts`
 * and `ledger.ts` each promise "never `Date.now()`". Nothing enforced it. A
 * `Date.now()` dropped into a deadline path would make a COBRA election window
 * answer differently on Tuesday than on Monday from the same link, and every
 * test would still pass, because a test that runs today agrees with code that
 * reads today.
 *
 * So: no clock read anywhere under `src/`, except the few places where the
 * current date IS the answer, each named here with its reason. The list is meant
 * to stay short. `new Date(Date.UTC(...))` and `new Date(ms)` are not clock
 * reads — they construct a date from an argument — so only the no-argument form
 * counts.
 *
 * `crypto.getRandomValues` is deliberately not covered: the encrypted-export
 * salt and IV MUST be unpredictable, and a deterministic one would be a
 * cryptographic defect rather than a determinism win.
 */
const ROOT = resolve(__dirname, "..", "..");

/** Where reading the clock is the answer rather than a leak of one. */
const CLOCK_IS_THE_ANSWER: Record<string, string> = {
  "src/ui/deadline.ts":
    "the default `asOf` a deadline view opens on, which the reader then sets — the render takes it as a parameter",
  "src/ui/readoutView.ts":
    "the default snapshot date offered in the ledger form, shown on screen and editable before anything is computed",
  "src/ui/reportView.ts":
    "the date stamped on a saved report, which records when the document was made rather than feeding any figure",
  "src/data/loader.ts":
    "the current year the staleness gate measures a shard's effective year against — the one place the calendar is genuinely the question",
};

/**
 * Comments out, so a promise NOT to read the clock is not counted as reading it.
 *
 * The four modules that make the promise make it in a JSDoc block — "the clock
 * is an input, never `Date.now()`" — which contains the same characters as the
 * call. Stripping only `//` lines flagged all four, which is the check calling
 * its own documentation a violation.
 */
export function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

/** A no-argument `new Date()` or `Date.now()`. Constructing from an argument is not a clock read. */
export function clockReads(source: string): number {
  return (source.match(/\bDate\.now\s*\(\s*\)|\bnew\s+Date\s*\(\s*\)/g) ?? []).length;
}

function tsFiles(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string): void => {
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (p.endsWith(".ts")) out.push(p);
    }
  };
  walk(join(ROOT, dir));
  return out;
}

describe("the clock is an input", () => {
  it("counts a no-argument construction and nothing else", () => {
    expect(clockReads("const t = Date.now();")).toBe(1);
    expect(clockReads("const d = new Date();")).toBe(1);
    // The forms all over the date engines, which take their argument from a
    // parameter and are the whole reason a naive grep cannot do this job.
    expect(clockReads("new Date(Date.UTC(y, m - 1, d))")).toBe(0);
    expect(clockReads("new Date(cur.getTime() + DAY_MS)")).toBe(0);
    expect(clockReads("new Date(ms).toISOString()")).toBe(0);
  });

  it("does not count a promise not to read the clock as reading it", () => {
    // Every module that makes the promise makes it in a JSDoc block, which
    // contains the same characters as the call. Counting those flagged all four
    // of them — the check calling its own documentation a violation.
    expect(clockReads("/** the clock is an input, never `Date.now()`. */")).toBe(1);
    expect(clockReads(stripComments("/** the clock is an input, never `Date.now()`. */"))).toBe(0);
    expect(clockReads(stripComments("// never Date.now()\nconst t = Date.now();"))).toBe(1);
  });

  it("finds no clock read outside the places where the date is the answer", () => {
    const leaks: string[] = [];
    for (const file of tsFiles("src")) {
      const rel = file.slice(ROOT.length + 1).replace(/\\/g, "/");
      const code = stripComments(readFileSync(file, "utf8"));
      if (clockReads(code) > 0 && !(rel in CLOCK_IS_THE_ANSWER)) leaks.push(rel);
    }
    expect(leaks, "the clock is an input — add a reason here if it truly is the answer").toEqual(
      [],
    );
  });

  it("keeps the allowlist honest: every entry still reads a clock", () => {
    // An entry that matches nothing grants a pass to a file nobody has looked
    // at, which is the same failure as having no list.
    const dead: string[] = [];
    for (const rel of Object.keys(CLOCK_IS_THE_ANSWER)) {
      const code = stripComments(readFileSync(join(ROOT, rel), "utf8"));
      if (clockReads(code) === 0) dead.push(rel);
    }
    expect(dead, "stale allowlist entry — the file no longer reads a clock").toEqual([]);
  });

  it("keeps the engine, the tiles, the profile and the readout clock-free", () => {
    // The allowlist above is all UI defaults and the staleness gate. Nothing in
    // the compute path may read a clock at all, and stating that separately is
    // what stops the list growing into those directories one reasonable-looking
    // entry at a time.
    for (const dir of ["src/engine", "src/tiles", "src/profile", "src/readout"]) {
      for (const file of tsFiles(dir)) {
        const code = stripComments(readFileSync(file, "utf8"));
        expect(clockReads(code), `${file.slice(ROOT.length + 1)} reads the clock`).toBe(0);
      }
    }
  });
});
