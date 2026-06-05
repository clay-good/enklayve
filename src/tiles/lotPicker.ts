/**
 * Cost-Basis Lot Picker tile (BUILD-SPEC.md §3.2): the FIFO / specific-
 * identification cost-basis helper for the Capital Gains tools. Enter your lots
 * (shares, cost per share, and whether each is long-term), a sale price, and the
 * shares to sell; it returns the realized gain split into short- and long-term —
 * the character that feeds the Capital Gains tile. Pure arithmetic, no dataset.
 */
import { Money } from "../engine/money";
import { fifoSelect, costBasisGain, type CostLot, type LotSale } from "../engine/costBasis";
import { el, option, clear } from "../ui/dom";
import { field, parseNonNegative, tryExampleButton } from "../ui/form";
import { resultCard, type BreakdownLine } from "../ui/resultCard";
import type { TileContext, TileDefinition } from "./types";

type Method = "fifo" | "specific";

interface Lot {
  shares: number;
  costPerShare: number;
  longTerm: boolean;
  sellShares: number; // used in specific-ID mode
}

interface Fields {
  salePrice: number;
  method: Method;
  sharesToSell: number;
  lots: Lot[];
}

const EXAMPLE: Fields = {
  salePrice: 60,
  method: "fifo",
  sharesToSell: 150,
  lots: [
    { shares: 100, costPerShare: 10, longTerm: true, sellShares: 100 },
    { shares: 100, costPerShare: 20, longTerm: true, sellShares: 50 },
    { shares: 100, costPerShare: 50, longTerm: false, sellShares: 0 },
  ],
};

function readFields(p: URLSearchParams): Fields {
  // Cap the row count: a row editor never holds this many, and a crafted ?k=
  // must not allocate a runaway number of rows.
  const count = Math.min(100, Math.max(0, Math.round(parseNonNegative(p.get("k"), 0))));
  const lots: Lot[] = [];
  for (let i = 0; i < count; i++) {
    lots.push({
      shares: parseNonNegative(p.get(`s${i}`), 0),
      costPerShare: parseNonNegative(p.get(`b${i}`), 0),
      longTerm: p.get(`lt${i}`) !== "0",
      sellShares: parseNonNegative(p.get(`ss${i}`), 0),
    });
  }
  return {
    salePrice: parseNonNegative(p.get("px"), 0),
    method: p.get("m") === "specific" ? "specific" : "fifo",
    sharesToSell: parseNonNegative(p.get("n"), 0),
    lots,
  };
}

function writeFields(f: Fields): URLSearchParams {
  const p = new URLSearchParams();
  p.set("px", String(f.salePrice));
  if (f.method === "specific") p.set("m", "specific");
  else p.set("n", String(f.sharesToSell));
  p.set("k", String(f.lots.length));
  f.lots.forEach((lot, i) => {
    p.set(`s${i}`, String(lot.shares));
    p.set(`b${i}`, String(lot.costPerShare));
    p.set(`lt${i}`, lot.longTerm ? "1" : "0");
    if (f.method === "specific") p.set(`ss${i}`, String(lot.sellShares));
  });
  return p;
}

function salesOf(f: Fields): LotSale[] {
  const lots: CostLot[] = f.lots.map((l) => ({
    shares: l.shares,
    costPerShare: l.costPerShare,
    longTerm: l.longTerm,
  }));
  if (f.method === "fifo") return fifoSelect(lots, f.sharesToSell);
  return lots
    .map((lot, i) => ({ lot, sharesSold: Math.min(f.lots[i]!.sellShares, lot.shares) }))
    .filter((s) => s.sharesSold > 0);
}

export function mountLotPicker(ctx: TileContext): void {
  const { root } = ctx;
  root.replaceChildren();
  let fields = readFields(ctx.params);
  if (fields.lots.length === 0)
    fields = { ...fields, lots: [{ shares: 0, costPerShare: 0, longTerm: true, sellShares: 0 }] };

  const priceInput = el("input", {
    type: "number",
    name: "px",
    min: 0,
    step: 1,
    value: fields.salePrice,
    attrs: { "aria-label": "Sale price per share", inputmode: "decimal" },
  });
  const methodSelect = el(
    "select",
    { name: "m", attrs: { "aria-label": "Lot selection method" } },
    option("fifo", "FIFO (sell oldest first)", fields.method === "fifo"),
    option("specific", "Specific lots", fields.method === "specific"),
  );
  const sharesInput = el("input", {
    type: "number",
    name: "n",
    min: 0,
    step: 1,
    value: fields.sharesToSell,
    attrs: { "aria-label": "Total shares to sell", inputmode: "numeric" },
  });
  const sharesField = field("Total shares to sell", sharesInput);

  const lotsContainer = el("div", { class: "plan-debts" });
  const resultContainer = el("div", { class: "tile-result", attrs: { "aria-live": "polite" } });

  function persist(): void {
    ctx.setParams(writeFields(fields));
  }

  function compute(): void {
    const r = costBasisGain(fields.salePrice, salesOf(fields));
    const fmt = (m: Money): string => m.format(ctx.locale);

    const lines: BreakdownLine[] = [
      { label: "Shares sold", value: String(r.sharesSold) },
      { label: "Proceeds", value: fmt(r.totalProceeds) },
      { label: "Cost basis", value: fmt(r.totalBasis) },
    ];
    if (!r.shortTermGain.isZero())
      lines.push({ label: "Short-term gain (taxed as ordinary)", value: fmt(r.shortTermGain) });
    if (!r.longTermGain.isZero())
      lines.push({ label: "Long-term gain (preferential rate)", value: fmt(r.longTermGain) });
    lines.push({ label: "Total realized gain", value: fmt(r.totalGain), emphasis: true });

    resultContainer.replaceChildren(
      resultCard({
        label: "Realized gain on this sale",
        value: r.totalGain,
        locale: ctx.locale,
        breakdown: lines,
        permalink: () => ctx.permalink(writeFields(fields)),
      }),
    );
  }

  function renderLots(): void {
    clear(lotsContainer);
    sharesField.hidden = fields.method === "specific";
    fields.lots.forEach((lot, i) => {
      const shares = el("input", {
        type: "number",
        min: 0,
        step: 1,
        value: lot.shares,
        attrs: { "aria-label": `Lot ${i + 1} shares`, inputmode: "numeric" },
        on: {
          input: (e) => {
            fields.lots[i] = {
              ...lot,
              shares: parseNonNegative((e.target as HTMLInputElement).value, 0),
            };
            persist();
            compute();
          },
        },
      });
      const basis = el("input", {
        type: "number",
        min: 0,
        step: 1,
        value: lot.costPerShare,
        attrs: { "aria-label": `Lot ${i + 1} cost per share`, inputmode: "decimal" },
        on: {
          input: (e) => {
            fields.lots[i] = {
              ...fields.lots[i]!,
              costPerShare: parseNonNegative((e.target as HTMLInputElement).value, 0),
            };
            persist();
            compute();
          },
        },
      });
      const longTerm = el("input", {
        type: "checkbox",
        attrs: { "aria-label": `Lot ${i + 1} held over one year` },
      });
      longTerm.checked = lot.longTerm;
      longTerm.addEventListener("change", () => {
        fields.lots[i] = { ...fields.lots[i]!, longTerm: longTerm.checked };
        persist();
        compute();
      });
      const cells = [
        field("Shares", shares),
        field("Cost / share", basis),
        field("Long-term", longTerm),
      ];
      if (fields.method === "specific") {
        const sell = el("input", {
          type: "number",
          min: 0,
          step: 1,
          value: lot.sellShares,
          attrs: { "aria-label": `Lot ${i + 1} shares to sell`, inputmode: "numeric" },
          on: {
            input: (e) => {
              fields.lots[i] = {
                ...fields.lots[i]!,
                sellShares: parseNonNegative((e.target as HTMLInputElement).value, 0),
              };
              persist();
              compute();
            },
          },
        });
        cells.push(field("Sell", sell));
      }
      const remove = el("button", {
        type: "button",
        class: "btn btn--ghost",
        text: "Remove",
        attrs: { "aria-label": `Remove lot ${i + 1}` },
        on: {
          click: () => {
            fields.lots = fields.lots.filter((_, j) => j !== i);
            persist();
            renderLots();
            compute();
          },
        },
      });
      lotsContainer.append(el("div", { class: "plan-debt-row" }, ...cells, remove));
    });
    lotsContainer.append(
      el("button", {
        type: "button",
        class: "btn btn--ghost plan-add-debt",
        text: "+ Add a lot",
        on: {
          click: () => {
            fields.lots = [
              ...fields.lots,
              { shares: 0, costPerShare: 0, longTerm: true, sellShares: 0 },
            ];
            persist();
            renderLots();
            compute();
          },
        },
      }),
    );
  }

  priceInput.addEventListener("input", () => {
    fields.salePrice = parseNonNegative(priceInput.value, 0);
    persist();
    compute();
  });
  sharesInput.addEventListener("input", () => {
    fields.sharesToSell = parseNonNegative(sharesInput.value, 0);
    persist();
    compute();
  });
  methodSelect.addEventListener("change", () => {
    fields.method = methodSelect.value === "specific" ? "specific" : "fifo";
    persist();
    renderLots();
    compute();
  });

  const tryExample = tryExampleButton(() => {
    fields = {
      salePrice: EXAMPLE.salePrice,
      method: EXAMPLE.method,
      sharesToSell: EXAMPLE.sharesToSell,
      lots: EXAMPLE.lots.map((l) => ({ ...l })),
    };
    priceInput.value = String(fields.salePrice);
    methodSelect.value = fields.method;
    sharesInput.value = String(fields.sharesToSell);
    persist();
    renderLots();
    compute();
  });

  const form = el(
    "form",
    { class: "tile-form", on: { submit: (e) => e.preventDefault() } },
    field("Sale price per share", priceInput),
    field("Method", methodSelect),
    sharesField,
    el("p", { class: "field-group-label", text: "Your lots (oldest first)" }),
    lotsContainer,
    el("div", { class: "tile-form-actions" }, tryExample),
  );

  root.append(form, resultContainer);
  renderLots();
  compute();
}

export const lotPickerTile: TileDefinition = {
  id: "cost-basis",
  title: "Cost-Basis Lot Picker",
  pillar: "investing",
  description: "FIFO or specific-ID cost basis for a stock sale.",
  keywords: ["cost basis", "fifo", "specific identification", "lots", "capital gains", "shares"],
  status: "ready",
  how: "When you sell part of a position you bought at different prices, which shares you sell changes your taxable gain. Two methods: FIFO sells your oldest lots first (the broker default), while specific identification lets you choose exactly which lots go, often to harvest losses or favor long-term shares. Enter each lot's shares, cost per share, and whether it's long-term (held more than one year), then a sale price.\n\nWe split the realized gain into short-term (taxed as ordinary income) and long-term (the preferential capital-gains rate), because the character matters as much as the amount. Feed the result into the Capital Gains tile to see the tax. Pure arithmetic on your numbers: confirm your broker's basis records, especially after splits or reinvested dividends.",
  resources: [
    {
      label: "IRS Publication 550 (cost basis)",
      url: "https://www.irs.gov/publications/p550",
    },
    { label: "IRS Topic No. 409", url: "https://www.irs.gov/taxtopics/tc409" },
  ],
  mount: mountLotPicker,
};
