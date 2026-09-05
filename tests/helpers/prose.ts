import { readFileSync, readdirSync } from "node:fs";
import { resolve, join } from "node:path";

/**
 * Reading the words on the page the way a reader sees them, so a figure in a
 * sentence can be compared with the figure the code computes from.
 *
 * Both sweeps that use this — the dollar amounts in
 * [`proseFigures.test.ts`](../ui/proseFigures.test.ts) and the rates in
 * [`proseRates.test.ts`](../ui/proseRates.test.ts) — need the same three
 * things: the modules a reader's prose can live in, the figures inside one, and
 * a containment test that does not mistake a prefix for an amount.
 */
export const ROOT = resolve(__dirname, "..", "..");

/** Every `.ts` module under `src/`, as a path relative to it. */
export function srcModules(dir = resolve(ROOT, "src"), prefix = ""): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...srcModules(join(dir, entry.name), rel));
    else if (entry.name.endsWith(".ts")) out.push(rel);
  }
  return out.sort();
}

/**
 * A module's text with everything a reader cannot see taken out: block
 * comments, whole-line comments, and comments that trail code. The `//` has to
 * be preceded by whitespace, a bracket or a semicolon so that the one in
 * `https://`, which follows a colon, survives — a URL is prose.
 */
export function readerText(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/^[ \t]*\/\/.*$/gm, " ")
    .replace(/(^|[\s;{}()[\]])\/\/[^\n]*/g, "$1 ");
}

/** The source of one `src/` module, as a reader would see it. */
export function readerSource(file: string): string {
  return readerText(readFileSync(resolve(ROOT, "src", file), "utf8"));
}

/** A shard, by id. */
export function shard(id: string): Record<string, unknown> {
  return JSON.parse(readFileSync(resolve(ROOT, "data", `${id}.json`), "utf8")) as Record<
    string,
    unknown
  >;
}

/** A dotted path into a shard, whatever it lands on. */
export function shardValue(id: string, path: string): unknown {
  return path
    .split(".")
    .filter(Boolean)
    .reduce<unknown>((o, k) => (o as Record<string, unknown>)[k], shard(id));
}

/** A dotted path into a shard, which must land on a number. */
export function shardNumber(id: string, path: string): number {
  const value = path
    .split(".")
    .filter(Boolean)
    .reduce<unknown>((o, k) => (o as Record<string, unknown>)[k], shard(id));
  if (typeof value !== "number") throw new Error(`${id}${path} is not a number`);
  return value;
}

/** The value of a `const NAME = <number>;` declared in a `src/` module. */
export function declaredConstant(file: string, name: string): number {
  // `150_000` is the same number as `150000`, and the engine writes the readable
  // form. Without the underscore here the binding throws "is not declared in" —
  // a hard failure, but one that reads as a missing constant rather than a
  // numeric separator, and the fix looks like deleting the separator.
  const declared = new RegExp(`const ${name} = ([\\d_]+(?:\\.\\d+)?);`).exec(
    readFileSync(resolve(ROOT, "src", file), "utf8"),
  );
  if (!declared) throw new Error(`${name} is not declared in ${file}`);
  return Number(declared[1]!.replace(/_/g, ""));
}
