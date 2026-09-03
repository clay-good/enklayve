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

/**
 * 0. The build under audit must BE the build of this tree.
 *
 * Every other check here reads `dist/`, and nothing checked whether `dist/` was
 * the output of the code beside it. `npm run audit` on a stale build prints
 * "✓ Release audit passed" about an artifact three commits old — the exact
 * shape of failure this file exists to prevent, in the file that exists to
 * prevent it. It was not hypothetical: on 2026-09-02 two runs certified a
 * `dist/` predating the session's changes and reported the eager shell at
 * 271.3 kB with 8.7 kB free, while the tree it was standing in built to 275.2 kB
 * with 4.8 kB free. The headroom in that budget is a few kilobytes wide, so
 * "passed" was being said about a number wrong by most of it.
 *
 * CI is unaffected — it builds in a fresh checkout and then audits — which is
 * precisely why nothing caught this. The person running the launch checklist by
 * hand is the one who gets the wrong answer.
 *
 * mtimes rather than hashes: a build is not reproducible byte-for-byte across
 * machines, and the question here is only "did the build happen after the last
 * edit", which a timestamp answers exactly. A `git checkout` restamps the files
 * it touches, so switching branches without rebuilding is correctly flagged.
 */
export function checkBuildIsCurrent(
  newestSourceMs: number,
  builtMs: number | null,
  newestSourcePath: string,
): string[] {
  if (builtMs === null) return []; // The missing-dist violation is reported at its own check.
  if (builtMs >= newestSourceMs) return [];
  return [
    `dist/ is older than the sources it is being audited against — ${newestSourcePath} is newer ` +
      "than the build. Run `npm run build` first; every check below reads dist/.",
  ];
}

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
 * The advice line a tier-2 or tier-3 tile must carry (SPEC-4 §3.3, gated per
 * §7.2). Matched loosely — the tile has to say its output is not a
 * determination somebody official makes, not use one exact sentence, so the
 * house voice stays free to vary.
 *
 * **§3.3 names four domains and this list saw one of them.** The rule is that a
 * Pillar 4 tool "is not legal, tax, medical-billing, or benefits-eligibility
 * determination", and the markers matched `legal|financial|tax` and the bare
 * phrase "not advice" — so a tile stating the line in the benefits-eligibility
 * or medical-billing form the spec itself prescribes failed the gate. That is
 * not hypothetical and it is the wrong way round: the Benefit Cliff Explorer's
 * copy already reads "not an eligibility determination. Only the agency that
 * runs a program decides who qualifies", which is a better sentence than any of
 * the eight that pass, and it would have failed this check the day the tile went
 * to tier 2. A gate that pushes correct copy toward a narrower phrasing to
 * satisfy a regex is worse than no gate.
 *
 * The other half of the finding: `/\bnot advice\b/i` had never matched a single
 * tile. All eight say "not legal or financial advice", with words between, so
 * the list was one regex wearing the look of two. It stays — a tile may yet say
 * it plainly — but `tests/build/auditRelease.test.ts` now exercises every marker
 * in the list, so a marker that matches nothing at all is a failure rather than
 * decoration.
 *
 * The domains are read out of SPEC-4 §3.3 by that test rather than trusted here,
 * so a fifth domain added to the spec fails loudly instead of going unchecked.
 */
export const ADVICE_MARKERS = [
  // "not legal, tax, or financial advice" — the form every shipping tile uses.
  /not\s+(legal|financial|tax|medical)\b/i,
  // "not an eligibility determination" — benefits eligibility, §3.3's fourth.
  /not\s+(?:an?\s+|your\s+)?(?:benefits?[-\s]?)?eligibility\s+determination\b/i,
  // "not a medical-billing determination" — §3.3's third, stated as a noun.
  /not\s+(?:an?\s+)?medical[-\s]?billing\s+determination\b/i,
  // The plainest form there is.
  /\bnot advice\b/i,
];

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
 *
 * **Raised 280 -> 282 on 2026-09-03, and it tripped on the rule most worth
 * spending it on.** The No Surprises tile told a patient that a notice-and-
 * consent form is their choice and that signing means paying more, and said
 * nothing about 45 CFR §149.420(b) — the list of care where the consent
 * criteria "do not apply" and the provider "will always be subject to" the
 * balance-billing prohibition. Anesthesiology, pathology, radiology,
 * neonatology, emergency medicine; assistant surgeons, hospitalists,
 * intensivists; diagnostic and lab work; anything where the facility has no
 * in-network provider who could do it; and anything an unforeseen urgent need
 * calls for mid-procedure, which survives a signature that was otherwise valid.
 * A patient handed that form at an in-network hospital was being asked to give
 * up something the form cannot take, and this page was agreeing with the form.
 *
 * Measured rather than estimated: the entry chunk went 275,346 -> 276,568 bytes
 * gzipped, so the rule and its citation cost **1.2 kB** — 0.4% of a first visit.
 * The levers were re-checked and the 2026-09-01 finding stands unchanged: the
 * entry chunk is 276.6 kB gzipped of the 280.1, the inlined shards are most of
 * it and cannot leave (`connect-src 'none'` inlines them at build time and the
 * manifest hash is computed over the exact shard bytes, so a lazily imported
 * copy would be hashing a shard that is not the shard), and splitting the tiles
 * moves bytes between chunks without moving them out of the precached set,
 * which is what this number measures.
 *
 * Two, not five. The headroom is 1.9 kB, and the gate is still meant to trip.
 *
 * **Correction, same day, and the lever list was the thing that needed it.**
 * The paragraph above first ended by saying `/tools.html` "is still 4.9 kB and
 * still the one asset with a real argument against it", and that dropping it
 * would buy four times the raise. It would buy nothing. It has not been in the
 * precache since 2026-09-01, and rule 8 below is a *gate* that keeps it out —
 * the 4.9 kB was spent two days before it was offered here as a saving.
 *
 * The paragraph claimed to have re-checked the levers and had re-quoted one,
 * which is the specific failure this comment already warns about two entries
 * up, where "~7%" and "~11%" described one quantity that had grown past both.
 * A lever list is a set of measurements with a shelf life, and a lever that a
 * gate forecloses is not a lever at all. Re-measured now: the precached shell
 * is `/`, `/index.html`, the entry chunk, the stylesheet, two icons and the web
 * manifest, and there is no fat asset left in it. Every remaining lever is
 * rejected on grounds stated above, which is the useful conclusion — the next
 * raise will not have a cheap alternative to compare itself against, and should
 * be argued on what it buys rather than on what it could have trimmed instead.
 *
 * **Raised 282 -> 283 on 2026-09-03, argued on what it buys, as promised one
 * paragraph up.** The Life-Event Sequences page asks a laid-off reader to
 * choose between COBRA and a Marketplace plan and did not say the choice is
 * hard to undo. 45 CFR §155.420(e): "Loss of coverage does not include
 * voluntary termination of coverage or other loss due to (1) Failure to pay
 * premiums on a timely basis, including COBRA continuation coverage premiums
 * prior to expiration of COBRA continuation coverage". So electing COBRA and
 * dropping it in March generally means waiting for open enrollment, while
 * running it out to the end opens a window — and so does the former employer
 * completely ceasing to pay toward the premium, under (d)(15), which is exactly
 * what happens when severance-funded COBRA runs out.
 *
 * Measured: the entry chunk went 278,360 -> 278,915 bytes gzipped, so the step
 * and its citation cost 555 bytes. That is a fifth of a kilobyte more than the
 * remaining headroom, on the page this project describes as carrying its
 * highest-harm numbers, at the moment a household is deciding.
 *
 * One, not two. The headroom is 0.6 kB, which is the smallest this has ever
 * been left, and the gate is meant to trip on the next sentence.
 *
 * **Then CI failed twice on a budget that passed locally, and the headroom was
 * the reason.** This number is measured with zlib, and zlib does not produce
 * identical output across versions. On 2026-09-03 a build measured 281.7 kB on
 * a developer machine running Node 26 and 282.0 kB on the CI runner at Node 24;
 * the next one, 281.8 against 282.2. A consistent 0.3-0.4 kB, which is nothing
 * against 282 kB and everything against the 0.2 kB of headroom that had been
 * left. Two commits went to `main` green locally and red in CI, and the number
 * that decided it was whose machine ran the check.
 *
 * Two changes. The compression level is pinned at 9 rather than defaulted,
 * which removes one source of drift — `gzipSync`'s default is not a promise.
 * And the rule that was missing: **the headroom must exceed the spread between
 * environments, or the gate is measuring the runner rather than the shell.**
 * 0.4 kB is the observed spread, so headroom below about 1 kB means the gate
 * has stopped being reproducible, whatever it says locally.
 *
 * **Raised 283 -> 284 on that finding**, which buys no new content at all — it
 * restores the margin the previous three raises each ate into, and it is the
 * first raise here that is not paying for a feature. CI is the authority on
 * this figure; a local run is an estimate that reads about 0.4 kB low.
 */
export const SHELL_GZIP_BUDGET_KB = 284;

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

/**
 * Nothing financial may persist on the device (SPEC §2 principle 8).
 *
 * This was `checkLocalStorage`, and the name is why the hole lasted: a gate
 * named after one API looked at that one API. `sessionStorage`, IndexedDB,
 * cookies and the Cache API all outlive a page the same way, and a tile writing
 * a household's income into any of them would have passed an audit whose success
 * line says "no sensitive persistence" — while the README states, flatly,
 * "auto-persisted user data: 0".
 *
 * Nothing under `src/` used any of them when this widened; it is a hole closed
 * rather than a leak stopped. The one allowance stays exactly as narrow as it
 * was: `ui/theme.ts`, and only for `localStorage`, because the locale and theme
 * preference is not financial and a reader's chosen theme flashing back to the
 * default on every visit is a worse experience than the privacy cost is real.
 * Theme is not thereby allowed IndexedDB.
 *
 * Comments are stripped before scanning, which the narrow version did not do and
 * could not afford to skip once the words widened: this file's own prose says
 * "the service worker caches the shell", and `caches` is the CacheStorage
 * global. A sentence about storage is not a write to it.
 */
const PERSISTENCE = [
  { pattern: /\blocalStorage\b/, name: "localStorage", allowed: /(^|\/)ui\/theme\.ts$/ },
  { pattern: /\bsessionStorage\b/, name: "sessionStorage", allowed: null },
  { pattern: /\bindexedDB\b|\bIDBFactory\b/, name: "IndexedDB", allowed: null },
  { pattern: /\bdocument\.cookie\b/, name: "document.cookie", allowed: null },
  { pattern: /\bcaches\b/, name: "the Cache API", allowed: null },
  { pattern: /\bnavigator\.storage\b/, name: "navigator.storage", allowed: null },
] as const;

/** Source with comments removed, so prose about storage is not read as storage. */
export function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

export function checkClientStorage(files: { path: string; content: string }[]): string[] {
  const violations: string[] = [];
  for (const { path, content } of files) {
    const code = withoutComments(content);
    for (const { pattern, name, allowed } of PERSISTENCE) {
      if (!pattern.test(code)) continue;
      if (allowed?.test(path)) continue;
      violations.push(
        `${path} uses ${name} (nothing financial persists; only ui/theme.ts may keep the locale/theme preference)`,
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

/**
 * What vite reads to produce `dist/`, and nothing else.
 *
 * `tests/` and `docs/` are deliberately outside it: editing a test does not make
 * a build stale, and a gate that fires on an edit it does not depend on is one
 * people learn to work around by rebuilding for no reason.
 */
const BUILD_INPUTS = ["src", "data", "public", "worker", "index.html", "vite.config.ts"];

/** The newest mtime across the build's inputs, and which file carries it. */
function newestBuildInput(root: string): { mtimeMs: number; path: string } {
  let newest = { mtimeMs: 0, path: "(nothing)" };
  const consider = (p: string): void => {
    const ms = statSync(p).mtimeMs;
    if (ms > newest.mtimeMs) newest = { mtimeMs: ms, path: p.slice(root.length + 1) };
  };
  for (const entry of BUILD_INPUTS) {
    const p = join(root, entry);
    try {
      if (statSync(p).isDirectory()) for (const f of walk(p, () => true)) consider(f);
      else consider(p);
    } catch {
      // An optional input this checkout does not have.
    }
  }
  return newest;
}

/** When the build ran, read off the one file every build rewrites. */
function distBuiltMs(root: string): number | null {
  try {
    return statSync(join(root, "dist", "index.html")).mtimeMs;
  } catch {
    return null;
  }
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
      assets.push({
        path: p,
        // Level pinned rather than defaulted. `gzipSync`'s default has been
        // level 6 for a long time and is not a promise; a budget the compressor
        // can move is not a budget. See SHELL_GZIP_BUDGET_KB for the residual
        // variance this does *not* remove.
        gzipBytes: gzipSync(readFileSync(join(root, "dist", p)), { level: 9 }).length,
      });
    } catch {
      // "/" is an alias for index.html and has no file of its own.
    }
  }
  return assets;
}

function runCli(): void {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const violations: string[] = [];

  // 0. Is dist/ the build of this tree at all?
  const newest = newestBuildInput(root);
  violations.push(...checkBuildIsCurrent(newest.mtimeMs, distBuiltMs(root), newest.path));

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
  violations.push(...checkClientStorage(tsFiles));

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
