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

  // The Readout's post-extraction states — the only major views the sweep above
  // skips, because they render dynamically only after a file is dropped. A plain
  // .txt flows through the same anchored extractors as a typed PDF, so we can
  // drive the real confirm flow deterministically (no binary fixture, no OCR):
  // the editable confirm fields, then the post-confirm "where you stand" summary
  // (its standing grid is a classic phone-overflow source). Asserts the viewport
  // and the field rows/standing grid all stay scroll-free at tight widths.
  test("the Readout confirm + summary fit on a phone", async ({ page }) => {
    // A minimal W-2 the anchored extractor recognizes (title markers + boxes).
    const w2 = [
      "Form W-2 Wage and Tax Statement 2024",
      "1 Wages, tips, other compensation  $128,500.00",
      "2 Federal income tax withheld  $18,250.00",
      "12a D 19,500.00",
      "17 State income tax  $7,420.00",
    ].join("\n");

    for (const width of [320, 360, 414]) {
      await page.setViewportSize({ width, height: 740 });
      await page.goto("/#/readout");
      await waitForApp(page);

      await page.setInputFiles("input.readout-file", {
        name: "w2.txt",
        mimeType: "text/plain",
        buffer: Buffer.from(w2, "utf-8"),
      });

      // The confirm state: editable fields + the "Confirm and add" button.
      const confirm = page.getByRole("button", { name: /confirm and add/i });
      await expect(confirm).toBeVisible();
      let overflow = await horizontalOverflow(page);
      expect(
        overflow,
        `Readout confirm @ ${width}px overflowed by ${overflow}px`,
      ).toBeLessThanOrEqual(1);

      await confirm.click();

      // The summary state: the §2.3 "where you stand" block.
      await page.waitForSelector(".readout-summary");
      overflow = await horizontalOverflow(page);
      expect(
        overflow,
        `Readout summary @ ${width}px overflowed by ${overflow}px`,
      ).toBeLessThanOrEqual(1);
      // The standing grid (if income produced one) must not scroll internally.
      const innerLeak = await page.evaluate(() => {
        let w = 0;
        for (const el of Array.from(
          document.querySelectorAll<HTMLElement>(".readout-standing, .readout-fields"),
        )) {
          w = Math.max(w, el.scrollWidth - el.clientWidth);
        }
        return w;
      });
      expect(
        innerLeak,
        `Readout inner box overflowed by ${innerLeak}px @ ${width}px`,
      ).toBeLessThanOrEqual(1);
    }
  });

  // Phone in landscape — a short viewport, the one orientation the width sweep
  // (all height 800) never exercises. Content still scrolls vertically only, and
  // the command palette (its own fixed overlay) must stay within the viewport so
  // its input and results are reachable rather than clipped off-screen.
  test("landscape phones scroll vertically only and the palette stays usable", async ({ page }) => {
    for (const size of [
      { width: 740, height: 360 }, // small phone, landscape
      { width: 932, height: 430 }, // large phone, landscape
    ]) {
      await page.setViewportSize(size);
      for (const hash of [
        "/",
        "/#/paycheck-taxes?tool=take-home",
        "/#/budget-cashflow?tool=cash-flow",
      ]) {
        await page.goto(hash);
        await waitForApp(page);
        const overflow = await horizontalOverflow(page);
        expect(
          overflow,
          `${hash} @ ${size.width}x${size.height} overflowed by ${overflow}px`,
        ).toBeLessThanOrEqual(1);
      }
      // Open ⌘K and confirm the panel fits within the short viewport.
      await page.keyboard.press("ControlOrMeta+k");
      const panel = page.getByRole("dialog", { name: "Command palette" });
      await expect(panel).toBeVisible();
      const fits = await panel.evaluate(
        (el, vh) => el.getBoundingClientRect().bottom <= vh + 1,
        size.height,
      );
      expect(fits, `palette panel exceeded the ${size.height}px viewport`).toBe(true);
      await page.keyboard.press("Escape");
    }
  });
});
