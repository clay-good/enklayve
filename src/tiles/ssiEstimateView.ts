/**
 * SSI Estimate, the interactive half (SPEC-5 Phase 30). Loaded on first use
 * with its shard; the definition in `ssiEstimate.ts` stays in the shell.
 * Screener-only: it estimates a payment and never says who is eligible.
 */
import { Money } from "../engine/money";
import { ssiEstimate } from "../engine/ssi";
import { el } from "../ui/dom";
import { field, parseNonNegative, tryExampleButton } from "../ui/form";
import { resultCard, type BreakdownLine } from "../ui/resultCard";
import type { TileContext } from "./types";

interface Fields {
  couple: boolean;
  earned: number;
  unearned: number;
  student: boolean;
  resources: number;
}

const EXAMPLE: Fields = { couple: false, earned: 500, unearned: 0, student: false, resources: 800 };

function readFields(p: URLSearchParams): Fields {
  return {
    couple: p.get("cpl") === "1",
    earned: parseNonNegative(p.get("earn"), 0),
    unearned: parseNonNegative(p.get("other"), 0),
    student: p.get("stu") === "1",
    resources: parseNonNegative(p.get("res"), 0),
  };
}

function writeFields(f: Fields): URLSearchParams {
  const p = new URLSearchParams();
  if (f.couple) p.set("cpl", "1");
  p.set("earn", String(f.earned));
  p.set("other", String(f.unearned));
  if (f.student) p.set("stu", "1");
  p.set("res", String(f.resources));
  return p;
}

export function mountSsiEstimate(ctx: TileContext): void {
  const { root, data } = ctx;
  root.replaceChildren();
  const rules = data?.ssi();
  if (!rules) {
    root.append(
      el("div", {
        class: "verify-banner",
        attrs: { role: "alert" },
        text: "The SSI amounts are unavailable, so no estimate is given. Social Security can tell you what you may be paid.",
      }),
    );
    return;
  }
  let fields = readFields(ctx.params);

  const box = (name: string, label: string, checked: boolean): HTMLInputElement => {
    const b = el("input", { type: "checkbox", name, attrs: { "aria-label": label } });
    b.checked = checked;
    return b;
  };
  const num = (name: string, value: number, label: string, step: number) =>
    el("input", {
      type: "number",
      name,
      min: 0,
      step,
      value,
      attrs: { "aria-label": label, inputmode: "decimal" },
    });
  const coupleBox = box("cpl", "Applying with a spouse who is also eligible", fields.couple);
  const earnedInput = num("earn", fields.earned, "Earnings from work a month", 50);
  const unearnedInput = num("other", fields.unearned, "Other income a month", 50);
  const studentBox = box("stu", "A student under 22", fields.student);
  const resourcesInput = num("res", fields.resources, "Savings and other countable resources", 100);

  const resultContainer = el("div", { class: "tile-result", attrs: { "aria-live": "polite" } });

  function compute(): void {
    const r = ssiEstimate(fields, rules!);
    const fmt = (m: Money): string => m.format(ctx.locale);
    const cite = rules!.citation;
    const lines: BreakdownLine[] = [
      {
        label: `The federal payment before income, ${fields.couple ? "for a couple" : "for one person"}`,
        value: `${fmt(r.federalBenefitRate)}/mo`,
        citation: cite,
      },
      {
        label: "Other income that counts, after the first $20",
        value: `${fmt(r.countableUnearned)}/mo`,
        citation: cite,
      },
      {
        label: fields.student
          ? "Earnings that count, after the student exclusion, $65 and half the rest"
          : "Earnings that count, after $65 and half the rest",
        value: `${fmt(r.countableEarned)}/mo`,
        citation: cite,
      },
    ];
    const blocks: HTMLElement[] = [
      el("p", {
        class: "ssi-state",
        attrs: { role: "note" },
        text: "Many states add their own payment on top of the federal one, and some count or exclude income differently. Only Social Security decides whether you are paid and how much.",
      }),
      resultCard({
        label: "An estimate of the federal monthly payment",
        value: r.payment,
        locale: ctx.locale,
        breakdown: lines,
        permalink: () => ctx.permalink(writeFields(fields)),
      }),
    ];
    blocks.push(
      el("p", {
        class: "ssi-screen",
        text: r.overResourceLimit
          ? `Your savings and other resources are above the federal limit of ${fmt(Money.from(r.resourceLimit))}, which Social Security applies to most of what you own, though not your home or usually one car. It is still worth asking, since some things do not count.`
          : r.payment.isZero()
            ? "At this income the estimate comes to nothing. It is still worth asking Social Security if your income changes, or if your state adds a payment."
            : "At this income and these resources, applying is worth it.",
      }),
    );
    resultContainer.replaceChildren(...blocks);
  }

  function recompute(): void {
    fields = {
      couple: coupleBox.checked,
      earned: parseNonNegative(earnedInput.value, 0),
      unearned: parseNonNegative(unearnedInput.value, 0),
      student: studentBox.checked,
      resources: parseNonNegative(resourcesInput.value, 0),
    };
    ctx.setParams(writeFields(fields));
    compute();
  }

  for (const i of [earnedInput, unearnedInput, resourcesInput])
    i.addEventListener("input", recompute);
  for (const b of [coupleBox, studentBox]) b.addEventListener("change", recompute);

  const tryExample = tryExampleButton(() => {
    fields = { ...EXAMPLE };
    coupleBox.checked = fields.couple;
    earnedInput.value = String(fields.earned);
    unearnedInput.value = String(fields.unearned);
    studentBox.checked = fields.student;
    resourcesInput.value = String(fields.resources);
    recompute();
  });

  root.append(
    el(
      "form",
      { class: "tile-form", on: { submit: (e) => e.preventDefault() } },
      field("Applying with a spouse who is also eligible", coupleBox),
      field("Earnings from work a month", earnedInput),
      field("Other income a month (Social Security, a pension)", unearnedInput),
      field("A student under 22", studentBox),
      field("Savings and other countable resources", resourcesInput),
      el("div", { class: "tile-form-actions" }, tryExample),
    ),
    resultContainer,
  );
  compute();
}
