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

  it("keeps results relevant: a specific name returns only related tools", () => {
    const palette = new CommandPalette(() => {});
    document.body.append(palette.element);
    palette.show();
    const field = input(palette);
    const titlesFor = (q: string): string[] => {
      field.value = q;
      field.dispatchEvent(new Event("input"));
      return options(palette).map((o) => o.querySelector(".palette-opt-title")?.textContent ?? "");
    };
    // "roth" must surface the Roth tools — and nothing unrelated like a home or
    // insurance tool that the old subsequence-over-description match dragged in.
    const roth = titlesFor("roth");
    expect(roth[0]).toBe("Roth Conversion Ladder");
    expect(roth.every((t) => /roth/i.test(t) || /retirement|backdoor/i.test(t))).toBe(true);
    expect(roth).not.toContain("Home Buying Readiness");
    expect(roth).not.toContain("Life Insurance Needs");
    // A pure abbreviation no substring covers still resolves to its tool.
    expect(titlesFor("thp")).toEqual(["Take-Home Pay"]);
    palette.element.remove();
  });
});
