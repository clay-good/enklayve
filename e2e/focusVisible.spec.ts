import { test, expect } from "@playwright/test";

/**
 * Every keyboard-focusable control shows that it has focus (WCAG 2.4.7).
 *
 * This needs a real browser and cannot be done anywhere else in this repo:
 * happy-dom has no layout engine and no computed styles, and axe does not
 * evaluate focus indicators at all. So the one requirement whose failure is
 * invisible to a mouse user and total to a keyboard user was the one nothing
 * checked.
 *
 * The stylesheet carries three `outline: none` declarations and all three are
 * correct: `<main>` is focused programmatically after a route change and an
 * outline round the whole content region would be noise; the passphrase field
 * and the home-budget money field sit inside wrappers that take a
 * `:focus-within` ring instead, so an inner outline would double up. Each is a
 * deliberate trade, and each is one edit away from becoming a control nobody
 * can see. That is what this holds.
 *
 * An indicator counts if it is on the element or on an ancestor, because the
 * wrapper pattern above is the reason two of those declarations exist at all.
 */
/**
 * What focusing this control changes, on it or on the wrapper above it.
 *
 * The first version of this asked whether a focused element "had an outline or
 * a box-shadow, on itself or an ancestor" — and passed everything, because the
 * cards these controls sit in carry a box-shadow for elevation. A check that
 * cannot fail is worse than none: it reports the requirement as covered.
 *
 * So it compares the control's appearance focused against unfocused. That is
 * what "visible focus" actually means, it needs no guess about which property
 * carries the indicator, and it survives the wrapper pattern — where the ring
 * appears on the parent via `:focus-within` — without opening the door to every
 * shadow on the page.
 */
function appearance(el: Element): string {
  const read = (node: Element | null): string => {
    if (!node) return "";
    const s = getComputedStyle(node);
    return [
      s.outlineStyle,
      s.outlineWidth,
      s.outlineColor,
      s.boxShadow,
      s.borderColor,
      s.backgroundColor,
      s.color,
    ].join("|");
  };
  return `${read(el)}//${read(el.parentElement)}//${read(el.parentElement?.parentElement ?? null)}`;
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])';

// Routes are asserted below, not assumed: the first version of this pointed at
// a hub id that does not exist, every page silently fell back to home, and all
// three tests passed while checking the same nineteen controls.
for (const [name, hash, expect1] of [
  ["home", "/", "home-budget__select"],
  ["a calculator", "/#/paycheck-taxes?tool=take-home", "tile-result"],
  ["All tools", "/#/all-tools", "all-tools"],
  ["a Pillar 4 screener", "/#/when-money-is-tight?tool=garnishment", "tile-result"],
] as const) {
  test(`every focusable control on ${name} shows focus`, async ({ page }) => {
    await page.goto(hash);
    await page.waitForSelector("#content");
    await page.waitForTimeout(400);
    // Prove we are on the view we meant to be on. A hash that names nothing
    // lands on home, and a suite that checks home four times is a suite that
    // checks home once.
    await expect(page.locator(`.${expect1}`).first()).toBeVisible({ timeout: 15_000 });

    const handles = await page.locator(FOCUSABLE).elementHandles();
    expect(handles.length, `${name} has nothing focusable`).toBeGreaterThan(3);

    const invisible: string[] = [];
    // Bounded: enough to cover every distinct control style on a view without
    // turning a fifteen-second suite into a minute.
    for (const handle of handles.slice(0, 40)) {
      if (!(await handle.isVisible())) continue;
      await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
      const before = await handle.evaluate(appearance);
      await handle.focus();
      // No catch here on purpose. An evaluation that throws is a broken check,
      // and a broken check that reports success is worse than no check.
      const after = await handle.evaluate(appearance);
      if (before === after) {
        invisible.push(
          await handle.evaluate(
            (el: Element) =>
              `${el.tagName.toLowerCase()}${el.className ? `.${String(el.className).split(" ")[0]}` : ""}`,
          ),
        );
      }
    }
    expect(invisible.join(", "), `${name}: focused with no visible indicator`).toBe("");
  });
}

/**
 * Every hub, with an answer on the screen.
 *
 * The four views above are the same four the contrast check started with, and
 * for the same reason they were not enough: a control that only exists once a
 * tile has computed something — "Copy number", "Copy link", the show-the-math
 * disclosure, the sensitivity toggle, the segmented picker on eleven other hubs
 * — is not on the page when an empty form is opened. So each hub is opened at
 * its default tool and its worked example is pressed first.
 */
const HUBS = [
  "paycheck-taxes",
  "self-employed",
  "investing",
  "retirement",
  "debt",
  "budget-cashflow",
  "home-purchases",
  "protection",
  "benefits",
  "benefit-cliffs",
  "when-money-is-tight",
  "where-you-stand",
] as const;

for (const hub of HUBS) {
  test(`every focusable control on the ${hub} hub shows focus, showing an answer`, async ({
    page,
  }) => {
    await page.goto(`/#/${hub}`);
    await page.waitForSelector("#content");
    await expect(page.locator(".segmented, .hub-tool").first()).toBeVisible({ timeout: 15_000 });
    // Pressed with the keyboard, not clicked. A real mouse click switches the
    // browser's `:focus-visible` heuristic to pointer modality, and every
    // subsequent programmatic `.focus()` then matches `:focus` but not
    // `:focus-visible` — which reported all twenty-eight controls on this page
    // as having no indicator, including the skip link the four views above
    // prove is fine. The check has to stay in the modality it is testing.
    const example = page.getByRole("button", { name: /try an example/i }).first();
    if (await example.isVisible().catch(() => false)) {
      await example.focus();
      await page.keyboard.press("Enter");
      await page.waitForTimeout(200);
    }
    await page.waitForTimeout(300);

    const handles = await page.locator(FOCUSABLE).elementHandles();
    expect(handles.length, `${hub} has nothing focusable`).toBeGreaterThan(3);

    const invisible: string[] = [];
    for (const handle of handles.slice(0, 40)) {
      if (!(await handle.isVisible())) continue;
      await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
      const before = await handle.evaluate(appearance);
      await handle.focus();
      const after = await handle.evaluate(appearance);
      if (before === after) {
        invisible.push(
          await handle.evaluate(
            (el: Element) =>
              `${el.tagName.toLowerCase()}${el.className ? `.${String(el.className).split(" ")[0]}` : ""}`,
          ),
        );
      }
    }
    expect(invisible.join(", "), `${hub}: focused with no visible indicator`).toBe("");
  });
}
