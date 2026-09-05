import { describe, it, expect, beforeAll, afterEach } from "vitest";
import axe from "axe-core";
import { renderReport } from "../../src/ui/reportView";
import { loadBundledData, type BundledData } from "../../src/data/browser";
import { SituationStore } from "../../src/profile/situation";
import { serialize } from "../../src/profile/portable";

/** Set a read-only file input's `files` for a change-event simulation. */
function setFiles(input: HTMLInputElement, files: File[]): void {
  Object.defineProperty(input, "files", { value: files, configurable: true });
  input.dispatchEvent(new Event("change"));
}
const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 30));

/**
 * The Readout Report view (BUILD-SPEC-2 §5): an in-app preview with a download
 * of a self-contained HTML file. Generated on the device from Your Situation.
 */
let data: BundledData;
beforeAll(async () => {
  data = await loadBundledData();
});

function fundedProfile(): SituationStore {
  const p = new SituationStore();
  p.set("annualIncome", 95000);
  p.set("filingStatus", "single");
  p.set("stateCode", "ca");
  p.set("essentialMonthlyExpenses", 3200);
  p.set("liquidSavings", 12000);
  return p;
}

function mount(profile: SituationStore): { container: HTMLElement; dest: () => string | null } {
  const container = document.createElement("div");
  let dest: string | null = null;
  renderReport({ container, navigate: (id) => (dest = id), profile, data });
  document.body.append(container);
  return { container, dest: () => dest };
}

afterEach(() => document.body.replaceChildren());

describe("Readout Report view", () => {
  it("previews the report with its sections, download, and print", () => {
    const { container } = mount(fundedProfile());
    expect(container.querySelector(".tile-title")?.textContent).toBe("My Readout Report");
    const titles = Array.from(container.querySelectorAll(".report-section-title")).map(
      (n) => n.textContent ?? "",
    );
    expect(titles).toContain("Snapshot");
    expect(titles).toContain("Assumptions & sources");
    const buttons = Array.from(container.querySelectorAll("button")).map((b) => b.textContent);
    expect(buttons).toContain("Download report (.html)");
    expect(buttons).toContain("Print");
  });

  it("shows cited sources the figures trace to", () => {
    const { container } = mount(fundedProfile());
    expect(container.querySelector(".report-appendix a.cite-link")?.getAttribute("href")).toMatch(
      /irs\.gov/,
    );
  });

  it("has no axe violations", async () => {
    const { container } = mount(fundedProfile());
    const results = await axe.run(container, { rules: { "color-contrast": { enabled: false } } });
    expect(results.violations.map((v) => v.id).join(", ")).toBe("");
  }, 30000);

  describe("portable export/import (BUILD-SPEC-2 §5.2)", () => {
    it("offers a portable save and a restore control", () => {
      const { container } = mount(fundedProfile());
      const titles = Array.from(container.querySelectorAll(".report-section-title")).map(
        (n) => n.textContent ?? "",
      );
      expect(titles).toContain("Keep a private copy");
      const buttons = Array.from(container.querySelectorAll("button")).map((b) => b.textContent);
      expect(buttons).toContain("Save my situation (.json)");
      expect(container.querySelector(".portable-pass")).not.toBeNull();
      expect(container.querySelector<HTMLInputElement>(".portable-file")?.accept).toContain(
        ".json",
      );
    });

    it("restores a saved (plain) situation from a chosen file and re-renders", async () => {
      const empty = new SituationStore();
      const { container } = mount(empty);
      const saved = serialize(fundedProfile());
      const input = container.querySelector<HTMLInputElement>(".portable-file");
      setFiles(input!, [new File([saved], "my-situation.json", { type: "application/json" })]);
      await tick();
      expect(empty.get("annualIncome")).toBe(95000);
      expect(empty.get("filingStatus")).toBe("single");
    });

    it("asks for a passphrase only when the chosen file is encrypted", async () => {
      const { container } = mount(new SituationStore());
      const unlock = Array.from(container.querySelectorAll("button")).find(
        (b) => b.textContent === "Unlock & restore",
      );
      expect(unlock?.hidden).toBe(true);
      const envelope = JSON.stringify({
        format: "enklayve.situation.encrypted",
        version: 1,
        kdf: "PBKDF2-SHA256",
        iterations: 210000,
        salt: "x",
        iv: "y",
        ciphertext: "z",
      });
      const input = container.querySelector<HTMLInputElement>(".portable-file");
      setFiles(input!, [new File([envelope], "my-situation.encrypted.json")]);
      await tick();
      expect(unlock?.hidden).toBe(false);
    });
  });
});

/**
 * The Report is built from My Situation, and My Situation is not a form.
 *
 * Every hostile-input sweep in this repo drives a tile through its fields or its
 * fragment. The Report has neither: it renders whatever the profile holds, which
 * a restored file or a confirmed document put there. `plan.ts` formatted its
 * dollar figures through `Money` and its rates with a bare `${n}%` one line
 * below, so a debt list carrying a large rate printed "Attack your card next,
 * $1,000,000,000,000,000.00 at 1000000000000000%" — one formatted figure and one
 * not, in the same sentence.
 */
describe("the Report against a profile no form could have produced", () => {
  const NON_FINITE = /\b(NaN|Infinity|-Infinity)\b|∞/;
  const UNFORMATTED = /\$\d{7,}|\d{7,}(?:\.\d+)?\s*%/;

  function hostileProfile(): SituationStore {
    const store = new SituationStore();
    store.load({
      values: {
        filingStatus: "single",
        stateCode: "CA",
        annualIncome: 1e308,
        essentialMonthlyExpenses: 0.01,
        liquidSavings: 1e308,
        debts: Array.from({ length: 5_000 }, (_, i) => ({
          name: `d${i}`,
          balance: 1e308,
          ratePct: 1e308,
        })),
      },
      sources: {},
    } as never);
    return store;
  }

  it("renders without a non-finite or unformatted figure", () => {
    const container = document.createElement("div");
    expect(() =>
      renderReport({ container, navigate: () => {}, profile: hostileProfile(), data }),
    ).not.toThrow();
    const text = (container.textContent ?? "").replace(/\s+/g, " ");
    expect(text).not.toMatch(NON_FINITE);
    const hit = UNFORMATTED.exec(text);
    expect(
      hit ? text.slice(Math.max(0, hit.index - 50), hit.index + 30) : null,
      "the Report sent an unformatted figure to the screen",
    ).toBeNull();
  });

  it("still prints a real rate the way it was entered", () => {
    const store = new SituationStore();
    store.set("annualIncome", 82_000);
    store.set("essentialMonthlyExpenses", 3_200);
    store.set("liquidSavings", 12_000);
    store.set("debts", [{ name: "Card", balance: 4_200, ratePct: 24.99 }]);
    const container = document.createElement("div");
    renderReport({ container, navigate: () => {}, profile: store, data });
    expect(container.textContent).toContain("24.99%");
  });
});
