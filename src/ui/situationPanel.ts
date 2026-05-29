/**
 * The My Situation panel (BUILD-SPEC-2 §3): a calm, warm dialog to view and edit
 * the session profile and to export/import it as a portable, optionally
 * encrypted, user-held file. It is the visible face of the in-memory profile
 * that the tiles read from and write to. Nothing here is persisted automatically
 * or sent anywhere — export is a download you keep. It can always be closed (a
 * visible Close button, the Escape key, or clicking outside), so it is never a
 * trap.
 */
import { el, option, clear, copyToClipboard } from "./dom";
import { field } from "./form";
import type { BundledData } from "../data/browser";
import { SituationStore, type FieldSource, type SituationKey } from "../profile/situation";
import { exportProfile, importProfile, readFileText, triggerDownload } from "../profile/portable";
import type { FilingStatus } from "../data/schemas";

const FILING_STATUSES: { value: FilingStatus; label: string }[] = [
  { value: "single", label: "Single" },
  { value: "married_jointly", label: "Married filing jointly" },
  { value: "married_separately", label: "Married filing separately" },
  { value: "head_of_household", label: "Head of household" },
  { value: "qualifying_surviving_spouse", label: "Qualifying surviving spouse" },
];

const FIELD_LABELS: Partial<Record<SituationKey, string>> = {
  filingStatus: "Filing status",
  stateCode: "State",
  county: "County",
  householdSize: "Household size",
  ages: "Ages",
  annualIncome: "Annual income",
  preTaxContributions: "Pre-tax contributions",
  essentialMonthlyExpenses: "Essential monthly expenses",
  totalMonthlyExpenses: "Total monthly expenses",
  liquidSavings: "Liquid savings",
  retirementContributionsAnnual: "Retirement contributions / yr",
  employerMatchAnnual: "Employer match available / yr",
  employerMatchCaptured: "Match you're capturing / yr",
  debts: "Debts",
};

const SOURCE_LABELS: Record<FieldSource, string> = {
  typed: "you",
  extracted: "document",
  assumed: "default",
};

export class SituationPanel {
  readonly element: HTMLElement;
  private readonly store: SituationStore;
  private readonly data: BundledData | null;
  private readonly summary: HTMLElement;
  private readonly status: HTMLElement;
  private readonly passInput: HTMLInputElement;
  private open = false;
  private unsubscribe: (() => void) | null = null;
  private onKeydown: ((e: KeyboardEvent) => void) | null = null;

  constructor(store: SituationStore, data: BundledData | null) {
    this.store = store;
    this.data = data;

    this.summary = el("div", { class: "situation-summary" });
    this.status = el("p", {
      class: "situation-status",
      attrs: { "aria-live": "polite" },
      text: "",
    });
    this.passInput = el("input", {
      type: "password",
      class: "situation-pass",
      name: "passphrase",
      placeholder: "Passphrase (optional)",
      attrs: { "aria-label": "Export/import passphrase", autocomplete: "off" },
    });

    const closeBtn = el("button", {
      type: "button",
      class: "btn btn--ghost situation-close",
      text: "✕ Close",
      attrs: { "aria-label": "Close My Situation" },
      on: { click: () => this.close() },
    });

    const panel = el(
      "div",
      {
        class: "palette-panel situation-dialog",
        attrs: { role: "dialog", "aria-modal": "true", "aria-label": "My Situation" },
      },
      el(
        "div",
        { class: "situation-header" },
        el("h2", { class: "situation-title", text: "My Situation" }),
        closeBtn,
      ),
      el("p", {
        class: "situation-blurb",
        text: "Tell me your numbers once and every tool uses them. They live only in memory and clear the moment you leave, export a private copy if you'd like to keep them. Nothing is ever sent anywhere.",
      }),
      this.buildEditor(),
      el("h3", { class: "situation-subhead", text: "What you've shared so far" }),
      this.summary,
      this.buildPortableControls(),
      this.status,
      el("div", { class: "situation-footer" }, this.buildDoneButton()),
    );

    this.element = el(
      "div",
      {
        class: "palette-backdrop",
        hidden: true,
        on: {
          click: (e) => {
            if (e.target === this.element) this.close();
          },
        },
      },
      panel,
    );
  }

  private buildDoneButton(): HTMLElement {
    return el("button", {
      type: "button",
      class: "btn btn--accent",
      text: "Done",
      on: { click: () => this.close() },
    });
  }

  private buildEditor(): HTMLElement {
    const fsSelect = el(
      "select",
      {
        name: "fs",
        attrs: { "aria-label": "Filing status" },
        on: {
          change: (e) =>
            this.store.set("filingStatus", (e.target as HTMLSelectElement).value as FilingStatus),
        },
      },
      ...FILING_STATUSES.map((s) =>
        option(s.value, s.label, s.value === this.store.get("filingStatus")),
      ),
    );

    const codes = this.data?.stateCodes() ?? [];
    const stSelect = el(
      "select",
      {
        name: "st",
        attrs: { "aria-label": "State" },
        on: { change: (e) => this.store.set("stateCode", (e.target as HTMLSelectElement).value) },
      },
      option("", "Not set", !this.store.has("stateCode")),
      ...codes.map((code) => {
        const j = this.data?.state(code);
        return option(code, j ? j.name : code.toUpperCase(), code === this.store.get("stateCode"));
      }),
    );

    const incInput = el("input", {
      type: "number",
      name: "inc",
      min: 0,
      step: 1000,
      value: this.store.get("annualIncome") ?? "",
      attrs: { "aria-label": "Annual income", inputmode: "decimal" },
      on: {
        input: (e) => {
          const v = Number((e.target as HTMLInputElement).value);
          if (Number.isFinite(v) && v >= 0) this.store.set("annualIncome", v);
        },
      },
    });

    return el(
      "div",
      { class: "tile-form situation-editor" },
      field("Filing status", fsSelect),
      field("State", stSelect),
      field("Annual income", incInput),
    );
  }

  private buildPortableControls(): HTMLElement {
    const exportBtn = el("button", {
      type: "button",
      class: "btn btn--ghost",
      text: "Export",
      on: { click: () => void this.doExport() },
    });

    const importInput = el("input", {
      type: "file",
      class: "situation-import",
      name: "import",
      attrs: { accept: ".json,application/json", "aria-label": "Import a profile file" },
      on: { change: (e) => void this.doImport(e) },
    });

    const clearBtn = el("button", {
      type: "button",
      class: "btn btn--ghost",
      text: "Clear",
      on: { click: () => this.doClear() },
    });

    return el(
      "div",
      { class: "situation-actions" },
      this.passInput,
      exportBtn,
      el("label", { class: "btn btn--ghost situation-import-label" }, "Import", importInput),
      clearBtn,
    );
  }

  private async doExport(): Promise<void> {
    const passphrase = this.passInput.value.trim();
    const content = await exportProfile(this.store, passphrase || undefined);
    const name = passphrase ? "my-situation.encrypted.json" : "my-situation.json";
    triggerDownload(name, content);
    // Also offer the content via clipboard as a fallback when downloads are blocked.
    void copyToClipboard(content);
    this.setStatus(passphrase ? "Exported an encrypted profile." : "Exported your profile.");
  }

  private async doImport(e: Event): Promise<void> {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    try {
      const text = await readFileText(file);
      await importProfile(this.store, text, this.passInput.value.trim() || undefined);
      this.setStatus("Imported your profile.");
    } catch (err) {
      this.setStatus((err as Error).message);
    } finally {
      input.value = "";
    }
  }

  private doClear(): void {
    this.store.clear();
    this.setStatus("Cleared. Nothing is kept on this device.");
  }

  private setStatus(message: string): void {
    this.status.textContent = message;
  }

  private renderSummary(): void {
    clear(this.summary);
    const entries = this.store.entries();
    if (entries.length === 0) {
      this.summary.append(
        el("p", {
          class: "situation-empty",
          text: "Nothing entered yet. Fill in a tool or the fields above.",
        }),
      );
      return;
    }
    const list = el("dl", { class: "situation-list" });
    for (const { key, value, source } of entries) {
      list.append(
        el("dt", { text: FIELD_LABELS[key] ?? key }),
        el(
          "dd",
          {},
          el("span", { text: formatValue(value) }),
          el("span", { class: "badge badge--soon", text: SOURCE_LABELS[source] }),
        ),
      );
    }
    this.summary.append(list);
  }

  show(): void {
    this.open = true;
    this.element.hidden = false;
    this.renderSummary();
    this.unsubscribe = this.store.subscribe(() => this.renderSummary());
    // Escape closes from anywhere while open (not only when a field is focused).
    this.onKeydown = (e) => {
      if (e.key === "Escape") this.close();
    };
    window.addEventListener("keydown", this.onKeydown);
  }

  close(): void {
    this.open = false;
    this.element.hidden = true;
    this.unsubscribe?.();
    this.unsubscribe = null;
    if (this.onKeydown) {
      window.removeEventListener("keydown", this.onKeydown);
      this.onKeydown = null;
    }
  }

  isOpen(): boolean {
    return this.open;
  }

  toggle(): void {
    if (this.open) this.close();
    else this.show();
  }
}

function formatValue(value: unknown): string {
  if (Array.isArray(value)) {
    // Debts are objects ({ name, balance, ratePct }); summarize them.
    if (value.every((v) => v && typeof v === "object")) {
      const debts = value as { name: string; balance: number; ratePct: number }[];
      return debts.length === 0
        ? "none"
        : debts
            .map((d) => `${d.name} ($${d.balance.toLocaleString("en-US")} @ ${d.ratePct}%)`)
            .join(", ");
    }
    return value.join(", ");
  }
  if (typeof value === "number") return value.toLocaleString("en-US");
  return String(value);
}
