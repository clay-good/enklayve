/**
 * Read a shipped data shard at build time, for the static pages.
 *
 * The browser gets its shards inlined through Vite's `?raw` glob and verified by
 * hash (src/data/browser.ts). The crawl pages are rendered in Node, where that
 * glob does not exist, so they read the same files from disk instead. They are
 * the same bytes the app ships, so a page and the calculator it links to cannot
 * quote two different years or two different brackets.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { FicaSchema, JurisdictionSchema, type FicaData, type Jurisdiction } from "../src/data";

// Vitest's happy-dom environment rewrites `import.meta.url` to an http URL,
// and plain Node ESM has no `__dirname`; this file runs under both.
const HERE = typeof __dirname === "string" ? __dirname : dirname(fileURLToPath(import.meta.url));
const DATA_DIR = resolve(HERE, "..", "data");

/** One shard's parsed JSON, by its manifest id (the filename without `.json`). */
export function readShard(id: string): unknown {
  return JSON.parse(readFileSync(resolve(DATA_DIR, `${id}.json`), "utf8"));
}

export function federalJurisdiction(): Jurisdiction {
  return JurisdictionSchema.parse(readShard("federal-income-tax-2024"));
}

export function ficaData(): FicaData {
  return FicaSchema.parse(readShard("fica-2024"));
}

export function stateJurisdiction(code: string): Jurisdiction {
  return JurisdictionSchema.parse(readShard(`state-${code}-income-tax-2024`));
}

/**
 * The tax year the federal figures are for. Read off the shard, not written
 * down, so the year in every page title rolls with the data at the annual roll
 * (docs/annual-roll.md) instead of waiting for someone to remember it.
 */
export const TAX_YEAR = federalJurisdiction().taxYear;
