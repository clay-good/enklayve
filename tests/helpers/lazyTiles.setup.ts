import { beforeAll } from "vitest";
import { loadBundledData } from "../../src/data/browser";
import { lazyTileCount, preloadLazyTiles } from "../../src/tiles/lazy";

/**
 * The lazy tiles this test file imported, loaded before its tests run. Setup
 * hooks run after the file's own imports, so a file that never reaches a lazy
 * tile pays nothing here.
 */
beforeAll(async () => {
  if (lazyTileCount() > 0) await preloadLazyTiles(await loadBundledData());
});
