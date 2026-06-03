/**
 * The shared "How this works" + "Learn more" renderer (BUILD-SPEC-2). Pulled out
 * of the shell so both the per-tool explainer (which adds the privacy promise
 * after it) and a hub's active sub-tool can render the same how/resources block
 * without the shell ↔ hub import cycle. Returns null when a tile has neither.
 */
import { el } from "./dom";
import type { TileDefinition } from "../tiles/types";

export function tileHowResources(tile: TileDefinition): HTMLElement | null {
  if (!tile.how && !(tile.resources && tile.resources.length > 0)) return null;
  const section = el("section", { class: "tile-howres" });

  if (tile.how) {
    const how = el("details", { class: "explainer-how", attrs: { open: "" } });
    how.append(el("summary", { text: "How this works" }));
    for (const para of tile.how.split(/\n\n+/)) {
      how.append(el("p", { class: "explainer-para", text: para.trim() }));
    }
    section.append(how);
  }

  if (tile.resources && tile.resources.length > 0) {
    const list = el(
      "ul",
      { class: "explainer-resources" },
      ...tile.resources.map((r) =>
        el(
          "li",
          {},
          el(
            "a",
            { href: r.url, attrs: { rel: "noopener noreferrer", target: "_blank" } },
            r.label,
          ),
        ),
      ),
    );
    section.append(el("h3", { class: "explainer-subhead", text: "Learn more" }), list);
  }

  return section;
}
