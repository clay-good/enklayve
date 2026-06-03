import { describe, it, expect } from "vitest";
import { CommandPalette } from "../../src/ui/commandPalette";
import type { SearchEntry } from "../../src/tiles/registry";

function input(p: CommandPalette): HTMLInputElement {
  return p.element.querySelector<HTMLInputElement>(".palette-input")!;
}
function options(p: CommandPalette): HTMLElement[] {
  return Array.from(p.element.querySelectorAll<HTMLElement>(".palette-opt"));
}
function press(el: HTMLElement, key: string): void {
  el.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
}

describe("command palette", () => {
  it("opens, filters by fuzzy query, and is keyboard operable", () => {
    let chosen: SearchEntry | null = null;
    const palette = new CommandPalette((e) => (chosen = e));
    document.body.append(palette.element);

    palette.show();
    expect(palette.isOpen()).toBe(true);
    expect(palette.element.hidden).toBe(false);
    // Empty query lists tools.
    expect(options(palette).length).toBeGreaterThan(0);

    const field = input(palette);
    field.value = "take home";
    field.dispatchEvent(new Event("input"));
    expect(options(palette)[0]?.textContent).toContain("Take-Home Pay");

    // Enter selects the active option.
    press(field, "Enter");
    expect(chosen).not.toBeNull();
    expect(palette.isOpen()).toBe(false);

    palette.element.remove();
  });

  it("marks the active option with aria-selected and moves with arrow keys", () => {
    const palette = new CommandPalette(() => {});
    document.body.append(palette.element);
    palette.show();
    const field = input(palette);

    const before = palette.element.querySelector('[aria-selected="true"]');
    expect(before?.id).toBe("palette-opt-0");

    press(field, "ArrowDown");
    const after = palette.element.querySelector('[aria-selected="true"]');
    expect(after?.id).toBe("palette-opt-1");
    expect(field.getAttribute("aria-activedescendant")).toBe("palette-opt-1");

    press(field, "Escape");
    expect(palette.isOpen()).toBe(false);
    palette.element.remove();
  });

  it("shows an empty state for a non-matching query", () => {
    const palette = new CommandPalette(() => {});
    document.body.append(palette.element);
    palette.show();
    const field = input(palette);
    field.value = "zzzzzzz";
    field.dispatchEvent(new Event("input"));
    expect(palette.element.querySelector(".palette-empty")).not.toBeNull();
    palette.element.remove();
  });
});
