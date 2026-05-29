import { describe, it, expect, beforeAll } from "vitest";
import { mountTakeHome } from "../../src/tiles/takeHome";
import { loadBundledData, type BundledData } from "../../src/data/browser";
import type { TileContext } from "../../src/tiles/types";

let data: BundledData;

beforeAll(async () => {
  data = await loadBundledData();
});

function mount(params: URLSearchParams): {
  root: HTMLElement;
  lastParams: () => URLSearchParams | null;
} {
  const root = document.createElement("div");
  let captured: URLSearchParams | null = null;
  const ctx: TileContext = {
    root,
    params,
    setParams: (p) => {
      captured = p;
    },
    permalink: (p) => `https://enklayve.com/#/take-home?${(p ?? params).toString()}`,
    locale: "en-US",
    data,
  };
  mountTakeHome(ctx);
  return { root, lastParams: () => captured };
}

function rowValue(root: HTMLElement, label: string): string | undefined {
  const rows = Array.from(root.querySelectorAll(".bd-row"));
  const row = rows.find((r) => r.querySelector(".bd-label")?.textContent === label);
  return row?.querySelector(".bd-value")?.textContent ?? undefined;
}

describe("take-home tile", () => {
  it("bundles the federal, FICA, and state datasets through the integrity gate", () => {
    expect(data.federal()).not.toBeNull();
    expect(data.fica()).not.toBeNull();
    expect(data.state("ca")).not.toBeNull();
    expect(data.statusOf("federal-income-tax-2024")).toBe("ok");
  });

  it("restores its inputs from a deep link and computes a result", () => {
    const { root } = mount(new URLSearchParams({ fs: "single", st: "ca", w: "85000" }));
    // Inputs reflect the URL state.
    expect(root.querySelector<HTMLInputElement>('input[name="w"]')?.value).toBe("85000");
    expect(root.querySelector<HTMLSelectElement>('select[name="st"]')?.value).toBe("ca");
    // A result card is rendered with the take-home headline.
    expect(root.querySelector(".result-card")).not.toBeNull();
    expect(root.querySelector(".result-label")?.textContent).toBe("Annual take-home pay");
    // The breakdown shows the total tax and the federal line.
    expect(rowValue(root, "Total tax")).toBeTruthy();
    const fedLabel = Array.from(root.querySelectorAll(".bd-label")).some((n) =>
      n.textContent?.startsWith("Federal income tax"),
    );
    expect(fedLabel).toBe(true);
  });

  it("shows a citation source link on rule-based lines (no orphan numbers)", () => {
    const { root } = mount(new URLSearchParams({ fs: "single", st: "ca", w: "85000" }));
    const links = root.querySelectorAll("a.cite-link");
    expect(links.length).toBeGreaterThan(0);
    expect(links[0]?.getAttribute("href")).toMatch(/^https?:\/\//);
  });

  it("writes edited inputs back to the URL fragment for deep linking", () => {
    const { root, lastParams } = mount(new URLSearchParams({ fs: "single", st: "ca", w: "85000" }));
    const wages = root.querySelector<HTMLInputElement>('input[name="w"]')!;
    wages.value = "120000";
    wages.dispatchEvent(new Event("input"));
    const p = lastParams();
    expect(p?.get("w")).toBe("120000");
    expect(p?.get("st")).toBe("ca");
  });

  it("prefills a realistic worked example", () => {
    const { root } = mount(new URLSearchParams());
    const example = Array.from(root.querySelectorAll("button")).find(
      (b) => b.textContent === "Try an example",
    )!;
    example.click();
    expect(root.querySelector<HTMLInputElement>('input[name="w"]')?.value).toBe("85000");
    expect(root.querySelector(".result-card")).not.toBeNull();
  });

  it("offers a local add-on for New York and includes it when checked", () => {
    const { root, lastParams } = mount(
      new URLSearchParams({ fs: "single", st: "ny", w: "100000" }),
    );
    const cb = root.querySelector<HTMLInputElement>('.local-addons input[type="checkbox"]');
    expect(cb).not.toBeNull();
    cb!.checked = true;
    cb!.dispatchEvent(new Event("change"));
    expect(lastParams()?.get("loc")).toBeTruthy();
  });
});
