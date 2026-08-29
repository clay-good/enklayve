import { describe, it, expect, beforeAll, afterEach } from "vitest";
import axe from "axe-core";
import { renderReadout } from "../../src/ui/readoutView";
import { loadBundledData, type BundledData } from "../../src/data/browser";
import { SituationStore } from "../../src/profile/situation";
import { buildReport } from "../../src/readout/report";
import {
  exportLedger,
  serializeLedger,
  takeSnapshot,
  watchableAnswers,
  type LedgerSnapshot,
} from "../../src/profile/ledger";
import type { TextExtractor } from "../../src/readout/extractText";

/**
 * The Standing Ledger end to end (SPEC-4-ledger.md §3, §6).
 *
 * A ledger dropped on the Readout is recomputed against today's bundled data
 * and rendered as a diff. The properties under test are the ones a household
 * would notice if they broke: nothing changed reads as reassurance rather than
 * an empty page, a crossing outranks a dollar move, and looking at the diff
 * never quietly overwrites My Situation.
 */
let data: BundledData;
beforeAll(async () => {
  data = await loadBundledData();
});

const NOOP_EXTRACTOR: TextExtractor = async () => ({ text: "", pages: [""], source: "typed" });

function populated(): SituationStore {
  const p = new SituationStore();
  p.set("annualIncome", 82000, "typed");
  p.set("filingStatus", "single", "typed");
  p.set("stateCode", "tx", "typed");
  p.set("liquidSavings", 12000, "typed");
  p.set("essentialMonthlyExpenses", 3200, "typed");
  return p;
}

function snapshot(): LedgerSnapshot {
  const profile = populated();
  return takeSnapshot(
    profile,
    data,
    watchableAnswers(buildReport(profile, data)),
    [],
    "2026-08-29",
  );
}

function setup(): { container: HTMLElement; profile: SituationStore } {
  const container = document.createElement("div");
  const profile = new SituationStore();
  renderReadout({
    container,
    navigate: () => {},
    profile,
    data,
    extractor: NOOP_EXTRACTOR,
  });
  document.body.append(container);
  return { container, profile };
}

/** Drop a `.json` on the Readout the way a user would. */
async function drop(container: HTMLElement, text: string, name = "my-ledger.json"): Promise<void> {
  const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;
  const file = new File([text], name, { type: "application/json" });
  Object.defineProperty(input, "files", { value: { 0: file, length: 1 }, configurable: true });
  input.dispatchEvent(new Event("change"));
  await new Promise((r) => setTimeout(r, 0));
}

afterEach(() => {
  document.body.replaceChildren();
});

describe("dropping a ledger on the Readout", () => {
  it("reads it as a ledger, not as a saved situation", async () => {
    const { container } = setup();
    await drop(container, serializeLedger(snapshot()));
    expect(container.querySelector(".ledger-title")?.textContent).toBe(
      "What changed since you were last here",
    );
    expect(container.textContent).toContain("taken on 2026-08-29");
  });

  it("says nothing changed, calmly, when nothing has", async () => {
    const { container } = setup();
    await drop(container, serializeLedger(snapshot()));
    const calm = container.querySelector(".ledger-calm")?.textContent ?? "";
    expect(calm).toContain("Nothing changed");
    expect(calm).toContain("nothing here you need to do");
    // Not an empty state: the reassurance is the content.
    expect(container.querySelectorAll(".ledger-row--material")).toHaveLength(0);
  });

  it("shows a crossing above a material move, and reports it whatever the amount", async () => {
    const snap = snapshot();
    const money = snap.answers.find((a) => a.amount !== undefined)!;
    const status = snap.answers.find((a) => a.amount === undefined)!;
    // One dollar answer moved a long way; one status answer flipped by a word.
    const tampered: LedgerSnapshot = {
      ...snap,
      answers: snap.answers.map((a) =>
        a.label === money.label
          ? { ...a, display: "$1.00", amount: 1 }
          : a.label === status.label
            ? { ...a, display: "Something entirely different" }
            : a,
      ),
    };
    const { container } = setup();
    await drop(container, serializeLedger(tampered));

    const headings = Array.from(container.querySelectorAll(".ledger-heading")).map(
      (h) => h.textContent,
    );
    expect(headings[0]).toBe("Something crossed a line");
    expect(headings).toContain("Answers that moved");
    expect(container.querySelector(".ledger-row--threshold")).not.toBeNull();
  });

  it("does not touch My Situation until the reader asks", async () => {
    const { container, profile } = setup();
    await drop(container, serializeLedger(snapshot()));
    // The diff is computed from a temporary store, so the live profile is empty.
    expect(profile.get("annualIncome")).toBeUndefined();

    const restore = Array.from(container.querySelectorAll("button")).find((b) =>
      b.textContent?.startsWith("Load this situation"),
    );
    restore?.click();
    expect(profile.get("annualIncome")).toBe(82000);
  });

  it("says plainly that nothing was written anywhere", async () => {
    const { container } = setup();
    await drop(container, serializeLedger(snapshot()));
    const privacy = container.querySelector(".ledger-privacy")?.textContent ?? "";
    expect(privacy).toContain("nothing was written anywhere");
    expect(privacy).toContain("the only copy");
  });

  it("asks for a passphrase on an encrypted ledger, and compares once given", async () => {
    const sealed = await exportLedger(snapshot(), "a passphrase");
    const { container } = setup();
    await drop(container, sealed, "my-ledger.encrypted.json");

    expect(container.textContent).toContain("That ledger is encrypted");
    const unlock = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent === "Unlock & compare",
    );
    expect(unlock).toBeDefined();

    const pass = container.querySelector<HTMLInputElement>(".portable-pass")!;
    pass.value = "a passphrase";
    unlock!.click();
    // PBKDF2 at 210,000 iterations is deliberately slow; poll rather than
    // guessing at a tick count.
    for (let i = 0; i < 200 && !container.querySelector(".ledger-title"); i += 1) {
      await new Promise((r) => setTimeout(r, 25));
    }
    expect(container.querySelector(".ledger-title")).not.toBeNull();
  });

  it("rejects a malformed ledger whole, with a plain-English reason", async () => {
    const { container, profile } = setup();
    const broken = JSON.stringify({ ...snapshot(), answers: [{ nope: true }] });
    await drop(container, broken);
    expect(container.querySelector(".readout-status")?.textContent).toContain(
      "isn't a valid enklayve ledger",
    );
    expect(container.querySelector(".ledger-title")).toBeNull();
    expect(profile.entries()).toHaveLength(0);
  });

  it("has no axe violations", async () => {
    const { container } = setup();
    await drop(container, serializeLedger(snapshot()));
    const results = await axe.run(container, { rules: { "color-contrast": { enabled: false } } });
    expect(results.violations.map((v) => v.id).join(", ")).toBe("");
  }, 30000);
});
