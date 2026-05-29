/**
 * The tiny vanilla render layer (BUILD-SPEC.md §6, §12). No UI framework: a
 * handful of typed DOM helpers keep the bundle small and the determinism
 * obvious. `el` is a hyperscript-style element factory; the rest are small
 * conveniences used across the shell, the tiles, and the command palette.
 */

/** Attributes/props accepted by {@link el}. */
export interface ElAttrs {
  class?: string;
  id?: string;
  type?: string;
  href?: string;
  title?: string;
  /** Inline text content (escaped by the DOM — never interpreted as HTML). */
  text?: string;
  value?: string | number;
  name?: string;
  placeholder?: string;
  min?: string | number;
  max?: string | number;
  step?: string | number;
  disabled?: boolean;
  checked?: boolean;
  hidden?: boolean;
  /** ARIA and data-* attributes, set verbatim via setAttribute. */
  attrs?: Record<string, string>;
  /** Event listeners keyed by event name (without the "on" prefix). */
  on?: Partial<Record<keyof HTMLElementEventMap, (ev: Event) => void>>;
  dataset?: Record<string, string>;
}

export type Child = Node | string | null | undefined | false;

/**
 * Create an element with attributes and children. Strings become text nodes,
 * so user-derived content can never be interpreted as HTML (no innerHTML
 * anywhere in the shell — an XSS-by-construction guarantee).
 */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: ElAttrs = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);

  if (attrs.class !== undefined) node.className = attrs.class;
  if (attrs.id !== undefined) node.id = attrs.id;
  if (attrs.title !== undefined) node.title = attrs.title;
  if (attrs.text !== undefined) node.textContent = attrs.text;
  if (attrs.hidden) node.hidden = true;

  if (node instanceof HTMLInputElement) {
    if (attrs.type !== undefined) node.type = attrs.type;
    if (attrs.value !== undefined) node.value = String(attrs.value);
    if (attrs.name !== undefined) node.name = attrs.name;
    if (attrs.placeholder !== undefined) node.placeholder = attrs.placeholder;
    if (attrs.min !== undefined) node.min = String(attrs.min);
    if (attrs.max !== undefined) node.max = String(attrs.max);
    if (attrs.step !== undefined) node.step = String(attrs.step);
    if (attrs.disabled) node.disabled = true;
    if (attrs.checked) node.checked = true;
  } else if (node instanceof HTMLButtonElement) {
    if (attrs.type !== undefined) node.type = attrs.type as HTMLButtonElement["type"];
    if (attrs.disabled) node.disabled = true;
  } else if (node instanceof HTMLAnchorElement) {
    if (attrs.href !== undefined) node.href = attrs.href;
  } else if (node instanceof HTMLSelectElement) {
    if (attrs.name !== undefined) node.name = attrs.name;
    if (attrs.disabled) node.disabled = true;
  }

  if (attrs.attrs) {
    for (const [key, val] of Object.entries(attrs.attrs)) node.setAttribute(key, val);
  }
  if (attrs.dataset) {
    for (const [key, val] of Object.entries(attrs.dataset)) node.dataset[key] = val;
  }
  if (attrs.on) {
    for (const [event, handler] of Object.entries(attrs.on)) {
      if (handler) node.addEventListener(event, handler as EventListener);
    }
  }

  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    node.append(typeof child === "string" ? document.createTextNode(child) : child);
  }

  return node;
}

/** Build a labeled <option>. */
export function option(value: string, label: string, selected = false): HTMLOptionElement {
  const opt = el("option", { text: label });
  opt.value = value;
  opt.selected = selected;
  return opt;
}

/** Remove all children of a node. */
export function clear(node: Node): void {
  while (node.firstChild) node.removeChild(node.firstChild);
}

/** Copy text to the clipboard, returning whether it succeeded. Never throws. */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
