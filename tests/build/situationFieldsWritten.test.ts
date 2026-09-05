import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve, dirname, join, extname } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Every My Situation field something reads is a field something writes.
 *
 * The sibling of [`shardFieldsRead.test.ts`](./shardFieldsRead.test.ts), which
 * holds that no *shipped figure* goes unread. This holds the other direction on
 * the other store: a field the site **reads** and nothing anywhere **writes**
 * is not an unused figure, it is a silent assumption. The reader gets an answer
 * computed from a default nobody ever offered them the chance to correct, and
 * the answer looks exactly like every other one on the page.
 *
 * Three were in that state on 2026-09-05, all found by hand, one after another,
 * which is why this exists:
 *
 *   `employerMatchAnnual` / `employerMatchCaptured` — My Plan's step compared
 *     0 against 0, called itself satisfied, and stepped over the one move on
 *     the ladder that pays a guaranteed return, while the tile that was
 *     supposed to feed it said in its own header comment that it did.
 *   `ages` — the Report counts qualifying children out of it, so it sized the
 *     EITC and the Child Tax Credit for a childless household in the same
 *     document whose section above drew the poverty line for a household of
 *     four.
 *   `debts` — read by six surfaces and written by none. The Report's net worth
 *     subtracted zero of it, so a household with $40,000 of debt and $12,000
 *     saved read its net worth as $12,000, positive; My Plan's "clear
 *     high-cost debt" step could never fire; and Life Insurance, Peace of Mind
 *     and Freedom Date each defaulted the balance they cover to nothing. The
 *     Debt Freedom Planner asked for the whole list — name, balance, rate —
 *     read the field to seed itself, and never wrote it back.
 *
 * The match is deliberately crude, in the same spirit as the shard sweep: a
 * `set("field"` anywhere in `src`, in any file. It cannot tell a real write
 * from a mention in a comment, and it is not trying to — what it catches is a
 * field nobody has thought about at all. `UNREAD_OK` is for a field carried
 * without being read, and `EXEMPT` for one that is genuinely read and
 * deliberately never written, each with the reason in a sentence.
 */
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

/**
 * Read and deliberately never written by any surface.
 *
 * Empty, and keeping it is the point: filling it costs a sentence saying why,
 * which is the difference between a decision and an oversight.
 */
const EXEMPT: Record<string, string> = {
  ages:
    "Nothing on the site asks for a list of household ages, and nothing should invent one. " +
    "The three tiles that care about children — the Child Tax Estimator, the EITC tile and " +
    "the screener — each ask for a *count* of qualifying children, and deriving an age from " +
    "a count (or from a household size) is exactly the inference this project refuses. Both " +
    "readers behave: `downshift` uses `ages[0]` only as the default starting age behind a " +
    "field the reader can see and change, and the Report, which counts children under 17 " +
    "out of it, now says in the section itself that the child credits are not estimated " +
    "because nothing records the ages. Closing this properly means a `qualifyingChildren` " +
    "field, which is a change to the portable-file and ledger formats and their versions " +
    "rather than a line of wiring, so it is a decision rather than an oversight — which is " +
    "what an entry here is for.",
};

/** Declared but not yet read anywhere — the shard sweep's failure, one store over. */
const UNREAD_OK: Record<string, string> = {};

function sourceFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (extname(p) === ".ts") out.push(p);
    }
  };
  walk(join(ROOT, "src"));
  return out;
}

describe("every My Situation field", () => {
  const source = sourceFiles()
    .map((f) => readFileSync(f, "utf8"))
    .join("\n");
  // The interface is the declaration of record, so a field added there is
  // covered here without anyone remembering to add it — which is the failure
  // mode of every hand-kept list in this repo. Read out of the source rather
  // than off the Zod schema beside it, because that schema ends in `.catch({})`
  // and a `ZodCatch` has no `.shape` to enumerate.
  const declaration = readFileSync(join(ROOT, "src/profile/situation.ts"), "utf8");
  const body = /export interface SituationValues \{([\s\S]*?)\n\}/.exec(declaration)?.[1] ?? "";
  const fields = [...body.matchAll(/^ {2}(\w+)[?]?:/gm)].map((m) => m[1]!);

  it("has fields to check, so an empty list cannot pass this silently", () => {
    expect(fields.length).toBeGreaterThan(10);
  });

  for (const field of fields) {
    it(`${field} is written by something, not only read`, () => {
      const read = source.includes(`get("${field}")`);
      // A write to *this* store, named on its receiver. Two looser forms were
      // tried and both let the bugs this exists for pass: anything containing
      // `field:` matches the interface that declares it and the plan's own
      // input type, and a bare `set("debts"` matches the Home Affordability
      // tile writing a URL parameter of that name onto a `URLSearchParams`.
      const written = new RegExp(`(?:profile|store)\\.set\\(\\s*"${field}"`).test(source);
      if (!read) {
        expect(
          UNREAD_OK[field] ?? null,
          `${field} is declared in My Situation and read by nothing — read it, or record it in UNREAD_OK with the reason`,
        ).not.toBeNull();
        return;
      }
      if (EXEMPT[field]) return;
      expect(
        written,
        `${field} is read by the site and written by nothing, so every reader gets a default nobody offered them the chance to correct`,
      ).toBe(true);
    });
  }
});
