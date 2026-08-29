/**
 * The recompute diff (SPEC-4-ledger.md §3) — what the Standing Ledger is for.
 *
 * You dropped back in with the file you kept. This renders what moved since you
 * took it, in the order that matters: threshold crossings first (the world moved
 * under you, and it is reported regardless of dollar magnitude), material
 * changes next with the shard that caused them named, deadlines last, sorted by
 * nearness.
 *
 * **"Nothing changed" is a first-class result**, and it renders as one calm line
 * of reassurance rather than an empty state. It is also the most common one,
 * which is the point: a utility that only speaks when something moved is worth
 * coming back to.
 */
import { el, clear } from "./dom";
import { renderDeadlineList } from "./deadline";
import type { AnswerDiff, LedgerDiff, LedgerSnapshot } from "../profile/ledger";

export interface RenderLedgerDiffOptions {
  snapshot: LedgerSnapshot;
  diff: LedgerDiff;
  /** The clock the deadline view counts from. Displayed, and editable. */
  asOf: string;
  locale: string;
  /** Called when the reader asks to load the snapshot's situation into My Situation. */
  onRestore: () => void;
  /** Called when the reader changes the clock. */
  onAsOfChange: (asOf: string) => void;
}

function money(n: number, locale: string): string {
  return n.toLocaleString(locale, { style: "currency", currency: "USD" });
}

/** One changed answer: what it was, what it is, and how far it moved. */
function answerRow(d: AnswerDiff, locale: string): HTMLElement {
  const movement =
    d.after === null
      ? "no longer appears in your report"
      : d.delta !== undefined
        ? `${d.before} → ${d.after} (${d.delta > 0 ? "+" : "−"}${money(Math.abs(d.delta), locale)})`
        : `${d.before} → ${d.after}`;
  return el(
    "li",
    { class: `ledger-row ledger-row--${d.kind}` },
    el("span", { class: "ledger-row-label", text: `${d.label} ` }),
    el("span", { class: "ledger-row-move", text: movement }),
    el("span", { class: "ledger-row-section", text: d.section }),
  );
}

export function renderLedgerDiff(container: HTMLElement, options: RenderLedgerDiffOptions): void {
  const { snapshot, diff, asOf, locale, onRestore, onAsOfChange } = options;
  clear(container);

  const asOfInput = el("input", {
    type: "date",
    value: asOf,
    attrs: { "aria-label": "Count deadlines from this date" },
    on: { change: (e) => onAsOfChange((e.target as HTMLInputElement).value) },
  });

  const head = el(
    "section",
    { class: "ledger", attrs: { "aria-label": "What changed since your snapshot" } },
    el("h2", { class: "ledger-title", text: "What changed since you were last here" }),
    el("p", {
      class: "ledger-taken",
      text: `Your ledger was taken on ${snapshot.takenOn} and holds ${snapshot.answers.length} answer${snapshot.answers.length === 1 ? "" : "s"}. Every figure below was recomputed on this device, just now, from the data bundled into the site today.`,
    }),
  );

  if (diff.nothingChanged) {
    // Reassurance, not an empty state. This is the common case and it should
    // read like good news, because it is.
    head.append(
      el("p", {
        class: "ledger-calm",
        text: "Nothing changed. Every answer you kept still computes to the same figure against today's data. There is nothing here you need to do.",
      }),
    );
  }

  if (diff.crossings.length > 0) {
    head.append(
      el("h3", { class: "ledger-heading", text: "Something crossed a line" }),
      el("p", {
        class: "ledger-note",
        text: "These are reported whatever the amount, because a threshold moving matters even when the dollars are small.",
      }),
      el("ul", { class: "ledger-list" }, ...diff.crossings.map((d) => answerRow(d, locale))),
    );
  }

  if (diff.material.length > 0) {
    head.append(
      el("h3", { class: "ledger-heading", text: "Answers that moved" }),
      el("p", {
        class: "ledger-note",
        text: "A change smaller than the greater of $25 or 1% is treated as unchanged, so a rounding-level shift in a bracket does not show up here as news.",
      }),
      el("ul", { class: "ledger-list" }, ...diff.material.map((d) => answerRow(d, locale))),
    );
  }

  if (diff.shardChanges.length > 0) {
    head.append(
      el("h3", { class: "ledger-heading", text: "Which data moved" }),
      el(
        "ul",
        { class: "ledger-list ledger-list--shards" },
        ...diff.shardChanges.map((s) =>
          el("li", {
            class: "ledger-row",
            text: `${s.id}: version ${s.before} → ${s.after}${
              s.effectiveYearBefore !== s.effectiveYearAfter
                ? `, effective ${s.effectiveYearBefore} → ${s.effectiveYearAfter}`
                : ""
            }`,
          }),
        ),
      ),
    );
  }

  if (diff.deadlines.length > 0) {
    head.append(
      el("h3", { class: "ledger-heading", text: "Deadlines you were carrying" }),
      el("div", { class: "ledger-asof" }, el("label", { text: "Count from " }), asOfInput),
      renderDeadlineList(diff.deadlines, { asOf, locale }),
    );
  }

  head.append(
    el("p", {
      class: "ledger-unchanged-count",
      text: `${diff.unchanged.length} of your ${snapshot.answers.length} kept answer${snapshot.answers.length === 1 ? "" : "s"} ${diff.unchanged.length === 1 ? "is" : "are"} unchanged.`,
    }),
    el(
      "div",
      { class: "ledger-actions" },
      el("button", {
        type: "button",
        class: "btn btn--accent",
        text: "Load this situation into My Situation",
        on: { click: onRestore },
      }),
    ),
    el("p", {
      class: "ledger-privacy",
      text: "Your ledger was read in this tab and nothing was written anywhere. Close the tab and it is gone; the file you keep is the only copy, and it never left your device.",
    }),
  );

  container.append(head);
}
