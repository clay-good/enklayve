import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve, dirname, join, extname } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Every figure the bundle ships is read by something.
 *
 * A shard field costs a reader nothing to carry and costs the project a great
 * deal to be wrong about: it is hashed, manifested, cited, watched by a refresh
 * adapter, and audited against the agency's own document — all of which happens
 * whether or not a single line of application code ever asks for it. On
 * 2026-09-03 two figures were in exactly that state, both in the retirement
 * limits shard, and the schema's own comment named them:
 *
 *   `catch_up_401k_60to63`  $11,250, IRC §414(v)(2)(E)(i), SECURE 2.0 §109.
 *     Both retirement tiles gave a 61-year-old the $8,000 age-50 catch-up
 *     instead, understating their limit by $3,250.
 *   `fsa_health`  $3,400, §125(i). Nothing anywhere offered it.
 *
 * Neither was a bug in the ordinary sense: nothing computed a wrong number,
 * every test passed, and the cited data was correct. The site simply did not
 * know something it had been told, which no gate in this repo could see —
 * `proseFigures` checks the figures that ARE stated, and a field nobody states
 * is invisible to it, in the same way that a link check cannot see a label
 * crediting the wrong agency.
 *
 * The match is deliberately crude: a key name appearing anywhere in `src` or
 * `scripts`, in code or in a comment. It cannot tell reading a field from
 * mentioning it, and it is not trying to — the failure it catches is a field
 * nobody has thought about at all, and a comment explaining why a figure is
 * carried unused is somebody having thought about it. `EXEMPT` is for the
 * remainder: a field that must ship and must not be read, with the reason.
 */
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

/** Keys that are structure or provenance rather than a figure the site computes with. */
const STRUCTURAL = new Set([
  "citation",
  "sourceUrl",
  "sourceDocument",
  "sourceNote",
  "effectiveYear",
  "dateRetrieved",
  "notes",
  "note",
  "label",
  "id",
  "detail",
  "url",
  "year",
  "taxYear",
  "filingSeason",
]);

/**
 * Fields that ship deliberately unread. Empty today, and the point of keeping
 * it is that filling it takes a sentence saying why — which is the whole
 * difference between a decision and an oversight.
 */
const EXEMPT: Record<string, string> = {};

function allSourceText(): string {
  let out = "";
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (extname(p) === ".ts") out += readFileSync(p, "utf8");
    }
  };
  walk(join(ROOT, "src"));
  walk(join(ROOT, "scripts"));
  return out;
}

/** Object keys down to a shallow depth — deeper than this is per-state data. */
function keysOf(value: unknown, depth = 0, into = new Set<string>()): Set<string> {
  if (depth > 2) return into;
  if (Array.isArray(value)) {
    for (const v of value.slice(0, 3)) keysOf(v, depth + 1, into);
  } else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(k)) into.add(k);
      keysOf(v, depth + 1, into);
    }
  }
  return into;
}

describe("every figure the bundle ships", () => {
  const source = allSourceText();
  const shards = readdirSync(join(ROOT, "data"))
    .filter((f) => extname(f) === ".json" && f !== "manifest.json")
    .sort();

  it("has shards to check, so a broken glob cannot pass this silently", () => {
    expect(shards.length).toBeGreaterThan(50);
  });

  for (const file of shards) {
    it(`${file} carries no field that nothing reads`, () => {
      const shard: unknown = JSON.parse(readFileSync(join(ROOT, "data", file), "utf8"));
      const unread = [...keysOf(shard)]
        .filter((k) => !STRUCTURAL.has(k) && k.length > 3)
        .filter((k) => !(k in EXEMPT))
        .filter((k) => !source.includes(k))
        .sort();
      expect(
        unread,
        `${file}: shipped, hashed, cited, and read by nothing — use it, or record it in EXEMPT with the reason`,
      ).toEqual([]);
    });
  }
});
