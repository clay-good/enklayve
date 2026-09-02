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
 *
 * **Raised 265 -> 275 on 2026-09-01, and this time the gate was doing its job.**
 * It tripped after a day of correctness work — the SALT limitation moving from a
 * constant to a cited shard field, IRC §170(p) being modelled, and both federal
 * tax tiles gaining a paragraph naming the three One Big Beautiful Bill Act
 * deductions they still do not model. The headroom went 2.0 kB -> 0.7 kB, which
 * is a build away from failing.
 *
 * Every alternative was measured before the number was touched, and the figures
 * are written down in the launch checklist rather than left as a claim:
 *
 *   - the entry chunk is 94% of the shell (248 kB gzipped of 264)
 *   - the inlined shards are 76 kB of that; minifying the committed JSON saves
 *     2.8 kB and costs the line-by-line diff readability of the files this
 *     project's entire claim rests on. A bad trade at that price.
 *   - zod and decimal.js are the two large dependencies and both are
 *     load-bearing. `Money` is exact-decimal arithmetic over decimal.js, and the
 *     zod schemas are the fail-safe itself: the SALT limitation is *required* on
 *     the federal shard precisely so a shard that cannot answer fails validation
 *     and raises the verify-before-relying banner.
 *   - /tools.html is 4.8 kB and is the one precached asset with a real argument
 *     against it, being a crawl surface the in-app All Tools view mirrors.
 *     Dropping it would have bought eight times the headroom and narrowed the
 *     offline promise, which is a worse thing to spend than 10 kB.
 *
 * So the ten kilobytes are the honest cost of the prose and provenance that were
 * added, and they buy roughly 11 kB of headroom rather than a fresh margin: the
 * gate is still meant to trip.
 *
 * **Raised 275 -> 280 on 2026-09-02, and it is the cheapest raise yet.** The
 * headroom went 1.8 kB -> 0.7 kB across a day that shipped all 92 Indiana county
 * tax rates, Detroit's city tax on a new engine capability, and the county tax
 * reaching the two tiles that answer "what does my next dollar cost". That is
 * **1.1 kB gzipped** for two mandatory local taxes covering roughly 13M people
 * and a marginal rate that had been understated by up to 3.3 points.
 *
 * Ninety-two counties cost almost nothing because they gzip almost perfectly:
 * the shard grows 10 kB on disk and the entry chunk barely moves, since every
 * row is the same four keys. That is worth knowing before the next local-tax
 * wave — Ohio's municipalities and Pennsylvania's local EIT are thousands of
 * rows, not ninety-two, and the compressor's help does not scale that far.
 *
 * The levers were re-measured rather than re-quoted, and the 2026-09-01 finding
 * stands: the entry chunk is 264 kB gzipped of the 274, the inlined shards are
 * most of it, and they cannot leave — `connect-src 'none'` inlines them at build
 * time and the manifest hash is computed over the exact shard bytes, so a lazily
 * imported copy would be hashing a shard that is not the shard. Splitting the 69
 * tiles out of the entry chunk moves bytes between chunks without moving them
 * out of the *precached* set, which is what this number measures: what the
 * service worker must hold for the site to work offline.
 *
 * Five, not ten. The gate is still meant to trip.
 */
export const SHELL_GZIP_BUDGET_KB = 280;

/** A precached asset and its gzipped size. */
export interface ShellAsset {
  path: string;
  gzipBytes: number;
}

/**
 * 8. The precache holds the app, not the crawl surfaces.
 *
 * `/tools.html` sat in the precached shell until 2026-09-01 and cost 4.8 kB
 * gzipped — about a fifth of the budget's remaining headroom — to make a page
 * available offline that the in-app All Tools view already mirrors out of the
 * shell that is precached. The sixty-eight per-tile crawl shells beside it were
 * never precached, so it was the odd case rather than the rule.
 *
 * This keeps it out. A static page is for a crawler and a reader with no
 * JavaScript; both are online by definition, and the fetch handler
 * runtime-caches the page the moment anyone opens it. `/index.html` is the
 * exception because it IS the app, and the fetch handler falls back to it for
 * every navigation.
 */
export function checkPrecacheContents(paths: readonly string[]): string[] {
  const crawlPages = paths.filter((p) => p.endsWith(".html") && p !== "/index.html");
  if (crawlPages.length === 0) return [];
  return [
    `the precache holds static crawl pages (${crawlPages.join(", ")}). They are for crawlers and ` +
      "no-JS readers, who are online; the fetch handler caches them on first use. Keep the " +
      "precache to the app shell, or change this rule deliberately and say why.",
  ];
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

  // 5. The eager shell's byte budget — what a first visit actually costs, and
  // what is allowed to be in it at all.
  const shell = precachedAssets(root);
  violations.push(...checkPrecacheContents(shell.map((a) => a.path)));
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
  let noteBytes = 0;
  try {
    const dir = join(root, "data");
    for (const name of readdirSync(dir)) {
      if (!name.endsWith(".json")) continue;
      const raw = readFileSync(join(dir, name), "utf8");
      shardBytes += Buffer.byteLength(raw);
      noteBytes += sourceNoteBytes(raw);
    }
  } catch {
    return lines;
  }
  lines.push(
    `${(shardBytes / 1024).toFixed(1).padStart(8)} kB  data/*.json (inlined verbatim; not in the source map)`,
    `${(noteBytes / 1024).toFixed(1).padStart(8)} kB    ...of which sourceNote prose` +
      ` (${Math.round((noteBytes / Math.max(1, shardBytes)) * 100)}% of the shards)`,
  );
  return lines;
}

/**
 * How many bytes of a shard are `sourceNote` prose.
 *
 * Split out because the shards are the largest thing in the shell and half of
 * that is sentences rather than figures — 124.6 kB of 323 raw on 2026-09-01,
 * which compresses to about 41.6 of the 78.6 kB gzipped the datasets cost, or
 * roughly 15% of the whole precached shell. Nobody had that number, and the
 * budget paragraph that ranked the candidates for trimming did not include it.
 *
 * It is measured rather than trimmed, and the reason is the integrity gate: the
 * loader recomputes each shard's sha256 over its exact bytes (BUILD-SPEC.md
 * §7.1), so the notes have to be inside the bytes that are hashed. Moving them
 * to a lazily imported chunk would mean hashing something other than the file
 * that is committed, which trades the guarantee this site is built on for
 * kilobytes. `connect-src 'none'` also forbids fetching them later.
 *
 * So the number's use is honesty about where the budget goes, and about what
 * the next raise is buying: citations a reader can read offline.
 */
export function sourceNoteBytes(raw: string): number {
  let total = 0;
  const walk = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const v of value) walk(v);
    } else if (value && typeof value === "object") {
      for (const [k, v] of Object.entries(value)) {
        if (k === "sourceNote" && typeof v === "string") total += Buffer.byteLength(v);
        else walk(v);
      }
    }
  };
  try {
    walk(JSON.parse(raw));
  } catch {
    return 0;
  }
  return total;
}

// Run only as a CLI (not when imported by tests). import.meta.main is not yet
// universal, so compare argv instead.
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  runCli();
}
