import { describe, it, expect, beforeAll } from "vitest";
import { loadManifest, needsVerifyBanner } from "../../src/data/loader";
import { loadBundledData, type BundledData } from "../../src/data/browser";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ManifestSchema } from "../../src/data/schemas";
import { renderDeadline } from "../../src/ui/deadline";
import { enrollmentWindows } from "../../src/engine/sequences";
import { resolveSequences } from "../../src/engine/sequences";
import { staleBanner } from "../../src/ui/staleBanner";

/**
 * The staleness gate, end to end (SPEC-3 §2.5, SPEC-4 §10.5).
 *
 * The loader has always marked a dataset whose effective year fell outside its
 * window. Nothing consumed that, so a shard could pass its window and keep
 * producing figures that looked exactly as current as the rest — which is the
 * failure the window exists to prevent, and matters most for the Pillar 4
 * shards pinned at `staleAfterYears: 0`.
 */
const DATA_DIR = resolve(__dirname, "..", "..", "data");

function readShard(file: string): string {
  return readFileSync(resolve(DATA_DIR, file), "utf8");
}

let data: BundledData;
beforeAll(async () => {
  data = await loadBundledData();
});

/** A BundledData stand-in that reports exactly the stale datasets given. */
function withStale(stale: { id: string; effectiveYear: number }[]): BundledData {
  return { ...data, staleDatasets: () => stale } as BundledData;
}

/** A BundledData stand-in reporting datasets that failed their integrity gate. */
function withInvalid(invalid: { id: string; problems: string[] }[]): BundledData {
  return { ...data, invalidDatasets: () => invalid } as BundledData;
}

describe("the staleness gate reaches the screen", () => {
  it("reports nothing stale in a healthy build", () => {
    expect(data.staleDatasets()).toEqual([]);
  });

  it("renders no banner when nothing is stale — a warning that cries wolf is ignored", () => {
    expect(staleBanner(data)).toBeNull();
    expect(staleBanner(null)).toBeNull();
  });

  it("names the stale datasets rather than gesturing at 'some data'", () => {
    const node = staleBanner(
      withStale([
        { id: "enrollment-windows-2026", effectiveYear: 2026 },
        { id: "garnishment-limits-2026", effectiveYear: 2026 },
      ]),
    );
    const text = node?.textContent ?? "";
    expect(node?.getAttribute("role")).toBe("alert");
    expect(text).toContain("Verify before relying on these figures");
    expect(text).toContain("2 datasets");
    expect(text).toContain("enrollment-windows-2026 (2026)");
    expect(text).toContain("garnishment-limits-2026 (2026)");
    expect(text).toContain("check the source link");
  });

  it("reads correctly for a single stale dataset", () => {
    const text =
      staleBanner(withStale([{ id: "no-surprises-2026", effectiveYear: 2026 }]))?.textContent ?? "";
    expect(text).toContain("1 dataset on this site has passed");
    expect(text).not.toContain("datasets");
  });

  it("reports nothing invalid in a healthy build", () => {
    expect(data.invalidDatasets()).toEqual([]);
  });

  it("says an integrity failure is an integrity failure, not staleness", () => {
    // A stale figure is merely old. An invalid one did not match the content
    // hash the manifest pins, which means the bytes are not the bytes that were
    // reviewed — calling that "out of date" would understate it badly.
    const node = withInvalid([
      { id: "federal-income-tax-2024", problems: ["content hash mismatch (expected ab12…)"] },
    ]);
    const text = staleBanner(node)?.textContent ?? "";
    expect(text).toContain("failed its integrity check");
    expect(text).toContain("federal-income-tax-2024");
    expect(text).toContain("content hash mismatch");
    expect(text).toContain("do not rely on anything here");
    expect(text).not.toContain("may be out of date");
  });

  it("reports an integrity failure ahead of a staleness one", () => {
    const both = {
      ...data,
      invalidDatasets: () => [{ id: "fica-2024", problems: ["schema validation failed"] }],
      staleDatasets: () => [{ id: "snap-fy2024-contiguous", effectiveYear: 2024 }],
    } as BundledData;
    const node = staleBanner(both);
    expect(node?.className).toContain("stale-banner--invalid");
    expect(node?.textContent).toContain("failed its integrity check");
  });

  it("marks a dataset stale once its window passes, and names it", async () => {
    const manifest = ManifestSchema.parse(JSON.parse(readShard("manifest.json")));
    const shards: Record<string, string> = {};
    for (const entry of manifest.datasets) shards[entry.id] = readShard(entry.shard);

    // Fast-forward the clock far enough that every window has lapsed.
    const future = await loadManifest(manifest, shards, 2099);
    const stale = future.datasets.filter((d) => d.status === "stale");
    expect(stale.length).toBeGreaterThan(0);
    for (const d of stale) {
      expect(needsVerifyBanner(d.status)).toBe(true);
      // A stale dataset still carries its data — which is exactly why the
      // banner has to exist: the figure renders either way.
      expect(d.data).not.toBeNull();
    }
  });

  it("puts every Pillar 4 shard on a zero-year window, so it lapses immediately", () => {
    const manifest = ManifestSchema.parse(JSON.parse(readShard("manifest.json")));
    const pillar4 = [
      "bill-triage-2026",
      "free-filing-2026",
      "no-surprises-2026",
      "garnishment-limits-2026",
      "enrollment-windows-2026",
      "life-events-2026",
    ];
    for (const id of pillar4) {
      const entry = manifest.datasets.find((d) => d.id === id);
      expect(entry, `${id} is missing from the manifest`).toBeDefined();
      // These are the highest-harm figures on the site: they must go stale the
      // moment their year passes, not a grace period later.
      expect(entry!.staleAfterYears).toBe(0);
    }
  });
});

/**
 * SPEC-4 §7.3 / §10.5: every dated obligation reaches the screen through
 * `renderDeadline`, which is the single path that guarantees a source link. The
 * assertion runs over the real shard rather than a fixture, so a window added
 * later without a citation fails here.
 */
describe("every deadline the site can render carries its source", () => {
  it("renders a source link for every window in the shard", () => {
    const windows = enrollmentWindows(data.enrollmentWindows()!);
    expect(windows.length).toBeGreaterThan(0);
    for (const w of windows) {
      const node = renderDeadline(w.deadline, { asOf: "2026-03-02", locale: "en-US" });
      expect(node.getAttribute("data-deadline")).not.toBeNull();
      const link = node.querySelector("a.cite-link");
      expect(link, `${w.id} rendered without a source link`).not.toBeNull();
      expect(link!.getAttribute("href")).toMatch(/^https:\/\//);
    }
  });

  it("renders a source link for every clock a life-event sequence attaches", () => {
    const sequences = resolveSequences(data.lifeEvents()!, data.enrollmentWindows()!);
    const dated = sequences.flatMap((s) => s.steps).filter((s) => s.deadline);
    expect(dated.length).toBeGreaterThan(0);
    for (const step of dated) {
      const node = renderDeadline(step.deadline!, { asOf: "2026-03-02", locale: "en-US" });
      expect(node.querySelector("a.cite-link")).not.toBeNull();
    }
  });

  it("only ever renders 'at least' for a window that is genuinely a floor", () => {
    for (const w of enrollmentWindows(data.enrollmentWindows()!)) {
      const node = renderDeadline(w.deadline, {
        asOf: "2026-03-02",
        locale: "en-US",
        // No trigger date, so the timing line reads as the raw window — which
        // is where the "at least" wording appears.
      });
      const text = node.textContent ?? "";
      if (w.isCeiling) {
        expect(text, `${w.id} is a ceiling but rendered as a minimum`).not.toContain("at least");
        expect(text).not.toContain("This is the federal minimum");
      }
    }
  });
});
