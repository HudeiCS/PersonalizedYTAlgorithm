// Persistence for the search form, so a refresh doesn't reset what you set.
//
// localStorage rather than a cookie: these are purely client-side UI choices
// the server never reads, and a cookie would attach them to every single
// request for no benefit. Filters live *only* here — unlike genres and
// discoverability, the backend has no store for them even when signed in.
//
// Every access is wrapped: storage throws outright in private-mode and
// blocked-storage browsers, and a preference failing to save must never take
// the page down with it.

const KEY = "sift:prefs:v1";

export const DEFAULT_FILTERS = {
  duration: "any",
  age: "any",
  useSubscriptions: true,
  includeShorts: true,
};

export const DEFAULT_DISCOVERABILITY = 0.6;

/** Reads saved preferences, merged over the defaults. Anything missing,
 *  corrupted, or of the wrong type falls back to its default, so a stale or
 *  hand-edited entry can't put the form into an invalid state. */
export function loadPrefs() {
  let stored = {};
  try {
    stored = JSON.parse(window.localStorage.getItem(KEY) ?? "{}") ?? {};
  } catch {
    stored = {};
  }

  return {
    genres: Array.isArray(stored.genres)
      ? stored.genres.filter((g) => typeof g === "string")
      : [],
    discoverability:
      typeof stored.discoverability === "number" &&
      stored.discoverability >= 0 &&
      stored.discoverability <= 1
        ? stored.discoverability
        : DEFAULT_DISCOVERABILITY,
    filters: {
      ...DEFAULT_FILTERS,
      ...(stored.filters && typeof stored.filters === "object" ? stored.filters : {}),
    },
  };
}

export function savePrefs(prefs) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(prefs));
  } catch {
    // Storage unavailable or full — settings just won't survive the refresh.
  }
}

/* ---- Theme -------------------------------------------------------------
   Kept in its own key, read and applied before React mounts (see main.jsx),
   so the page paints in the right theme instead of flashing the other one.
   "system" is a real third state, not the absence of a choice: it means
   "follow the OS", which the CSS handles on its own once no data-theme
   attribute is set. */

const THEME_KEY = "sift:theme";

export function loadTheme() {
  try {
    const stored = window.localStorage.getItem(THEME_KEY);
    return stored === "light" || stored === "dark" ? stored : "system";
  } catch {
    return "system";
  }
}

/** Writes the choice onto <html>, where the CSS token blocks pick it up.
 *  "system" removes the attribute so the prefers-color-scheme query wins. */
export function applyTheme(theme) {
  const root = document.documentElement;
  if (theme === "light" || theme === "dark") {
    root.setAttribute("data-theme", theme);
  } else {
    root.removeAttribute("data-theme");
  }
  try {
    if (theme === "system") window.localStorage.removeItem(THEME_KEY);
    else window.localStorage.setItem(THEME_KEY, theme);
  } catch {
    // Not persisted; the choice still applies for this page view.
  }
}

/** What the page is actually showing right now, resolving "system" against
 *  the OS setting. */
export function resolveTheme(theme) {
  if (theme === "light" || theme === "dark") return theme;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}
