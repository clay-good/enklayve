import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

/**
 * A count in a comment is a figure nobody is watching.
 *
 * The README's counts are read back out of the prose and compared against the
 * registry, the manifest, and the build's own page list, because a claim that
 * cannot drift is worth more than one that reads well. Comments have no such
 * check, and on 2026-09-01 they had drifted exactly as far as you would expect:
 * the screenshot script described "the 59-calculator catalog" of "10 hubs"
 * against a real 69 in 12, and two other files still said "the 10 hubs".
 *
 * None of it broke anything. That is the point — an unwatched figure decays
 * silently and is believed by the next reader, which is the same lesson the
 * SALT constant taught this repo at a cost of $2,400 of somebody's tax.
 *
 * The rule is not "keep them current". It is "do not write one": say *the*
 * hubs, *every* calculator. Where a real count belongs, it belongs in prose
 * that `readmeCounts.test.ts` reads, or in a figure derived from the registry
 * at run time.
 *
 * Scoped to shipped and build code. `tests/` and `e2e/` may narrate the past — a
 * case recording that the README once claimed 63 calculators against a real 68
 * is a historical fact, and rewriting it would erase the evidence.
 *
 * `worker/` was missing from that scope until 2026-09-05, which is the same
 * shape as the link sweep skipping the repository root: a list of directories
 * that leaves out shipped code, while the sentence above it says "shipped and
 * build code". Nothing had drifted there — it is one file — and the list said
 * something it did not do, which is the part worth fixing before a second file
 * arrives beside it.
 */
const ROOT = resolve(__dirname, "..", "..");
const SCANNED = ["src", "scripts", "worker"];

/** Nouns whose counts this repo has watched drift. */
const COUNTED = /\b(\d{2,3})[- ](calculators?|tiles?|hubs?|shards?|datasets?|jurisdictions?)\b/g;

/**
 * Counts that are not claims about this repo's contents, in either the spaced
 * or the hyphenated form. "50 states + DC" and "the 50-jurisdiction problem"
 * are facts about the United States; "24 jurisdictions" is Maryland's county
 * count, which is Maryland's to change and not ours. These do not drift with
 * the repo, so watching them would only train people to ignore this check.
 */
const NOT_OURS = /\b(50|51|24)[- ](states|jurisdictions?)\b/;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = resolve(dir, e.name);
    if (e.isDirectory()) return sourceFiles(full);
    return e.name.endsWith(".ts") ? [full] : [];
  });
}

describe("counts written into comments", () => {
  it("does not claim a number of calculators, hubs, or shards in a comment", () => {
    const offenders: string[] = [];
    for (const root of SCANNED) {
      for (const file of sourceFiles(resolve(ROOT, root))) {
        const rel = file.slice(ROOT.length + 1);
        readFileSync(file, "utf8")
          .split("\n")
          .forEach((line, i) => {
            const comment = /^\s*(\/\/|\*|\/\*)/.test(line);
            if (!comment || NOT_OURS.test(line)) return;
            for (const m of line.matchAll(COUNTED)) {
              offenders.push(`${rel}:${i + 1} — "${m[0]}"`);
            }
          });
      }
    }
    expect(
      offenders,
      "a count in a comment is watched by nothing and decays silently. Say 'the hubs' or" +
        " 'every calculator' instead, or put the figure in README prose where readmeCounts" +
        " reads it back out and compares it to the registry",
    ).toEqual([]);
  });
});
