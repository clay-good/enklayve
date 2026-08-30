import { test, expect } from "@playwright/test";
import { createRequire } from "node:module";

/**
 * Colour contrast (WCAG 1.4.3), in a real browser, in both themes.
 *
 * This is the one axe rule the unit suite cannot run: happy-dom has no layout
 * engine and no computed colours, so every `axe.run` in `tests/` disables
 * `color-contrast` by necessity — and axe was never run in Playwright at all.
 * The result was a checklist promising "axe-core: zero violations" while the
 * single most-failed success criterion in the WCAG catalogue went unmeasured,
 * verified by reading the theme tokens by hand.
 *
 * It passes, and it passed the first time it ran, so this is a lock rather than
 * a fix — the hand-verification was right.
 *
 * Two things this asserts besides the violations, both learned the hard way
 * while writing it:
 *
 * **That it measured anything.** The first version passed `runOnly:
 * ["color-contrast"]`. A bare array is read by axe as a list of TAGS, not rule
 * ids, so the rule never ran; a planted `#bbbbbb`-on-white paragraph went
 * unreported across all eight cases and every one of them was green. Asserting
 * a floor on the passing node count is what makes the next such mistake loud.
 *
 * **What it could not measure.** Nine elements on the home page sit on a
 * background gradient, and axe cannot resolve a background it has to sample, so
 * it reports them `incomplete` rather than pass or fail. That is not a failure
 * and is not a pass; it is the boundary of the machine check, and it is
 * reported so the hand-verification knows exactly what it still owns.
 */
const require = createRequire(import.meta.url);
const AXE = require.resolve("axe-core");

interface ContrastResult {
  passes: number;
  violations: string[];
  incomplete: string[];
}

/** A floor per view, low enough not to be brittle and high enough to catch a rule that never ran. */
const MIN_EVALUATED = 40;

for (const theme of ["light", "dark"] as const) {
  for (const [name, hash, marker] of [
    ["home", "/", "home-budget__select"],
    ["a calculator", "/#/paycheck-taxes?tool=take-home", "tile-result"],
    ["All tools", "/#/all-tools", "all-tools"],
    ["a Pillar 4 screener", "/#/when-money-is-tight?tool=garnishment", "tile-result"],
  ] as const) {
    test(`${name} has no contrast violations in the ${theme} theme`, async ({ page }) => {
      await page.goto(hash);
      await page.waitForSelector("#content");
      // Prove we are on the view we meant to be on: a hash naming no route
      // falls back to home, and four checks of home are one check.
      await expect(page.locator(`.${marker}`).first()).toBeVisible({ timeout: 15_000 });
      await page.evaluate((t) => document.documentElement.setAttribute("data-theme", t), theme);
      await page.waitForTimeout(300);
      await page.addScriptTag({ path: AXE });

      const result: ContrastResult = await page.evaluate(async () => {
        // `{ type: "rule", values: [...] }`, never a bare array — see above.
        // @ts-expect-error axe is injected into the page, not imported here
        const res = await window.axe.run(document, {
          runOnly: { type: "rule", values: ["color-contrast"] },
        });
        const describe = (
          list: { nodes: { target: unknown[]; any: { message?: string }[] }[] }[],
        ) =>
          list.flatMap((r) =>
            r.nodes.map(
              (n) => `${n.target.join(" ")} — ${(n.any[0]?.message ?? "").slice(0, 140)}`,
            ),
          );
        return {
          passes: res.passes.reduce((n: number, r: { nodes: unknown[] }) => n + r.nodes.length, 0),
          violations: describe(res.violations),
          incomplete: describe(res.incomplete),
        };
      });

      expect(
        result.passes,
        `axe evaluated ${result.passes} elements for contrast on ${name}, which means the rule did not run`,
      ).toBeGreaterThan(MIN_EVALUATED);

      expect(result.violations.join("\n"), `${name} (${theme}) fails WCAG 1.4.3`).toBe("");

      // Not a failure. The page's gradient backgrounds are the one thing axe
      // cannot resolve, and naming them is how the hand-verification knows what
      // it still owns.
      if (result.incomplete.length > 0) {
        console.log(
          `${name} (${theme}): ${result.incomplete.length} element(s) axe could not judge — ${result.incomplete[0]}`,
        );
      }
    });
  }
}
