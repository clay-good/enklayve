/**
 * Audit-release: mechanically verify the family invariants before any release
 * (BUILD-SPEC.md §10). It is the last gate — CI runs `npm run audit` after the
 * build, and a violation fails the build so a regression can never ship.
 *
 * The checks are pure functions of file contents (so they are unit-tested with
 * synthetic inputs); the CLI at the bottom reads the real files and exits
 * non-zero on any violation.
 *
 * Invariants:
 *   1. The Worker's Content-Security-Policy keeps `connect-src 'none'` for pages.
 *   2. The built index.html loads no cross-origin resources (everything is
 *      same-origin/relative; the CSP enforces this at runtime too).
 *   3. Every shipped dataset rule resolves to a non-empty citation (§9).
 *   4. No sensitive input is persisted: localStorage is touched only by the
 *      theme/locale boundary (theme.ts), never by a financial tile.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

/** 1. The page CSP must keep connect-src locked to 'none'. */
export function checkCsp(workerSource: string): string[] {
  return /connect-src 'none'/.test(workerSource)
    ? []
    : ["worker CSP no longer sets connect-src 'none' for pages"];
}

/** 2. The built index.html must not load any cross-origin resource.
 *
 * A self-referential absolute URL on the production origin (enklayve.com) is
 * same-origin at runtime and permitted by the CSP's `'self'`, so it is allowed:
 * the SEO surface (Phase 11) needs an absolute `<link rel="canonical">` and
 * og:url/og:image, and those are metadata a crawler reads, not resources the
 * page fetches. Any other origin (a CDN font, a third-party script) is still
 * flagged. The host mirrors SITE_ORIGIN in scripts/sitemap.ts; it is inlined
 * here to keep this a pure function of the HTML. */
export function checkIndexHtml(html: string): string[] {
  const violations: string[] = [];
  const crossOrigin = /\b(?:src|href)\s*=\s*"https?:\/\/(?!enklayve\.com[/"])/gi;
  const matches = html.match(crossOrigin);
  if (matches) {
    violations.push(`index.html references cross-origin resources: ${matches.join(", ")}`);
  }
  return violations;
}

/** 3. Every dataset shard must carry a non-empty citation (no orphan numbers). */
export function checkProvenance(shards: { name: string; json: unknown }[]): string[] {
  const violations: string[] = [];
  for (const { name, json } of shards) {
    const citation = (json as { citation?: { sourceUrl?: string; sourceDocument?: string } })
      .citation;
    if (!citation?.sourceUrl?.trim() || !citation?.sourceDocument?.trim()) {
      violations.push(`dataset ${name} is missing a complete citation`);
    }
  }
  return violations;
}

/** Citation-style names stay short enough to read in a hover tooltip; the long
 * "why this value / transcription" prose belongs in `sourceNote`, which the
 * readout report renders where it can wrap (SPEC-3-citations §2). This gate
 * keeps the convention from silently regressing as new jurisdictions land. */
export const SOURCE_DOCUMENT_MAX = 160;
export function checkCitationLength(shards: { name: string; json: unknown }[]): string[] {
  const violations: string[] = [];
  for (const { name, json } of shards) {
    const doc = (json as { citation?: { sourceDocument?: string } }).citation?.sourceDocument;
    if (typeof doc === "string" && doc.length > SOURCE_DOCUMENT_MAX) {
      violations.push(
        `dataset ${name} sourceDocument is ${doc.length} chars (max ${SOURCE_DOCUMENT_MAX}); move the rationale into sourceNote`,
      );
    }
  }
  return violations;
}

/**
 * The advice line every Pillar 4 tile must carry (SPEC-4 §3.3). Matched loosely
 * — we check the tile says it is not advice and points somewhere official, not
 * that it uses one exact sentence, so the house voice stays free to vary.
 */
const ADVICE_MARKERS = [/not\s+(legal|financial|tax)\b/i, /\bnot advice\b/i];

/** The minimal shape this check needs; avoids importing the DOM-bound tile type. */
export interface AuditTile {
  id: string;
  pillar: string;
  harmTier?: 1 | 2 | 3;
  channels?: { label: string; url: string }[];
  how?: string;
}

/**
 * 5. The Pillar 4 admission bar (SPEC-4 §3.2, §7.2).
 *
 * Unlike the checks above, this one runs from the **test suite**, not the CLI:
 * the CLI executes under plain `node`, which cannot resolve the extensionless
 * TypeScript module graph the tile registry is built from. The gate is no
 * weaker for it — `tests/build/auditRelease.test.ts` applies it to the real
 * catalog and CI runs `npm run test` — and keeping the function here holds all
 * the release invariants in one readable place.
 *
 * Being wrong in "rough"
 * costs a household its housing, its wages, or a benefit it was owed, so the
 * tier is a machine-checked field rather than a convention that quietly rots:
 *
 *  - every `pillar: "rough"` tile declares a harm tier;
 *  - a tier-3 (rights-adjacent) tile names at least one free channel to act
 *    through, because a screener with no route out is a dead end; and
 *  - a tier-2 or tier-3 tile carries the advice line in its "how" block.
 */
export function checkHarmTier(tiles: AuditTile[]): string[] {
  const violations: string[] = [];
  for (const tile of tiles) {
    // Two separate rules. Pillar 4 must *declare* a tier — that is the
    // admission bar. But the tier rules below bind any tile that declares one,
    // whatever pillar hosts it: a rights-adjacent screener living in an older
    // hub (the EOB checker sits in Insurance & Protection, where someone
    // holding a health claim actually goes) is no less rights-adjacent for it,
    // and keying the gate on the pillar would have let it through unchecked.
    if (tile.pillar === "rough" && tile.harmTier === undefined) {
      violations.push(`tile ${tile.id} is pillar "rough" but declares no harmTier (SPEC-4 §3.2)`);
      continue;
    }
    if (tile.harmTier === undefined) continue;
    if (tile.harmTier === 3 && !tile.channels?.length) {
      violations.push(
        `tile ${tile.id} is harmTier 3 (screener-only) but names no channels to act through`,
      );
    }
    if (tile.harmTier >= 2 && !ADVICE_MARKERS.some((re) => re.test(tile.how ?? ""))) {
      violations.push(
        `tile ${tile.id} is harmTier ${tile.harmTier} but its "how" block omits the advice line`,
      );
    }
  }
  return violations;
}

/** 6. localStorage may be used only by the theme/locale boundary. */
/**
 * The precached shell's gzipped budget, in kilobytes.
 *
 * This is the bytes a first-time visitor downloads before anything works, and
 * the bytes the service worker must hold for the site to run offline — the one
 * size figure that describes what a reader actually pays. It was drifting
 * unwatched: the README claimed "~180 kB gzipped" against a real 241, and Vite's
 * own 800 kB chunk warning had been tripping on *every build* for long enough
 * that it had become part of the scenery. A warning that always fires is not a
 * warning.
 *
 * So it is a gate instead. Raising this number is a deliberate act with a reason
 * attached, not something that happens by accident over six phases.
 *
 * **Raised 260 -> 265 on 2026-08-29, and here is what bought it.** Every dataset
 * shard now carries a `sourceNote` saying what its figures leave out, and every
 * result card renders them under the number — that Michigan's city income taxes
 * are outside this engine, that Pennsylvania's Tax Forgiveness can zero the tax
 * out, that a $0 state income tax says nothing about that state's sales and
 * property taxes. That is 115 kB of prose, about 19 kB gzipped, or roughly 7% of
 * what a first visit costs.
 *
 * It cannot be split out of the eager shell. `connect-src 'none'` means shards
 * are inlined at build time rather than fetched, and the manifest hash is
 * computed over the exact shard bytes — so moving the notes into a lazily
 * imported chunk would mean hashing a shard that is not the shard, which breaks
 * the integrity gate to save bytes on prose about integrity.
 *
 * The headroom left is deliberately small (~4 kB). The point of the gate is that
 * the next drift trips it too.
 */
export const SHELL_GZIP_BUDGET_KB = 265;

/** A precached asset and its gzipped size. */
export interface ShellAsset {
  path: string;
  gzipBytes: number;
}

/**
 * 7. The eager shell stays inside its budget. Reported with the breakdown, so a
 * failure names the chunk that grew rather than only the total.
 */
export function checkBundleBudget(
  assets: ShellAsset[],
  budgetKb: number = SHELL_GZIP_BUDGET_KB,
): string[] {
  if (assets.length === 0)
    return ["no precached assets found, run `npm run build` before the audit"];
  const totalKb = assets.reduce((sum, a) => sum + a.gzipBytes, 0) / 1024;
  if (totalKb <= budgetKb) return [];
  const biggest = [...assets]
    .sort((a, b) => b.gzipBytes - a.gzipBytes)
    .slice(0, 3)
    .map((a) => `${a.path} ${Math.round(a.gzipBytes / 1024)} kB`)
    .join(", ");
  return [
    `the precached shell is ${totalKb.toFixed(1)} kB gzipped, over its ${budgetKb} kB budget ` +
      `(largest: ${biggest}). Trim it, or raise SHELL_GZIP_BUDGET_KB deliberately and say why.`,
  ];
}

/**
 * The one line the audit prints on success: what the shell costs, what it may
 * cost, and what is left. Pure, so the wording is testable without a build.
 */
export function shellSummary(
  assets: readonly ShellAsset[],
  budgetKb: number = SHELL_GZIP_BUDGET_KB,
): string {
  const totalKb = assets.reduce((sum, a) => sum + a.gzipBytes, 0) / 1024;
  const freeKb = budgetKb - totalKb;
  const biggest = [...assets].sort((a, b) => b.gzipBytes - a.gzipBytes)[0];
  const largest = biggest ? `, largest ${biggest.path}` : "";
  return (
    `precached shell ${totalKb.toFixed(1)} of ${budgetKb} kB gzipped, ` +
    `${freeKb.toFixed(1)} kB free across ${assets.length} assets${largest}`
  );
}

export function checkLocalStorage(files: { path: string; content: string }[]): string[] {
  const allowed = /(^|\/)ui\/theme\.ts$/;
  const violations: string[] = [];
  for (const { path, content } of files) {
    if (/\blocalStorage\b/.test(content) && !allowed.test(path)) {
      violations.push(
        `${path} uses localStorage (only ui/theme.ts may, nothing financial persists)`,
      );
    }
  }
  return violations;
}

// --- CLI ---------------------------------------------------------------------

function walk(dir: string, test: (name: string) => boolean): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p, test));
    else if (test(name)) out.push(p);
  }
  return out;
}

/**
 * Where the precached shell's bytes come from, grouped by source directory.
 *
 * The budget has about three kilobytes of headroom, so the next person to hit
 * it needs to know what is in there — and a paragraph in a comment answering
 * that goes stale the way every hand-tended figure in this repo has. This
 * reads it back out of the build's own source map instead, so the answer is a
 * command rather than a claim: `npm run audit -- --breakdown`.
 *
 * These are *source* bytes, not shipped bytes: minification and gzip do not
 * apply evenly across groups, so the numbers rank the contributors rather than
 * summing to the gzipped total. Ranking is what the question needs.
 */
export function shellBreakdown(sources: readonly string[], lengths: readonly number[]): string[] {
  const byGroup = new Map<string, number>();
  for (let i = 0; i < sources.length; i += 1) {
    const src = sources[i] ?? "";
    const len = lengths[i] ?? 0;
    let group: string;
    if (src.includes("node_modules/")) {
      group = `node_modules/${src.split("node_modules/")[1]?.split("/").slice(0, 2).join("/") ?? ""}`;
    } else if (src.endsWith(".json")) {
      // The bundled shards are the only JSON inlined here. Testing the path for
      // "/data/" instead filed all of `src/data` — the loader, the schemas, the
      // integrity gate — under "shards", which is how the first run of this
      // reported no `src/data` at all and a data figure a third too large.
      group = "data/ (bundled shards)";
    } else {
      const dir = /\/(src\/[^/]+)\//.exec(src)?.[1];
      group = dir ?? src.replace(/^.*\/(src\/[^/]+)$/, "$1");
    }
    byGroup.set(group, (byGroup.get(group) ?? 0) + len);
  }
  return [...byGroup.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([group, len]) => `${(len / 1024).toFixed(1).padStart(8)} kB  ${group}`);
}

/** Every asset the built service worker precaches, with its gzipped size. */
function precachedAssets(root: string): ShellAsset[] {
  let sw: string;
  try {
    sw = readFileSync(join(root, "dist", "sw.js"), "utf8");
  } catch {
    return [];
  }
  const match = /const PRECACHE = (\[[\s\S]*?\]);/.exec(sw);
  if (!match?.[1]) return [];
  const paths = JSON.parse(match[1]) as string[];
  const assets: ShellAsset[] = [];
  for (const p of paths) {
    try {
      assets.push({ path: p, gzipBytes: gzipSync(readFileSync(join(root, "dist", p))).length });
    } catch {
      // "/" is an alias for index.html and has no file of its own.
    }
  }
  return assets;
}

function runCli(): void {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const violations: string[] = [];

  // 1. CSP.
  violations.push(...checkCsp(readFileSync(join(root, "worker", "index.ts"), "utf8")));

  // 2. Built index.html (build must have run first).
  const indexPath = join(root, "dist", "index.html");
  try {
    violations.push(...checkIndexHtml(readFileSync(indexPath, "utf8")));
  } catch {
    violations.push("dist/index.html not found, run `npm run build` before the audit");
  }

  // 3. Provenance for every dataset shard.
  const dataDir = join(root, "data");
  const shards = readdirSync(dataDir)
    .filter((n) => n.endsWith(".json") && n !== "manifest.json")
    .map((n) => ({ name: n, json: JSON.parse(readFileSync(join(dataDir, n), "utf8")) as unknown }));
  violations.push(...checkProvenance(shards));
  violations.push(...checkCitationLength(shards));

  // 4. localStorage boundary.
  const tsFiles = walk(join(root, "src"), (n) => n.endsWith(".ts")).map((p) => ({
    path: p.slice(root.length + 1).replace(/\\/g, "/"),
    content: readFileSync(p, "utf8"),
  }));
  violations.push(...checkLocalStorage(tsFiles));

  // 5. The eager shell's byte budget — what a first visit actually costs.
  const shell = precachedAssets(root);
  violations.push(...checkBundleBudget(shell));

  if (violations.length > 0) {
    console.error("✗ Release audit failed:");
    for (const v of violations) console.error(`  - ${v}`);
    process.exit(1);
  }
  console.log(
    "✓ Release audit passed: CSP, no cross-origin loads, provenance, citation length, no sensitive persistence, shell size budget.",
  );
  // Say the number even when it passes. The headroom here is deliberately a few
  // kilobytes, and a gate that only speaks when it fails means the first time
  // anyone learns how close it was is the build that broke — which is how the
  // README came to claim 180 kB against a real 241.
  console.log(`  ${shellSummary(shell)}`);
  if (process.argv.includes("--breakdown")) {
    for (const line of shellBreakdownFromBuild(root)) console.log(`  ${line}`);
  }
}

/** Read the entry chunk's source map and rank what is inside it. */
function shellBreakdownFromBuild(root: string): string[] {
  const dir = join(root, "dist", "assets");
  let map: { sources?: string[]; sourcesContent?: (string | null)[] };
  try {
    const name = readdirSync(dir).find((n) => n.startsWith("index-") && n.endsWith(".js.map"));
    if (!name) return ["(no entry source map; build with sourcemap enabled to see the breakdown)"];
    map = JSON.parse(readFileSync(join(dir, name), "utf8")) as typeof map;
  } catch {
    return ["(no entry source map; run `npm run build` first)"];
  }
  const sources = map.sources ?? [];
  const lengths = (map.sourcesContent ?? []).map((c) => c?.length ?? 0);
  const lines = shellBreakdown(sources, lengths);

  // The shards are `?raw` imports, so the bundler inlines them as string
  // literals in the generated code and they appear in no source map at all —
  // the largest single thing in the chunk, invisible to the tool that exists to
  // say what is in the chunk. They are measured off disk instead, and labelled,
  // because a breakdown that silently omits its biggest entry is worse than
  // none.
  let shardBytes = 0;
  try {
    const dir = join(root, "data");
    for (const name of readdirSync(dir)) {
      if (name.endsWith(".json")) shardBytes += statSync(join(dir, name)).size;
    }
  } catch {
    return lines;
  }
  lines.push(
    `${(shardBytes / 1024).toFixed(1).padStart(8)} kB  data/*.json (inlined verbatim; not in the source map)`,
  );
  return lines;
}

// Run only as a CLI (not when imported by tests). import.meta.main is not yet
// universal, so compare argv instead.
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  runCli();
}
