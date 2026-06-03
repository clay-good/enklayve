import { test, expect, type Page } from "@playwright/test";

/**
 * Responsiveness: every page/view must scroll vertically only — never sideways —
 * on every device width (the owner's hard requirement; BUILD-SPEC-2 §0.7,
 * BUILD-SPEC.md §11). happy-dom has no layout engine, so this is the only place
 * the guarantee is actually measured rather than asserted from CSS.
 */

/** Device widths from a small phone to a wide desktop. */
const WIDTHS = [320, 360, 375, 414, 768, 1024, 1280, 1440];

/**
 * Measure genuine horizontal overflow. The shipped CSS clips overflow-x on both
 * the root and the content column so the viewport can never scroll sideways — so
 * to detect a *real* leak (content actually wider than the viewport, which clip
 * would otherwise mask) we disable those clips first, then check whether the
 * document is wider than its client box. Contained scrollers (the "show the
 * math" tables, the cash-flow timeline) keep their own overflow-x:auto, so they
 * never widen the document.
 */
async function horizontalOverflow(page: Page): Promise<number> {
  await page.addStyleTag({
    content: "html, .content { overflow-x: visible !important; }",
  });
  return page.evaluate(() => {
    const de = document.documentElement;
    return de.scrollWidth - de.clientWidth;
  });
}

/** Wait until the SPA has mounted its content region. */
async function waitForApp(page: Page): Promise<void> {
  await page.waitForSelector(".content", { state: "attached" });
  // The result/intro content renders synchronously after mount; a microtask
  // settle keeps the measurement stable across engines.
  await page.waitForLoadState("networkidle").catch(() => undefined);
}

test.describe("no horizontal scrolling, every view", () => {
  // The home, the crawlable index, the trust page, and the two document views.
  const KEY_VIEWS: Array<{ name: string; hash: string }> = [
    { name: "home", hash: "/" },
    { name: "all-tools", hash: "/#/all-tools" },
    { name: "about", hash: "/#/about" },
    { name: "readout", hash: "/#/readout" },
    { name: "report", hash: "/#/report" },
  ];

  for (const view of KEY_VIEWS) {
    test(`${view.name} fits at every width`, async ({ page }) => {
      for (const width of WIDTHS) {
        await page.setViewportSize({ width, height: 800 });
        await page.goto(view.hash);
        await waitForApp(page);
        const overflow = await horizontalOverflow(page);
        expect(
          overflow,
          `${view.name} @ ${width}px overflowed by ${overflow}px`,
        ).toBeLessThanOrEqual(1);
      }
    });
  }

  // Every tool, at a tight phone width — comprehensive coverage of "delightful
  // on every page/view." The full route list comes from sitemap.xml, whose
  // /tools/<id>.html entries are generated from the tile registry (the static
  // crawl surface), so a new tile is covered automatically. The All Tools index
  // renders tools as buttons (not anchors), so the sitemap is the reliable list.
  test("every tool fits on a 360px phone", async ({ page, request }) => {
    const sitemap = await (await request.get("/sitemap.xml")).text();
    const ids = [...sitemap.matchAll(/\/tools\/([^.<]+)\.html/g)].map((m) => m[1]);
    const unique = [...new Set(ids)];
    expect(unique.length, "expected the sitemap to list many tools").toBeGreaterThan(40);

    await page.setViewportSize({ width: 360, height: 740 });
    const leaks: string[] = [];
    for (const id of unique) {
      // A tool may be hosted inside a hub behind `?tool=`, so use the real
      // in-app link printed on its static page rather than assuming `/#/<id>`.
      const pageHtml = await (await request.get(`/tools/${id}.html`)).text();
      const m = pageHtml.match(/href="(\/#\/[^"]+)"/);
      await page.goto(m ? m[1]! : `/#/${id}`);
      await waitForApp(page);
      const overflow = await horizontalOverflow(page);
      if (overflow > 1) leaks.push(`${id} (+${overflow}px)`);
    }
    expect(leaks, `tools that scroll sideways at 360px: ${leaks.join(", ")}`).toEqual([]);
  });

  // A tool with a result card open (the breakdown table is the classic leak
  // source) must still fit — exercise the worked example, then the open math.
  test("a computed result with the math open still fits at 360px", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 740 });
    await page.goto("/#/paycheck-taxes?tool=take-home");
    await waitForApp(page);
    const example = page.getByRole("button", { name: /example/i }).first();
    if (await example.isVisible().catch(() => false)) {
      await example.click();
    }
    // Open any "show the math" disclosure if present.
    const details = page.locator("details").first();
    if (await details.count()) {
      await details.evaluate((d: Element) => ((d as HTMLDetailsElement).open = true));
    }
    const overflow = await horizontalOverflow(page);
    expect(overflow, `take-home with math open overflowed by ${overflow}px`).toBeLessThanOrEqual(1);
  });

  // The W-4 refund check puts whole sentences in the breakdown's value column;
  // with the math auto-open, those must wrap, not force an inner sideways scroll.
  test("the W-4 breakdown wraps instead of scrolling sideways", async ({ page }) => {
    for (const width of [360, 414, 768]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/#/paycheck-taxes?tool=w4");
      await waitForApp(page);
      const example = page.getByRole("button", { name: /example/i }).first();
      if (await example.isVisible().catch(() => false)) await example.click();
      await page.waitForSelector(".breakdown-table");
      // No breakdown box or table may scroll sideways — it must wrap.
      const worst = await page.evaluate(() => {
        let w = 0;
        for (const el of Array.from(
          document.querySelectorAll<HTMLElement>(".breakdown, .breakdown-table"),
        )) {
          w = Math.max(w, el.scrollWidth - el.clientWidth);
        }
        return w;
      });
      expect(worst, `W-4 breakdown overflowed by ${worst}px @ ${width}px`).toBeLessThanOrEqual(1);
      expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1);
    }
  });
});
