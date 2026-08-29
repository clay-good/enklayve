/**
 * Medical Bill & EOB Checker (SPEC-4-safety-net §B1) — harm tier 3, screener-only.
 *
 * Two questions, kept separate because they fail differently:
 *
 * 1. **Does the plan's own math come out where the notice says it does?** Given
 *    the allowed amount and the plan's deductible / coinsurance / out-of-pocket
 *    maximum, recompute the member's share and compare. A mismatch is stated as
 *    a mismatch to ask about — never as an error proven. A second payer, a
 *    mid-year deductible reset, or a family accumulator all produce an innocent
 *    difference, and the tile says so next to the number.
 * 2. **Does this situation sit inside the No Surprises Act?** The user says
 *    where the care happened; we never infer it. The answer names the rule, the
 *    exclusions, and the notice-and-consent form that gives the protection up.
 *
 * What it never does is say "you don't owe this." Whether a particular bill is
 * a prohibited balance bill turns on facts we do not have — the provider's
 * contract, the facility's status on the day, whether a consent form was signed
 * — so the tile states the rule, says whether the *situation* appears to fall
 * inside its scope, and names the free federal channel to raise it through.
 * We do not price-benchmark and we do not adjudicate medical necessity.
 */
import { claimPatientResponsibility } from "../engine/finance";
import { el, option } from "../ui/dom";
import { field, parseNonNegative, tryExampleButton } from "../ui/form";
import { citationLink } from "../ui/resultCard";
import type { NoSurprisesData } from "../data/schemas";
import type { TileContext, TileDefinition } from "./types";

/**
 * Where the care happened, in the user's words. Each option maps to an entry in
 * the `no-surprises` shard, so the scope statement is the shard's text rather
 * than a paraphrase that could drift from it. `entryId` names the protection or
 * exclusion; `protected` says which list it is on.
 */
const SETTINGS: { id: string; label: string; entryId: string; isProtected: boolean }[] = [
  { id: "er", label: "An emergency room visit", entryId: "emergency-room", isProtected: true },
  {
    id: "post",
    label: "Care to stabilize me after an emergency",
    entryId: "post-stabilization",
    isProtected: true,
  },
  {
    id: "facility",
    label: "A visit to an in-network hospital, outpatient department, or surgical center",
    entryId: "in-network-facility",
    isProtected: true,
  },
  { id: "air", label: "An air ambulance", entryId: "air-ambulance", isProtected: true },
  { id: "ground", label: "A ground ambulance", entryId: "ground-ambulance", isProtected: false },
  {
    id: "other",
    label: "Somewhere else — a doctor's office, or an out-of-network facility",
    entryId: "other",
    isProtected: false,
  },
];

interface Fields {
  allowed: number;
  deductible: number;
  deductibleMet: number;
  coinsurancePct: number;
  oopMax: number;
  oopMet: number;
  billed: number;
  network: "in" | "out";
  setting: string;
}

const EXAMPLE: Fields = {
  allowed: 2000,
  deductible: 1500,
  deductibleMet: 0,
  coinsurancePct: 20,
  oopMax: 6000,
  oopMet: 0,
  billed: 950,
  network: "out",
  setting: "er",
};

function readFields(p: URLSearchParams): Fields {
  const network = p.get("net") === "in" ? "in" : EXAMPLE.network;
  const setting = SETTINGS.find((s) => s.id === p.get("set"))?.id ?? EXAMPLE.setting;
  return {
    allowed: parseNonNegative(p.get("alw"), EXAMPLE.allowed),
    deductible: parseNonNegative(p.get("ded"), EXAMPLE.deductible),
    deductibleMet: parseNonNegative(p.get("dmet"), EXAMPLE.deductibleMet),
    coinsurancePct: Math.min(100, parseNonNegative(p.get("coin"), EXAMPLE.coinsurancePct)),
    oopMax: parseNonNegative(p.get("oop"), EXAMPLE.oopMax),
    oopMet: parseNonNegative(p.get("omet"), EXAMPLE.oopMet),
    billed: parseNonNegative(p.get("bill"), EXAMPLE.billed),
    network: p.has("net") ? network : EXAMPLE.network,
    setting,
  };
}

function writeFields(f: Fields): URLSearchParams {
  const p = new URLSearchParams();
  p.set("alw", String(f.allowed));
  p.set("ded", String(f.deductible));
  p.set("dmet", String(f.deductibleMet));
  p.set("coin", String(f.coinsurancePct));
  p.set("oop", String(f.oopMax));
  p.set("omet", String(f.oopMet));
  p.set("bill", String(f.billed));
  p.set("net", f.network);
  p.set("set", f.setting);
  return p;
}

/** Innocent explanations for a plan-math gap, shown *with* the gap so the
 * number is never read as proof of an error. */
const MISMATCH_CAVEATS =
  "A gap does not mean the plan is wrong. A second payer, a deductible that reset partway through the year, a family rather than individual accumulator, or a copay the plan applies instead of coinsurance all produce a legitimate difference.";

export function mountEobChecker(ctx: TileContext): void {
  const { root, data } = ctx;
  root.replaceChildren();
  let fields = readFields(ctx.params);

  const num = (value: number, label: string, step = 100): HTMLInputElement =>
    el("input", {
      type: "number",
      min: 0,
      step,
      value,
      attrs: { "aria-label": label, inputmode: "decimal" },
    });

  const allowedInput = num(fields.allowed, "Allowed amount on the EOB");
  const billedInput = num(fields.billed, "Patient responsibility the notice shows");
  const deductibleInput = num(fields.deductible, "Your plan's deductible");
  const deductibleMetInput = num(fields.deductibleMet, "Deductible already met this year");
  const coinsuranceInput = num(fields.coinsurancePct, "Coinsurance percentage", 1);
  const oopMaxInput = num(fields.oopMax, "Your plan's out-of-pocket maximum");
  const oopMetInput = num(fields.oopMet, "Out-of-pocket maximum already met this year");

  const networkSelect = el(
    "select",
    { attrs: { "aria-label": "Network status on the notice" } },
    option("out", "Out-of-network", fields.network === "out"),
    option("in", "In-network", fields.network === "in"),
  );
  const settingSelect = el(
    "select",
    { attrs: { "aria-label": "Where the care happened" } },
    ...SETTINGS.map((s) => option(s.id, s.label, s.id === fields.setting)),
  );

  const resultContainer = el("div", { class: "tile-result", attrs: { "aria-live": "polite" } });

  /** Section 1: the plan's own math, recomputed and compared. */
  function planMathBlock(): HTMLElement {
    const share = claimPatientResponsibility({
      allowedAmount: fields.allowed,
      deductible: fields.deductible,
      deductibleMet: fields.deductibleMet,
      coinsuranceRate: fields.coinsurancePct / 100,
      outOfPocketMax: fields.oopMax,
      outOfPocketMet: fields.oopMet,
    });
    const expected = share.patientResponsibility;
    const gap = fields.billed - expected.toNumber();
    const matches = Math.abs(gap) <= 1;

    return el(
      "div",
      { class: "eob-block" },
      el("h3", { class: "eob-heading", text: "1. The plan's own math" }),
      el(
        "p",
        { class: "eob-figure" },
        `On your plan's terms, ${expected.format(ctx.locale)} of this claim lands on you: `,
        `${share.toDeductible.format(ctx.locale)} against the deductible you have left, plus ${share.coinsurance.format(ctx.locale)} of coinsurance`,
        share.cappedByOutOfPocketMax ? ", capped by your out-of-pocket maximum." : ".",
      ),
      el("p", {
        class: matches ? "eob-screen eob-screen--ok" : "eob-screen",
        text: matches
          ? `The notice shows ${Math.round(fields.billed).toLocaleString("en-US", { style: "currency", currency: "USD" })}, which reconciles with your plan's terms.`
          : `The notice shows ${Math.round(fields.billed).toLocaleString("en-US", { style: "currency", currency: "USD" })} — ${Math.abs(Math.round(gap)).toLocaleString("en-US", { style: "currency", currency: "USD" })} ${gap > 0 ? "more" : "less"} than your plan's terms produce. That is worth asking your plan about.`,
      }),
      matches ? null : el("p", { class: "eob-caveat", text: MISMATCH_CAVEATS }),
    );
  }

  /** Section 2: the No Surprises scope, straight from the shard. */
  function scopeBlock(ns: NoSurprisesData): HTMLElement {
    const setting = SETTINGS.find((s) => s.id === fields.setting) ?? SETTINGS[0]!;
    const entry = setting.isProtected
      ? ns.protections.find((p) => p.id === setting.entryId)
      : ns.exclusions.find((e) => e.id === setting.entryId);

    const block = el(
      "div",
      { class: "eob-block" },
      el("h3", { class: "eob-heading", text: "2. Does the No Surprises Act cover this?" }),
    );

    if (fields.network === "in") {
      block.append(
        el("p", {
          class: "eob-screen",
          text: "This claim is in-network, and the federal surprise-billing protections cover out-of-network charges. They are not the rule in play here — a plan-math question is, and that is section 1.",
        }),
      );
      return block;
    }

    block.append(
      el("p", {
        class: setting.isProtected ? "eob-screen eob-screen--ok" : "eob-screen",
        // Never "you are protected" / "you don't owe this": what the rule covers
        // is a fact; whether this bill falls inside it is not one we can know.
        text: setting.isProtected
          ? `${setting.label} is one of the situations the No Surprises Act covers. That is the rule; whether your bill is a prohibited balance bill turns on facts this page does not have, so it is a question to raise, not an answer.`
          : entry
            ? `${setting.label} is not covered by the No Surprises Act's billing protections.`
            : "This situation sits outside the settings the No Surprises Act covers.",
      }),
      el("p", { class: "eob-detail", text: entry?.detail ?? ns.waiver.label }),
      el("p", { class: "eob-detail", text: ns.waiver.detail }),
      el(
        "p",
        { class: "eob-cite" },
        `In effect since ${ns.effectiveFrom}. `,
        citationLink(ns.citation),
      ),
      el("h4", { class: "eob-subheading", text: "What the Act does not reach" }),
      el(
        "ul",
        { class: "eob-list" },
        ...ns.exclusions.map((e) => el("li", { text: `${e.label} — ${e.detail}` })),
      ),
      el("h4", { class: "eob-subheading", text: "Where to raise it, free" }),
      el(
        "ul",
        { class: "eob-list" },
        ...ns.channels.map((c) =>
          el(
            "li",
            {},
            el("a", {
              href: c.url,
              text: c.label,
              attrs: { rel: "noopener noreferrer", target: "_blank" },
            }),
            el("span", { text: ` — ${c.note}` }),
          ),
        ),
      ),
      el("p", { class: "eob-detail", text: ns.uninsured.detail }),
    );
    return block;
  }

  function compute(): void {
    const ns = data?.noSurprises() ?? null;
    resultContainer.replaceChildren(
      planMathBlock(),
      ns
        ? scopeBlock(ns)
        : el("div", {
            class: "verify-banner",
            attrs: { role: "alert" },
            text: "The No Surprises Act scope data is unavailable, so nothing is stated about it here. Call the federal No Surprises Help Desk on 1-800-985-3059 with any out-of-network bill you did not expect.",
          }),
      el("p", {
        class: "eob-limit",
        text: "This is a screener, not a determination. It does not tell you whether you owe a bill, does not compare what you were charged against typical prices, and does not judge whether care was medically necessary — all three need facts and judgment that belong to you, your plan, and the help desk.",
      }),
    );
  }

  function recompute(): void {
    fields = {
      allowed: parseNonNegative(allowedInput.value, 0),
      deductible: parseNonNegative(deductibleInput.value, 0),
      deductibleMet: parseNonNegative(deductibleMetInput.value, 0),
      coinsurancePct: Math.min(100, parseNonNegative(coinsuranceInput.value, 0)),
      oopMax: parseNonNegative(oopMaxInput.value, 0),
      oopMet: parseNonNegative(oopMetInput.value, 0),
      billed: parseNonNegative(billedInput.value, 0),
      network: networkSelect.value === "in" ? "in" : "out",
      setting: settingSelect.value,
    };
    ctx.setParams(writeFields(fields));
    compute();
  }

  for (const input of [
    allowedInput,
    billedInput,
    deductibleInput,
    deductibleMetInput,
    coinsuranceInput,
    oopMaxInput,
    oopMetInput,
  ]) {
    input.addEventListener("input", recompute);
  }
  networkSelect.addEventListener("change", recompute);
  settingSelect.addEventListener("change", recompute);

  const tryExample = tryExampleButton(() => {
    fields = { ...EXAMPLE };
    allowedInput.value = String(fields.allowed);
    billedInput.value = String(fields.billed);
    deductibleInput.value = String(fields.deductible);
    deductibleMetInput.value = String(fields.deductibleMet);
    coinsuranceInput.value = String(fields.coinsurancePct);
    oopMaxInput.value = String(fields.oopMax);
    oopMetInput.value = String(fields.oopMet);
    networkSelect.value = fields.network;
    settingSelect.value = fields.setting;
    recompute();
  });

  root.append(
    el(
      "form",
      { class: "tile-form", on: { submit: (e) => e.preventDefault() } },
      field("Allowed amount on the EOB", allowedInput),
      field("Patient responsibility the notice shows", billedInput),
      field("Your plan's deductible", deductibleInput),
      field("Deductible already met this year", deductibleMetInput),
      field("Coinsurance (%)", coinsuranceInput),
      field("Your plan's out-of-pocket maximum", oopMaxInput),
      field("Out-of-pocket maximum already met", oopMetInput),
      field("Network status on the notice", networkSelect),
      field("Where the care happened", settingSelect),
      el("div", { class: "tile-form-actions" }, tryExample),
    ),
    resultContainer,
  );
  compute();
}

export const eobCheckerTile: TileDefinition = {
  id: "eob-checker",
  title: "Medical Bill & EOB Checker",
  // Pillar 4 in substance (SPEC-4-safety-net §B1) even though it is hosted in
  // the Insurance & Protection hub, which is where someone looking at a health
  // claim actually goes. The harm-tier gate applies to any tile that declares a
  // tier, not only to tiles in the "rough" pillar, so the tier-3 bar is enforced
  // here exactly as it is on the charity-care screener.
  pillar: "rough",
  harmTier: 3,
  channels: [
    {
      label: "No Surprises Help Desk — 1-800-985-3059",
      url: "https://www.cms.gov/initiatives/your-patient-rights/medical-bill-rights/get-help",
      note: "Free, 7 days a week, with language support — questions and complaints",
    },
    {
      label: "CMS: find an action plan for your medical bill",
      url: "https://www.cms.gov/initiatives/your-patient-rights/medical-bill-rights/get-help/find-action-plan-your-medical-bill",
      note: "A few questions, then the steps that fit your situation",
    },
    {
      label: "Find free legal help near you",
      url: "https://www.lsc.gov/about-lsc/what-legal-aid/i-need-legal-help",
      note: "If a bill has gone to collections or a provider will not engage",
    },
  ],
  description: "Whether a health claim adds up, and whether federal surprise-billing rules apply.",
  keywords: [
    "eob",
    "explanation of benefits",
    "surprise bill",
    "balance billing",
    "no surprises act",
    "medical bill",
    "out of network",
    "coinsurance",
    "deductible",
  ],
  status: "ready",
  mount: mountEobChecker,
  how: "An Explanation of Benefits is not a bill, and the bill that follows it does not always match. This does two separate checks on the same claim, because they fail in different ways.\n\nThe first is arithmetic. Your plan's terms — the deductible, how much of it you have used, the coinsurance share, the out-of-pocket maximum — determine what one claim should cost you: the allowed amount fills what is left of the deductible, coinsurance applies to the rest, and the total is capped by what remains of your out-of-pocket maximum. That is a calculation, so it either reconciles with the notice or it does not. When it does not, the gap is a question worth asking, not proof of an error: a second payer, a deductible that reset mid-year, a family rather than individual accumulator, or a copay applied instead of coinsurance all produce a legitimate difference.\n\nThe second is the No Surprises Act, the federal law in effect since January 1, 2022. It bars a balance bill in three situations — an emergency room visit, care from an out-of-network provider during a visit to an in-network hospital, hospital outpatient department, or ambulatory surgical center, and air ambulance services — and it does not reach everything: ground ambulance is outside it, as are vision-only and dental-only plans, short-term and sharing-ministry plans, and fixed indemnity plans. Signing a notice and consent form gives the protection up. You tell this page where the care happened; it never guesses from a document.\n\nWhat it will not tell you is whether you owe the bill. That turns on the provider's contract, the facility's network status on the day, and whether a consent form was signed — facts this page does not have. It also does not compare what you were charged against typical prices and does not judge medical necessity. It gives you the rule, whether the situation appears to fall inside it, and the free federal channel to raise it through.\n\nThis is information about published federal rules applied to figures you entered. It is not legal, medical, or financial advice, and only your plan, your provider, and the help desk can resolve a specific bill.",
  resources: [
    {
      label: "CMS: know your rights with insurance",
      url: "https://www.cms.gov/initiatives/your-patient-rights/medical-bill-rights/know-your-medical-bill-rights/know-your-rights-insurance",
    },
    {
      label: "CMS: dispute a medical bill",
      url: "https://www.cms.gov/initiatives/your-patient-rights/medical-bill-rights/get-help/dispute-medical-bill",
    },
  ],
  related: [
    {
      hubId: "when-money-is-tight",
      tool: "charity-care",
      label: "Hospital Financial Assistance",
      note: "The discount a nonprofit hospital must let you ask for",
    },
    {
      hubId: "when-money-is-tight",
      tool: "bill-triage",
      label: "Bill Triage",
      note: "Where a medical bill sits against the rest of the month",
    },
  ],
};
