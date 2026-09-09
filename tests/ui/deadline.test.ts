import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { renderDeadline, renderDeadlineList, todayIso } from "../../src/ui/deadline";
import type { Deadline } from "../../src/engine/deadline";
import type { CitationData } from "../../src/data/schemas";

/**
 * The structural half of SPEC-4 §4 addition 11: a deadline reaches the screen
 * through exactly one helper, and that helper always paints the citation and
 * the "as of" date. The assertion that matters is the last one in the file —
 * every `[data-deadline]` node carries a source link.
 */
const CITATION: CitationData = {
  sourceUrl: "https://www.dol.gov/agencies/ebsa/laws-and-regulations/laws/cobra",
  sourceDocument: "COBRA continuation coverage (ERISA)",
  effectiveYear: 2026,
  dateRetrieved: "2026-08-28",
};

const OPTS = { asOf: "2026-09-01", locale: "en-US" };

const fixed: Deadline = {
  label: "File the appeal",
  due: { on: "2026-09-20" },
  citation: CITATION,
};

describe("renderDeadline", () => {
  it("shows the label, the due date, and the days left", () => {
    const node = renderDeadline(fixed, OPTS);
    expect(node.textContent).toContain("File the appeal");
    expect(node.textContent).toContain("Sep 20, 2026");
    expect(node.textContent).toContain("19 days left");
  });

  it("always paints the citation as a source link", () => {
    const link = renderDeadline(fixed, OPTS).querySelector<HTMLAnchorElement>("a.cite-link");
    expect(link).not.toBeNull();
    expect(link!.href).toBe(CITATION.sourceUrl);
  });

  it("displays the asOf date, because the clock is an input not an assumption", () => {
    expect(renderDeadline(fixed, OPTS).textContent).toContain("Counted from Sep 1, 2026");
  });

  it("states an unresolved window plainly instead of inventing a date", () => {
    const windowed: Deadline = {
      label: "Elect COBRA coverage",
      due: { daysFromTrigger: 60, trigger: "the date coverage ended" },
      citation: CITATION,
    };
    const text = renderDeadline(windowed, OPTS).textContent ?? "";
    expect(text).toContain("Within 60 days of the date coverage ended");
    expect(text).not.toMatch(/\d{4}\b.*days left/);
  });

  it("says a federal floor is a floor, so it is never read as a ceiling", () => {
    const node = renderDeadline({ ...fixed, isFloor: true }, OPTS);
    expect(node.textContent).toContain("federal minimum");
    expect(node.textContent).toContain("may allow longer");
  });

  it("renders a past deadline honestly rather than hiding it", () => {
    const node = renderDeadline({ ...fixed, due: { on: "2026-08-20" } }, OPTS);
    expect(node.className).toContain("deadline--past");
    expect(node.textContent).toContain("12 days ago");
  });

  it("links a free channel to act through when one is given", () => {
    const node = renderDeadline(
      { ...fixed, channel: { label: "Marketplace appeals", url: "https://www.healthcare.gov/" } },
      OPTS,
    );
    const link = node.querySelector<HTMLAnchorElement>(".deadline__channel a");
    expect(link?.textContent).toBe("Marketplace appeals");
  });
});

describe("renderDeadlineList", () => {
  const list = renderDeadlineList(
    [
      { ...fixed, label: "Later", due: { on: "2026-12-01" } },
      {
        ...fixed,
        label: "No trigger yet",
        due: { daysFromTrigger: 60, trigger: "coverage ended" },
      },
      { ...fixed, label: "Soonest", due: { on: "2026-09-03" } },
    ],
    OPTS,
  );

  it("orders soonest first and unresolved last", () => {
    const labels = [...list.querySelectorAll(".deadline__label")].map((n) => n.textContent);
    expect(labels).toEqual(["Soonest", "Later", "No trigger yet"]);
  });

  it("gives every rendered deadline a source link (SPEC-4 §4, addition 11)", () => {
    const nodes = [...list.querySelectorAll("[data-deadline]")];
    expect(nodes.length).toBe(3);
    for (const node of nodes) {
      expect(node.querySelector("a.cite-link")).not.toBeNull();
    }
  });
});

describe("today, on the reader's own wall", () => {
  // CI runs in UTC, where local and UTC dates never differ — so a test that
  // takes the runner's zone as given would have passed on the broken code in
  // the only place it actually runs. Node re-reads `process.env.TZ`, so the
  // zone is an input here rather than an inheritance: this is the same rule
  // the shell-budget gate had to learn, one directory over.
  const REAL_TZ = process.env.TZ;
  beforeEach(() => {
    process.env.TZ = "America/Los_Angeles";
  });
  afterEach(() => {
    if (REAL_TZ === undefined) delete process.env.TZ;
    else process.env.TZ = REAL_TZ;
    vi.useRealTimers();
  });

  it("is the local date, not the UTC one", () => {
    // `toISOString()` is UTC, and this used it: from about 5 p.m. Pacific
    // onward — 8 p.m. Eastern — UTC has already rolled over, so "today" was
    // tomorrow for the whole west-coast evening. On a payoff horizon that is a
    // rounding error; on the last evening of a COBRA election or an ACA
    // special-enrollment window, `deadlineStatus` calls the window past and
    // tells somebody a door that is open has closed.
    //
    // 04:00 UTC on 2 March is 8 p.m. on 1 March in Los Angeles.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-02T04:00:00Z"));
    const now = new Date();
    const local = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(
      now.getDate(),
    ).padStart(2, "0")}`;
    expect(todayIso()).toBe(local);
    // The whole point: at this instant the two answers differ, and the UTC one
    // is tomorrow.
    expect(new Date().toISOString().slice(0, 10)).toBe("2026-03-02");
    expect(todayIso()).toBe("2026-03-01");
  });

  it("agrees with the platform's own local-date formatting, wherever it runs", () => {
    // en-CA formats as YYYY-MM-DD, so this is the same question asked of Intl
    // rather than of arithmetic — and it holds in any timezone the suite runs
    // in, including UTC, where the old implementation also happened to pass.
    vi.useFakeTimers();
    for (const instant of [
      "2026-03-02T04:00:00Z",
      "2026-12-31T23:30:00Z",
      "2026-07-04T12:00:00Z",
    ]) {
      vi.setSystemTime(new Date(instant));
      expect(todayIso(), instant).toBe(new Date().toLocaleDateString("en-CA"));
    }
  });
});
