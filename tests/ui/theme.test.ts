import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { getTheme, setTheme, applyStoredPreferences, THEMES } from "../../src/ui/theme";

// happy-dom's localStorage is unreliable under the node test runner, so install
// a minimal in-memory Storage. theme.ts wraps storage in try/catch, so this
// also documents that persistence is best-effort.
function fakeStorage(): Storage {
  const map = new Map<string, string>();
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, String(v)),
    removeItem: (k) => void map.delete(k),
    clear: () => map.clear(),
    key: (i) => Array.from(map.keys())[i] ?? null,
    get length() {
      return map.size;
    },
  };
}

describe("theme preferences", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", fakeStorage());
    document.documentElement.removeAttribute("data-theme");
  });

  afterEach(() => vi.unstubAllGlobals());

  it("defaults to light when nothing is stored", () => {
    expect(getTheme()).toBe("light");
  });

  it("applies the theme instantly via the data-theme attribute and persists it", () => {
    setTheme("dark");
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    expect(getTheme()).toBe("dark");
  });

  it("ignores an unknown stored theme", () => {
    localStorage.setItem("enklayve.theme", "neon");
    expect(getTheme()).toBe("light");
  });

  it("supports exactly the three specified themes", () => {
    expect([...THEMES]).toEqual(["light", "dark", "high-contrast"]);
  });

  it("restores the persisted theme on startup", () => {
    setTheme("high-contrast");
    document.documentElement.removeAttribute("data-theme");
    const { theme } = applyStoredPreferences();
    expect(theme).toBe("high-contrast");
    expect(document.documentElement.getAttribute("data-theme")).toBe("high-contrast");
  });
});
