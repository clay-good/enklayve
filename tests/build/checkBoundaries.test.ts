import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { againstBaseline, boundariesIn, renderReport } from "../../scripts/check-boundaries";

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
    const [a] = boundariesIn("x.ts", "if (a <= b && c <= d) return 0;");
    expect(a?.id).toBe("x.ts:1:<=:6");
  });

  it("finds every comparison on a line, not just the first", () => {
    expect(boundariesIn("x.ts", "if (a <= b && c <= d) return 0;")).toHaveLength(2);
  });
});

describe("the baseline", () => {
  const baseline = JSON.parse(
    readFileSync(resolve(ROOT, "scripts", "boundary-baseline.json"), "utf8"),
  ) as { unheld: string[]; note: string[] };

  it("fails only on a boundary that was not already known to be unheld", () => {
    // The backlog is a backlog, not a monthly alarm. Only something newly
    // unheld is worth failing on: that is somebody adding a threshold without a
    // case that sits exactly on it.
    const known = ["a.ts:1:<=:0", "b.ts:2:>=:0"];
    expect(againstBaseline(known, known).fresh).toEqual([]);
    expect(againstBaseline([...known, "c.ts:3:<=:0"], known).fresh).toEqual(["c.ts:3:<=:0"]);
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
  });

  it("holds ids in the shape the checker produces", () => {
    for (const id of baseline.unheld) {
      expect(id, `${id} is not file:line:operator:column`).toMatch(
        /^src\/engine\/[\w/.]+\.ts:\d+:(<=|>=|lessThanOrEqual\(|greaterThanOrEqual\():\d+$/,
      );
    }
  });
});

describe("the report", () => {
  const boundary = {
    file: "src/engine/benefits.ts",
    line: 10,
    id: "src/engine/benefits.ts:10:<=:4",
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
