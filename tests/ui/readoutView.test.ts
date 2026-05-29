import { describe, it, expect, afterEach } from "vitest";
import axe from "axe-core";
import { renderReadout } from "../../src/ui/readoutView";
import { SituationStore } from "../../src/profile/situation";
import type { TextExtractor } from "../../src/readout/extractText";

/**
 * The Readout view (BUILD-SPEC-2 §2): drop a document, see the anchored fields
 * with their confidence, confirm, and have them flow into Your Situation — all
 * on the device. The file→text step is injected so the deterministic extraction
 * and the confirm flow are testable without a real PDF.
 */
const W2_TEXT =
  "Form W-2 Wage and Tax Statement 2024 " +
  "1 Wages, tips, other compensation 75000.00 " +
  "2 Federal income tax withheld 9200.00 " +
  "12a D 8000.00";

const typedExtractor: TextExtractor = async () => ({
  text: W2_TEXT,
  pages: [W2_TEXT],
  source: "typed" as const,
});

function setup(extractor: TextExtractor = typedExtractor): {
  container: HTMLElement;
  profile: SituationStore;
  dest: () => string | null;
} {
  const container = document.createElement("div");
  const profile = new SituationStore();
  let dest: string | null = null;
  renderReadout({ container, navigate: (id) => (dest = id), profile, extractor });
  document.body.append(container);
  return { container, profile, dest: () => dest };
}

/** Drive the file input the way a user would, then let the async parse settle. */
async function dropFile(container: HTMLElement, name = "w2.pdf"): Promise<void> {
  const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;
  const file = new File(["%PDF-1.7"], name, { type: "application/pdf" });
  Object.defineProperty(input, "files", { value: { 0: file, length: 1 }, configurable: true });
  input.dispatchEvent(new Event("change"));
  await new Promise((r) => setTimeout(r, 0));
}

afterEach(() => {
  document.body.replaceChildren();
});

describe("Readout view", () => {
  it("parses a dropped document and lists its fields with confidence", async () => {
    const { container } = setup();
    await dropFile(container);
    expect(container.querySelector(".readout-detected")?.textContent).toContain("W-2");
    const labels = Array.from(container.querySelectorAll(".readout-field-label")).map(
      (n) => n.textContent ?? "",
    );
    expect(labels.some((l) => l.includes("Wages"))).toBe(true);
    // The form citation is shown.
    expect(container.querySelector(".readout-cite a")?.getAttribute("href")).toMatch(/irs\.gov/);
  });

  it("flows confirmed values into Your Situation with extracted provenance", async () => {
    const { container, profile } = setup();
    await dropFile(container);
    const confirm = Array.from(container.querySelectorAll("button")).find((b) =>
      b.textContent?.startsWith("Confirm and add"),
    );
    confirm?.click();
    expect(profile.get("annualIncome")).toBe(75000);
    expect(profile.sourceOf("annualIncome")).toBe("extracted");
    expect(profile.get("retirementContributionsAnnual")).toBe(8000);
    // A plain-English summary appears.
    expect(container.querySelector(".readout-summary-line")?.textContent).toContain("$75,000");
  });

  it("shows the error message when a file type isn't supported", async () => {
    const failing: TextExtractor = async () => {
      throw new Error("Unsupported file. Drop a typed PDF or paste the text.");
    };
    const { container } = setup(failing);
    await dropFile(container, "photo.heic");
    expect(container.querySelector(".readout-status")?.textContent).toContain("Unsupported file");
  });

  it("has no axe violations after extraction", async () => {
    const { container } = setup();
    await dropFile(container);
    const results = await axe.run(container, { rules: { "color-contrast": { enabled: false } } });
    expect(results.violations.map((v) => v.id).join(", ")).toBe("");
  }, 30000);
});
