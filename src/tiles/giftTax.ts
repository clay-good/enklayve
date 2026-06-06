/**
 * Gift-tax exclusion tracker (SPEC-3 §4.4). "Is my gift to family taxable, or does
 * it sit under the annual exclusion / lifetime exemption?" Descriptive only — it
 * never advises whether to give. Reads the annual exclusion, the non-citizen-spouse
 * exclusion, and the lifetime exemption from a cited shard (IRS Rev. Proc.; IRC
 * §2503(b), §2010), degrading to the verify banner when the shard is missing.
 */
import { Money } from "../engine/money";
import { giftTaxImpact } from "../engine/giftTax";
import { el, option } from "../ui/dom";
import { field, parseNonNegative, tryExampleButton } from "../ui/form";
import { resultCard, type BreakdownLine } from "../ui/resultCard";
import type { TileContext, TileDefinition } from "./types";

type Recipient = "other" | "spouse" | "spouse_nc";

const RECIPIENTS: { value: Recipient; label: string }[] = [
  { value: "other", label: "Family or friend (not your spouse)" },
  { value: "spouse", label: "Spouse (US citizen)" },
  { value: "spouse_nc", label: "Spouse (not a US citizen)" },
];

interface Fields {
  gift: number;
  recipient: Recipient;
  lifetimeUsed: number;
}

const EXAMPLE: Fields = { gift: 50000, recipient: "other", lifetimeUsed: 0 };

function isRecipient(v: string): v is Recipient {
  return RECIPIENTS.some((r) => r.value === v);
}

function readFields(p: URLSearchParams): Fields {
  const r = p.get("r");
  return {
    gift: parseNonNegative(p.get("g"), 0),
    recipient: r && isRecipient(r) ? r : "other",
    lifetimeUsed: parseNonNegative(p.get("used"), 0),
  };
}

function writeFields(f: Fields): URLSearchParams {
  const p = new URLSearchParams();
  p.set("g", String(f.gift));
  p.set("r", f.recipient);
  if (f.lifetimeUsed > 0) p.set("used", String(f.lifetimeUsed));
  return p;
}

export function mountGiftTax(ctx: TileContext): void {
  const { root, data } = ctx;
  root.replaceChildren();
  const giftData = data?.giftTax();
  if (!giftData) {
    root.append(
      el("div", {
        class: "verify-banner",
        attrs: { role: "alert" },
        text: "Gift-tax data is unavailable, verify before relying on any figure.",
      }),
    );
    return;
  }
  let fields = readFields(ctx.params);

  const giftInput = el("input", {
    type: "number",
    name: "g",
    min: 0,
    step: 1000,
    value: fields.gift,
    attrs: { "aria-label": "Gift amount this year", inputmode: "decimal" },
  });
  const rSelect = el(
    "select",
    { name: "r", attrs: { "aria-label": "Who is the recipient" } },
    ...RECIPIENTS.map((r) => option(r.value, r.label, r.value === fields.recipient)),
  );
  const usedInput = el("input", {
    type: "number",
    name: "used",
    min: 0,
    step: 10000,
    value: fields.lifetimeUsed,
    attrs: { "aria-label": "Lifetime exemption already used", inputmode: "decimal" },
  });

  const resultContainer = el("div", { class: "tile-result", attrs: { "aria-live": "polite" } });

  function compute(): void {
    const r = giftTaxImpact(
      {
        giftAmount: fields.gift,
        recipientIsSpouse: fields.recipient !== "other",
        spouseIsUSCitizen: fields.recipient === "spouse",
        lifetimeExemptionUsed: fields.lifetimeUsed,
      },
      giftData!,
    );
    const fmt = (m: Money): string => m.format(ctx.locale);
    const lines: BreakdownLine[] = [];

    if (r.maritalDeduction) {
      lines.push({
        label: "Gifts to a US-citizen spouse",
        value: "Unlimited marital deduction — not a taxable gift, no Form 709 needed.",
        citation: giftData!.citation,
      });
    } else {
      lines.push(
        {
          label: "Annual exclusion (per recipient)",
          value: fmt(r.annualExclusion),
          citation: giftData!.citation,
        },
        { label: "Covered by the annual exclusion", value: fmt(r.exclusionApplied) },
        {
          label: "Taxable gift (over the exclusion)",
          value: fmt(r.taxableGift),
          emphasis: true,
          citation: giftData!.citation,
        },
        {
          label: "Lifetime exemption remaining after this gift",
          value: fmt(r.lifetimeExemptionRemaining),
          citation: giftData!.citation,
        },
        {
          label: "Form 709 gift-tax return required?",
          value: r.form709Required
            ? "Yes — the gift is over the annual exclusion (usually no tax, just the filing)."
            : "No — the gift is within the annual exclusion.",
        },
      );
      if (r.estimatedTaxDue.greaterThan(0)) {
        lines.push({
          label: "Estimated gift tax due (top rate, exemption exhausted)",
          value: fmt(r.estimatedTaxDue),
          citation: giftData!.citation,
        });
      }
    }
    lines.push({
      label: "Note",
      value:
        "Descriptive, not advice. The annual exclusion is per recipient per year, so gifts to different people each get their own. Splitting a gift with a spouse can double the exclusion (not modeled here).",
    });

    resultContainer.replaceChildren(
      resultCard({
        label: r.maritalDeduction ? "Taxable gift" : "Taxable gift (uses lifetime exemption)",
        value: r.taxableGift,
        locale: ctx.locale,
        breakdown: lines,
        permalink: () => ctx.permalink(writeFields(fields)),
      }),
    );
  }

  function recompute(): void {
    fields = {
      gift: parseNonNegative(giftInput.value, 0),
      recipient: isRecipient(rSelect.value) ? rSelect.value : "other",
      lifetimeUsed: parseNonNegative(usedInput.value, 0),
    };
    ctx.setParams(writeFields(fields));
    compute();
  }

  rSelect.addEventListener("change", recompute);
  for (const i of [giftInput, usedInput]) i.addEventListener("input", recompute);

  const tryExample = tryExampleButton(() => {
    fields = { ...EXAMPLE };
    giftInput.value = String(fields.gift);
    rSelect.value = fields.recipient;
    usedInput.value = String(fields.lifetimeUsed);
    recompute();
  });

  const form = el(
    "form",
    { class: "tile-form", on: { submit: (e) => e.preventDefault() } },
    field("Gift amount this year", giftInput),
    field("Recipient", rSelect),
    field("Lifetime exemption already used (optional)", usedInput),
    el("div", { class: "tile-form-actions" }, tryExample),
  );

  root.append(form, resultContainer);
  compute();
}

export const giftTaxTile: TileDefinition = {
  id: "gift-tax",
  title: "Gift Tax Checker",
  pillar: "paycheck",
  description:
    "Whether a gift is taxable, or sits under the annual exclusion and lifetime exemption.",
  keywords: [
    "gift tax",
    "annual exclusion",
    "lifetime exemption",
    "estate tax",
    "form 709",
    "709",
    "gifting",
    "2503",
  ],
  status: "ready",
  how: "Most gifts are never taxed. Each year you can give up to the annual exclusion to any one person with no tax and no paperwork; gifts to a US-citizen spouse are unlimited. Give more than the annual exclusion to one person and the excess isn't taxed either — it just draws down your large lifetime gift/estate exemption, and you file a Form 709 to track it. You'd only owe gift tax after the entire lifetime exemption is used up, at the 40% top rate.\n\nWe use the 2026 figures (IRS Rev. Proc. 2025-32): a $19,000 annual exclusion, a $194,000 exclusion for a non-citizen spouse, and a $15,000,000 lifetime exemption. This is descriptive — it tells you the tax treatment, never whether to make the gift.",
  resources: [
    {
      label: "IRS, frequently asked questions on gift taxes",
      url: "https://www.irs.gov/businesses/small-businesses-self-employed/frequently-asked-questions-on-gift-taxes",
    },
    { label: "IRS Form 709", url: "https://www.irs.gov/forms-pubs/about-form-709" },
  ],
  mount: mountGiftTax,
};
