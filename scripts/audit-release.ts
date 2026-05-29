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
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

/** 1. The page CSP must keep connect-src locked to 'none'. */
export function checkCsp(workerSource: string): string[] {
  return /connect-src 'none'/.test(workerSource)
    ? []
    : ["worker CSP no longer sets connect-src 'none' for pages"];
}

/** 2. The built index.html must not load any cross-origin resource. */
export function checkIndexHtml(html: string): string[] {
  const violations: string[] = [];
  const crossOrigin = /\b(?:src|href)\s*=\s*"https?:\/\//gi;
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

/** 4. localStorage may be used only by the theme/locale boundary. */
export function checkLocalStorage(files: { path: string; content: string }[]): string[] {
  const allowed = /(^|\/)ui\/theme\.ts$/;
  const violations: string[] = [];
  for (const { path, content } of files) {
    if (/\blocalStorage\b/.test(content) && !allowed.test(path)) {
      violations.push(
        `${path} uses localStorage (only ui/theme.ts may — nothing financial persists)`,
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
    violations.push("dist/index.html not found — run `npm run build` before the audit");
  }

  // 3. Provenance for every dataset shard.
  const dataDir = join(root, "data");
  const shards = readdirSync(dataDir)
    .filter((n) => n.endsWith(".json") && n !== "manifest.json")
    .map((n) => ({ name: n, json: JSON.parse(readFileSync(join(dataDir, n), "utf8")) as unknown }));
  violations.push(...checkProvenance(shards));

  // 4. localStorage boundary.
  const tsFiles = walk(join(root, "src"), (n) => n.endsWith(".ts")).map((p) => ({
    path: p.slice(root.length + 1).replace(/\\/g, "/"),
    content: readFileSync(p, "utf8"),
  }));
  violations.push(...checkLocalStorage(tsFiles));

  if (violations.length > 0) {
    console.error("✗ Release audit failed:");
    for (const v of violations) console.error(`  - ${v}`);
    process.exit(1);
  }
  console.log(
    "✓ Release audit passed: CSP, no cross-origin loads, provenance, no sensitive persistence.",
  );
}

// Run only as a CLI (not when imported by tests). import.meta.main is not yet
// universal, so compare argv instead.
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  runCli();
}
