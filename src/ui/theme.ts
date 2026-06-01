/**
 * Display preferences (BUILD-SPEC.md §11).
 *
 * enklayve ships a single light theme — calm, easy on the eyes, and the same for
 * everyone (the dark and high-contrast themes were removed 2026-06-01 for a
 * simpler, more delightful experience). So the only preference left is the
 * locale, which is not sensitive and may live in localStorage; everything
 * financial stays in memory and is cleared on unload (§2 principle 3).
 */

export const LOCALES = ["en-US"] as const;
export type Locale = (typeof LOCALES)[number];

const LOCALE_KEY = "enklayve.locale";
const DEFAULT_LOCALE: Locale = "en-US";

function isLocale(value: string | null): value is Locale {
  return value !== null && (LOCALES as readonly string[]).includes(value);
}

/** Safe localStorage read — returns null if storage is unavailable (private mode). */
function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* storage unavailable — the preference simply does not persist. */
  }
}

export function getLocale(): Locale {
  const stored = read(LOCALE_KEY);
  return isLocale(stored) ? stored : DEFAULT_LOCALE;
}

export function setLocale(locale: Locale): void {
  document.documentElement.setAttribute("lang", locale.split("-")[0] ?? "en");
  write(LOCALE_KEY, locale);
}

/** Apply the persisted (or default) locale on startup. */
export function applyStoredPreferences(): { locale: Locale } {
  const locale = getLocale();
  setLocale(locale);
  return { locale };
}
