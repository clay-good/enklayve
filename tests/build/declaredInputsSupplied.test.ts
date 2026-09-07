import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

/**
 * A field this codebase declares is a field this codebase sets.
 *
 * Three times now the same shape has shipped: an interface declares a field, a
 * consumer reads it, and the one caller never passes it. Nothing crashes,
 * nothing is blank, and the feature simply does not exist.
 *
 *   - `PlanInput.netWorth` — read by the war-chest step, set by nobody, so the
 *     last step on the ladder counted gross savings and ignored every debt and
 *     told a household $400,000 short that work was optional.
 *   - `CheckContext.noSurprises` — the shard carrying the No Surprises Act's own
 *     citation. The balance-billing check returns null without it, so it had
 *     never once fired in the product, on six green unit cases that each built
 *     their own context.
 *   - `TimelineOptions.payday` — read by the cash-flow chart, styled by
 *     `.balance-col--payday`, promised in the chart's own prose ("payday carries
 *     a small marker"), and drawn never.
 *
 * `engineInputsSupplied.test.ts` holds the first two by name, which is a lock on
 * two doors somebody already came through. This is the corridor: every field of
 * every exported interface in `src`, against every construction site in `src`.
 *
 * **`src` only, deliberately.** A field that only a test ever sets is exactly the
 * `noSurprises` case — six unit cases building the context the product does not.
 * A test is not a caller.
 *
 * It is a text search rather than a type-check because the type checker cannot
 * see this: every one of the three was optional, which is what makes the shape
 * survive. Optionality is the point — a required field nobody sets does not
 * compile.
 */
const ROOT = resolve(__dirname, "..", "..");

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
    a.name.localeCompare(b.name),
  )) {
    const full = resolve(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(full));
    else if (entry.name.endsWith(".ts")) out.push(full);
  }
  return out;
}

const FILES = sourceFiles(resolve(ROOT, "src"));
const INTERFACE = /export interface (\w+)\s*\{([\s\S]*?)\n\}/g;

/** Everything in `src` except the interface declarations themselves. */
const CONSTRUCTION_SITES = FILES.map((f) =>
  readFileSync(f, "utf8").replace(/export interface \w+\s*\{[\s\S]*?\n\}/g, ""),
).join("\n");

/**
 * Whether anything anywhere builds an object carrying this field.
 *
 * `name:` is the ordinary literal; `name,` and `name }` are the shorthand, which
 * `{ ...rest, netWorth }` and a destructured pass-through both use. Broad on
 * purpose: a false "supplied" costs a missed gap, a false "unsupplied" costs a
 * wrong failure and the sweep's credibility, and the first is the recoverable
 * one — the three bugs above were all supplied by *nothing at all*.
 */
function isSuppliedAnywhere(field: string): boolean {
  return new RegExp(`(?<![.\\w])${field}(:\\s|,|\\s*\\})`).test(CONSTRUCTION_SITES);
}

describe("every declared field has somewhere it comes from", () => {
  const declared: { file: string; iface: string; field: string }[] = [];
  for (const file of FILES) {
    const rel = file.slice(ROOT.length + 1).replace(/\\/g, "/");
    for (const m of readFileSync(file, "utf8").matchAll(INTERFACE)) {
      for (const f of m[2]!.matchAll(/^ {2}(\w+)\??:/gm)) {
        declared.push({ file: rel, iface: m[1]!, field: f[1]! });
      }
    }
  }

  it("finds the interfaces to sweep, so a rename cannot empty this quietly", () => {
    expect(declared.length).toBeGreaterThan(200);
    expect(declared.some((d) => d.iface === "PlanInput" && d.field === "netWorth")).toBe(true);
    expect(declared.some((d) => d.iface === "TimelineOptions" && d.field === "paydays")).toBe(true);
  });

  it("recognizes a field that is supplied, and one that is not", () => {
    // The detector, checked against itself: without this the sweep could pass by
    // calling everything supplied.
    expect(isSuppliedAnywhere("netWorth")).toBe(true);
    expect(isSuppliedAnywhere("aFieldNothingAnywhereSets")).toBe(false);
  });

  it("has no field declared, read, and passed by nothing in src", () => {
    const orphans = declared
      .filter((d) => !isSuppliedAnywhere(d.field))
      .map((d) => `${d.iface}.${d.field} (${d.file})`)
      .sort();
    expect(
      [...new Set(orphans)],
      "nothing in src ever builds an object carrying this field, so whatever reads it " +
        "gets undefined every time — either wire it up at the call site or delete the " +
        "declaration, because a field with no source is a feature that does not exist",
    ).toEqual([]);
  });
});
