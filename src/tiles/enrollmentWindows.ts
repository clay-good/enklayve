/**
 * Enrollment & Appeal Windows (SPEC-4-safety-net §B4) — harm tier 2.
 *
 * The highest-harm numbers on the site. A missed COBRA election costs the
 * coverage itself; a missed Part B special enrollment period costs a penalty
 * for life; a missed fair-hearing request costs the benefit. So every clock
 * here renders through `renderDeadline` (SPEC-4 §7.3), carries the section that
 * sets it, and is counted from an `asOf` date that is an **input** — shown on
 * screen and encoded in the deep link — never `Date.now()`.
 *
 * Two things this tile refuses to do. It does not state a state's appeal window,
 * because there is no federal figure to state and a plausible default is worse
 * than a pointer. And it never renders a ceiling as if it were a floor: the
 * Medicaid fair-hearing period is the *most* a state must allow, and the tile
 * says so in words directly beneath the clock.
 */
import { enrollmentWindows, programsIn, type EnrollmentWindow } from "../engine/sequences";
import { el, option } from "../ui/dom";
import { field, tryExampleButton } from "../ui/form";
import { renderDeadline } from "../ui/deadline";
import type { EnrollmentWindowsData } from "../data/schemas";
import { citationLink } from "../ui/resultCard";
import type { TileContext, TileDefinition } from "./types";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** The worked example: a job ended, and the clocks that starts. */
const EXAMPLE = { asOf: "2026-03-02", trigger: "2026-02-28", program: "COBRA" };

interface Fields {
  /** The clock, as an explicit input (SPEC-4 §7.3) — never `Date.now()`. */
  asOf: string;
  /** The date the triggering event happened, for the window-style clocks. */
  trigger: string;
  program: string;
}

function readDate(raw: string | null, fallback: string): string {
  return raw !== null && ISO_DATE.test(raw) ? raw : fallback;
}

function readFields(p: URLSearchParams, programs: string[]): Fields {
  const program = p.get("prog");
  return {
    asOf: readDate(p.get("as"), EXAMPLE.asOf),
    trigger: readDate(p.get("trig"), EXAMPLE.trigger),
    program: program && programs.includes(program) ? program : (programs[0] ?? EXAMPLE.program),
  };
}

function writeFields(f: Fields): URLSearchParams {
  const p = new URLSearchParams();
  p.set("as", f.asOf);
  p.set("trig", f.trigger);
  p.set("prog", f.program);
  return p;
}

export function mountEnrollmentWindows(ctx: TileContext): void {
  const { root, data } = ctx;
  root.replaceChildren();

  const shard = data?.enrollmentWindows() ?? null;
  if (!shard) {
    root.append(
      el("div", {
        class: "verify-banner",
        attrs: { role: "alert" },
        text: "The enrollment-window data is unavailable, so no dates are shown here. Do not assume you have time: call your plan administrator, your state agency, or 1-800-MEDICARE today and ask what your deadline is.",
      }),
    );
    return;
  }

  // A non-nullable alias taken after the guard above. The closures below capture
  // it rather than the nullable binding, so the "no data" path stays a single
  // early return instead of a null check repeated in every render function.
  const windows: EnrollmentWindowsData = shard;
  const programs = programsIn(windows);
  let fields = readFields(ctx.params, programs);

  const asOfInput = el("input", {
    type: "date",
    value: fields.asOf,
    attrs: { "aria-label": "Today's date, the date every clock is counted from" },
  });
  const triggerInput = el("input", {
    type: "date",
    value: fields.trigger,
    attrs: { "aria-label": "The date the triggering event happened" },
  });
  const programSelect = el(
    "select",
    { attrs: { "aria-label": "Program" } },
    ...programs.map((p) => option(p, p, p === fields.program)),
  );

  const resultContainer = el("div", { class: "tile-result", attrs: { "aria-live": "polite" } });

  function windowBlock(w: EnrollmentWindow): HTMLElement {
    return el(
      "div",
      { class: "enw-window" },
      renderDeadline(w.deadline, {
        asOf: fields.asOf,
        locale: ctx.locale,
        triggerDate: fields.trigger,
      }),
      // A ceiling stated without this sentence reads as a guarantee, which is
      // how the window gets missed.
      w.isCeiling
        ? el("p", {
            class: "enw-ceiling",
            attrs: { role: "note" },
            text: "This is the most your state has to allow, not a promise that you have it. Your state may set a shorter window — go by the date on your own notice.",
          })
        : null,
      el("p", { class: "enw-detail", text: w.detail }),
    );
  }

  function compute(): void {
    const mine = enrollmentWindows(windows).filter((w) => w.program === fields.program);

    resultContainer.replaceChildren(
      el("p", {
        class: "enw-lede",
        text: `Every date below is counted from ${fields.asOf}, which you set above. Change it and the whole page recomputes — the clock is an input here, so a link you paste or save shows the same thing tomorrow that it shows today.`,
      }),
      el("div", { class: "enw-windows" }, ...mine.map(windowBlock)),
      el("h3", { class: "enw-heading", text: "Clocks your state sets, which we will not guess" }),
      el(
        "ul",
        { class: "enw-list" },
        ...windows.stateSet.map((s) =>
          el("li", {}, el("strong", { text: `${s.label}. ` }), el("span", { text: s.note })),
        ),
      ),
      ...(windows.upcomingChanges.length > 0
        ? [
            el("h3", { class: "enw-heading", text: "Already published, not yet in effect" }),
            el(
              "ul",
              { class: "enw-list" },
              ...windows.upcomingChanges.map((c) =>
                el(
                  "li",
                  {},
                  el("strong", { text: `${c.label}. ` }),
                  el("span", { text: `${c.detail} ` }),
                  citationLink(c.citation),
                ),
              ),
            ),
          ]
        : []),
      el("p", {
        class: "enw-limit",
        text: "These are the federal windows. A plan, a state, or an administrator may allow longer, and several states do — but none may allow less than a federal floor. If a date here and a date on your own notice disagree, act on whichever is sooner and ask the agency in writing today.",
      }),
    );
  }

  function recompute(): void {
    fields = {
      asOf: readDate(asOfInput.value, EXAMPLE.asOf),
      trigger: readDate(triggerInput.value, EXAMPLE.trigger),
      program: programSelect.value,
    };
    ctx.setParams(writeFields(fields));
    compute();
  }

  asOfInput.addEventListener("change", recompute);
  triggerInput.addEventListener("change", recompute);
  programSelect.addEventListener("change", recompute);

  const tryExample = tryExampleButton(() => {
    fields = {
      ...EXAMPLE,
      program: programs.includes(EXAMPLE.program) ? EXAMPLE.program : programs[0]!,
    };
    asOfInput.value = fields.asOf;
    triggerInput.value = fields.trigger;
    programSelect.value = fields.program;
    recompute();
  });

  root.append(
    el(
      "form",
      { class: "tile-form", on: { submit: (e) => e.preventDefault() } },
      field("Program", programSelect),
      field("The date the event happened", triggerInput),
      field("Count from this date", asOfInput),
      el("div", { class: "tile-form-actions" }, tryExample),
    ),
    resultContainer,
  );
  compute();
}

export const enrollmentWindowsTile: TileDefinition = {
  id: "enrollment-windows",
  title: "Enrollment & Appeal Windows",
  pillar: "rough",
  harmTier: 2,
  channels: [
    {
      // Credited to the Department of Labor until 2026-09-03, pointing at
      // Cornell's LII. The note beside it always said what the page is; the
      // label said who published it, and was wrong. Named after the section it
      // is, like the other statute links in this tile.
      label: "29 U.S.C. §1165 — the COBRA election period",
      url: "https://www.law.cornell.edu/uscode/text/29/1165",
      note: "The election-period statute itself",
    },
    {
      label: "HealthCare.gov: how to appeal a Marketplace decision",
      url: "https://www.healthcare.gov/appeals/",
      note: "Free, and the form is on the page",
    },
    {
      label: "Find free legal help near you",
      url: "https://www.lsc.gov/about-lsc/what-legal-aid/i-need-legal-help",
      note: "For a Medicaid or SNAP hearing, before the window closes",
    },
  ],
  description:
    "The federal deadlines that decide whether you keep coverage or a benefit, counted from a date you set.",
  keywords: [
    "cobra",
    "cobra deadline",
    "special enrollment",
    "open enrollment",
    "medicare enrollment",
    "part b penalty",
    "fair hearing",
    "appeal deadline",
    "lost my job insurance",
  ],
  status: "ready",
  mount: mountEnrollmentWindows,
  how: 'These are the numbers on this site with the sharpest edges. Miss a COBRA election and the coverage is simply gone. Miss the Medicare Part B special enrollment period and you pay a late-enrollment penalty for as long as you have Part B. Miss a fair-hearing request and the decision stands, whether or not it was right.\n\nSo every date here is counted from a date you set, not from the moment the page loaded. That is deliberate: it makes the result reproducible, it shows the clock rather than hiding it, and it lets you check what a date will look like next week without waiting for next week.\n\nOne distinction matters more than any single number, and summaries routinely lose it. Most of these windows are floors — a plan or an agency may give you longer, and may never give you less. The Medicaid fair-hearing period is not. The rule gives a state a reasonable time "not to exceed 90 days," which makes 90 days the most your state has to allow, and reading it as a guarantee is exactly how someone misses it. The page says which kind each one is, in words, under the clock.\n\nWhere the states set the clock themselves, most of all for unemployment appeals, no number is shown. There is no federal figure to show, the states differ widely, and a plausible-looking default would be worse than a pointer to your own notice.\n\nThis is information about published federal rules. It is not legal or financial advice, and your own notice is the authority on your own deadline. If a date here and a date on your notice disagree, act on whichever is sooner.',
  resources: [
    {
      label: "45 CFR §155.420 — Special enrollment periods",
      url: "https://www.ecfr.gov/current/title-45/subtitle-A/subchapter-B/part-155/subpart-E/section-155.420",
    },
    {
      label: "42 CFR §431.221 — Medicaid hearing requests",
      url: "https://www.ecfr.gov/current/title-42/chapter-IV/subchapter-C/part-431/subpart-E/subject-group-ECFR4e89d7b32b71f9d/section-431.221",
    },
  ],
  related: [
    {
      hubId: "protection",
      tool: "eob-checker",
      label: "Medical Bill & EOB Checker",
      note: "Once the new coverage is in place and the first claim arrives",
    },
    {
      hubId: "when-money-is-tight",
      tool: "bill-triage",
      label: "Bill Triage",
      note: "For the month the coverage change lands in",
    },
  ],
};
