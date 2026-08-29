/**
 * Life-Event Sequences (SPEC-4 §Phase 20b) — harm tier 2.
 *
 * Six ordered checklists for the events that rearrange a household's money:
 * losing a job, a death, a divorce, a disability, a new child, and a move
 * across a state line. Each is a *sequence*, not a list, because the order is
 * the value: two or three steps have clocks on them, and at least one of those
 * clocks starts before anyone feels ready to think about it.
 *
 * Every dated step draws its clock from the `enrollment-windows` shard by
 * reference (SPEC-4 §7.3), so the deadline and its citation come from the shard
 * that was sourced against the regulation. This tile never states a date of its
 * own, and a step whose window is missing degrades to a dateless instruction
 * rather than a guess.
 *
 * The ordering itself is editorial judgment, and the page says so rather than
 * dressing it as a published sequence.
 */
import { resolveSequences, type Sequence, type SequenceStep } from "../engine/sequences";
import { el, option } from "../ui/dom";
import { field, tryExampleButton } from "../ui/form";
import { renderDeadline } from "../ui/deadline";
import type { TileContext, TileDefinition } from "./types";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const EXAMPLE = { event: "job-loss", trigger: "2026-02-28", asOf: "2026-03-02" };

interface Fields {
  event: string;
  trigger: string;
  /** The clock, an explicit input (SPEC-4 §7.3) — never `Date.now()`. */
  asOf: string;
}

function readDate(raw: string | null, fallback: string): string {
  return raw !== null && ISO_DATE.test(raw) ? raw : fallback;
}

export function mountLifeEvents(ctx: TileContext): void {
  const { root, data } = ctx;
  root.replaceChildren();

  const events = data?.lifeEvents() ?? null;
  const windowsData = data?.enrollmentWindows() ?? null;
  if (!events || !windowsData) {
    root.append(
      el("div", {
        class: "verify-banner",
        attrs: { role: "alert" },
        text: "The life-event data is unavailable, so no sequence is shown here. Two things are worth doing today whatever the event: file for any benefit you might be eligible for rather than waiting to be sure, and read any notice about health coverage the day it arrives — those are the steps with clocks on them.",
      }),
    );
    return;
  }

  const sequences = resolveSequences(events, windowsData);
  let fields: Fields = {
    event: sequences.some((s) => s.id === ctx.params.get("ev"))
      ? ctx.params.get("ev")!
      : (sequences[0]?.id ?? EXAMPLE.event),
    trigger: readDate(ctx.params.get("trig"), EXAMPLE.trigger),
    asOf: readDate(ctx.params.get("as"), EXAMPLE.asOf),
  };

  const eventSelect = el(
    "select",
    { attrs: { "aria-label": "What happened" } },
    ...sequences.map((s) => option(s.id, s.label, s.id === fields.event)),
  );
  const triggerInput = el("input", {
    type: "date",
    value: fields.trigger,
    attrs: { "aria-label": "The date it happened" },
  });
  const asOfInput = el("input", {
    type: "date",
    value: fields.asOf,
    attrs: { "aria-label": "Today's date, the date every clock is counted from" },
  });

  const resultContainer = el("div", { class: "tile-result", attrs: { "aria-live": "polite" } });

  function stepBlock(step: SequenceStep, index: number): HTMLElement {
    const body = el(
      "div",
      { class: "lev-step-body" },
      el("p", { class: "lev-step-label", text: step.label }),
      el("p", { class: "lev-step-detail", text: step.detail }),
    );
    if (step.deadline) {
      body.append(
        renderDeadline(step.deadline, {
          asOf: fields.asOf,
          locale: ctx.locale,
          triggerDate: fields.trigger,
        }),
      );
      if (step.isCeiling) {
        body.append(
          el("p", {
            class: "lev-ceiling",
            attrs: { role: "note" },
            text: "This is the most your state has to allow, not a promise that you have it — go by the date on your own notice.",
          }),
        );
      }
    }
    if (step.channel) {
      body.append(
        el(
          "p",
          { class: "lev-step-channel" },
          el("a", {
            class: "cite-link",
            href: step.channel.url,
            text: step.channel.label,
            attrs: { rel: "noopener noreferrer", target: "_blank" },
          }),
        ),
      );
    }
    if (step.tileId) {
      const tileId = step.tileId;
      body.append(
        el("button", {
          type: "button",
          class: "btn btn--ghost",
          text: "Open the tool that does this →",
          on: { click: () => ctx.navigate(tileId) },
        }),
      );
    }
    return el(
      "li",
      { class: step.deadline ? "lev-step lev-step--dated" : "lev-step" },
      el("span", {
        class: "lev-step-n",
        attrs: { "aria-hidden": "true" },
        text: String(index + 1),
      }),
      body,
    );
  }

  function render(seq: Sequence): void {
    const dated = seq.steps.filter((s) => s.deadline).length;
    resultContainer.replaceChildren(
      el("p", { class: "lev-lede", text: seq.lede }),
      el("p", {
        class: "lev-clock",
        text: `${dated === 0 ? "No step here" : dated === 1 ? "One step here has" : `${dated} steps here have`} a clock on ${dated === 1 ? "it" : "them"}, counted from ${seq.triggerLabel.toLowerCase()} (${fields.trigger}) against ${fields.asOf}, which you set above.`,
      }),
      el("ol", { class: "lev-steps" }, ...seq.steps.map(stepBlock)),
      el("p", {
        class: "lev-limit",
        text: "The dates here come from federal rules, each linked to the section that sets it. The order does not — it is our judgment about which step unlocks the others and which one has a clock you cannot get back. Your own situation may reorder it, and your own notice is the authority on your own deadline.",
      }),
    );
  }

  function compute(): void {
    const seq = sequences.find((s) => s.id === fields.event) ?? sequences[0];
    if (seq) render(seq);
  }

  function recompute(): void {
    fields = {
      event: eventSelect.value,
      trigger: readDate(triggerInput.value, EXAMPLE.trigger),
      asOf: readDate(asOfInput.value, EXAMPLE.asOf),
    };
    const p = new URLSearchParams();
    p.set("ev", fields.event);
    p.set("trig", fields.trigger);
    p.set("as", fields.asOf);
    ctx.setParams(p);
    compute();
  }

  eventSelect.addEventListener("change", recompute);
  triggerInput.addEventListener("change", recompute);
  asOfInput.addEventListener("change", recompute);

  const tryExample = tryExampleButton(() => {
    fields = { ...EXAMPLE };
    eventSelect.value = fields.event;
    triggerInput.value = fields.trigger;
    asOfInput.value = fields.asOf;
    recompute();
  });

  root.append(
    el(
      "form",
      { class: "tile-form", on: { submit: (e) => e.preventDefault() } },
      field("What happened", eventSelect),
      field("The date it happened", triggerInput),
      field("Count from this date", asOfInput),
      el("div", { class: "tile-form-actions" }, tryExample),
    ),
    resultContainer,
  );
  compute();
}

export const lifeEventsTile: TileDefinition = {
  id: "life-events",
  title: "Life-Event Sequences",
  pillar: "rough",
  harmTier: 2,
  channels: [
    {
      label: "HealthCare.gov: which life changes open a special enrollment period",
      url: "https://www.healthcare.gov/sep-list/",
      note: "The qualifying events, in the government's words",
    },
    {
      label: "USA.gov: how to file for unemployment benefits in your state",
      url: "https://www.usa.gov/unemployment-benefits",
      note: "The step most worth doing on day one",
    },
    {
      label: "Find free legal help near you",
      url: "https://www.lsc.gov/about-lsc/what-legal-aid/i-need-legal-help",
      note: "For a death, a divorce, or a benefits denial",
    },
  ],
  description:
    "Six ordered checklists for the events that rearrange your money, with the clocks that matter.",
  keywords: [
    "lost my job",
    "laid off",
    "divorce",
    "death in the family",
    "new baby",
    "moving states",
    "disability",
    "checklist",
    "what do i do now",
  ],
  status: "ready",
  mount: mountLifeEvents,
  how: "Six things rearrange a household's money more than any budget decision does: losing a job, a death, a divorce, a disability, a new child, and a move across a state line. Each of these is a sequence rather than a list, because the order is the whole value. Two or three steps in each one have a clock on them, and at least one of those clocks starts before anyone feels ready to think about it.\n\nEvery date here comes from a federal rule, and each links to the section that sets it. Nothing on this page states a deadline of its own: the clocks live in the enrollment-and-appeal-window dataset, sourced against the regulations themselves, and this page only points at them. That is deliberate, because a duplicated deadline is a deadline that will eventually be wrong in one of the two places.\n\nThe dates are counted from a date you set rather than from the moment the page loaded, so you can check what next week looks like without waiting for next week, and so a link you save shows the same thing when you open it again.\n\nWhat is not from a rule is the ordering. That is our judgment about which step unlocks the others and which one has a window you cannot get back, and your own situation may reorder it. Where a step is genuinely time-critical the page says so with the clock attached; where it is merely important, it does not pretend otherwise.\n\nThis is information about published rules and free public channels. It is not legal, tax, or financial advice, and your own notice is the authority on your own deadline.",
  resources: [
    {
      label: "HealthCare.gov: report a life change to the Marketplace",
      url: "https://www.healthcare.gov/reporting-changes/why-report-changes/",
    },
    {
      label: "Medicare.gov: how and when to sign up",
      url: "https://www.medicare.gov/basics/get-started-with-medicare/sign-up",
    },
  ],
  related: [
    {
      hubId: "when-money-is-tight",
      tool: "enrollment-windows",
      label: "Enrollment & Appeal Windows",
      note: "Every clock on this page, on its own, with the rule that sets it",
    },
    {
      hubId: "when-money-is-tight",
      tool: "bill-triage",
      label: "Bill Triage",
      note: "For the month the change lands in",
    },
  ],
};
