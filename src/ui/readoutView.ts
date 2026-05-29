/**
 * The Readout view (BUILD-SPEC-2 §2): the hero experience. Drop a typed pay
 * stub, W-2, or 1040 and get an instant private readout, parsed entirely on the
 * device. Extraction is deterministic and anchored (never inferred); every value
 * is shown with its confidence and a needs-review flag, and the user confirms
 * before anything flows into My Situation. Nothing is uploaded — the strict
 * CSP keeps `connect-src 'none'`, so the browser physically cannot send the
 * document anywhere.
 */
import { el, clear, option } from "./dom";
import { field } from "./form";
import { extractDocument, labelFor } from "../readout/extract";
import { applyToSituation } from "../readout/toSituation";
import { extractTextFromFile, type TextExtractor } from "../readout/extractText";
import type { ExtractedField, ExtractionResult } from "../readout/types";
import type { SituationStore } from "../profile/situation";
import type { FilingStatus } from "../data/schemas";

const FILING_LABELS: Record<FilingStatus, string> = {
  single: "Single",
  married_jointly: "Married filing jointly",
  married_separately: "Married filing separately",
  head_of_household: "Head of household",
  qualifying_surviving_spouse: "Qualifying surviving spouse",
};

const CONFIDENCE_LABEL = {
  high: "high confidence",
  "needs-review": "review",
  low: "low confidence",
} as const;

export interface RenderReadoutOptions {
  container: HTMLElement;
  navigate: (id: string | null) => void;
  profile: SituationStore;
  /** Injectable for tests; defaults to the real on-device extractor. */
  extractor?: TextExtractor;
}

function confidenceBadge(field: ExtractedField): HTMLElement {
  const cls =
    field.confidence === "high"
      ? "badge badge--good"
      : field.confidence === "low"
        ? "badge badge--warn"
        : "badge badge--soon";
  return el("span", { class: cls, text: CONFIDENCE_LABEL[field.confidence] });
}

/** A friendly, deterministic plain-English line from the confirmed fields. */
function summaryLine(fields: ExtractedField[]): string {
  const income = fields.find((f) => f.target === "annualIncome");
  const status = fields.find((f) => f.target === "filingStatus");
  const parts: string[] = [];
  if (income && typeof income.value === "number") {
    parts.push(
      `income of ${income.value.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 })}`,
    );
  }
  if (status && typeof status.value === "string") {
    parts.push(`filing as ${FILING_LABELS[status.value as FilingStatus].toLowerCase()}`);
  }
  return parts.length > 0
    ? `Here's where you stand: ${parts.join(", ")}.`
    : "Your values are ready to review.";
}

export function renderReadout(opts: RenderReadoutOptions): void {
  const { container, navigate, profile } = opts;
  const extractor = opts.extractor ?? extractTextFromFile;
  clear(container);
  document.title = "The Readout — enklayve";

  const back = el(
    "button",
    { type: "button", class: "btn btn--ghost back-link", on: { click: () => navigate(null) } },
    "← Home",
  );
  const head = el(
    "div",
    { class: "tile-head" },
    back,
    el("h1", { class: "tile-title", text: "The Readout" }),
    el("p", {
      class: "tile-desc",
      text: "Drop a typed pay stub, W-2, or 1040 and get an instant private readout. Parsed on your device — never uploaded.",
    }),
  );

  const status = el("p", { class: "readout-status", attrs: { "aria-live": "polite" }, text: "" });
  const resultRegion = el("div", { class: "readout-result", attrs: { "aria-live": "polite" } });

  const fileInput = el("input", {
    type: "file",
    class: "readout-file",
    name: "readout-file",
    attrs: {
      accept: ".pdf,.txt,.text,application/pdf,text/plain",
      "aria-label": "Choose a document to read on your device",
    },
    on: {
      change: (e) => {
        const f = (e.target as HTMLInputElement).files?.[0];
        if (f) void handleFile(f);
      },
    },
  });

  const dropzone = el(
    "label",
    {
      class: "readout-dropzone readout-dropzone--live",
      on: {
        dragover: (e) => {
          e.preventDefault();
          dropzone.classList.add("is-dragover");
        },
        dragleave: () => dropzone.classList.remove("is-dragover"),
        drop: (e) => {
          e.preventDefault();
          dropzone.classList.remove("is-dragover");
          const f = (e as DragEvent).dataTransfer?.files?.[0];
          if (f) void handleFile(f);
        },
      },
    },
    el("span", { class: "readout-dropzone-icon", attrs: { "aria-hidden": "true" }, text: "⤓" }),
    el("span", { class: "readout-dropzone-title", text: "Drop a file here, or choose one" }),
    el("span", {
      class: "readout-dropzone-sub",
      text: "Typed PDF or text. Scanned images need OCR, which lands with offline support.",
    }),
    fileInput,
  );

  async function handleFile(file: File): Promise<void> {
    clear(resultRegion);
    status.textContent = "Reading on your device…";
    try {
      const text = await extractor(file);
      const result = extractDocument(text);
      status.textContent = "";
      renderResult(result);
    } catch (err) {
      status.textContent = (err as Error).message;
    }
  }

  function renderResult(result: ExtractionResult): void {
    clear(resultRegion);

    for (const w of result.warnings) {
      resultRegion.append(
        el("p", {
          class: result.recognized ? "readout-note" : "readout-note readout-note--warn",
          text: w,
        }),
      );
    }

    if (result.fields.length === 0) {
      resultRegion.append(
        el(
          "div",
          { class: "readout-actions" },
          el("button", {
            type: "button",
            class: "btn btn--accent",
            text: "Enter values in My Situation →",
            on: { click: () => navigate("your-plan") },
          }),
        ),
      );
      return;
    }

    const source = result.source === "ocr" ? "optical character recognition" : "the typed document";
    resultRegion.append(
      el("p", {
        class: "readout-detected",
        text: `Recognized a ${labelFor(result.kind)}${result.revision ? ` (${result.revision})` : ""}, read from ${source}.`,
      }),
    );
    if (result.citation) {
      resultRegion.append(
        el(
          "p",
          { class: "readout-cite" },
          el("span", { text: `Form: ${result.citation.sourceDocument} ` }),
          el(
            "a",
            {
              class: "cite-link",
              href: result.citation.sourceUrl,
              attrs: { rel: "noopener noreferrer", target: "_blank" },
            },
            "source",
          ),
        ),
      );
    }

    // An editable copy so the user confirms (and can correct) before anything is used.
    const working: ExtractedField[] = result.fields.map((f) => ({ ...f }));

    const list = el("div", { class: "tile-form readout-fields" });
    working.forEach((f, i) => {
      if (f.target === "filingStatus") {
        const sel = el(
          "select",
          {
            name: f.id,
            attrs: { "aria-label": f.label },
            on: {
              change: (e) => (working[i] = { ...f, value: (e.target as HTMLSelectElement).value }),
            },
          },
          ...(Object.keys(FILING_LABELS) as FilingStatus[]).map((s) =>
            option(s, FILING_LABELS[s], s === f.value),
          ),
        );
        list.append(wrapField(f, sel));
      } else {
        const input = el("input", {
          type: "number",
          name: f.id,
          step: 1,
          value: typeof f.value === "number" ? f.value : "",
          attrs: { "aria-label": f.label, inputmode: "decimal" },
          on: {
            input: (e) => {
              const v = Number((e.target as HTMLInputElement).value);
              working[i] = { ...f, value: Number.isFinite(v) ? v : 0 };
            },
          },
        });
        list.append(wrapField(f, input));
      }
    });

    const confirm = el("button", {
      type: "button",
      class: "btn btn--accent",
      text: "Confirm and add to My Situation",
      on: {
        click: () => {
          const applied = applyToSituation(profile, working);
          renderSummary(working, applied);
        },
      },
    });

    resultRegion.append(list, el("div", { class: "readout-actions" }, confirm));
  }

  function wrapField(f: ExtractedField, control: HTMLElement): HTMLElement {
    const labelRow = el(
      "span",
      { class: "readout-field-label" },
      el("span", { text: f.label }),
      confidenceBadge(f),
    );
    const wrapped = field(f.label, control);
    // Replace the plain label with one that carries the confidence badge.
    const existingLabel = wrapped.querySelector("label");
    if (existingLabel)
      existingLabel.replaceWith(el("span", { class: "field-label-wrap" }, labelRow));
    if (f.note) wrapped.append(el("span", { class: "readout-field-note", text: f.note }));
    return wrapped;
  }

  function renderSummary(fields: ExtractedField[], applied: number): void {
    clear(resultRegion);
    resultRegion.append(
      el(
        "section",
        { class: "readout-summary", attrs: { "aria-label": "Your readout" } },
        el("p", { class: "readout-summary-line", text: summaryLine(fields) }),
        el("p", {
          class: "readout-note",
          text:
            applied > 0
              ? `Added ${applied} value${applied === 1 ? "" : "s"} to My Situation (provenance: from a document). Open My Situation in the header to review or export them.`
              : "Nothing was added — adjust the values and confirm again.",
        }),
        el(
          "div",
          { class: "readout-actions" },
          el("button", {
            type: "button",
            class: "btn btn--accent",
            text: "See My Plan →",
            on: { click: () => navigate("your-plan") },
          }),
          el("button", {
            type: "button",
            class: "btn btn--ghost",
            text: "My Readout Report →",
            on: { click: () => navigate("report") },
          }),
          el("button", {
            type: "button",
            class: "btn btn--ghost",
            text: "Read another document",
            on: {
              click: () => {
                fileInput.value = "";
                clear(resultRegion);
                status.textContent = "";
              },
            },
          }),
        ),
      ),
    );
  }

  const privacy = el("p", {
    class: "readout-privacy",
    text: "Everything here is computed on your device. The Content-Security-Policy keeps connect-src 'none', so your documents cannot leave the page.",
  });

  container.append(el("article", { class: "tile" }, head, dropzone, status, resultRegion, privacy));
}
