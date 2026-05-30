/**
 * Estate & Beneficiary Checklist tile (BUILD-SPEC-2 §6.6): a deterministic
 * checklist of the basics, not legal advice. It tracks how many essentials are
 * in place and what's left, encoding your progress in the URL so you can revisit
 * it. Actual document drafting and review belongs to the sibling product
 * vaulytica and to a qualified attorney — this is a calm starting point.
 */
import { Money } from "../engine/money";
import { el } from "../ui/dom";
import { field, tryExampleButton } from "../ui/form";
import { resultCard, type BreakdownLine } from "../ui/resultCard";
import type { TileContext, TileDefinition } from "./types";

interface Item {
  id: string;
  label: string;
}

const ITEMS: Item[] = [
  { id: "will", label: "A will that names an executor" },
  { id: "bene", label: "Beneficiaries named on retirement accounts and life insurance" },
  { id: "benecur", label: "Those beneficiaries are current (no ex-spouse or deceased)" },
  { id: "poa", label: "A durable financial power of attorney" },
  { id: "hcd", label: "A healthcare directive / medical power of attorney" },
  { id: "guard", label: "Guardianship named for any minor children" },
  { id: "tod", label: "Transfer-on-death / payable-on-death set on accounts" },
  { id: "letter", label: "A letter of instruction (where documents and accounts are)" },
];

const EXAMPLE_DONE = ["will", "bene", "poa", "hcd"];

function readDone(p: URLSearchParams): Set<string> {
  const raw = p.get("d");
  if (!raw) return new Set();
  const valid = new Set(ITEMS.map((i) => i.id));
  return new Set(raw.split(",").filter((id) => valid.has(id)));
}

function writeDone(done: Set<string>): URLSearchParams {
  const p = new URLSearchParams();
  // Keep checklist order stable in the URL for clean, reproducible links.
  const ordered = ITEMS.filter((i) => done.has(i.id)).map((i) => i.id);
  if (ordered.length > 0) p.set("d", ordered.join(","));
  return p;
}

export function mountEstateChecklist(ctx: TileContext): void {
  const { root } = ctx;
  root.replaceChildren();
  let done = readDone(ctx.params);

  const boxes = new Map<string, HTMLInputElement>();
  for (const item of ITEMS) {
    const box = el("input", {
      type: "checkbox",
      name: item.id,
      attrs: { "aria-label": item.label },
    });
    box.checked = done.has(item.id);
    boxes.set(item.id, box);
  }

  const resultContainer = el("div", { class: "tile-result", attrs: { "aria-live": "polite" } });

  function compute(): void {
    const count = done.size;
    const lines: BreakdownLine[] = [
      { label: "Items in place", value: `${count} of ${ITEMS.length}`, emphasis: true },
    ];
    for (const item of ITEMS) {
      lines.push({
        label: item.label,
        value: done.has(item.id) ? "✓ In place" : "To do",
      });
    }
    lines.push({
      label: "A note",
      value:
        "This is a checklist, not legal advice. Drafting and reviewing the documents belongs to a qualified attorney; the sibling product vaulytica can help you organize and review them.",
    });

    resultContainer.replaceChildren(
      resultCard({
        label: "Estate basics in place",
        value: Money.from(count),
        locale: ctx.locale,
        breakdown: lines,
        format: (n) => `${Math.round(n)} of ${ITEMS.length}`,
        copyText: `${count} of ${ITEMS.length}`,
        permalink: () => ctx.permalink(writeDone(done)),
      }),
    );
  }

  function recompute(): void {
    done = new Set(ITEMS.filter((i) => boxes.get(i.id)!.checked).map((i) => i.id));
    ctx.setParams(writeDone(done));
    compute();
  }

  for (const box of boxes.values()) box.addEventListener("change", recompute);

  const tryExample = tryExampleButton(() => {
    done = new Set(EXAMPLE_DONE);
    for (const item of ITEMS) boxes.get(item.id)!.checked = done.has(item.id);
    recompute();
  });

  const form = el(
    "form",
    { class: "tile-form", on: { submit: (e) => e.preventDefault() } },
    ...ITEMS.map((item) => field(item.label, boxes.get(item.id)!)),
    el("div", { class: "tile-form-actions" }, tryExample),
  );

  root.append(form, resultContainer);
  compute();
}

export const estateChecklistTile: TileDefinition = {
  id: "estate-checklist",
  title: "Estate & Beneficiary Checklist",
  pillar: "protect",
  description: "Track the estate basics that protect your family.",
  keywords: ["estate", "will", "beneficiary", "power of attorney", "checklist", "directive"],
  status: "ready",
  how: "Estate planning isn't only for the wealthy: it's how you spare your family confusion and delay at the hardest time. This is a plain checklist of the basics: a will, current beneficiaries on every account, powers of attorney for money and health, guardianship for young children, transfer-on-death designations, and a letter saying where everything is. Beneficiary designations on retirement and insurance accounts actually override your will, so keeping them current matters as much as the will itself.\n\nThis is a checklist, not legal advice, and it doesn't draft anything. Use it to see what's missing, then have the documents prepared and reviewed by a qualified attorney. The sibling product vaulytica can help you organize and review the documents themselves.",
  resources: [
    { label: "Consumer Financial Protection Bureau", url: "https://www.consumerfinance.gov/" },
    { label: "USA.gov", url: "https://www.usa.gov/" },
  ],
  mount: mountEstateChecklist,
};
