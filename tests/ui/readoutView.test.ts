import { describe, it, expect, afterEach, beforeAll } from "vitest";
import axe from "axe-core";
import { renderReadout } from "../../src/ui/readoutView";
import { loadBundledData, type BundledData } from "../../src/data/browser";
import { SituationStore } from "../../src/profile/situation";
import { serialize } from "../../src/profile/portable";
import { PDF_PASSWORD_REQUIRED, type TextExtractor } from "../../src/readout/extractText";

let bundled: BundledData;
beforeAll(async () => {
  bundled = await loadBundledData();
});

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

function setup(
  extractor: TextExtractor = typedExtractor,
  data: BundledData | null = null,
): {
  container: HTMLElement;
  profile: SituationStore;
  dest: () => string | null;
} {
  const container = document.createElement("div");
  const profile = new SituationStore();
  let dest: string | null = null;
  renderReadout({ container, navigate: (id) => (dest = id), profile, data, extractor });
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

/** A text extractor that yields a different document on each successive read,
 * so a multi-document session (and its cross-document check) is testable. */
function sequence(...texts: string[]): TextExtractor {
  let i = 0;
  return async () => {
    const text = texts[Math.min(i++, texts.length - 1)]!;
    return { text, pages: [text], source: "typed" as const };
  };
}

const EOB_TEXT =
  "Explanation of Benefits — This is not a bill. Claim Number: CLM-88213 " +
  "Date of Service 09/12/2026 Out-of-Network " +
  "Amount Billed 1,200.00 Allowed Amount 640.00 Plan Paid 512.00 " +
  "Patient Responsibility 128.00";

const BILL_TEXT =
  "Riverside Clinic Itemized Statement Patient Account 44120 " +
  "09/12/2026 Office visit level 3 400.00 " +
  "09/12/2026 Metabolic panel 140.00 " +
  "09/12/2026 Chest radiograph 100.00 " +
  "Total Charges 640.00";

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

  it("shows the tax rate and the next right step in the summary when data is present", async () => {
    const { container } = setup(typedExtractor, bundled);
    await dropFile(container);
    const confirm = Array.from(container.querySelectorAll("button")).find((b) =>
      b.textContent?.startsWith("Confirm and add"),
    );
    confirm?.click();
    // The §2.3 standing block: effective rate + take-home, plus the next step.
    const standing = container.querySelector(".readout-standing")?.textContent ?? "";
    expect(standing).toContain("Effective tax rate");
    expect(standing).toContain("Annual take-home");
    expect(container.querySelector(".readout-next-step")?.textContent).toContain(
      "Your next right step:",
    );
  });

  it("shows an unreadable filing status as text, not an empty number box", async () => {
    // A real 1040 prints all five statuses and the checked box is a glyph, so
    // the extractor reports "Not read" with a note and no target. The editor
    // branches on `target === "filingStatus"` for its select and treats
    // everything else as a number — which would have put an empty numeric
    // spinner under the label "Filing status": a control that does nothing,
    // dressed as one that does.
    const form1040 =
      "Form 1040 U.S. Individual Income Tax Return 2024 " +
      "Filing Status Check only one box. Single Married filing jointly (MFJ) " +
      "Married filing separately (MFS) Head of household (HOH) " +
      "Qualifying surviving spouse (QSS) 11 Adjusted gross income 52000.00";
    const { container, profile } = setup(async () => ({
      text: form1040,
      pages: [form1040],
      source: "typed" as const,
    }));
    await dropFile(container, "1040.pdf");

    const statik = container.querySelector(".readout-field-static");
    expect(statik?.textContent).toBe("Not read");
    expect(container.querySelector('input[name="f1040-filing-status"]')).toBeNull();
    expect(container.querySelector('select[name="f1040-filing-status"]')).toBeNull();
    expect(
      Array.from(container.querySelectorAll(".readout-field-note")).some((n) =>
        (n.textContent ?? "").includes("Head of household"),
      ),
    ).toBe(true);

    // Confirming still applies what WAS read, and leaves the status unset.
    Array.from(container.querySelectorAll("button"))
      .find((b) => b.textContent?.startsWith("Confirm and add"))
      ?.click();
    expect(profile.get("annualIncome")).toBe(52000);
    expect(profile.get("filingStatus")).toBeUndefined();
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

  describe("restoring a saved situation (.json)", () => {
    /** Drop a saved-situation file (not a document) into the dropzone. */
    async function dropSituation(container: HTMLElement, content: string): Promise<void> {
      const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;
      const file = new File([content], "my-situation.json", { type: "application/json" });
      Object.defineProperty(input, "files", { value: { 0: file, length: 1 }, configurable: true });
      input.dispatchEvent(new Event("change"));
      await new Promise((r) => setTimeout(r, 0));
    }

    it("restores a dropped .json into the profile without running extraction", async () => {
      const { container, profile } = setup();
      const saved = (() => {
        const p = new SituationStore();
        p.set("annualIncome", 88000);
        p.set("filingStatus", "head_of_household");
        return serialize(p);
      })();
      await dropSituation(container, saved);
      expect(profile.get("annualIncome")).toBe(88000);
      expect(profile.get("filingStatus")).toBe("head_of_household");
      // It's a restore, not a parse: no detected-document block, a restored summary.
      expect(container.querySelector(".readout-detected")).toBeNull();
      expect(container.querySelector(".readout-summary-line")?.textContent).toContain("Restored");
    });

    it("asks for a passphrase when the dropped .json is encrypted", async () => {
      const { container, profile } = setup();
      const envelope = JSON.stringify({
        format: "enklayve.situation.encrypted",
        version: 1,
        kdf: "PBKDF2-SHA256",
        iterations: 210000,
        salt: "x",
        iv: "y",
        ciphertext: "z",
      });
      await dropSituation(container, envelope);
      const unlock = Array.from(container.querySelectorAll("button")).find(
        (b) => b.textContent === "Unlock & restore",
      );
      expect(unlock).toBeDefined();
      expect(profile.get("annualIncome")).toBeUndefined();
    });

    it("shows a friendly error for a .json that isn't a saved situation, not a parse attempt", async () => {
      const { container } = setup();
      await dropSituation(container, '{"hello":"world"}');
      // The dropzone now accepts three kinds of .json — a situation, a ledger,
      // or an encrypted envelope of either — so the message names the family.
      expect(container.querySelector(".readout-status")?.textContent).toContain(
        "isn't a saved enklayve file",
      );
    });
  });
});

/**
 * Readout v2 (SPEC-4-readout-v2 §2): every document, every kind, renders the
 * same four sections in the same order. The shape is the product, so it is
 * asserted structurally rather than by review.
 */
describe("Readout view, the four-part answer", () => {
  const titles = (container: HTMLElement): string[] =>
    Array.from(container.querySelectorAll(".readout-answer-title")).map((n) => n.textContent ?? "");

  it("renders all four sections, in order, for an existing document kind", async () => {
    const { container } = setup();
    await dropFile(container);
    expect(titles(container)).toEqual([
      "What this says",
      "What looks wrong",
      "What you may be owed",
      "What to do next, by when",
    ]);
    // Empty is honest: each empty section states its one-line reason.
    const empties = Array.from(container.querySelectorAll(".readout-answer-empty")).map(
      (n) => n.textContent ?? "",
    );
    expect(empties.every((e) => e.trim().length > 0)).toBe(true);
  });

  it("restates an EOB and routes an out-of-network claim to the free federal page", async () => {
    const { container } = setup(sequence(EOB_TEXT));
    await dropFile(container, "eob.pdf");
    expect(container.querySelector(".readout-detected")?.textContent).toContain(
      "Explanation of Benefits",
    );
    const says = Array.from(container.querySelectorAll(".readout-says dt")).map(
      (n) => n.textContent ?? "",
    );
    expect(says).toContain("Patient responsibility");
    const links = Array.from(container.querySelectorAll(".readout-next a")).map(
      (a) => a.getAttribute("href") ?? "",
    );
    expect(links.some((h) => h.includes("cms.gov/medical-bill-rights"))).toBe(true);
  });

  it("fires the EOB × medical-bill cross-check once both are read in one session", async () => {
    const { container } = setup(sequence(EOB_TEXT, BILL_TEXT));
    await dropFile(container, "eob.pdf");
    // The EOB alone: the cross-check has nothing to compare against.
    expect(container.querySelectorAll(".readout-flag")).toHaveLength(0);

    await dropFile(container, "bill.pdf");
    const flags = Array.from(container.querySelectorAll(".readout-flag-q")).map(
      (n) => n.textContent ?? "",
    );
    expect(flags.some((f) => f.includes("more than your plan says you owe"))).toBe(true);
    // A question to ask, never a verdict — and it names who to ask.
    expect(flags.every((f) => f.trim().endsWith("?"))).toBe(true);
    expect(container.querySelector(".readout-flag-ask")?.textContent).toContain("Who to ask:");
  });

  it('treats a cleared box as "leave this one out", not as zero', async () => {
    // Deleting a figure the extractor got wrong is the natural way to say skip
    // it, and `Number("")` is 0 — finite, so it used to be confirmed and
    // written. A reader who cleared the wages box and pressed Confirm recorded
    // an annual income of $0, which the EITC tile and the subsidy screeners
    // downstream believe. Nothing on the screen said so.
    const { container, profile } = setup();
    await dropFile(container);
    const wages = container.querySelector<HTMLInputElement>('input[name="w2-box1"]')!;
    wages.value = "";
    wages.dispatchEvent(new Event("input"));
    container.querySelector<HTMLButtonElement>(".readout-actions .btn--accent")!.click();
    expect(profile.has("annualIncome")).toBe(false);
    // The count says what was written, so the skipped field is visible there too.
    expect(container.querySelector(".readout-note")?.textContent).not.toContain("Added 2 values");
  });

  it("asks for a locked PDF's password and reads the file with it", async () => {
    // A locked PDF is the likeliest way a real tax document fails to open here
    // — payroll providers and banks deliver W-2s and 1099s encrypted, often
    // with the last four of an SSN as the password. Telling the reader to go
    // unlock it in another program was honest and was the wrong answer: the
    // decryption happens in pdf.js, on this device, which is what this page is
    // for.
    const asked: (string | undefined)[] = [];
    const locked: TextExtractor = async (_file, password) => {
      asked.push(password);
      if (password !== "hunter2") {
        const err = new Error(
          password === undefined
            ? "This PDF is password-protected. Type its password to open it here."
            : "That password did not open the file.",
        );
        err.name = PDF_PASSWORD_REQUIRED;
        throw err;
      }
      return { text: W2_TEXT, pages: [W2_TEXT], source: "typed" as const };
    };
    const { container, profile } = setup(locked);
    await dropFile(container, "w2.pdf");

    const field = container.querySelector<HTMLInputElement>('input[name="pdf-password"]')!;
    expect(field).not.toBeNull();
    // A password field, not a text one, and not offered to a password manager.
    expect(field.type).toBe("password");
    expect(field.getAttribute("autocomplete")).toBe("off");
    expect(container.textContent).toContain("password-protected");

    // A wrong one says so and asks again rather than dropping the file.
    field.value = "nope";
    container.querySelector<HTMLButtonElement>(".portable-actions .btn--accent")!.click();
    await new Promise((r) => setTimeout(r, 0));
    expect(container.textContent).toContain("did not open the file");

    const retry = container.querySelector<HTMLInputElement>('input[name="pdf-password"]')!;
    retry.value = "hunter2";
    container.querySelector<HTMLButtonElement>(".portable-actions .btn--accent")!.click();
    await new Promise((r) => setTimeout(r, 0));
    expect(asked).toEqual([undefined, "nope", "hunter2"]);

    // And the document is read: the confirm list is there to press.
    container.querySelector<HTMLButtonElement>(".readout-actions .btn--accent")!.click();
    expect(profile.get("annualIncome")).toBe(75000);

    // The password went to one function call and nowhere else. The session's
    // no-persistence promise is asserted end to end in Playwright; this holds
    // the narrower thing a unit test can see — it is not in the fragment, and
    // the field it was typed into is gone with the render that replaced it.
    expect(window.location.hash).not.toContain("hunter2");
    expect(container.querySelector('input[name="pdf-password"]')).toBeNull();
  });

  it("says which figure a second document replaced, and what it was", async () => {
    // The summary's own "Read another document" button makes this a first-class
    // path: a freelancer with a job confirms a W-2 and then a 1099-NEC, and both
    // target `annualIncome`. Last write wins — summing would double-count a
    // 1040's AGI against the W-2 it came from — but it used to win in silence,
    // under a line reading "Added 1 value to My Situation".
    const NEC_TEXT =
      "Form 1099-NEC Nonemployee Compensation 2024 1 Nonemployee compensation 30000.00";
    const { container, profile } = setup(sequence(W2_TEXT, NEC_TEXT));

    await dropFile(container, "w2.pdf");
    container.querySelector<HTMLButtonElement>(".readout-actions .btn--accent")!.click();
    expect(profile.get("annualIncome")).toBe(75000);
    expect(container.querySelector(".readout-note--replaced")).toBeNull();

    await dropFile(container, "1099nec.pdf");
    container.querySelector<HTMLButtonElement>(".readout-actions .btn--accent")!.click();
    expect(profile.get("annualIncome")).toBe(30000);
    const note = container.querySelector(".readout-note--replaced")?.textContent ?? "";
    expect(note).toContain("Annual income was $75,000 from a document read earlier");
    expect(note).toContain("is now $30,000");
  });

  it("points a medical bill at the hospital financial-assistance rule, with its source", async () => {
    const { container } = setup(sequence(BILL_TEXT));
    await dropFile(container, "bill.pdf");
    const owed = container.querySelector(".readout-owed-item");
    expect(owed?.textContent).toContain("financial assistance policy");
    expect(owed?.querySelector("a")?.getAttribute("href")).toMatch(/irs\.gov/);
  });

  it("never states a determination about the household", async () => {
    const { container } = setup(sequence(BILL_TEXT));
    await dropFile(container, "bill.pdf");
    const answer = container.querySelector(".readout-answer")?.textContent?.toLowerCase() ?? "";
    expect(answer.length).toBeGreaterThan(0);
    for (const forbidden of [
      "you qualify",
      "you are eligible",
      "you do not qualify",
      "you owe nothing",
    ]) {
      expect(answer).not.toContain(forbidden);
    }
    expect(answer).toContain("question to ask, not a verdict");
  });
});
