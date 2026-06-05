import { test, expect, type Page } from "@playwright/test";

/**
 * Input robustness across every tool (BUILD-SPEC.md §9). A user — or a crafted
 * deep link — can put absurd numbers into any field. Two failure modes must
 * never happen: a runaway loop / `Decimal.pow` that freezes the tab (the engine
 * clamps every horizon and row count; `tests/engine/horizonCaps.test.ts` proves
 * the unit-level bound), and a divide-by-zero surfacing as "$NaN"/"Infinity" in
 * the result. This sweeps the whole catalog in a real browser and asserts both,
 * the end-to-end complement to the unit caps.
 *
 * The tool list comes from sitemap.xml (generated from the tile registry), so a
 * new tile is covered automatically — the same source the responsive sweep uses.
 * The "no hang" assertion is implicit: a wedged main thread would make these
 * awaited calls time out and fail the test; a bounded one returns at once.
 */

/** Set every numeric field to `value` and fire the events that recompute. */
async function setAllNumbers(page: Page, value: string): Promise<void> {
  await page.evaluate((v) => {
    const sel = "input[type=number], input[inputmode=decimal], input[inputmode=numeric]";
    for (const el of Array.from(document.querySelectorAll<HTMLInputElement>(sel))) {
      el.value = v;
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    }
  }, value);
}

const BROKEN = /NaN|Infinity|\$NaN|undefined|null%/;

test("no tool hangs or renders NaN/Infinity for absurd inputs", async ({ page, request }) => {
  const sitemap = await (await request.get("/sitemap.xml")).text();
  const ids = [
    ...new Set([...sitemap.matchAll(/\/tools\/([^.<]+)\.html/g)].map((m) => m[1])).values(),
  ];
  expect(ids.length, "expected the sitemap to list many tools").toBeGreaterThan(40);

  await page.setViewportSize({ width: 390, height: 900 });
  const broken: string[] = [];
  for (const id of ids) {
    // Resolve the in-app deep link (a sub-tool lives inside a hub at `?tool=`).
    const pageHtml = await (await request.get(`/tools/${id}.html`)).text();
    const m = pageHtml.match(/href="(\/#\/[^"]+)"/);
    await page.goto(m ? m[1]! : `/#/${id}`);
    await page.waitForSelector(".content", { state: "attached" });

    for (const value of ["999999999", "0"]) {
      await setAllNumbers(page, value);
      // If a recompute spun a runaway loop, this read would never resolve and
      // the test would time out — so reaching the assertion is itself the
      // no-hang proof.
      const text = (await page.locator(".content").textContent()) ?? "";
      const hit = text.match(new RegExp(`.{0,20}(?:${BROKEN.source}).{0,12}`));
      if (hit) broken.push(`${id} @ ${value}: «${hit[0].trim()}»`);
    }
  }
  expect(broken, `tools rendering NaN/Infinity/undefined: ${broken.join(", ")}`).toEqual([]);
});
