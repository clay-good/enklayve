import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Colour contrast (WCAG 1.4.3) computed from the stylesheet, in the fast suite.
 *
 * happy-dom has no layout engine and no computed colours, so every `axe.run` in
 * `tests/` disables `color-contrast` by necessity, and the browser check that
 * covers the gap ([`e2e/contrast.spec.ts`](../../e2e/contrast.spec.ts)) can only
 * judge what is on the screen in the states it opens. A colour pair that only
 * appears when a dataset goes stale, or when a benefit screener says "eligible",
 * is invisible to both.
 *
 * This reads the pairs out of `src/styles.css` instead of a page: the `:root`
 * tokens, then every rule that sets a `color` whose background is declared on
 * the same selector or on a selector it descends from. It found five surfaces
 * failing at once, all the same mistake — `--enk-good` and `--enk-warn` clear
 * 4.5:1 on the plain surface, and **neither clears it on a wash of itself**:
 *
 *   - the good stat card, 4.38
 *   - the warn stat card, 4.19
 *   - the site-wide staleness banner's bold text, 4.01
 *   - the good badge, 4.05 on a card and 3.85 on the page background
 *   - the warn badge, 3.89 and 3.71
 *
 * Every one of them reads as a slightly soft label rather than as a failure,
 * which is what a miss of a tenth of a point looks like. The fix is the pattern
 * `--enk-accent-ink` already established: a darker ink for text that sits on its
 * own colour's tint.
 *
 * Two deliberate limits. It reads a rule's *own* `font-size` and `font-weight`,
 * so a large-text element that inherits its size is judged at the 4.5:1 bar
 * rather than 3:1 — strict in the safe direction. And a `color-mix` over
 * `transparent` has no background to resolve, so it is checked over both the
 * surface and the page, and must pass on both.
 */
const CSS = readFileSync(resolve(process.cwd(), "src/styles.css"), "utf8").replace(
  /\/\*[\s\S]*?\*\//g,
  " ",
);

const channels = (hex: string): number[] => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

/** Relative luminance, WCAG 2.x §relative-luminance. */
function luminance(hex: string): number {
  const c = channels(hex)
    .map((v) => v / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * (c[0] ?? 0) + 0.7152 * (c[1] ?? 0) + 0.0722 * (c[2] ?? 0);
}

/** Contrast ratio, WCAG 2.x §contrast-ratio. */
export function contrastRatio(a: string, b: string): number {
  const x = luminance(a);
  const y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

/** `color-mix(in srgb, x p%, y)` in sRGB, which is what the stylesheet uses. */
function mix(x: string, p: number, y: string): string {
  const a = channels(x);
  const b = channels(y);
  return `#${a
    .map((v, i) =>
      Math.round(p * v + (1 - p) * (b[i] ?? 0))
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
}

const TOKENS: Record<string, string> = {};
for (const m of (/:root\s*\{([^}]*)\}/.exec(CSS)?.[1] ?? "").matchAll(
  /(--[\w-]+)\s*:\s*(#[0-9a-fA-F]{6})\s*;/g,
)) {
  TOKENS[m[1] as string] = (m[2] as string).toLowerCase();
}

/** Flat `[selectorList, body]` pairs, with `@media`/`@supports` wrappers dropped. */
function flatRules(css: string): [string, string][] {
  const out: [string, string][] = [];
  let depth = 0;
  let buf = "";
  let selector = "";
  for (const ch of css) {
    if (ch === "{") {
      depth += 1;
      if (depth === 1) {
        selector = buf.trim();
        buf = "";
      } else buf += ch;
    } else if (ch === "}") {
      depth -= 1;
      if (depth === 0) {
        out.push([selector, buf]);
        buf = "";
        selector = "";
      } else buf += ch;
    } else buf += ch;
  }
  return out;
}

function declarations(body: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const decl of body.split(";")) {
    const at = decl.indexOf(":");
    if (at < 0) continue;
    out[decl.slice(0, at).trim()] = decl.slice(at + 1).trim();
  }
  return out;
}

/** A token reference or a two-token `color-mix`, resolved to a hex colour. */
function resolveColor(value: string, over: string): string | null {
  const v = value.trim();
  const direct = /^var\((--[\w-]+)\)$/.exec(v);
  if (direct) return TOKENS[direct[1] as string] ?? null;
  const mixed =
    /^color-mix\(in srgb,\s*var\((--[\w-]+)\)\s*([\d.]+)%\s*,\s*(var\((--[\w-]+)\)|transparent)\s*\)$/.exec(
      v,
    );
  if (mixed) {
    const front = TOKENS[mixed[1] as string];
    const back = mixed[3] === "transparent" ? over : TOKENS[mixed[4] as string];
    return front && back ? mix(front, Number(mixed[2]) / 100, back) : null;
  }
  return /^#[0-9a-fA-F]{6}$/.test(v) ? v.toLowerCase() : null;
}

const RULES = flatRules(CSS);
const selectors = (list: string): string[] =>
  list
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && !s.startsWith("@"));

const BACKGROUNDS = new Map<string, string>();
for (const [list, body] of RULES) {
  const d = declarations(body);
  const raw = d["background"] ?? d["background-color"];
  if (raw) for (const s of selectors(list)) BACKGROUNDS.set(s, raw);
}

/** The nearest declared background: this selector, or the longest ancestor of it. */
function backgroundFor(selector: string): [string, string] | null {
  let best: [string, string] | null = null;
  for (const [sel, raw] of BACKGROUNDS) {
    if (selector === sel || selector.startsWith(`${sel} `) || selector.startsWith(`${sel}:`)) {
      if (!best || sel.length > best[0].length) best = [sel, raw];
    }
  }
  return best;
}

function pixels(size: string | undefined): number | null {
  if (!size) return null;
  if (size.endsWith("rem")) return parseFloat(size) * 16;
  if (size.endsWith("px")) return parseFloat(size);
  return null;
}

interface Pair {
  selector: string;
  host: string;
  over: string;
  fg: string;
  bg: string;
  need: number;
}

function pairs(): Pair[] {
  const out: Pair[] = [];
  for (const [list, body] of RULES) {
    const d = declarations(body);
    if (!d["color"]) continue;
    const px = pixels(d["font-size"]);
    const weight = d["font-weight"] ? parseInt(d["font-weight"], 10) : 400;
    // WCAG's large-text threshold: 24px, or 18.66px at bold.
    const large = px !== null && (px >= 24 || (px >= 18.66 && weight >= 700));
    for (const selector of selectors(list)) {
      const fg = resolveColor(d["color"] ?? "", TOKENS["--enk-surface"] ?? "");
      if (!fg) continue;
      const host = backgroundFor(selector);
      if (!host) continue;
      const [hostSelector, hostValue] = host;
      // A tint over `transparent` sits on whatever is behind it, so it has to
      // hold on both of the two things that can be.
      const overs = hostValue.includes("transparent")
        ? ["--enk-surface", "--enk-bg"]
        : ["--enk-surface"];
      for (const over of overs) {
        const bg = resolveColor(hostValue, TOKENS[over] ?? "");
        if (bg) out.push({ selector, host: hostSelector, over, fg, bg, need: large ? 3 : 4.5 });
      }
    }
  }
  return out;
}

const PAIRS = pairs();

describe("every colour pair the stylesheet declares", () => {
  it("finds pairs to check at all", () => {
    // The failure this guards against is a parser that quietly matches nothing
    // and reports a clean sheet — the same mistake the browser check's
    // evaluated-node floor exists for.
    expect(Object.keys(TOKENS).length).toBeGreaterThan(15);
    expect(PAIRS.length).toBeGreaterThan(20);
  });

  it("meets WCAG 1.4.3", () => {
    const failures = PAIRS.filter((p) => contrastRatio(p.fg, p.bg) < p.need).map(
      (p) =>
        `${p.selector} on ${p.host} (over ${p.over}): ${contrastRatio(p.fg, p.bg).toFixed(2)}:1 ` +
        `is below ${p.need}:1 — ${p.fg} on ${p.bg}`,
    );
    expect(failures.join("\n")).toBe("");
  });

  it("computes the ratio the way WCAG defines it", () => {
    // Pinned against the published extremes so a broken formula cannot pass the
    // sweep above by making everything look fine.
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(contrastRatio("#ffffff", "#ffffff")).toBeCloseTo(1, 5);
    expect(contrastRatio("#767676", "#ffffff")).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio("#777777", "#ffffff")).toBeLessThan(4.54);
  });

  it("keeps each semantic ink readable on its own tint and on the plain surface", () => {
    // The five failures this file was written for were all one shape: a colour
    // that passes on white, used as text on a wash of itself.
    const surface = TOKENS["--enk-surface"] ?? "";
    for (const [ink, base] of [
      ["--enk-good-ink", "--enk-good"],
      ["--enk-warn-ink", "--enk-warn"],
    ] as const) {
      const text = TOKENS[ink] ?? "";
      const tint = TOKENS[base] ?? "";
      expect(
        [text, tint, surface].every((c) => c.length === 7),
        `${ink}/${base} are declared`,
      ).toBe(true);
      for (const share of [0.09, 0.16, 0.22]) {
        expect(
          contrastRatio(text, mix(tint, share, surface)),
          `${ink} on ${Math.round(share * 100)}% ${base}`,
        ).toBeGreaterThanOrEqual(4.5);
      }
      expect(contrastRatio(text, surface)).toBeGreaterThanOrEqual(4.5);
    }
  });
});
