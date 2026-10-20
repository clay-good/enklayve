/**
 * A tile whose code and shards load when it is opened (SPEC-5 §7.5).
 *
 * The definition — id, title, keywords, the "how" block — stays in the shell,
 * because search, the hub, and the crawlable tool pages read it before any tool
 * is opened. The mount function and the shards it reads are imported on first
 * use: the code as a same-origin script chunk, each shard through
 * `loadDeferred`, which checks it against the manifest hash like any other.
 * Once both have arrived, later mounts are synchronous.
 *
 * A load that resolves after the reader has moved on is dropped: the
 * placeholder it would replace is gone, so whatever replaced it stays.
 */
import { el } from "../ui/dom";
import type { BundledData } from "../data/browser";
import type { TileContext, TileDefinition } from "./types";

type Mount = (ctx: TileContext) => void;

interface LazyTile {
  load: () => Promise<Mount>;
  shards: readonly string[];
  mount?: Mount;
}

const LAZY: LazyTile[] = [];
const HOWS: TileDefinition[] = [];

function shardsReady(data: BundledData | null, shards: readonly string[]): boolean {
  return !data || shards.every((id) => data.loadedDeferred(id) !== undefined);
}

export function lazyMount(load: () => Promise<Mount>, shards: readonly string[] = []): Mount {
  const tile: LazyTile = { load, shards };
  LAZY.push(tile);
  return (ctx) => {
    if (tile.mount && shardsReady(ctx.data, shards)) {
      tile.mount(ctx);
      return;
    }
    const placeholder = el("p", {
      class: "tile-loading",
      attrs: { role: "status", "aria-busy": "true" },
      text: "Loading this tool…",
    });
    ctx.root.replaceChildren(placeholder);
    const data = ctx.data;
    Promise.all([
      tile.mount ? Promise.resolve(tile.mount) : tile.load(),
      ...(data ? shards.map((id) => data.loadDeferred(id)) : []),
    ]).then(
      ([mount]) => {
        tile.mount = mount;
        if (ctx.root.contains(placeholder)) mount(ctx);
      },
      () => {
        if (!ctx.root.contains(placeholder)) return;
        ctx.root.replaceChildren(
          el("div", {
            class: "verify-banner",
            attrs: { role: "alert" },
            text: "This tool could not load. Check your connection and reload the page; once it has loaded, it works offline.",
          }),
        );
      },
    );
  };
}

/**
 * A tile whose code, shards and "how" block all load when it is opened. Only
 * the title, description, keywords and the rest of the definition stay in the
 * shell; `loadHow` fills in `how` for the explainer, the hub's audit copy and
 * the build's crawlable page, each of which waits for it.
 */
export function lazyTile(
  definition: Omit<TileDefinition, "mount" | "how" | "loadHow">,
  parts: { view: () => Promise<Mount>; shards?: readonly string[]; how: () => Promise<string> },
): TileDefinition {
  const tile: TileDefinition = {
    ...definition,
    mount: lazyMount(parts.view, parts.shards ?? []),
    loadHow: async () => (tile.how ??= await parts.how()),
  };
  HOWS.push(tile);
  return tile;
}

/** Every lazy "how" block, loaded into its tile — for the build and the tests. */
export async function loadLazyHows(): Promise<void> {
  await Promise.all(HOWS.map((t) => t.loadHow?.()));
}

/**
 * Load every lazy tile's code and shards now, so later mounts are synchronous.
 * The test setup calls this, so the sweeps that mount every tile and read the
 * result at once cover a lazy tile as fully as an eager one.
 */
export async function preloadLazyTiles(data: BundledData): Promise<void> {
  await loadLazyHows();
  await Promise.all(
    LAZY.map(async (tile) => {
      tile.mount ??= await tile.load();
      await Promise.all(tile.shards.map((id) => data.loadDeferred(id)));
    }),
  );
}

/** How many tiles load this way, so a test can assert the sweeps reached them. */
export function lazyTileCount(): number {
  return LAZY.length + HOWS.length;
}
