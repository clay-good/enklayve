/**
 * The Readout Report view (BUILD-SPEC-2 §5): an in-app preview of the
 * downloadable summary, with a one-tap download of a self-contained HTML file
 * and a print button. Everything is generated on the device from My Situation
 * — nothing is uploaded. The report itself is reproducible: the same profile and
 * dataset versions always produce the same document.
 */
import { el, clear } from "./dom";
import {
  triggerDownload,
  exportProfile,
  importProfile,
  isEncrypted,
  readFileText,
} from "../profile/portable";
import { buildReport, renderReportHtml, type ReportModel } from "../readout/report";
import type { BundledData } from "../data/browser";
import type { SituationStore } from "../profile/situation";

export interface RenderReportOptions {
  container: HTMLElement;
  navigate: (id: string | null) => void;
  profile: SituationStore;
  data: BundledData | null;
}

function sectionEl(section: ReportModel["sections"][number]): HTMLElement {
  const children: HTMLElement[] = [
    el("h2", { class: "report-section-title", text: section.title }),
  ];
  if (section.lines.length > 0) {
    const rows = section.lines.map((l) =>
      el(
        "tr",
        { class: "bd-row" },
        el("th", { class: "bd-label", attrs: { scope: "row" }, text: l.label }),
        el("td", { class: "bd-value", text: l.value }),
      ),
    );
    children.push(el("table", { class: "breakdown-table report-table" }, el("tbody", {}, ...rows)));
  }
  if (section.note) children.push(el("p", { class: "report-note", text: section.note }));
  return el("section", { class: "report-section" }, ...children);
}

export function renderReport(opts: RenderReportOptions, flash?: string): void {
  const { container, navigate, profile, data } = opts;
  clear(container);
  document.title = "My Readout Report · enklayve";

  const model = buildReport(profile, data);

  const back = el(
    "button",
    { type: "button", class: "btn btn--ghost back-link", on: { click: () => navigate(null) } },
    "← Home",
  );
  const head = el(
    "div",
    { class: "tile-head" },
    back,
    el("h1", { class: "tile-title", text: "My Readout Report" }),
    el("p", {
      class: "tile-desc",
      text: `Where you stand, computed on your device from ${model.effectiveYear} data. Download a private copy or print it, nothing is uploaded.`,
    }),
  );

  const download = el("button", {
    type: "button",
    class: "btn btn--accent",
    text: "Download report (.html)",
    on: { click: () => triggerDownload("your-readout-report.html", renderReportHtml(model)) },
  });
  const print = el("button", {
    type: "button",
    class: "btn btn--ghost",
    text: "Print",
    on: {
      click: () => {
        if (typeof window.print === "function") window.print();
      },
    },
  });
  const actions = el("div", { class: "report-actions" }, download, print);

  const sections = el("div", { class: "report-body" }, ...model.sections.map(sectionEl));

  // Appendix: assumptions, dataset versions, and citations (every figure traces here).
  const appendix = el(
    "section",
    { class: "report-section report-appendix" },
    el("h2", { class: "report-section-title", text: "Assumptions & sources" }),
    el(
      "table",
      { class: "breakdown-table report-table" },
      el(
        "tbody",
        {},
        ...model.appendix.assumptions.map((a) =>
          el(
            "tr",
            { class: "bd-row" },
            el("th", { class: "bd-label", attrs: { scope: "row" }, text: a.label }),
            el("td", { class: "bd-value", text: a.value }),
          ),
        ),
      ),
    ),
    el("h3", { class: "report-subhead", text: "Dataset versions used" }),
    el(
      "ul",
      { class: "report-list" },
      ...model.appendix.datasets.map((d) =>
        el("li", { text: `${d.id}, effective ${d.effectiveYear} (${d.status})` }),
      ),
    ),
    el("h3", { class: "report-subhead", text: "Citations" }),
    model.appendix.citations.length > 0
      ? el(
          "ul",
          { class: "report-list" },
          ...model.appendix.citations.map((c) =>
            el(
              "li",
              {},
              el("span", { text: `${c.sourceDocument} (${c.effectiveYear}) ` }),
              el(
                "a",
                {
                  class: "cite-link",
                  href: c.sourceUrl,
                  attrs: { rel: "noopener noreferrer", target: "_blank" },
                },
                "source",
              ),
            ),
          ),
        )
      : el("p", { class: "report-note", text: "Citations appear once your snapshot is computed." }),
  );

  // A successful restore rebuilds this view from the new profile; the flash
  // message rides through the re-render so the confirmation survives it.
  const portable = portableBlock(profile, (msg) => renderReport(opts, msg), flash);

  container.append(
    el("article", { class: "tile report" }, head, actions, sections, appendix, portable),
  );
}

/**
 * "Keep a private copy" — the portable, user-held export/import (BUILD-SPEC-2
 * §3.2, §5.2; Phase 16: "offer the portable encrypted profile export alongside
 * [the report]"). The session profile is otherwise cleared on unload, so this
 * is the one way to carry it across sessions. It is all on-device: `exportProfile`
 * serializes (and optionally PBKDF2 → AES-GCM encrypts) the profile to a file the
 * user keeps; `importProfile` reads one back. Nothing is ever uploaded, so the
 * strict `connect-src 'none'` CSP is untouched.
 */
function portableBlock(
  profile: SituationStore,
  rerender: (flash?: string) => void,
  flash?: string,
): HTMLElement {
  const count = profile.entries().length;
  const status = el("p", {
    class: "report-note portable-status",
    attrs: { "aria-live": "polite" },
    text: flash ?? "",
  });

  const passInput = el("input", {
    type: "password",
    class: "portable-pass",
    name: "situation-passphrase",
    attrs: {
      placeholder: "Passphrase (optional)",
      autocomplete: "off",
      "aria-label": "Passphrase to encrypt a saved copy, or to open an encrypted one (optional)",
    },
  });

  const save = el("button", {
    type: "button",
    class: "btn btn--ghost",
    text: "Save my situation (.json)",
    on: {
      click: () => {
        void doSave();
      },
    },
  });

  async function doSave(): Promise<void> {
    const pass = passInput.value.trim();
    try {
      const content = await exportProfile(profile, pass || undefined);
      triggerDownload(pass ? "my-situation.encrypted.json" : "my-situation.json", content);
      status.textContent = pass
        ? "Saved an encrypted copy to your device. Keep the passphrase safe — there is no recovery."
        : "Saved a private copy to your device.";
    } catch (e) {
      status.textContent = (e as Error).message;
    }
  }

  // Restore: a saved file is plain JSON or an encrypted envelope; we only ask for
  // the passphrase when the chosen file actually needs one.
  let pending: string | null = null;
  const unlock = el("button", {
    type: "button",
    class: "btn btn--ghost",
    text: "Unlock & restore",
    hidden: true,
    on: {
      click: () => {
        void doUnlock();
      },
    },
  });

  const fileInput = el("input", {
    type: "file",
    class: "portable-file",
    name: "situation-restore",
    attrs: {
      accept: ".json,application/json",
      "aria-label": "Restore my situation from a saved file",
    },
    on: {
      change: (e) => {
        const f = (e.target as HTMLInputElement).files?.[0];
        if (f) void chooseRestore(f);
      },
    },
  });

  async function chooseRestore(file: File): Promise<void> {
    unlock.hidden = true;
    pending = null;
    try {
      const text = await readFileText(file);
      if (isEncrypted(text)) {
        pending = text;
        unlock.hidden = false;
        status.textContent =
          "That file is encrypted. Enter its passphrase above, then Unlock & restore.";
        return;
      }
      await importProfile(profile, text);
      rerender("Restored your situation from the file.");
    } catch (e) {
      status.textContent = `Could not restore: ${(e as Error).message}`;
    }
  }

  async function doUnlock(): Promise<void> {
    if (!pending) return;
    try {
      await importProfile(profile, pending, passInput.value.trim());
      pending = null;
      unlock.hidden = true;
      rerender("Restored your situation from the encrypted file.");
    } catch (e) {
      status.textContent = (e as Error).message;
    }
  }

  const lede =
    `Save your situation${count > 0 ? ` (${count} value${count === 1 ? "" : "s"})` : ""} to a ` +
    "local file you keep, and restore it later — it never leaves your device. Add a passphrase to " +
    "encrypt it (PBKDF2 → AES-GCM); leave it blank for plain JSON.";

  return el(
    "section",
    { class: "report-section report-portable" },
    el("h2", { class: "report-section-title", text: "Keep a private copy" }),
    el("p", { class: "report-note", text: lede }),
    el(
      "div",
      { class: "portable-actions" },
      passInput,
      save,
      el(
        "label",
        { class: "portable-restore" },
        el("span", { text: "Restore from a file" }),
        fileInput,
      ),
      unlock,
    ),
    status,
  );
}
