import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { getLocale, setLocale, applyStoredPreferences, LOCALES } from "../../src/ui/theme";

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

// enklayve ships a single light theme (the dark + high-contrast themes and the
// toggle were removed 2026-06-01). The only remaining preference is the locale.
describe("display preferences", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", fakeStorage());
  });
  afterEach(() => vi.unstubAllGlobals());

  it("defaults to en-US when nothing is stored", () => {
    expect(getLocale()).toBe("en-US");
  });

  it("supports exactly the US-English locale today", () => {
    expect([...LOCALES]).toEqual(["en-US"]);
  });

  it("ignores an unknown stored locale", () => {
    localStorage.setItem("enklayve.locale", "fr-FR");
    expect(getLocale()).toBe("en-US");
  });

  it("persists the locale and sets the document lang on startup", () => {
    setLocale("en-US");
    const { locale } = applyStoredPreferences();
    expect(locale).toBe("en-US");
    expect(document.documentElement.getAttribute("lang")).toBe("en");
  });
});
