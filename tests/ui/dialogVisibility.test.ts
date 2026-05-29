import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Regression guard for the dialog-won't-close bug: the overlay backdrop uses
 * `display: flex`, which (being an author rule) overrides the browser's default
 * `[hidden] { display: none }`. So the stylesheet must force the `hidden`
 * attribute to win, or setting `element.hidden = true` would never actually hide
 * the My Situation dialog or the command palette. happy-dom doesn't apply the
 * CSS cascade, so this is asserted against the stylesheet text directly.
 */
describe("overlay visibility", () => {
  const css = readFileSync(resolve(__dirname, "../../src/styles.css"), "utf8");

  it("forces the hidden attribute to hide even display:flex overlays", () => {
    expect(css).toMatch(/\[hidden\]\s*\{[^}]*display:\s*none\s*!important/);
  });
});
