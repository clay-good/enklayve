import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

/**
 * A style rule nothing can reach still ships.
 *
 * `deadExports.test.ts` makes this argument about values: `src` is one eager
 * bundle the service worker precaches whole, so a thing nobody uses is bytes on
 * every first visit against a budget with a few kilobytes of headroom, and it is
 * a claim a reader believes. The stylesheet is in that same precached shell and
 * had nothing watching it. Five selectors were unreachable on 2026-09-03:
 * `.budget-lead`, `.cat-chips`, `.journey-step` (three rules, including two
 * hover states), `.tile-link--soon`, and `.visually-hidden` — the last of which
 * is the one that matters, because a reader scanning this file for the standard
 * screen-reader-only helper would find it and use it, and it had been deleted
 * from the markup long enough that nothing rendered it.
 *
 * **Modifiers built at run time are not dead.** `deadline--past` never appears
 * in the source, because the source writes ``deadline--${status.state}`` — and
 * the same is true of the ledger rows, the readout flags, the stat cards, the
 * triage items and the free-filing channels. Those are derived rather than
 * listed: a `stem--value` selector counts as reached when the source builds
 * ``stem--${`` anywhere. Nobody has to maintain an exemption list, and adding a
 * new enum's styles needs no ceremony.
 */
const ROOT = resolve(__dirname, "..", "..");

function tsFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = resolve(dir, e.name);
    if (e.isDirectory()) return tsFiles(full);
    return e.name.endsWith(".ts") ? [full] : [];
  });
}

/** Everything that can put a class on an element: the app, the build's page
 * generators, and the hand-written shell. */
const source = [
  ...tsFiles(resolve(ROOT, "src")),
  ...tsFiles(resolve(ROOT, "scripts")),
  resolve(ROOT, "index.html"),
]
  .map((f) => readFileSync(f, "utf8"))
  .join("\n");

const css = readFileSync(resolve(ROOT, "src", "styles.css"), "utf8");

/**
 * Class names the stylesheet defines. Two characters or fewer are skipped: they
 * are indistinguishable from a decimal in a shorthand (`.5rem`) and there are
 * none in this file.
 */
const declared = [
  ...new Set([...css.matchAll(/\.([a-zA-Z][a-zA-Z0-9_-]{2,})/g)].map((m) => m[1]!)),
];

function reachable(cls: string): boolean {
  if (source.includes(cls)) return true;
  if (!cls.includes("--")) return false;
  const stem = cls.slice(0, cls.lastIndexOf("--"));
  return source.includes(`${stem}--\${`);
}

/**
 * Custom properties the stylesheet declares. Only the palette's own names — a
 * property declared inside a `@media` or `[data-theme]` block is the same name
 * redefined, not a new one.
 */
const declaredVars = [
  ...new Set([...css.matchAll(/^\s*(--[a-zA-Z][\w-]*)\s*:/gm)].map((m) => m[1]!)),
];

/**
 * Read anywhere: by a rule in this file, by the app, or by a `var()` the app
 * builds — `charts.ts` writes ``var(--enk-chart-${n})`` for a ten-colour
 * palette, so nine of the ten names appear nowhere as literal text.
 */
function varIsRead(name: string): boolean {
  if (css.includes(`var(${name}`) || source.includes(name)) return true;
  const stem = name.replace(/-\d+$/, "");
  return stem !== name && source.includes(`${stem}-\${`);
}

describe("styles that nothing can reach", () => {
  it("finds the stylesheet's classes, so an empty pass cannot look like a clean one", () => {
    expect(declared.length).toBeGreaterThan(100);
  });

  it("still counts a modifier the source builds at run time", () => {
    // The guard on the guard: if the template-literal rule ever stopped
    // matching, this check would go off like a firework and somebody would
    // "fix" it by deleting styles that are in use.
    expect(reachable("deadline--past")).toBe(true);
    expect(reachable("ledger-row--gone")).toBe(true);
    expect(reachable("stat-card--warn")).toBe(true);
  });

  it("leaves no custom property nothing reads", () => {
    // The other half of the same file. Nothing was dead here on 2026-09-03 —
    // this is the gate arriving before the debt does, which is cheaper than the
    // other order.
    const unread = declaredVars.filter((v) => !varIsRead(v));
    expect(
      unread,
      "these custom properties are declared and never read — by a rule here, by the app, or by" +
        " a var() the app builds. Delete them, or use them",
    ).toEqual([]);
  });

  it("still counts a palette entry the app indexes into", () => {
    // Nine of the ten chart colours appear nowhere as literal text.
    expect(varIsRead("--enk-chart-7")).toBe(true);
  });

  it("leaves nothing in the precached stylesheet that no element can wear", () => {
    const dead = declared.filter((c) => !reachable(c));
    expect(
      dead,
      "these classes are defined in styles.css and nothing in src, scripts or index.html puts" +
        " them on an element — delete the rule, or use it. A style nobody can reach is bytes on" +
        " every first visit and a helper the next reader will believe exists",
    ).toEqual([]);
  });
});
