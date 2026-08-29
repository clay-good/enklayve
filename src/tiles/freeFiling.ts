/**
 * Free Filing & Free Help (SPEC-4 §A5) — harm tier 1.
 *
 * "Do I have to pay to file?" For most households the answer is no, and they pay
 * anyway, because the paid products are the ones with the advertising budget.
 * This is the cheapest real money the site can hand someone: a few published
 * eligibility tests, applied to figures the profile already knows.
 *
 * Two design choices carry the honesty here. Channels the household *doesn't*
 * qualify for are shown with the exact reason, so nobody is left wondering what
 * was skipped. And channels the IRS has discontinued are listed as checked and
 * unavailable, so an absence reads as a verified fact rather than a stale list.
 */
import { freeFilingOptions, type ChannelEligibility } from "../engine/freeFiling";
import { el } from "../ui/dom";
import { field, parseNonNegative, tryExampleButton } from "../ui/form";
import type { TileContext, TileDefinition } from "./types";

interface Fields {
  agi: number;
  age: number;
  military: boolean;
  disability: boolean;
  limitedEnglish: boolean;
}

const EXAMPLE: Fields = {
  agi: 41000,
  age: 34,
  military: false,
  disability: false,
  limitedEnglish: false,
};

function readFields(p: URLSearchParams, defaultIncome: number): Fields {
  return {
    agi: p.has("agi") ? parseNonNegative(p.get("agi"), 0) : defaultIncome,
    age: Math.min(120, Math.round(parseNonNegative(p.get("age"), 0))),
    military: p.get("mil") === "1",
    disability: p.get("dis") === "1",
    limitedEnglish: p.get("lep") === "1",
  };
}

function writeFields(f: Fields): URLSearchParams {
  const p = new URLSearchParams();
  p.set("agi", String(f.agi));
  p.set("age", String(f.age));
  if (f.military) p.set("mil", "1");
  if (f.disability) p.set("dis", "1");
  if (f.limitedEnglish) p.set("lep", "1");
  return p;
}

function checkbox(label: string, checked: boolean, onChange: (v: boolean) => void): HTMLElement {
  const input = el("input", {
    type: "checkbox",
    checked,
    on: { change: (e) => onChange((e.target as HTMLInputElement).checked) },
  });
  return el("label", { class: "checkbox" }, input, el("span", { text: label }));
}

function channelItem(e: ChannelEligibility, eligible: boolean): HTMLElement {
  return el(
    "li",
    { class: `ff-channel ff-channel--${eligible ? "yes" : "no"}` },
    el(
      "p",
      { class: "ff-channel__head" },
      el("a", {
        href: e.channel.url,
        text: e.channel.label,
        attrs: { rel: "noopener noreferrer", target: "_blank" },
      }),
    ),
    el("p", { class: "ff-channel__reason", text: e.reason }),
    eligible ? el("p", { class: "ff-channel__note", text: e.channel.note }) : null,
  );
}

export function mountFreeFiling(ctx: TileContext): void {
  const { root, data } = ctx;
  root.replaceChildren();
  const rules = data?.freeFiling();
  if (!rules) {
    root.append(
      el("div", {
        class: "verify-banner",
        attrs: { role: "alert" },
        text: "The free-filing eligibility data is unavailable. Check IRS.gov directly, and verify before relying on any figure.",
      }),
    );
    return;
  }

  let fields = readFields(ctx.params, ctx.profile.get("annualIncome") ?? EXAMPLE.agi);

  const agiInput = el("input", {
    type: "number",
    min: 0,
    step: 1000,
    value: fields.agi,
    attrs: { "aria-label": "Adjusted gross income", inputmode: "decimal" },
  });
  const ageInput = el("input", {
    type: "number",
    min: 0,
    max: 120,
    step: 1,
    value: fields.age,
    attrs: { "aria-label": "Your age", inputmode: "numeric" },
  });
  const resultContainer = el("div", { class: "tile-result", attrs: { "aria-live": "polite" } });

  function compute(): void {
    const r = freeFilingOptions(
      {
        adjustedGrossIncome: fields.agi,
        age: fields.age,
        military: fields.military,
        disability: fields.disability,
        limitedEnglish: fields.limitedEnglish,
      },
      rules!,
    );

    const nodes: HTMLElement[] = [
      el("p", {
        class: "ff-lead",
        text: `You can file your federal return for free through ${r.eligible.length} of these ${rules!.channels.length} options. Tax year ${r.taxYear}, filed in ${r.filingSeason}.`,
      }),
      el("h3", { class: "ff-heading", text: "Open to you" }),
      el("ul", { class: "ff-list" }, ...r.eligible.map((e) => channelItem(e, true))),
    ];

    if (r.ineligible.length > 0) {
      nodes.push(
        el("h3", { class: "ff-heading", text: "Not open to you, and why" }),
        el("ul", { class: "ff-list" }, ...r.ineligible.map((e) => channelItem(e, false))),
      );
    }
    if (r.omitted.length > 0) {
      nodes.push(
        el("h3", { class: "ff-heading", text: "Checked, and not available this year" }),
        el(
          "ul",
          { class: "ff-list" },
          ...r.omitted.map((o) =>
            el(
              "li",
              { class: "ff-channel ff-channel--gone" },
              el(
                "p",
                { class: "ff-channel__head" },
                el("a", {
                  href: o.url,
                  text: o.label,
                  attrs: { rel: "noopener noreferrer", target: "_blank" },
                }),
              ),
              el("p", { class: "ff-channel__reason", text: o.reason }),
            ),
          ),
        ),
      );
    }
    nodes.push(
      el(
        "p",
        { class: "ff-source" },
        "Thresholds from ",
        el("a", {
          href: rules!.citation.sourceUrl,
          text: rules!.citation.sourceDocument,
          attrs: { rel: "noopener noreferrer", target: "_blank" },
        }),
        ". These change every filing season, and each Free File partner sets extra criteria of its own, so open the official page before you start.",
      ),
    );

    resultContainer.replaceChildren(...nodes);
  }

  function recompute(): void {
    fields = {
      ...fields,
      agi: parseNonNegative(agiInput.value, 0),
      age: Math.min(120, Math.round(parseNonNegative(ageInput.value, 0))),
    };
    ctx.setParams(writeFields(fields));
    compute();
  }

  agiInput.addEventListener("input", recompute);
  ageInput.addEventListener("input", recompute);

  const milBox = checkbox("Someone in the household is in the military community", fields.military, (v) => {
    fields.military = v;
    recompute();
  });
  const disBox = checkbox("Someone filing has a disability", fields.disability, (v) => {
    fields.disability = v;
    recompute();
  });
  const lepBox = checkbox("You'd rather get help in a language other than English", fields.limitedEnglish, (v) => {
    fields.limitedEnglish = v;
    recompute();
  });

  const tryExample = tryExampleButton(() => {
    fields = { ...EXAMPLE };
    agiInput.value = String(fields.agi);
    ageInput.value = String(fields.age);
    for (const [box, on] of [
      [milBox, fields.military],
      [disBox, fields.disability],
      [lepBox, fields.limitedEnglish],
    ] as const) {
      const input = box.querySelector("input");
      if (input) input.checked = on;
    }
    recompute();
  });

  root.append(
    el(
      "form",
      { class: "tile-form", on: { submit: (e) => e.preventDefault() } },
      field("Adjusted gross income", agiInput),
      field("Your age", ageInput),
      el("div", { class: "ff-conditions" }, milBox, disBox, lepBox),
      el("div", { class: "tile-form-actions" }, tryExample),
    ),
    resultContainer,
  );
  compute();
}

export const freeFilingTile: TileDefinition = {
  id: "free-filing",
  title: "Do I Have to Pay to File?",
  pillar: "rough",
  harmTier: 1,
  description: "The free ways to file your taxes, and which ones you qualify for.",
  keywords: [
    "free file",
    "free tax filing",
    "VITA",
    "TCE",
    "MilTax",
    "tax prep",
    "file taxes free",
    "AARP tax aide",
  ],
  status: "ready",
  mount: mountFreeFiling,
  how: "Most households can file a federal return for nothing, and a great many pay anyway. That's not an accident: the paid products have the advertising budget, and the free ones have a .gov page and no marketing at all.\n\nThe rules are small and published, so this just applies them. An income ceiling for the guided software, a lower one for free in-person help, an age of 60 for the retirement-focused volunteers, and no ceiling at all for the plain electronic forms or for the military community. Two routes are easy to miss reading the raw rules: the in-person program is open to people with disabilities and to taxpayers who'd rather work in another language, regardless of the income guideline.\n\nOptions you don't qualify for are listed too, with the exact reason and how far off you are, so nothing looks quietly skipped. So are options the IRS has discontinued, so their absence reads as something we checked rather than a list we forgot to update.\n\nThese thresholds move every filing season, and each Free File partner adds criteria of its own, so treat this as the map and the official page as the territory.",
  resources: [
    { label: "IRS Free File", url: "https://www.irs.gov/filing/irs-free-file-do-your-taxes-for-free" },
    {
      label: "Find a free tax-prep site near you (VITA / TCE)",
      url: "https://www.irs.gov/individuals/free-tax-return-preparation-for-qualifying-taxpayers",
    },
    { label: "MilTax, for the military community", url: "https://www.militaryonesource.mil/financial-legal/tax-resource-center/" },
  ],
  related: [
    {
      hubId: "benefits",
      tool: "eitc",
      label: "Earned Income Tax Credit",
      note: "A credit worth filing for even if you owe nothing",
    },
    {
      hubId: "when-money-is-tight",
      tool: "bill-triage",
      label: "Bill Triage",
      note: "When the month doesn't close",
    },
  ],
};
