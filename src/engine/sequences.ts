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
import type { EnrollmentWindowsData, LifeEventsData } from "../data/schemas";

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

/** One step of a life-event sequence, with its clock resolved where it has one. */
export interface SequenceStep {
  id: string;
  label: string;
  detail: string;
  /** Present only where the step names a window that the shard actually carries. */
  deadline?: Deadline;
  /** True where that window is a ceiling rather than a floor. */
  isCeiling: boolean;
  channel?: { label: string; url: string };
  tileId?: string;
}

/** One life-event sequence, in order. */
export interface Sequence {
  id: string;
  label: string;
  triggerLabel: string;
  lede: string;
  steps: SequenceStep[];
}

/**
 * Join a life-event sequence to the clocks that date it. A step's `windowId`
 * points into the `enrollment-windows` shard, so the deadline and its citation
 * come from the shard that was sourced against the regulation — this module
 * never invents one.
 *
 * A `windowId` naming a window that is not present resolves to a step with no
 * deadline rather than throwing. That degrades to a dateless instruction, which
 * is the honest failure: the step is still worth doing, and inventing a clock
 * for it would be the harm this whole phase exists to avoid.
 */
export function resolveSequences(
  events: LifeEventsData,
  windows: EnrollmentWindowsData,
): Sequence[] {
  const byId = new Map(enrollmentWindows(windows).map((w) => [w.id, w]));
  return events.sequences.map((seq) => ({
    id: seq.id,
    label: seq.label,
    triggerLabel: seq.triggerLabel,
    lede: seq.lede,
    steps: seq.steps.map((step) => {
      const window = step.windowId ? byId.get(step.windowId) : undefined;
      return {
        id: step.id,
        label: step.label,
        detail: step.detail,
        ...(window ? { deadline: window.deadline } : {}),
        isCeiling: window?.isCeiling ?? false,
        ...(step.channel ? { channel: step.channel } : {}),
        ...(step.tileId ? { tileId: step.tileId } : {}),
      };
    }),
  }));
}

/** Every `windowId` a sequence references that the windows shard does not carry.
 * Empty in a healthy build; a test asserts it, so a renamed window cannot
 * silently strip the clock off a step. */
export function danglingWindowIds(
  events: LifeEventsData,
  windows: EnrollmentWindowsData,
): string[] {
  const known = new Set(windows.windows.map((w) => w.id));
  return events.sequences
    .flatMap((s) => s.steps)
    .map((s) => s.windowId)
    .filter((id): id is string => id !== undefined && !known.has(id));
}
