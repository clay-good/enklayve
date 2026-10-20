/**
 * Medicare Enrollment Penalties, the interactive half (SPEC-5 Phase 29).
 * Loaded on first use with its shard; the definition in `medicarePenalties.ts`
 * stays in the shell.
 */
import { Money } from "../engine/money";
import { medicarePenalties } from "../engine/medicare";
import { enrollmentWindows } from "../engine/sequences";
import { el, option } from "../ui/dom";
import { field, parseNonNegative, pct, tryExampleButton } from "../ui/form";
import { resultCard, type BreakdownLine } from "../ui/resultCard";
import { renderDeadline, todayIso } from "../ui/deadline";
import type { TileContext } from "./types";

interface Fields {
  lateB: number;
  lateD: number;
  lateA: number;
  partA: "none" | "reduced" | "full";
  years: number;
}

const EXAMPLE: Fields = { lateB: 24, lateD: 14, lateA: 0, partA: "none", years: 20 };
const PART_A = ["none", "reduced", "full"] as const;

function readFields(p: URLSearchParams): Fields {
  const a = p.get("pa");
  return {
    lateB: Math.min(600, Math.round(parseNonNegative(p.get("b"), 0))),
    lateD: Math.min(600, Math.round(parseNonNegative(p.get("d"), 0))),
    lateA: Math.min(600, Math.round(parseNonNegative(p.get("a"), 0))),
    partA: PART_A.find((x) => x === a) ?? "none",
    years: Math.min(50, Math.round(parseNonNegative(p.get("y"), 20))),
  };
}

function writeFields(f: Fields): URLSearchParams {
  const p = new URLSearchParams();
  p.set("b", String(f.lateB));
  p.set("d", String(f.lateD));
  if (f.partA !== "none") {
    p.set("pa", f.partA);
    p.set("a", String(f.lateA));
  }
  p.set("y", String(f.years));
  return p;
}

export function mountMedicarePenalties(ctx: TileContext): void {
  const { root, data } = ctx;
  root.replaceChildren();
  const costs = data?.medicareCosts();
  const windows = data?.enrollmentWindows();
  if (!costs) {
    root.append(
      el("div", {
        class: "verify-banner",
        attrs: { role: "alert" },
        text: "Medicare's cost figures are unavailable, so no penalty is given. Medicare.gov explains each one.",
      }),
    );
    return;
  }
  let fields = readFields(ctx.params);

  const num = (name: string, value: number, label: string) =>
    el("input", {
      type: "number",
      name,
      min: 0,
      step: 1,
      value,
      attrs: { "aria-label": label, inputmode: "numeric" },
    });
  const bInput = num("b", fields.lateB, "Months late signing up for Part B");
  const dInput = num("d", fields.lateD, "Months without Part D or creditable drug coverage");
  const aSelect = el(
    "select",
    { name: "pa", attrs: { "aria-label": "Do you buy Part A?" } },
    option("none", "No, Part A is premium-free", fields.partA === "none"),
    option("reduced", "Yes, at the reduced premium", fields.partA === "reduced"),
    option("full", "Yes, at the full premium", fields.partA === "full"),
  );
  aSelect.value = fields.partA;
  const aInput = num("a", fields.lateA, "Months late buying Part A");
  const yearsInput = num("y", fields.years, "Years you expect to have this coverage");

  const resultContainer = el("div", { class: "tile-result", attrs: { "aria-live": "polite" } });

  function compute(): void {
    const r = medicarePenalties(
      {
        monthsLateB: fields.lateB,
        monthsLateD: fields.lateD,
        monthsLateA: fields.lateA,
        partAPremium: fields.partA,
      },
      costs!,
    );
    const fmt = (m: Money): string => m.format(ctx.locale);
    const cite = costs!.citation;
    const total = r.partB.monthly.add(r.partD.monthly).add(r.partA.monthly);
    const lines: BreakdownLine[] = [
      {
        label: `Part B: ${pct(r.partB.percent, 0)} of the standard premium, for as long as you have Part B`,
        value: `${fmt(r.partB.monthly)}/mo`,
        citation: cite,
      },
      {
        label: "Your Part B premium with it, rounded as Medicare rounds",
        value: `${fmt(r.partB.premiumWithPenalty)}/mo`,
        citation: cite,
      },
      {
        label: `Part D: ${pct(r.partD.percent, 0)} of the base beneficiary premium, on top of your plan's, for as long as you have Part D`,
        value: `${fmt(r.partD.monthly)}/mo`,
        citation: cite,
      },
    ];
    if (fields.partA !== "none")
      lines.push({
        label: `Part A: ${pct(r.partA.percent, 0)} of its premium, for ${r.partA.years} years`,
        value: `${fmt(r.partA.monthly)}/mo`,
        citation: cite,
      });
    const bAndD = r.partB.monthly.add(r.partD.monthly);
    lines.push(
      {
        label: "Penalties a year, at today's premiums",
        value: fmt(total.multiply(12)),
        emphasis: true,
      },
      {
        label: `Parts B and D over ${fields.years} years, at today's premiums (an assumption you set; premiums usually rise, and the penalties with them)`,
        value: fmt(bAndD.multiply(12 * fields.years)),
      },
    );

    const after: HTMLElement[] = [];
    if (windows) {
      const byId = new Map(enrollmentWindows(windows).map((w) => [w.id, w]));
      for (const id of [
        "medicare-initial-enrollment",
        "medicare-part-b-sep",
        "part-d-creditable-gap",
      ]) {
        const w = byId.get(id);
        if (w) after.push(renderDeadline(w.deadline, { asOf: todayIso(), locale: ctx.locale }));
      }
    }
    resultContainer.replaceChildren(
      resultCard({
        label: "Late-enrollment penalties a month",
        value: total,
        locale: ctx.locale,
        breakdown: lines,
        permalink: () => ctx.permalink(writeFields(fields)),
      }),
      ...after,
    );
  }

  function recompute(): void {
    fields = {
      lateB: Math.min(600, Math.round(parseNonNegative(bInput.value, 0))),
      lateD: Math.min(600, Math.round(parseNonNegative(dInput.value, 0))),
      lateA: Math.min(600, Math.round(parseNonNegative(aInput.value, 0))),
      partA: PART_A.find((x) => x === aSelect.value) ?? "none",
      years: Math.min(50, Math.round(parseNonNegative(yearsInput.value, 20))),
    };
    ctx.setParams(writeFields(fields));
    compute();
  }

  for (const i of [bInput, dInput, aInput, yearsInput]) i.addEventListener("input", recompute);
  aSelect.addEventListener("change", recompute);

  const tryExample = tryExampleButton(() => {
    fields = { ...EXAMPLE };
    bInput.value = String(fields.lateB);
    dInput.value = String(fields.lateD);
    aSelect.value = fields.partA;
    aInput.value = String(fields.lateA);
    yearsInput.value = String(fields.years);
    recompute();
  });

  root.append(
    el(
      "form",
      { class: "tile-form", on: { submit: (e) => e.preventDefault() } },
      field("Months late signing up for Part B", bInput),
      field("Months without Part D or creditable drug coverage", dInput),
      field("Do you buy Part A?", aSelect),
      field("Months late buying Part A", aInput),
      field("Years you expect to have this coverage", yearsInput),
      el("div", { class: "tile-form-actions" }, tryExample),
    ),
    resultContainer,
  );
  compute();
}
