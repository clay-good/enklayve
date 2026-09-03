import { describe, it, expect, beforeAll } from "vitest";
import axe from "axe-core";
import { mountLifeEvents, lifeEventsTile } from "../../src/tiles/lifeEvents";
import { resolveSequences, danglingWindowIds } from "../../src/engine/sequences";
import { loadBundledData, type BundledData } from "../../src/data/browser";
import { SituationStore } from "../../src/profile/situation";
import { checkHarmTier, type AuditTile } from "../../scripts/audit-release";
import { TILES, SUB_TOOLS } from "../../src/tiles/registry";
import type { TileContext } from "../../src/tiles/types";

/**
 * Life-Event Sequences (SPEC-4 Phase 20b), harm tier 2.
 *
 * The design property under test: this tile states no deadline of its own. Every
 * dated step points into the `enrollment-windows` shard, which carries the
 * citation to the regulation that sets the clock. A duplicated deadline is a
 * deadline that will eventually be wrong in one of the two places, so the shard
 * is asserted to contain no figure at all.
 */
let data: BundledData;
beforeAll(async () => {
  data = await loadBundledData();
});

function mount(params: URLSearchParams, bundled: BundledData | null = data): HTMLElement {
  const root = document.createElement("div");
  let dest: string | null = null;
  mountLifeEvents({
    root,
    params,
    setParams: () => {},
    permalink: (p) => `https://enklayve.com/#/x?${(p ?? params).toString()}`,
    navigate: (id) => (dest = id),
    locale: "en-US",
    data: bundled,
    profile: new SituationStore(),
  } as TileContext);
  void dest;
  return root;
}

const JOB_LOSS = new URLSearchParams({ ev: "job-loss", trig: "2026-02-28", as: "2026-03-02" });
const DEATH = new URLSearchParams({ ev: "death", trig: "2026-02-28", as: "2026-03-02" });

describe("the life-events shard", () => {
  it("carries all six sequences the spec names", () => {
    expect(data.lifeEvents()!.sequences.map((s) => s.id)).toEqual([
      "job-loss",
      "death",
      "divorce",
      "disability",
      "new-child",
      "moving-states",
    ]);
  });

  it("contains no figure anywhere — every clock lives in the windows shard", () => {
    const shard = data.lifeEvents()!;
    for (const seq of shard.sequences) {
      const prose = [seq.lede, ...seq.steps.flatMap((s) => [s.label, s.detail])].join(" ");
      // No "within 60 days", no "90 days", no bare day/month counts. The one
      // number allowed through is a percentage or an ordinal in plain prose, so
      // the assertion targets duration phrasing specifically.
      expect(prose).not.toMatch(/\b\d+\s*(calendar |business )?(days?|months?|weeks?)\b/i);
      expect(prose).not.toMatch(/within \d/i);
    }
  });

  it("references only windows the enrollment-windows shard actually carries", () => {
    expect(danglingWindowIds(data.lifeEvents()!, data.enrollmentWindows()!)).toEqual([]);
  });

  it("gives every sequence at least one dated step, since the order is the value", () => {
    const seqs = resolveSequences(data.lifeEvents()!, data.enrollmentWindows()!);
    for (const seq of seqs) {
      expect(seq.steps.filter((s) => s.deadline).length).toBeGreaterThan(0);
    }
  });

  it("points every tileId at a tool that actually exists in the catalog", () => {
    // Hubs and the calculators inside them are both valid destinations.
    const known = new Set([...TILES.map((t) => t.id), ...SUB_TOOLS.map((s) => s.tile.id)]);
    const referenced = data
      .lifeEvents()!
      .sequences.flatMap((s) => s.steps)
      .map((s) => s.tileId)
      .filter((id): id is string => id !== undefined);
    expect(referenced.length).toBeGreaterThan(0);
    expect(referenced.filter((id) => !known.has(id))).toEqual([]);
  });

  it("degrades a step to a dateless instruction when its window is missing", () => {
    const windows = data.enrollmentWindows()!;
    const stripped = {
      ...windows,
      windows: windows.windows.filter((w) => w.id !== "cobra-election"),
    };
    const seqs = resolveSequences(data.lifeEvents()!, stripped);
    const step = seqs.find((s) => s.id === "job-loss")!.steps.find((s) => s.id === "cobra-decide")!;
    // The instruction survives; the invented clock does not.
    expect(step.deadline).toBeUndefined();
    expect(step.label.length).toBeGreaterThan(0);
  });
});

describe("Life-Event Sequences", () => {
  it("renders the steps in order, numbered", () => {
    const root = mount(JOB_LOSS);
    const numbers = Array.from(root.querySelectorAll(".lev-step-n")).map((n) => n.textContent);
    expect(numbers).toEqual(["1", "2", "3", "4", "5", "6", "7"]);
    expect(root.querySelector(".lev-step-label")?.textContent).toContain(
      "File for unemployment in your state, today",
    );
  });

  it("names the one-way door in the COBRA decision, with the rule that closes it", () => {
    // The sequence asked the reader to choose between COBRA and a Marketplace
    // plan and did not say the choice is hard to undo. 45 CFR §155.420(e):
    // "Loss of coverage does not include voluntary termination of coverage or
    // other loss due to (1) Failure to pay premiums on a timely basis,
    // including COBRA continuation coverage premiums prior to expiration" — so
    // electing COBRA and dropping it in March generally means waiting for open
    // enrollment. Running it out does open a window, and so does the employer
    // ceasing to pay toward the premium under (d)(15), which is the case a
    // laid-off worker on severance-funded COBRA walks into.
    const root = mount(JOB_LOSS);
    const step = [...root.querySelectorAll(".lev-step-body")].find((n) =>
      (n.textContent ?? "").includes("closes the Marketplace door"),
    );
    expect(step, "the sequence still stops short of the trap").toBeDefined();
    const text = step!.textContent ?? "";
    expect(text).toContain("dropping COBRA later does not");
    expect(text).toContain("Running COBRA out to its end does open a window");
    expect(text).toContain("ceasing to pay toward the premium");
    // A step that states a rule of its own carries the rule; the others point
    // at the enrollment-window shard, where their clocks are cited.
    expect(step!.querySelector(".lev-step-cite a")?.getAttribute("href")).toContain("155.420");
  });

  it("renders every clock through renderDeadline, each with its source link", () => {
    const root = mount(JOB_LOSS);
    const nodes = Array.from(root.querySelectorAll("[data-deadline]"));
    expect(nodes.length).toBeGreaterThan(0);
    for (const n of nodes) expect(n.querySelector("a.cite-link")).not.toBeNull();
  });

  it("counts the clocks from the dates the user set", () => {
    const text = mount(JOB_LOSS).textContent ?? "";
    // 60 days from 2026-02-28 is 2026-04-29.
    expect(text).toContain("Due Apr 29, 2026");
    expect(text).toContain("Counted from Mar 2, 2026.");
    expect(text).toContain("counted from the day your job ended (2026-02-28) against 2026-03-02");
  });

  it("marks which steps are dated and says how many", () => {
    const root = mount(JOB_LOSS);
    expect(root.querySelectorAll(".lev-step--dated").length).toBeGreaterThan(0);
    expect(root.textContent).toMatch(/steps here have a clock on them/);
  });

  it("says plainly that the ordering is judgment, not a published rule", () => {
    const text = mount(DEATH).textContent ?? "";
    expect(text).toContain("The order does not — it is our judgment");
    expect(text).toContain("your own notice is the authority on your own deadline");
  });

  it("names the coverage clock a death starts, the one nobody mentions", () => {
    const text = mount(DEATH).textContent ?? "";
    expect(text).toContain("your own window has already started");
    expect(text).toContain("the one nobody mentions");
    // The window itself is stated once, by the cited clock beneath the step.
    expect(text).toContain("Due Apr 29, 2026");
  });

  it("never tells someone to pay a deceased person's debts", () => {
    const text = mount(DEATH).textContent ?? "";
    expect(text).toContain("Do not pay their debts from your own money before you get advice");
  });

  it("does not imply there is time when the data is missing", () => {
    const root = mount(JOB_LOSS, null);
    expect(root.querySelector(".verify-banner")?.textContent).toContain(
      "those are the steps with clocks on them",
    );
    expect(root.querySelectorAll("[data-deadline]")).toHaveLength(0);
  });

  it("clears the tier-2 bar", () => {
    expect(checkHarmTier([lifeEventsTile as AuditTile])).toEqual([]);
    expect(lifeEventsTile.harmTier).toBe(2);
    expect(lifeEventsTile.how).toMatch(/not legal, tax, or financial advice/i);
  });

  it("has no axe violations", async () => {
    const root = mount(JOB_LOSS);
    document.body.append(root);
    const results = await axe.run(root, { rules: { "color-contrast": { enabled: false } } });
    expect(results.violations.map((v) => v.id).join(", ")).toBe("");
    document.body.replaceChildren();
  }, 30000);
});
