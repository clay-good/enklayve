import { test, expect } from "@playwright/test";

/**
 * The shared filing status survives a tile that cannot express it.
 *
 * `filingStatus` is chosen once and read by every tile after it. Most tiles ask
 * with a five-option select and write back what the reader chose, which loses
 * nothing. Four ask with a single *married filing jointly* checkbox, which has
 * two values, and Education Credits used to write that bit through as
 * `married ? "married_jointly" : "single"` — so a head-of-household filer who
 * typed a MAGI there had their status quietly rewritten to single, and then paid
 * for it in Take-Home at a different standard deduction and a different
 * schedule.
 *
 * The unit suite holds the write itself. It cannot hold this: the question a
 * reader would ask is *what does the filing status control say when I come
 * back*, and happy-dom mis-reports `<select>.value` when options are built with
 * `selected` set before insertion, which is how every tile builds them.
 * `catalogInvariants.test.ts` and `countyTax.spec.ts` both carry that warning.
 *
 * So it is asked here, where a select behaves like a select.
 */
const TAKE_HOME = "/#/paycheck-taxes?tool=take-home";
const EDUCATION = "/#/benefits?tool=education-credits";

test("a head of household stays one after visiting Education Credits", async ({ page }) => {
  // Chosen, not deep-linked: a tile writes the shared profile when the reader
  // edits it, so a link that merely displays a status has not told the profile
  // anything yet.
  await page.goto(`${TAKE_HOME}&fs=single&st=ca&w=60000`);
  const status = page.locator("select[name='fs']");
  await status.selectOption("head_of_household");
  await expect(status).toHaveValue("head_of_household");

  // The checkbox tile reads the same profile: not a joint return, which head of
  // household already satisfies, so the box is clear and stays clear.
  await page.goto(EDUCATION);
  const mfj = page.locator("input[name='mfj']");
  await expect(mfj).not.toBeChecked();
  await page.locator("input[name='magi']").fill("70000");
  await expect(page.locator(".tile-result")).toBeVisible();

  // Back to Take-Home with nothing in the link: the status has to come from the
  // profile, and it has to be the one the reader chose.
  await page.goto(TAKE_HOME);
  await expect(page.locator("select[name='fs']")).toHaveValue("head_of_household");
});

test("checking married filing jointly there does reach Take-Home", async ({ page }) => {
  // The other direction has to keep working: the bit the checkbox CAN express is
  // a real answer, and a shared field that ignores it is its own bug.
  await page.goto(`${TAKE_HOME}&fs=single&st=ca&w=60000`);
  await page.locator("select[name='fs']").selectOption("head_of_household");

  await page.goto(EDUCATION);
  await page.locator("input[name='mfj']").check();
  await expect(page.locator(".tile-result")).toBeVisible();

  await page.goto(TAKE_HOME);
  await expect(page.locator("select[name='fs']")).toHaveValue("married_jointly");
});
