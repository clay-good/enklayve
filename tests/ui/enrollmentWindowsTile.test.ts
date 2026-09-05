import { describe, it, expect, beforeAll } from "vitest";
import axe from "axe-core";
import { mountEnrollmentWindows, enrollmentWindowsTile } from "../../src/tiles/enrollmentWindows";
import { resolveDueDate } from "../../src/engine/deadline";
import { enrollmentWindows, programsIn } from "../../src/engine/sequences";
import { loadBundledData, type BundledData } from "../../src/data/browser";
import { SituationStore } from "../../src/profile/situation";
import { checkHarmTier, type AuditTile } from "../../scripts/audit-release";
import type { TileContext } from "../../src/tiles/types";

/**
 * Enrollment & Appeal Windows (SPEC-4-safety-net §B4), harm tier 2.
 *
 * These are the highest-harm numbers on the site, and the tests are written
 * against the two ways this page could hurt someone: rendering a ceiling as if
 * it were a floor, and inventing a state figure there is no federal number for.
 */
let data: BundledData;
beforeAll(async () => {
  data = await loadBundledData();
});

function mount(params: URLSearchParams, bundled: BundledData | null = data): HTMLElement {
  const root = document.createElement("div");
  mountEnrollmentWindows({
    root,
    params,
    setParams: () => {},
    permalink: (p) => `https://enklayve.com/#/x?${(p ?? params).toString()}`,
    navigate: () => {},
    locale: "en-US",
    data: bundled,
    profile: new SituationStore(),
  } as TileContext);
  return root;
}

const COBRA = new URLSearchParams({ prog: "COBRA", trig: "2026-02-28", as: "2026-03-02" });
const MEDICAID = new URLSearchParams({ prog: "Medicaid", trig: "2026-02-28", as: "2026-03-02" });
const MEDICARE = new URLSearchParams({ prog: "Medicare", trig: "2026-02-28", as: "2026-03-02" });

describe("the enrollment-windows shard and its mapping", () => {
  it("gives every window its own citation, not just the shard's", () => {
    const shard = data.enrollmentWindows()!;
    for (const w of shard.windows) {
      expect(w.citation.sourceUrl.length).toBeGreaterThan(0);
      expect(w.citation.sourceDocument).toMatch(/(U\.S\.C\.|CFR)/);
      // Every clock cites the *section* that sets it, not a summary of it: the
      // document name carries a section number, and the note quotes the rule.
      expect(w.citation.sourceDocument).toMatch(/§+\s?\d/);
      expect((w.citation.sourceNote ?? "").length).toBeGreaterThan(40);
    }
    // ...and the shard-level citation names the set rather than standing in for
    // any one of them.
    expect(shard.citation.sourceDocument).toContain("Federal enrollment and appeal windows");
  });

  it("carries state-set clocks as pointers with no figure in them", () => {
    const shard = data.enrollmentWindows()!;
    expect(shard.stateSet.length).toBeGreaterThan(0);
    for (const s of shard.stateSet) {
      // The 50-jurisdiction problem must not leak back in as a plausible default.
      expect(s.note).not.toMatch(/\b\d+\s*(calendar |business )?days\b/i);
      expect(s.note).not.toMatch(/within \d+/i);
    }
  });

  it("marks a floor as a floor and a ceiling as neither", () => {
    const shard = data.enrollmentWindows()!;
    const all = enrollmentWindows(shard);
    const cobra = all.find((w) => w.id === "cobra-election")!;
    expect(cobra.deadline.isFloor).toBe(true);
    expect(cobra.isCeiling).toBe(false);

    // 42 CFR §431.221(d) gives a "reasonable time, not to exceed 90 days" — the
    // most a state must allow. Rendering it as "at least 90 days" would invert it.
    const medicaid = all.find((w) => w.id === "medicaid-fair-hearing")!;
    expect(medicaid.isCeiling).toBe(true);
    expect(medicaid.deadline.isFloor).toBeUndefined();
  });

  it("does not call the Marketplace appeal a floor, because a state can make it shorter", () => {
    // 45 CFR §155.520(b): the Exchange must allow an appeal within 90 days of
    // the notice, OR a timeframe consistent with the state Medicaid agency's
    // requirement, "provided that timeframe is no less than 30 days". So 90 is
    // the outer edge and a State-based Exchange may run 30. Marked a floor, the
    // page said "at least 90 days" and added "your plan, state, or
    // administrator may allow longer" — directly above its own paragraph saying
    // the state's timeframe can be shorter. Two halves of one card, and the
    // wrong half was the headline, on a deadline whose miss is final.
    const all = enrollmentWindows(data.enrollmentWindows()!);
    const appeal = all.find((w) => w.id === "marketplace-appeal")!;
    expect(appeal.isCeiling).toBe(true);
    expect(appeal.deadline.isFloor).toBeUndefined();
    expect(appeal.detail).toContain("never less than 30 days");
  });

  it("cites the Part B special enrollment period to the Part B section", () => {
    // The eight months are right and the section was not: 42 CFR §406.24 sits
    // in Part 406, "Hospital Insurance Eligibility and Entitlement", subpart C
    // — premium Part A. The Part B (SMI) SEP is §407.20, which takes the SEP's
    // definition and duration from §406.24(a)(4). A reader following the link
    // to check a Part B deadline landed on the Part A rule; every other
    // Medicare window in this shard already cited Part 407.
    const all = enrollmentWindows(data.enrollmentWindows()!);
    const sep = all.find((w) => w.id === "medicare-part-b-sep")!;
    expect(sep.deadline.citation.sourceDocument).toContain("407.20");
    expect(sep.deadline.citation.sourceUrl).toContain("part-407");
    // Every Medicare window points at the part that governs its own program.
    for (const w of all.filter((x) => x.program === "Medicare")) {
      expect(w.deadline.citation.sourceUrl, `${w.id} cites the wrong CFR part`).toContain(
        "part-407",
      );
    }
  });

  it("counts the Medicare periods in calendar months, not an approximation in days", () => {
    const shard = data.enrollmentWindows()!;
    const iep = enrollmentWindows(shard)
      .filter((w) => w.program === "Medicare")
      .find((w) => w.id === "medicare-initial-enrollment")!;
    // Three months from the last day of February 2026 is the last day of May.
    expect(resolveDueDate(iep.deadline.due, "2026-02-28")).toBe("2026-05-28");
    // ...and from the last day of a 31-day month, the last day of a 30-day one.
    expect(resolveDueDate(iep.deadline.due, "2026-01-31")).toBe("2026-04-30");

    const sep = enrollmentWindows(shard)
      .filter((w) => w.program === "Medicare")
      .find((w) => w.id === "medicare-part-b-sep")!;
    expect(resolveDueDate(sep.deadline.due, "2026-01-31")).toBe("2026-09-30");
  });

  it("lists every program the shard carries", () => {
    expect(programsIn(data.enrollmentWindows()!)).toEqual([
      "COBRA",
      "Marketplace",
      "Medicare",
      "Medicaid",
      "SNAP",
    ]);
  });
});

describe("Enrollment & Appeal Windows", () => {
  it("renders every clock through renderDeadline, each with a source link", () => {
    const root = mount(COBRA);
    const nodes = Array.from(root.querySelectorAll("[data-deadline]"));
    expect(nodes.length).toBeGreaterThan(0);
    for (const n of nodes) {
      expect(n.querySelector("a.cite-link")).not.toBeNull();
    }
  });

  it("counts from the date the user set, and says so", () => {
    const root = mount(COBRA);
    const text = root.textContent ?? "";
    expect(text).toContain("counted from 2026-03-02");
    // 60 days from 2026-02-28 is 2026-04-29, and every clock says which date it
    // was counted from, so a saved link reproduces exactly what it showed.
    expect(text).toContain("Due Apr 29, 2026");
    expect(text).toContain("Counted from Mar 2, 2026.");
  });

  it("recomputes when the clock changes, so the page is a function of its inputs", () => {
    const later = mount(
      new URLSearchParams({ prog: "COBRA", trig: "2026-02-28", as: "2026-04-20" }),
    );
    expect(later.textContent).toContain("9 days left");
    const past = mount(
      new URLSearchParams({ prog: "COBRA", trig: "2026-02-28", as: "2026-06-01" }),
    );
    expect(past.textContent).toContain("days ago");
  });

  it("marks a federal floor as a minimum a plan may exceed", () => {
    const text = mount(COBRA).textContent ?? "";
    expect(text).toContain("This is the federal minimum");
    expect(text).toContain("may allow longer");
  });

  it("never calls a ceiling a minimum, and says the state may allow less", () => {
    const text = mount(MEDICAID).textContent ?? "";
    // The floor caveat must be absent here: 90 days is the most a state must
    // allow, so "this is the federal minimum" would invert the rule.
    expect(text).not.toContain("This is the federal minimum");
    expect(text).toContain("This is the most your state has to allow, not a promise");
    expect(text).toContain("Due May 29, 2026");
  });

  it("names the clocks it will not guess", () => {
    const text = mount(COBRA).textContent ?? "";
    expect(text).toContain("Clocks your state sets, which we will not guess");
    expect(text).toContain("Appeal an unemployment determination");
  });

  it("surfaces a published rule change that has not taken effect yet", () => {
    const text = mount(COBRA).textContent ?? "";
    expect(text).toContain("Already published, not yet in effect");
    expect(text).toContain("2027");
  });

  it("tells the user to act on their own notice when the two disagree", () => {
    const text = mount(MEDICARE).textContent ?? "";
    expect(text).toContain("act on whichever is sooner");
  });

  it("does not tell someone they have time when the data is missing", () => {
    const root = mount(COBRA, null);
    const banner = root.querySelector(".verify-banner")?.textContent ?? "";
    expect(banner).toContain("Do not assume you have time");
    expect(root.querySelectorAll("[data-deadline]")).toHaveLength(0);
  });

  it("clears the tier-2 bar: the advice line is present", () => {
    expect(checkHarmTier([enrollmentWindowsTile as AuditTile])).toEqual([]);
    expect(enrollmentWindowsTile.harmTier).toBe(2);
    expect(enrollmentWindowsTile.how).toMatch(/not legal or financial advice/i);
  });

  it("has no axe violations", async () => {
    const root = mount(MEDICARE);
    document.body.append(root);
    const results = await axe.run(root, { rules: { "color-contrast": { enabled: false } } });
    expect(results.violations.map((v) => v.id).join(", ")).toBe("");
    document.body.replaceChildren();
  }, 30000);
});
