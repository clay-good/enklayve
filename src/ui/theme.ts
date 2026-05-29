/**
 * Theme and locale preferences (BUILD-SPEC.md §10, §11).
 *
 * Three themes — light (default), dark, and high contrast — applied instantly
 * by toggling a single `data-theme` attribute on <html>, so the CSS custom
 * properties in styles.css switch with no reflow flash. These two preferences
 * are the ONLY values enklayve ever persists (§2 principle 3): they are not
 * sensitive, so they live in localStorage; everything financial stays in
 * memory and is cleared on unload.
 */

export const THEMES = ["light", "dark", "high-contrast"] as const;
export type Theme = (typeof THEMES)[number];

export const LOCALES = ["en-US"] as const;
export type Locale = (typeof LOCALES)[number];

const THEME_KEY = "enklayve.theme";
const LOCALE_KEY = "enklayve.locale";

const DEFAULT_THEME: Theme = "light";
const DEFAULT_LOCALE: Locale = "en-US";

function isTheme(value: string | null): value is Theme {
  return value !== null && (THEMES as readonly string[]).includes(value);
}

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

export function getTheme(): Theme {
  const stored = read(THEME_KEY);
  return isTheme(stored) ? stored : DEFAULT_THEME;
}

/** Apply a theme to <html> immediately and persist the choice. */
export function setTheme(theme: Theme): void {
  document.documentElement.setAttribute("data-theme", theme);
  write(THEME_KEY, theme);
}

export function getLocale(): Locale {
  const stored = read(LOCALE_KEY);
  return isLocale(stored) ? stored : DEFAULT_LOCALE;
}

export function setLocale(locale: Locale): void {
  document.documentElement.setAttribute("lang", locale.split("-")[0] ?? "en");
  write(LOCALE_KEY, locale);
}

/** Apply the persisted (or default) theme and locale on startup. */
export function applyStoredPreferences(): { theme: Theme; locale: Locale } {
  const theme = getTheme();
  const locale = getLocale();
  setTheme(theme);
  setLocale(locale);
  return { theme, locale };
}
