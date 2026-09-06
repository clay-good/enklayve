import { test, expect } from "@playwright/test";

/**
 * The front door is on the plumbing, in a real browser.
 *
 * The home budget asks for income, filing status, state and the mandatory
 * county — the same four every tax tile asks for — and shared none of them, so
 * a reader who filled it in retyped their income in the first tool they opened
 * from it. The unit suite holds the writes. It cannot hold this: what a reader
 * would actually check is whether the number they entered on the home page is
 * *already there* when the tool opens, and a `<select>` only behaves like a
 * select in a real browser (`catalogInvariants.test.ts` and
 * `sharedFilingStatus.spec.ts` both carry that warning).
 *
 * Navigation here is by hash, which keeps the document — and therefore the
 * in-memory profile — alive. That is the whole point: nothing is persisted.
 */
const TAKE_HOME = "/#/paycheck-taxes?tool=take-home";
const HOME = "/#/";

test("what you type on the home page is waiting for you in Take-Home", async ({ page }) => {
  await page.goto(HOME);
  await page.locator("select[aria-label='State']").selectOption("ny");
  await page.locator("input[aria-label='Income']").fill("8000");
  await page.locator("select[aria-label='Filing status']").selectOption("head_of_household");

  // No figures in the link: everything below has to have come from the budget.
  await page.goto(TAKE_HOME);
  await expect(page.locator("select[name='st']")).toHaveValue("ny");
  await expect(page.locator("select[name='fs']")).toHaveValue("head_of_household");
  await expect(page.locator("input[name='w']")).toHaveValue("96000");
});

test("and an income entered in a tool is what the home budget opens on", async ({ page }) => {
  await page.goto(`${TAKE_HOME}&fs=single&st=ca&w=60000`);
  await page.locator("input[name='w']").fill("85000");

  // $85,000 a year, restated in the budget's own per-period box.
  await page.goto(HOME);
  await expect(page.locator("input[aria-label='Income']")).toHaveValue("7083");
  await expect(page.locator("select[aria-label='State']")).toHaveValue("ca");

  // And restating it is not editing it: $7,083 × 12 is $84,996, which is what a
  // budget that recomputed from its own box would send back.
  await page.locator("input[aria-label='Housing']").fill("1800");
  await page.goto(TAKE_HOME);
  await expect(page.locator("input[name='w']")).toHaveValue("85000");
});
