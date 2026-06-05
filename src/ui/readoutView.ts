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
import { importProfile, isEncrypted, readFileText } from "../profile/portable";
import { buildReport } from "../readout/report";
import type { ExtractedField, ExtractionResult } from "../readout/types";
import type { SituationStore } from "../profile/situation";
import type { BundledData } from "../data/browser";
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

/**
 * A dropped `.json` is a previously-saved situation to restore, not a tax
 * document to parse — no document the extractors read is JSON, so this split is
 * unambiguous and keeps the extraction path untouched.
 */
function isSituationFile(file: File): boolean {
  return file.name.toLowerCase().endsWith(".json") || file.type === "application/json";
}

export interface RenderReadoutOptions {
  container: HTMLElement;
  navigate: (id: string | null) => void;
  profile: SituationStore;
  /** Bundled datasets, so the summary can show the tax rate and the next step. */
  data?: BundledData | null;
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
  const data = opts.data ?? null;
  const extractor = opts.extractor ?? extractTextFromFile;
  clear(container);
  document.title = "The Readout · enklayve";

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
      text: "Drop a typed pay stub, W-2, 1040, 1099, 1095-A, 1098 mortgage statement, or FAFSA Submission Summary and get an instant private readout. Parsed on your device, never uploaded.",
    }),
  );

  const status = el("p", { class: "readout-status", attrs: { "aria-live": "polite" }, text: "" });
  const resultRegion = el("div", { class: "readout-result", attrs: { "aria-live": "polite" } });

  const fileInput = el("input", {
    type: "file",
    class: "readout-file",
    name: "readout-file",
    attrs: {
      accept:
        ".pdf,.docx,.txt,.text,.png,.jpg,.jpeg,.webp,.bmp,.gif,.tif,.tiff,.json,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain,application/json,image/*",
      "aria-label": "Choose a document to read, or a saved situation (.json) to restore",
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
      text: "Typed PDF, Word (.docx), text, or a scanned image (PNG/JPG). Images are read on-device with OCR and flagged for review. Already have a saved situation? Drop its .json here to restore it.",
    }),
    fileInput,
  );

  async function handleFile(file: File): Promise<void> {
    clear(resultRegion);
    // A saved enklayve situation (.json) is a restore, not a document to parse.
    if (isSituationFile(file)) {
      await handleRestore(file);
      return;
    }
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

  /** Restore a saved situation file (plain or encrypted) into the profile. */
  async function handleRestore(file: File): Promise<void> {
    status.textContent = "";
    try {
      const text = await readFileText(file);
      if (isEncrypted(text)) {
        renderUnlock(text);
        return;
      }
      await importProfile(profile, text);
      renderRestored();
    } catch (e) {
      status.textContent = `That .json isn't a saved enklayve situation: ${(e as Error).message}`;
    }
  }

  /** An encrypted situation needs its passphrase before it can be restored. */
  function renderUnlock(text: string): void {
    clear(resultRegion);
    const pass = el("input", {
      type: "password",
      class: "portable-pass",
      name: "restore-passphrase",
      attrs: {
        placeholder: "Passphrase",
        autocomplete: "off",
        "aria-label": "Passphrase to open the encrypted situation file",
      },
    });
    const msg = el("p", {
      class: "readout-note",
      attrs: { "aria-live": "polite" },
      text: "That file is encrypted. Enter its passphrase to restore your situation.",
    });
    async function doUnlock(): Promise<void> {
      try {
        await importProfile(profile, text, pass.value.trim());
        renderRestored();
      } catch (e) {
        msg.textContent = (e as Error).message;
      }
    }
    const unlock = el("button", {
      type: "button",
      class: "btn btn--accent",
      text: "Unlock & restore",
      on: {
        click: () => {
          void doUnlock();
        },
      },
    });
    resultRegion.append(
      el(
        "div",
        { class: "readout-fields" },
        msg,
        el("div", { class: "portable-actions" }, pass, unlock),
      ),
    );
  }

  /** Confirm a restore and show where the restored situation stands. */
  function renderRestored(): void {
    clear(resultRegion);
    const count = profile.entries().length;
    resultRegion.append(
      el(
        "section",
        { class: "readout-summary", attrs: { "aria-label": "Restored situation" } },
        el("p", {
          class: "readout-summary-line",
          text:
            count > 0
              ? `Restored your situation — ${count} value${count === 1 ? "" : "s"}.`
              : "Restored, but that file held no values.",
        }),
        standingBlock(),
        el("p", {
          class: "readout-note",
          text: "These prefill the matching tools. Everything stays in this browser tab and is cleared when you leave; nothing is uploaded.",
        }),
        el(
          "div",
          { class: "readout-actions" },
          el("button", {
            type: "button",
            class: "btn btn--accent",
            text: "My Readout Report →",
            on: { click: () => navigate("report") },
          }),
          el("button", {
            type: "button",
            class: "btn btn--ghost",
            text: "Read another file",
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
            text: "Enter your numbers in the budget →",
            on: { click: () => navigate(null) },
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

  /**
   * The §2.3 payoff, composed from the same engine the Readout Report uses (so
   * the figures match and nothing is duplicated): the effective tax rate and
   * annual take-home, plus the single next right step from My Plan. Returns null
   * when there's no data or no income yet, so the summary degrades gracefully.
   */
  function standingBlock(): HTMLElement | null {
    if (!data) return null;
    const model = buildReport(profile, data);
    const grid = el("dl", { class: "readout-standing" });
    if (model.hasIncomeData) {
      const snap = model.sections.find((s) => s.title === "Snapshot");
      for (const label of ["Effective tax rate", "Annual take-home"]) {
        const line = snap?.lines.find((l) => l.label === label);
        if (line) grid.append(el("dt", { text: label }), el("dd", { text: line.value }));
      }
    }
    const planSection = model.sections.find((s) => s.title.startsWith("My Plan"));
    const stepTitle = planSection?.lines.find((l) => l.label === "Current step")?.value;
    const action = planSection?.lines.find((l) => l.label === "Next action")?.value;

    if (grid.childElementCount === 0 && !stepTitle) return null;
    return el(
      "div",
      { class: "readout-standing-wrap" },
      grid.childElementCount > 0 ? grid : null,
      stepTitle
        ? el(
            "p",
            { class: "readout-next-step" },
            el("strong", { text: "Your next right step: " }),
            el("span", { text: action ? `${stepTitle}. ${action}` : stepTitle }),
          )
        : null,
    );
  }

  function renderSummary(fields: ExtractedField[], applied: number): void {
    clear(resultRegion);
    resultRegion.append(
      el(
        "section",
        { class: "readout-summary", attrs: { "aria-label": "Your readout" } },
        el("p", { class: "readout-summary-line", text: summaryLine(fields) }),
        standingBlock(),
        el("p", {
          class: "readout-note",
          text:
            applied > 0
              ? `Added ${applied} value${applied === 1 ? "" : "s"} to My Situation (provenance: from a document) — they prefill the matching tools. Open the report to see where you stand and, if you like, save a private copy you can restore later. Everything stays in this browser tab and is cleared when you leave; nothing is uploaded.`
              : "These values are informational: review them above and carry them into the matching tile. Nothing was changed in My Situation.",
        }),
        el(
          "div",
          { class: "readout-actions" },
          el("button", {
            type: "button",
            class: "btn btn--accent",
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
