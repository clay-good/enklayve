/**
 * The command palette (BUILD-SPEC.md Phase 4; the sophiewell hero search of
 * BUILD-SPEC-2 §1). A fuzzy search over every tile, reachable by Cmd/Ctrl-K or
 * the inline search bar. It is a real modal dialog with a combobox/listbox
 * pattern so it is fully keyboard operable and screen-reader legible: arrow keys
 * move the active option, Enter opens it, Escape closes.
 */
import { el, clear } from "./dom";
import { fuzzyFilter } from "./fuzzy";
import { SEARCH_ENTRIES, searchEntryText, type SearchEntry } from "../tiles/registry";

const MAX_RESULTS = 8;

export class CommandPalette {
  readonly element: HTMLElement;
  private readonly input: HTMLInputElement;
  private readonly list: HTMLElement;
  private results: SearchEntry[] = [];
  private activeIndex = 0;
  private open = false;
  /** Where focus was before the palette opened, so Escape can return it there. */
  private lastFocused: HTMLElement | null = null;
  private readonly onSelect: (entry: SearchEntry) => void;

  constructor(onSelect: (entry: SearchEntry) => void) {
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
    this.lastFocused = (document.activeElement as HTMLElement) ?? null;
    this.open = true;
    this.element.hidden = false;
    this.input.value = "";
    this.refresh();
    this.input.focus();
  }

  close(): void {
    this.open = false;
    this.element.hidden = true;
    // Return focus where it was before opening (proper modal behavior), so a
    // keyboard user who dismisses with Escape isn't dropped onto <body>. A
    // selection navigates instead and the shell then moves focus to <main>, so
    // this only meaningfully fires on dismiss; guarded by `isConnected` in case
    // the previous element was torn down.
    const prev = this.lastFocused;
    this.lastFocused = null;
    if (prev && prev !== document.body && prev.isConnected && typeof prev.focus === "function") {
      prev.focus();
    }
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
    const ranked = fuzzyFilter(query, SEARCH_ENTRIES, searchEntryText);
    const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    let chosen = ranked;
    if (tokens.length > 0) {
      // The fuzzy matcher accepts any subsequence, so a short query ("roth",
      // "aca", "thp") otherwise drags in unrelated tools via scattered character
      // hits. Prefer results where every query token appears as a contiguous
      // substring of the name/keywords (a genuine hit), and fall back to the
      // single best fuzzy match for a pure abbreviation that no substring covers
      // ("thp" → "Take-Home Pay"). The strongest match therefore always shows.
      const strong = ranked.filter((r) => {
        const text = searchEntryText(r.item).toLowerCase();
        return tokens.every((tok) => text.includes(tok));
      });
      chosen = strong.length > 0 ? strong : ranked.slice(0, 1);
    }
    this.results = chosen.slice(0, MAX_RESULTS).map((r) => r.item);
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
    this.results.forEach((entry, i) => {
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
        el("span", { class: "palette-opt-title", text: entry.title }),
        el("span", { class: "palette-opt-desc", text: entry.description }),
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
    const entry = this.results[index];
    if (!entry) return;
    this.close();
    this.onSelect(entry);
  }
}
