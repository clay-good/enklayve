import { describe, it, expect } from "vitest";
import { renderDeadline, renderDeadlineList } from "../../src/ui/deadline";
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
