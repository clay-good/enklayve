/**
 * Medicare Savings Programs & Extra Help, the interactive half (SPEC-5
 * Phase 30). Loaded on first use with its shard; the definition in
 * `medicareSavings.ts` stays in the shell. Screener-only: each row says
 * whether applying looks worth it, and never who is eligible.
 */
import { Money } from "../engine/money";
import { medicareSavingsScreen } from "../engine/medicareSavings";
import { el } from "../ui/dom";
import { field, parseNonNegative, tryExampleButton } from "../ui/form";
import { citationLink } from "../ui/resultCard";
import type { TileContext } from "./types";

interface Fields {
  couple: boolean;
  income: number;
  resources: number;
}

const EXAMPLE: Fields = { couple: false, income: 1500, resources: 6000 };

function readFields(p: URLSearchParams): Fields {
  return {
    couple: p.get("cpl") === "1",
    income: parseNonNegative(p.get("inc"), 0),
    resources: parseNonNegative(p.get("res"), 0),
  };
}

function writeFields(f: Fields): URLSearchParams {
  const p = new URLSearchParams();
  if (f.couple) p.set("cpl", "1");
  p.set("inc", String(f.income));
  p.set("res", String(f.resources));
  return p;
}

export function mountMedicareSavings(ctx: TileContext): void {
  const { root, data } = ctx;
  root.replaceChildren();
  const rules = data?.medicareSavings();
  if (!rules) {
    root.append(
      el("div", {
        class: "verify-banner",
        attrs: { role: "alert" },
        text: "The program limits are unavailable, so nothing is compared. Your state Medicaid agency or a SHIP counselor can tell you what applies.",
      }),
    );
    return;
  }
  let fields = readFields(ctx.params);

  const coupleBox = el("input", {
    type: "checkbox",
    name: "cpl",
    attrs: { "aria-label": "Married and living together" },
  });
  coupleBox.checked = fields.couple;
  const num = (name: string, value: number, label: string, step: number) =>
    el("input", {
      type: "number",
      name,
      min: 0,
      step,
      value,
      attrs: { "aria-label": label, inputmode: "decimal" },
    });
  const incomeInput = num("inc", fields.income, "Monthly income before taxes", 50);
  const resourcesInput = num("res", fields.resources, "Savings and other countable resources", 100);

  const resultContainer = el("div", { class: "tile-result", attrs: { "aria-live": "polite" } });

  function compute(): void {
    const r = medicareSavingsScreen(
      { couple: fields.couple, monthlyIncome: fields.income, resources: fields.resources },
      rules!,
    );
    const fmt = (n: number): string => Money.from(n).format(ctx.locale);
    const anyUnder = r.programs.some((p) => p.underIncomeLine) && r.underSavingsResourceLimit;
    const rows = r.programs.map((p) =>
      el(
        "li",
        { class: "msp-row" },
        el("strong", { text: p.name }),
        ` pays ${p.pays}. The federal line is ${fmt(p.monthlyIncomeLine)} a month. `,
        p.underIncomeLine
          ? "Your income is under it, so this is likely worth applying for."
          : "Your income is above it, but your state may set a higher line.",
      ),
    );
    const eh = r.extraHelp;
    const ehResources =
      eh.resources === "under"
        ? `Your savings are under its ${fmt(eh.resourceLimit)} limit.`
        : eh.resources === "under-with-burial"
          ? `Your savings are under its ${fmt(eh.resourceLimitWithBurial)} limit if you set some aside for burial.`
          : `Your savings are above its ${fmt(eh.resourceLimitWithBurial)} limit, though some things do not count.`;
    rows.push(
      el(
        "li",
        { class: "msp-row" },
        el("strong", { text: "Extra Help" }),
        ` lowers Part D costs to no more than ${Money.from(rules!.extraHelp.maxCopayPerDrug).format(ctx.locale)} a drug. The federal line is ${fmt(eh.annualIncomeLine)} a year. `,
        eh.underIncomeLine
          ? `Your income is under it. ${ehResources}`
          : `Your income is above it. ${ehResources}`,
      ),
    );
    resultContainer.replaceChildren(
      el("p", {
        class: "msp-state",
        attrs: { role: "note" },
        text: "These are federal lines. Many states go above them or do not count some income or savings, and only your state Medicaid agency and Social Security decide who is enrolled.",
      }),
      el(
        "p",
        { class: "msp-resources" },
        `The Medicare Savings Programs' federal savings limit is ${fmt(r.savingsResourceLimit)}. `,
        r.underSavingsResourceLimit
          ? "Yours are under it. "
          : "Yours are above it, but your home and usually one car do not count, and some states have no limit. ",
        citationLink(rules!.citation),
      ),
      el("ul", { class: "msp-programs" }, ...rows),
      el("p", {
        class: "msp-screen",
        text: anyUnder
          ? "A Medicare Savings Program also brings Extra Help without a separate application. A SHIP counselor can help you apply for free."
          : "Applying costs nothing, and a SHIP counselor can tell you what your state counts.",
      }),
    );
  }

  function recompute(): void {
    fields = {
      couple: coupleBox.checked,
      income: parseNonNegative(incomeInput.value, 0),
      resources: parseNonNegative(resourcesInput.value, 0),
    };
    ctx.setParams(writeFields(fields));
    compute();
  }

  incomeInput.addEventListener("input", recompute);
  resourcesInput.addEventListener("input", recompute);
  coupleBox.addEventListener("change", recompute);

  const tryExample = tryExampleButton(() => {
    fields = { ...EXAMPLE };
    coupleBox.checked = fields.couple;
    incomeInput.value = String(fields.income);
    resourcesInput.value = String(fields.resources);
    recompute();
  });

  root.append(
    el(
      "form",
      { class: "tile-form", on: { submit: (e) => e.preventDefault() } },
      field("Married and living together", coupleBox),
      field("Monthly income before taxes", incomeInput),
      field("Savings and other countable resources", resourcesInput),
      el("div", { class: "tile-form-actions" }, tryExample),
    ),
    resultContainer,
  );
  compute();
}
