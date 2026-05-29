/**
 * The command palette (BUILD-SPEC.md Phase 4; the sophiewell hero search of
 * BUILD-SPEC-2 §1). A fuzzy search over every tile, reachable by Cmd/Ctrl-K or
 * the inline search bar. It is a real modal dialog with a combobox/listbox
 * pattern so it is fully keyboard operable and screen-reader legible: arrow keys
 * move the active option, Enter opens it, Escape closes.
 */
import { el, clear } from "./dom";
import { fuzzyFilter } from "./fuzzy";
import { TILES } from "../tiles/registry";
import { searchText, type TileDefinition } from "../tiles/types";

const MAX_RESULTS = 8;

export class CommandPalette {
  readonly element: HTMLElement;
  private readonly input: HTMLInputElement;
  private readonly list: HTMLElement;
  private results: TileDefinition[] = [];
  private activeIndex = 0;
  private open = false;
  private readonly onSelect: (tile: TileDefinition) => void;

  constructor(onSelect: (tile: TileDefinition) => void) {
    this.onSelect = onSelect;

    this.input = el("input", {
      type: "text",
      class: "palette-input",
      placeholder: "Search any tool or question…",
      attrs: {
        role: "combobox",
        "aria-expanded": "true",
        "aria-controls": "palette-list",
        "aria-autocomplete": "list",
        "aria-label": "Search tools",
        autocomplete: "off",
      },
      on: {
        input: () => this.refresh(),
        keydown: (e) => this.onKeyDown(e as KeyboardEvent),
      },
    });

    this.list = el("ul", {
      id: "palette-list",
      class: "palette-list",
      attrs: { role: "listbox", "aria-label": "Search results" },
    });

    const panel = el(
      "div",
      {
        class: "palette-panel",
        attrs: { role: "dialog", "aria-modal": "true", "aria-label": "Command palette" },
      },
      this.input,
      this.list,
    );

    this.element = el(
      "div",
      {
        class: "palette-backdrop",
        hidden: true,
        on: {
          click: (e) => {
            if (e.target === this.element) this.close();
          },
        },
      },
      panel,
    );
  }

  show(): void {
    this.open = true;
    this.element.hidden = false;
    this.input.value = "";
    this.refresh();
    this.input.focus();
  }

  close(): void {
    this.open = false;
    this.element.hidden = true;
  }

  isOpen(): boolean {
    return this.open;
  }

  toggle(): void {
    if (this.open) this.close();
    else this.show();
  }

  private refresh(): void {
    const query = this.input.value;
    this.results = fuzzyFilter(query, TILES, searchText)
      .slice(0, MAX_RESULTS)
      .map((r) => r.item);
    this.activeIndex = 0;
    this.renderList();
  }

  private renderList(): void {
    clear(this.list);
    if (this.results.length === 0) {
      this.list.append(el("li", { class: "palette-empty", text: "No matching tools." }));
      this.input.setAttribute("aria-activedescendant", "");
      return;
    }
    this.results.forEach((tile, i) => {
      const active = i === this.activeIndex;
      const item = el(
        "li",
        {
          id: `palette-opt-${i}`,
          class: active ? "palette-opt palette-opt--active" : "palette-opt",
          attrs: { role: "option", "aria-selected": active ? "true" : "false" },
          on: {
            click: () => this.choose(i),
            mousemove: () => {
              if (this.activeIndex !== i) {
                this.activeIndex = i;
                this.renderList();
              }
            },
          },
        },
        el("span", { class: "palette-opt-title", text: tile.title }),
        el("span", { class: "palette-opt-desc", text: tile.description }),
        tile.status === "coming-soon"
          ? el("span", { class: "badge badge--soon", text: "soon" })
          : null,
      );
      this.list.append(item);
    });
    this.input.setAttribute("aria-activedescendant", `palette-opt-${this.activeIndex}`);
  }

  private onKeyDown(e: KeyboardEvent): void {
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        this.move(1);
        break;
      case "ArrowUp":
        e.preventDefault();
        this.move(-1);
        break;
      case "Enter":
        e.preventDefault();
        this.choose(this.activeIndex);
        break;
      case "Escape":
        e.preventDefault();
        this.close();
        break;
    }
  }

  private move(delta: number): void {
    if (this.results.length === 0) return;
    const n = this.results.length;
    this.activeIndex = (this.activeIndex + delta + n) % n;
    this.renderList();
  }

  private choose(index: number): void {
    const tile = this.results[index];
    if (!tile) return;
    this.close();
    this.onSelect(tile);
  }
}
