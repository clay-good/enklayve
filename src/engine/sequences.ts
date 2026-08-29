/**
 * Statutory enrollment and appeal clocks (SPEC-4-safety-net §B4, SPEC-4 §7.3).
 *
 * A thin, pure mapping from the `enrollment-windows` shard to the {@link Deadline}
 * type every dated obligation on the site renders through. It exists so the
 * shard stays plain data and the UI never hand-builds a `Deadline` — which is
 * what keeps `Deadline.citation` being non-optional a real guarantee rather than
 * a convention someone could route around.
 *
 * The `bound` distinction is carried through faithfully and is the reason this
 * module is not a one-liner. A **floor** maps to `isFloor: true`, which renders
 * as "at least". A **ceiling** must not: 42 CFR §431.221(d) gives a state a
 * reasonable time "not to exceed 90 days" for a Medicaid fair hearing, so 90
 * days is the most a state may allow and a household reading it as a guarantee
 * is exactly how the window gets missed.
 */
import type { Deadline } from "./deadline";
import type { EnrollmentWindowsData } from "../data/schemas";

/** One window from the shard, plus the program it belongs to. */
export interface EnrollmentWindow {
  id: string;
  program: string;
  /** The clock itself, ready for `renderDeadline`. */
  deadline: Deadline;
  /** True where the figure is the *most* an agency must allow, not a guarantee. */
  isCeiling: boolean;
  detail: string;
}

type ShardWindow = EnrollmentWindowsData["windows"][number];

/** Map one shard entry to a {@link Deadline}. */
function toDeadline(w: ShardWindow, channel?: { label: string; url: string }): Deadline {
  const due =
    "on" in w.due
      ? ({ on: w.due.on } as const)
      : "months" in w.due
        ? ({ monthsFromTrigger: w.due.months, trigger: w.due.trigger } as const)
        : ({ daysFromTrigger: w.due.days, trigger: w.due.trigger } as const);
  return {
    label: w.label,
    due,
    citation: w.citation,
    ...(channel ? { channel } : {}),
    // Only a floor may render as "at least". A ceiling renders plainly, and the
    // tile states in words that a state may allow less.
    ...(w.bound === "floor" ? { isFloor: true } : {}),
  };
}

/** Every window in the shard, in shard order, as renderable deadlines. */
export function enrollmentWindows(data: EnrollmentWindowsData): EnrollmentWindow[] {
  return data.windows.map((w) => ({
    id: w.id,
    program: w.program,
    deadline: toDeadline(w),
    isCeiling: w.bound === "ceiling",
    detail: w.detail,
  }));
}

/** The windows for one program, e.g. every COBRA clock in the sequence. */
export function windowsForProgram(
  data: EnrollmentWindowsData,
  program: string,
): EnrollmentWindow[] {
  return enrollmentWindows(data).filter((w) => w.program === program);
}

/** Every distinct program the shard carries, in first-appearance order. */
export function programsIn(data: EnrollmentWindowsData): string[] {
  return Array.from(new Set(data.windows.map((w) => w.program)));
}
