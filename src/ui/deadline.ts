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
import { byNearness, deadlineStatus } from "../engine/deadline";
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

/** The plain-English timing line: what is due, when, and how long is left. */
function timingText(deadline: Deadline, asOf: string, locale: string, triggerDate?: string): string {
  const status = deadlineStatus(deadline, asOf, triggerDate);
  const atLeast = deadline.isFloor ? "at least " : "";

  if (status.dueOn === null) {
    if ("daysFromTrigger" in deadline.due) {
      const { daysFromTrigger, trigger } = deadline.due;
      return `Within ${atLeast}${daysFromTrigger} days of ${trigger}.`;
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
