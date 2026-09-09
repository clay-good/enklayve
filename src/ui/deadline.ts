/**
 * The single path a deadline reaches the screen (SPEC-4 §7.3).
 *
 * Nothing else renders a date-with-a-clock. Routing every deadline through one
 * helper makes two obligations structural instead of remembered:
 *   1. the citation link is always present (the type already guarantees the
 *      citation exists; this guarantees it is *shown*), and
 *   2. the "as of" date is always displayed, because the clock is an input, not
 *      an ambient fact (SPEC-4 §7.3, and `engine/deadline.ts`).
 *
 * A window with no trigger date yet renders the window itself ("within 60 days
 * of the date coverage ended") rather than a computed date — missing input
 * degrades to a plain statement, never to a wrong number (SPEC-3 §2.5).
 */
import type { Deadline } from "../engine/deadline";
import { addCalendarMonths, byNearness, deadlineStatus } from "../engine/deadline";
import { el } from "./dom";
import { citationLink } from "./resultCard";

/** Format an ISO date for display in the user's locale, e.g. "Nov 15, 2026". */
function formatIso(iso: string, locale: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  return new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(y, m - 1, d)));
}

/**
 * A calendar label for a number of whole months ahead of `fromIso`, e.g.
 * "March 2027" — the "freedom date" the payoff tiles put on a payoff horizon.
 *
 * Both tiles used to carry their own copy built on `d.setMonth(d.getMonth() +
 * n)`, which overflows rather than clamping: one month from January 31 built
 * February 31, rolled into March, and labelled the month after next. That is
 * wrong on the 31st of January, March, May, August and October, and it is the
 * kind of wrong nobody checks, because the answer is a plausible month.
 *
 * `fromIso` is a parameter rather than a call to the clock inside, so the label
 * can be tested at a chosen date instead of only on the days the bug shows.
 */
/**
 * Today, as an ISO date, in the reader's own timezone.
 *
 * `toISOString()` is **UTC**, and this used it. From about 5 p.m. Pacific
 * onward — 8 p.m. Eastern — UTC has already rolled over, so "today" was
 * tomorrow for the whole west coast evening. That is a rounding error on a
 * payoff horizon and something worse on a deadline: `enrollmentWindows`
 * defaults its `asOf` to this, `deadlineStatus` calls a window past at
 * `daysRemaining < 0`, and the last evening of a COBRA election or an ACA
 * special-enrollment period is exactly when somebody opens the page. Being
 * told a still-open window has closed is the highest-harm direction Pillar 4
 * has.
 *
 * (The paragraph this replaces said "a deadline never comes through here",
 * which had stopped being true: the enrollment tiles take their default `asOf`
 * from it. A statutory clock the machine set is still a number nobody can
 * check — which is why the field stays editable and the link carries it.)
 *
 * Built from the local calendar fields rather than by shifting a UTC instant,
 * so it is the date on the reader's own wall.
 */
export function todayIso(): string {
  const now = new Date();
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export function monthsAheadLabel(monthsAhead: number, locale: string, fromIso: string): string {
  const [y, m] = addCalendarMonths(fromIso, monthsAhead).split("-").map(Number);
  if (!y || !m) return fromIso;
  return new Intl.DateTimeFormat(locale, {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(y, m - 1, 1)));
}

/** The plain-English timing line: what is due, when, and how long is left. */
function timingText(
  deadline: Deadline,
  asOf: string,
  locale: string,
  triggerDate?: string,
): string {
  const status = deadlineStatus(deadline, asOf, triggerDate);
  const atLeast = deadline.isFloor ? "at least " : "";

  if (status.dueOn === null) {
    if ("daysFromTrigger" in deadline.due) {
      const { daysFromTrigger, trigger } = deadline.due;
      return `Within ${atLeast}${daysFromTrigger} days of ${trigger}.`;
    }
    if ("monthsFromTrigger" in deadline.due) {
      const { monthsFromTrigger, trigger } = deadline.due;
      const unit = monthsFromTrigger === 1 ? "month" : "months";
      return `Within ${atLeast}${monthsFromTrigger} ${unit} of ${trigger}.`;
    }
    return "This date could not be resolved — check the source.";
  }

  const on = formatIso(status.dueOn, locale);
  const days = status.daysRemaining ?? 0;
  if (status.state === "past") {
    const ago = Math.abs(days);
    return `Was due ${on} — ${ago} ${ago === 1 ? "day" : "days"} ago.`;
  }
  if (status.state === "today") return `Due today, ${on}.`;
  return `Due ${on} — ${days} ${days === 1 ? "day" : "days"} left.`;
}

export interface RenderDeadlineOptions {
  /** The explicit clock. Displayed, never assumed (SPEC-4 §7.3). */
  asOf: string;
  locale: string;
  /** The date the triggering event occurred, for a window-style deadline. */
  triggerDate?: string;
}

/**
 * Render one deadline: what is due, when, the rule that sets the clock, and
 * where to act. The returned element carries `data-deadline` so the UI test can
 * assert that every deadline node on the site has a source link.
 */
export function renderDeadline(deadline: Deadline, options: RenderDeadlineOptions): HTMLElement {
  const { asOf, locale, triggerDate } = options;
  const status = deadlineStatus(deadline, asOf, triggerDate);

  const node = el("div", {
    class: `deadline deadline--${status.state}`,
    attrs: { "data-deadline": "" },
  });

  node.append(
    el("p", { class: "deadline__label", text: deadline.label }),
    el(
      "p",
      { class: "deadline__timing" },
      timingText(deadline, asOf, locale, triggerDate),
      " ",
      citationLink(deadline.citation),
    ),
  );

  if (deadline.isFloor) {
    node.append(
      el("p", {
        class: "deadline__floor",
        text: "This is the federal minimum. Your plan, state, or administrator may allow longer — confirm with them.",
      }),
    );
  }

  if (deadline.channel) {
    node.append(
      el(
        "p",
        { class: "deadline__channel" },
        el("a", {
          href: deadline.channel.url,
          text: deadline.channel.label,
          attrs: { rel: "noopener noreferrer", target: "_blank" },
        }),
      ),
    );
  }

  node.append(
    el("p", {
      class: "deadline__asof",
      text: `Counted from ${formatIso(asOf, locale)}.`,
    }),
  );

  return node;
}

/**
 * Render a list of deadlines, soonest first. Unresolved windows sort last —
 * they have no clock to be near.
 */
export function renderDeadlineList(
  deadlines: Deadline[],
  options: RenderDeadlineOptions,
): HTMLElement {
  const ordered = deadlines
    .map((d) => ({ d, s: deadlineStatus(d, options.asOf, options.triggerDate) }))
    .sort((a, b) => byNearness(a.s, b.s));

  return el(
    "div",
    { class: "deadline-list" },
    ...ordered.map(({ d }) => renderDeadline(d, options)),
  );
}
