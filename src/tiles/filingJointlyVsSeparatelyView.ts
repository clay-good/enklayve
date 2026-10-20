/**
 * Married: Jointly or Separately?, the interactive half (SPEC-5 Phase 28).
 * Loaded on first use; the definition in `filingJointlyVsSeparately.ts` stays
 * in the shell. Every figure comes from the tax and credit engines and cites
 * their shards (SPEC-5 §4, addition 12).
 */
import { Money } from "../engine/money";
import { compareFilingStatus } from "../engine/filingComparison";
import { US_STATES } from "../data/usStates";
import { el, option } from "../ui/dom";
import { field, parseNonNegative, tryExampleButton } from "../ui/form";
import { resultCard, type BreakdownLine } from "../ui/resultCard";
import type { TileContext } from "./types";

interface Fields {
  a: number;
  b: number;
  kids: number;
  by: "a" | "b";
  st: string;
}

const EXAMPLE: Fields = { a: 48000, b: 0, kids: 2, by: "a", st: "TX" };

function readFields(p: URLSearchParams, ctx: TileContext): Fields {
  const st = (p.get("st") ?? ctx.profile.get("stateCode") ?? "").toUpperCase();
  return {
    a: p.has("a") ? parseNonNegative(p.get("a"), 0) : (ctx.profile.get("annualIncome") ?? 0),
    b: parseNonNegative(p.get("b"), 0),
    kids: Math.min(
      10,
      Math.round(
        p.has("kids")
          ? parseNonNegative(p.get("kids"), 0)
          : (ctx.profile.get("qualifyingChildren") ?? 0),
      ),
    ),
    by: p.get("by") === "b" ? "b" : "a",
    st: US_STATES.some((s) => s.code === st) ? st : "TX",
  };
}

function writeFields(f: Fields): URLSearchParams {
  const p = new URLSearchParams();
  p.set("a", String(f.a));
  p.set("b", String(f.b));
  p.set("kids", String(f.kids));
  p.set("by", f.by);
  p.set("st", f.st);
  return p;
}

export function mountFilingJointlyVsSeparately(ctx: TileContext): void {
  const { root, data } = ctx;
  root.replaceChildren();
  const fed = data?.federal();
  const fica = data?.fica();
  const credits = data?.eitcCtc();
  if (!fed || !fica || !credits) {
    root.append(
      el("div", {
        class: "verify-banner",
        attrs: { role: "alert" },
        text: "The tax or credit rules are unavailable, so no comparison is given.",
      }),
    );
    return;
  }
  let fields = readFields(ctx.params, ctx);

  const num = (name: string, value: number, label: string, step: number) =>
    el("input", {
      type: "number",
      name,
      min: 0,
      step,
      value,
      attrs: { "aria-label": label, inputmode: "decimal" },
    });
  const aInput = num("a", fields.a, "Your wages this year", 1000);
  const bInput = num("b", fields.b, "Your spouse's wages this year", 1000);
  const kidsInput = num("kids", fields.kids, "Children who qualify for the credits", 1);
  const bySelect = el(
    "select",
    { name: "by", attrs: { "aria-label": "On separate returns, who claims the children" } },
    option("a", "You", fields.by === "a"),
    option("b", "Your spouse", fields.by === "b"),
  );
  const stSelect = el(
    "select",
    { name: "st", attrs: { "aria-label": "State you live in" } },
    ...US_STATES.map((s) => option(s.code, s.name, s.code === fields.st)),
  );

  const resultContainer = el("div", { class: "tile-result", attrs: { "aria-live": "polite" } });

  function compute(): void {
    const state = data!.state(fields.st.toLowerCase());
    const r = compareFilingStatus(
      {
        wagesA: fields.a,
        wagesB: fields.b,
        qualifyingChildren: fields.kids,
        childrenClaimedBy: fields.by,
      },
      { federal: fed!, fica: fica!, ...(state ? { state } : {}) },
      credits!,
    );
    const fmt = (m: Money): string => m.format(ctx.locale);
    const net = (m: Money): string => (m.isNegative() ? `${fmt(m.multiply(-1))} back` : fmt(m));
    const lines: BreakdownLine[] = [
      {
        label: "Joint return: federal and state income tax",
        value: fmt(r.joint.federalIncomeTax.add(r.joint.stateIncomeTax)),
        citation: fed!.citation,
      },
      {
        label: "Joint return: Earned Income and Child Tax Credits",
        value: fmt(r.joint.eitc.add(r.joint.childTaxCredit)),
        citation: credits!.citation,
      },
      { label: "Joint return, after credits", value: net(r.joint.net), emphasis: true },
      {
        label: "Your separate return, after credits",
        value: net(r.separateA.net),
        citation: fed!.citation,
      },
      {
        label: "Your spouse's separate return, after credits",
        value: net(r.separateB.net),
        citation: fed!.citation,
      },
      { label: "Separate returns together", value: net(r.separateTotal), emphasis: true },
    ];
    if (r.joint.eitc.greaterThan(0))
      lines.push({
        label: "Earned Income Credit given up on separate returns",
        value: fmt(r.joint.eitc),
        citation: credits!.citation,
      });
    const diff = r.separateCostsMore;
    resultContainer.replaceChildren(
      resultCard({
        label: diff.isNegative()
          ? "Filing separately saves this year"
          : "Filing jointly saves this year",
        value: diff.isNegative() ? diff.multiply(-1) : diff,
        locale: ctx.locale,
        breakdown: lines,
        permalink: () => ctx.permalink(writeFields(fields)),
      }),
    );
  }

  function recompute(): void {
    fields = {
      a: parseNonNegative(aInput.value, 0),
      b: parseNonNegative(bInput.value, 0),
      kids: Math.min(10, Math.round(parseNonNegative(kidsInput.value, 0))),
      by: bySelect.value === "b" ? "b" : "a",
      st: stSelect.value || fields.st,
    };
    ctx.setParams(writeFields(fields));
    compute();
  }

  for (const i of [aInput, bInput, kidsInput]) i.addEventListener("input", recompute);
  for (const c of [bySelect, stSelect]) c.addEventListener("change", recompute);

  const tryExample = tryExampleButton(() => {
    fields = { ...EXAMPLE };
    aInput.value = String(fields.a);
    bInput.value = String(fields.b);
    kidsInput.value = String(fields.kids);
    bySelect.value = fields.by;
    stSelect.value = fields.st;
    recompute();
  });

  root.append(
    el(
      "form",
      { class: "tile-form", on: { submit: (e) => e.preventDefault() } },
      field("Your wages this year", aInput),
      field("Your spouse's wages this year", bInput),
      field("Children who qualify for the credits", kidsInput),
      field("On separate returns, who claims the children", bySelect),
      field("State you live in", stSelect),
      el("div", { class: "tile-form-actions" }, tryExample),
    ),
    resultContainer,
  );
  compute();
}
