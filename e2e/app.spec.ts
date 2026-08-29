import { test, expect } from "@playwright/test";

/**
 * Smoke + offline (BUILD-SPEC.md §8/§11): the production build boots, a deep
 * link computes a real result on-device, the command palette opens, and — the
 * Phase 8 acceptance criterion — the site still loads and renders after the
 * network is cut, served by the precaching service worker.
 */

test("the home boots and the wordmark renders", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".wordmark")).toHaveText("enklayve");
});

test("a deep link computes a real result on-device", async ({ page }) => {
  // Take-Home Pay now lives inside the Paycheck & Taxes hub (its default tool).
  await page.goto("/#/paycheck-taxes?tool=take-home");
  await page.waitForSelector(".content");
  await page.getByRole("button", { name: /try an example/i }).click();
  // The result card shows a large headline figure; it must be a currency value.
  const value = page.locator(".result-value").first();
  await expect(value).toBeVisible();
  await expect(value).toContainText("$");
});

test("the command palette opens with the keyboard", async ({ page }) => {
  await page.goto("/");
  await page.waitForSelector(".wordmark");
  await page.keyboard.press("ControlOrMeta+k");
  // `.palette-panel` is shared with the My Situation dialog, so target the
  // command palette by its accessible name.
  await expect(page.getByRole("dialog", { name: "Command palette" })).toBeVisible();
});

test("printing the Readout Report strips the app chrome", async ({ page }) => {
  // The Report offers a Print action; under print media the site chrome and
  // interactive controls must drop away so the printout is a clean document
  // (BUILD-SPEC-2 §5). happy-dom has no media engine, so this is verified here.
  await page.goto("/#/report");
  await page.waitForSelector(".report-body");
  await page.emulateMedia({ media: "print" });
  await expect(page.locator(".app-header")).toBeHidden();
  await expect(page.locator(".app-footer")).toBeHidden();
  await expect(page.locator(".report-actions")).toBeHidden();
  // The report content itself stays on the page.
  await expect(page.locator(".report-body")).toBeVisible();
});

test("works offline after the first visit", async ({ page, context }) => {
  // First visit: let the service worker install and precache the core shell.
  await page.goto("/");
  await page.waitForSelector(".wordmark");
  await page.evaluate(async () => {
    if ("serviceWorker" in navigator) await navigator.serviceWorker.ready;
  });

  // Reload so this page becomes SW-controlled (the SW takes control on the next
  // navigation after activation).
  await page.reload();
  await page.waitForSelector(".wordmark");
  await page.evaluate(async () => {
    if (!("serviceWorker" in navigator)) return;
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) {
      await new Promise<void>((resolve) => {
        navigator.serviceWorker.addEventListener("controllerchange", () => resolve(), {
          once: true,
        });
        setTimeout(resolve, 3000);
      });
    }
  });

  // Cut the network and reload: the cached shell must still boot the app, and
  // since datasets are inlined at build time there is no runtime fetch to miss.
  await context.setOffline(true);
  await page.reload();
  await expect(page.locator(".wordmark")).toHaveText("enklayve");
  await context.setOffline(false);
});

/**
 * SPEC-4-ledger §6.1 and §7, and SPEC §2 principle 8 more broadly: a household
 * that never opts into the Standing Ledger experiences the product exactly as it
 * was, and Phase 24 adds no persistence at all.
 *
 * The assertion is deliberately over-broad — it walks a real session across the
 * home, a calculator, the Readout, and the Report, then reads back *everything*
 * the browser could be holding. Only the one allowed key may be there. A future
 * change that starts quietly remembering a figure fails here rather than in a
 * privacy review that may not happen.
 */
test("a session that never exports persists nothing financial", async ({ page }) => {
  await page.goto("/");
  await page.waitForSelector(".wordmark");

  await page.goto("/#/paycheck-taxes?tool=take-home");
  await page.waitForSelector(".content");
  await page.getByRole("button", { name: /try an example/i }).click();

  await page.goto("/#/readout");
  await page.waitForSelector(".readout-dropzone");

  await page.goto("/#/report");
  await page.waitForSelector(".report");

  const stored = await page.evaluate(async () => {
    const local = Object.fromEntries(
      Object.keys(localStorage).map((k) => [k, localStorage.getItem(k)]),
    );
    const session = Object.fromEntries(
      Object.keys(sessionStorage).map((k) => [k, sessionStorage.getItem(k)]),
    );
    const cookies = document.cookie;
    let databases: string[] = [];
    if (typeof indexedDB !== "undefined" && "databases" in indexedDB) {
      databases = (await indexedDB.databases()).map((d) => d.name ?? "");
    }
    return { local, session, cookies, databases };
  });

  // The locale/theme preference is the single permitted key (the mechanical
  // expression of SPEC §2 principle 8, enforced in code by `checkLocalStorage`).
  for (const key of Object.keys(stored.local)) {
    expect(key).toMatch(/^enklayve\.(locale|theme)$/);
  }
  expect(Object.keys(stored.session)).toEqual([]);
  expect(stored.cookies).toBe("");
  expect(stored.databases.filter((n) => n.length > 0)).toEqual([]);
});

/**
 * The shared-profile promise, in a real browser (BUILD-SPEC-2 §3).
 *
 * "A number entered in one tool prefills every other" is the reason My Situation
 * exists, and nothing checked it end to end. It has to be a browser test: this
 * was first probed in happy-dom, which mis-reports `<select>.value` when the
 * options are built with `selected` set before insertion — it claimed the Benefit
 * Cliff Explorer ignored the profile entirely, and Chromium showed it does not.
 * A unit assertion here would have "found" a bug that does not exist.
 */
test("a value entered in one tool prefills the next", async ({ page }) => {
  await page.goto("/#/paycheck-taxes?tool=take-home");
  await page.waitForSelector(".tile-form");
  await page.locator('select[name="fs"]').first().selectOption("head_of_household");
  await page.locator('select[name="st"]').first().selectOption("ny");

  // A different hub, a different calculator: it must open on those values.
  await page.goto("/#/benefit-cliffs?tool=cliff-explorer");
  await page.waitForSelector(".tile-form");
  await expect(page.locator('select[name="fs"]').first()).toHaveValue("head_of_household");
  await expect(page.locator('select[name="st"]').first()).toHaveValue("ny");
});

test("a deep link beats the profile, and the control shows it", async ({ page }) => {
  await page.goto("/#/paycheck-taxes?tool=take-home");
  await page.waitForSelector(".tile-form");
  await page.locator('select[name="fs"]').first().selectOption("head_of_household");

  // URL fragment > session profile > default (the profileSync precedence). The
  // substitution must be *visible*, not just applied to the maths (SPEC-3 §2.6).
  await page.goto("/#/benefit-cliffs?tool=cliff-explorer&fs=single&st=tx");
  await page.waitForSelector(".tile-form");
  await expect(page.locator('select[name="fs"]').first()).toHaveValue("single");
  await expect(page.locator('select[name="st"]').first()).toHaveValue("tx");
});
