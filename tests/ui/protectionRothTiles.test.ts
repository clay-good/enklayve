import { describe, it, expect, beforeAll, afterEach } from "vitest";
import axe from "axe-core";
import { mountBackdoorRoth } from "../../src/tiles/backdoorRoth";
import { mountDisability } from "../../src/tiles/disability";
import { mountUmbrella } from "../../src/tiles/umbrella";
import { loadBundledData, type BundledData } from "../../src/data/browser";
import { SituationStore } from "../../src/profile/situation";
import type { TileContext } from "../../src/tiles/types";

/**
 * Backdoor / mega-backdoor Roth (BUILD-SPEC-2 §6.5) + Disability and Umbrella
 * sizing (§6.6), Phase 17 fifth wave. The Roth tile reads its limits from the
 * bundled, cited retirement-limits dataset; the two protection tiles are
 * labeled guidelines (no external rule to cite). All deep-link and pass axe.
 */
let data: BundledData;
beforeAll(async () => {
  data = await loadBundledData();
});

function mount(
  mountFn: (ctx: TileContext) => void,
  params: URLSearchParams,
  profile = new SituationStore(),
): { root: HTMLElement; lastParams: () => URLSearchParams | null } {
  const root = document.createElement("div");
  let captured: URLSearchParams | null = null;
  mountFn({
    root,
    params,
    setParams: (p) => {
      captured = p;
    },
    permalink: (p) => `https://enklayve.com/#/x?${(p ?? params).toString()}`,
    navigate: () => {},
    locale: "en-US",
    data,
    profile,
  });
  return { root, lastParams: () => captured };
}

function rowValue(root: HTMLElement, labelStarts: string): string | undefined {
  const rows = Array.from(root.querySelectorAll(".bd-row"));
  const row = rows.find((r) =>
    (r.querySelector(".bd-label")?.textContent ?? "").startsWith(labelStarts),
  );
  return row?.querySelector(".bd-value")?.textContent ?? undefined;
}
function clickExample(root: HTMLElement): void {
  Array.from(root.querySelectorAll("button"))
    .find((b) => b.textContent === "Try an example")!
    .click();
}

afterEach(() => document.body.replaceChildren());

describe("Backdoor Roth", () => {
  it("is a clean, tax-free conversion with no pre-tax IRA balance, citing the IRS limit", () => {
    const { root } = mount(
      mountBackdoorRoth,
      new URLSearchParams({ age: "35", c: "7500", ord: "24" }),
    );
    expect(rowValue(root, "IRA limit")).toContain("$7,500");
    expect(rowValue(root, "Into your Roth")).toContain("$7,500");
    expect(rowValue(root, "Tax owed")).toContain("$0");
    expect(rowValue(root, "A clean backdoor")).toBeTruthy();
    expect(root.querySelector("a.cite-link")).not.toBeNull();
  });

  it("taxes the conversion pro-rata when pre-tax IRA money exists", () => {
    const { root } = mount(
      mountBackdoorRoth,
      new URLSearchParams({ age: "35", c: "7000", pt: "30000", ord: "24" }),
    );
    expect(rowValue(root, "Taxable portion (pro-rata)")).toContain("$5,675.68");
    expect(rowValue(root, "Tax owed")).toContain("$1,362.16");
    expect(rowValue(root, "Heads up")).toBeTruthy();
  });

  it("caps the IRA contribution at the catch-up limit for age 50+", () => {
    const { root } = mount(
      mountBackdoorRoth,
      new URLSearchParams({ age: "55", c: "99999", ord: "24" }),
    );
    // 2026 IRA limit $7,500 + $1,100 catch-up = $8,600.
    expect(rowValue(root, "IRA limit (with catch-up)")).toContain("$8,600");
    expect(rowValue(root, "Into your Roth")).toContain("$8,600");
  });

  it("computes the mega-backdoor after-tax room from §415(c)", () => {
    const { root } = mount(
      mountBackdoorRoth,
      new URLSearchParams({ m: "mega", ed: "23000", er: "10000" }),
    );
    // 2026 §415(c) $72,000 − 23,000 − 10,000 = $39,000.
    expect(rowValue(root, "Total 401(k) limit")).toContain("$72,000");
    expect(rowValue(root, "After-tax room")).toContain("$39,000");
    expect(root.querySelector("a.cite-link")).not.toBeNull();
  });

  it("prefills a worked example and deep-links it", () => {
    const { root, lastParams } = mount(mountBackdoorRoth, new URLSearchParams());
    clickExample(root);
    expect(root.querySelector<HTMLInputElement>('input[name="c"]')?.value).toBe("7500");
    expect(lastParams()?.get("c")).toBe("7500");
  });
});

describe("Disability Insurance Needs", () => {
  it("sizes the monthly gap from a replacement rate, reading income from My Situation", () => {
    const profile = new SituationStore();
    profile.set("annualIncome", 90000);
    const { root } = mount(
      mountDisability,
      new URLSearchParams({ r: "60", cov: "2000", oth: "500" }),
      profile,
    );
    expect(rowValue(root, "Income to replace (60%)")).toContain("$4,500");
    expect(rowValue(root, "Already covered")).toContain("$2,500");
    expect(rowValue(root, "Monthly coverage gap")).toContain("$2,000");
    expect(rowValue(root, "Annual coverage gap")).toContain("$24,000");
    expect(root.querySelector("a.cite-link")).toBeNull();
  });

  it("writes income back to My Situation", () => {
    const profile = new SituationStore();
    const { root } = mount(mountDisability, new URLSearchParams({ inc: "80000" }), profile);
    const inc = root.querySelector<HTMLInputElement>('input[name="inc"]')!;
    inc.value = "120000";
    inc.dispatchEvent(new Event("input"));
    expect(profile.get("annualIncome")).toBe(120000);
  });
});

describe("Umbrella Liability Coverage", () => {
  it("rounds uncovered net worth up to the next $1M layer", () => {
    const { root } = mount(mountUmbrella, new URLSearchParams({ nw: "1300000", cov: "500000" }));
    expect(rowValue(root, "Total exposure")).toContain("$1,300,000");
    expect(rowValue(root, "Uncovered exposure")).toContain("$800,000");
    expect(rowValue(root, "Umbrella to consider")).toContain("$1,000,000");
    expect(root.querySelector("a.cite-link")).toBeNull();
  });

  it("prefills a worked example and deep-links it", () => {
    const { root, lastParams } = mount(mountUmbrella, new URLSearchParams());
    clickExample(root);
    expect(root.querySelector<HTMLInputElement>('input[name="nw"]')?.value).toBe("1300000");
    expect(lastParams()?.get("nw")).toBe("1300000");
  });
});

describe("fifth-wave tiles accessibility", () => {
  for (const tc of [
    {
      name: "backdoor-roth",
      mount: mountBackdoorRoth,
      params: new URLSearchParams({ age: "35", c: "7000", pt: "30000", ord: "24" }),
    },
    {
      name: "backdoor-roth-mega",
      mount: mountBackdoorRoth,
      params: new URLSearchParams({ m: "mega", ed: "23000", er: "10000" }),
    },
    {
      name: "disability-insurance",
      mount: mountDisability,
      params: new URLSearchParams({ inc: "90000", r: "60", cov: "2000" }),
    },
    {
      name: "umbrella-liability",
      mount: mountUmbrella,
      params: new URLSearchParams({ nw: "1300000", cov: "500000" }),
    },
  ]) {
    it(`${tc.name} has no axe violations`, async () => {
      const { root } = mount(tc.mount, tc.params);
      document.body.append(root);
      const results = await axe.run(root, { rules: { "color-contrast": { enabled: false } } });
      expect(results.violations.map((v) => v.id).join(", ")).toBe("");
    }, 30000);
  }
});

/**
 * The mega-backdoor deferral field opens on the shard's figure.
 *
 * This tile's header has always said both limits "read from (and cite) the
 * bundled IRS retirement-limits dataset", and the computation did. The number
 * sitting in the input box when the tile opened was a hardcoded 24500 — correct
 * for 2026 and silently a year behind from 2027 on. It is a default rather than
 * an asserted figure, which makes it milder than the SALT constant or the
 * readout's frozen fallback, and it is the same mistake in the same week.
 *
 * Named-constant sweeps cannot see this one: it was an inline literal in three
 * places, so a test is what holds it.
 */
describe("the mega-backdoor deferral default", () => {
  const deferral = (): number => data.retirementLimits()!.limits.elective_deferral_401k;

  it("is the shard's elective-deferral limit, not a literal", () => {
    const { root } = mount(mountBackdoorRoth, new URLSearchParams({ m: "mega" }));
    const input = root.querySelector<HTMLInputElement>('input[name="ed"]');
    expect(input, "the mega mode has an elective-deferral field").not.toBeNull();
    expect(Number(input!.value)).toBe(deferral());
  });

  it("a deep link still wins over the default", () => {
    const { root } = mount(mountBackdoorRoth, new URLSearchParams({ m: "mega", ed: "12000" }));
    const input = root.querySelector<HTMLInputElement>('input[name="ed"]');
    expect(Number(input!.value)).toBe(12000);
  });

  it("the worked example uses the shard figure too", () => {
    const { root } = mount(mountBackdoorRoth, new URLSearchParams({ m: "mega" }));
    const example = [...root.querySelectorAll("button")].find((b) =>
      /example/i.test(b.textContent ?? ""),
    );
    expect(example, "the tile offers a worked example").toBeTruthy();
    example!.click();
    const input = root.querySelector<HTMLInputElement>('input[name="ed"]');
    expect(Number(input!.value)).toBe(deferral());
  });
});

/**
 * And the field beside it, which the same fix missed.
 *
 * The IRA contribution box opened on a hardcoded `7500` — the shard's own
 * `ira_contribution` for 2026, right today and a year behind from 2027 — sitting
 * two lines under a paragraph explaining that defaults come off the shard and
 * never from a literal. The deferral was fixed and its neighbour was not, which
 * is how the second instance of a bug outlives the first: the story of the fix
 * makes everyone believe the class is closed.
 */
describe("the IRA contribution default", () => {
  const iraLimit = (): number => data.retirementLimits()!.limits.ira_contribution;

  it("is the shard's IRA limit, not a literal", () => {
    const { root } = mount(mountBackdoorRoth, new URLSearchParams());
    const input = root.querySelector<HTMLInputElement>('input[name="c"]');
    expect(input, "the backdoor mode has a contribution field").not.toBeNull();
    expect(Number(input!.value)).toBe(iraLimit());
  });

  it("adds the age-50 catch-up from the shard, rather than a second literal", () => {
    // The tile already knew how to do this in its computation; the default just
    // was not asking. A 55-year-old's box should open on the larger figure.
    const { root } = mount(mountBackdoorRoth, new URLSearchParams({ age: "55" }));
    const input = root.querySelector<HTMLInputElement>('input[name="c"]');
    expect(Number(input!.value)).toBe(
      iraLimit() + data.retirementLimits()!.limits.ira_catch_up_50plus!,
    );
  });

  it("a deep link still wins over the default", () => {
    const { root } = mount(mountBackdoorRoth, new URLSearchParams({ c: "3000" }));
    const input = root.querySelector<HTMLInputElement>('input[name="c"]');
    expect(Number(input!.value)).toBe(3000);
  });
});
