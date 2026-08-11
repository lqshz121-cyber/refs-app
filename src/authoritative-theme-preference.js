// ---------------------------------------------------------------------------
// Authoritative presentation-only theme preference.
//
// The authoritative accounting surface intentionally does not include any
// `localStorage` code.  Theme is not accounting state, but keeping this small
// preference in the tab session makes the deployed bundle mechanically prove
// that it has no path to browser-persisted business data.  It survives a
// reload in the same authenticated tab and falls back to the operating-system
// preference when the tab has no explicit choice.
//
// The legacy demonstration surface keeps its separate long-lived preference
// helper.  Do not import that helper here: it also owns demo-only local storage
// behaviour and must stay outside the authoritative dependency graph.
// ---------------------------------------------------------------------------

export const AUTHORITATIVE_THEME_STORAGE_KEY = 'refs_authoritative_theme';
export const THEME_MEDIA = '(prefers-color-scheme: dark)';

export function osPrefersDark(view) {
  const w = view || (typeof window === 'undefined' ? null : window);
  if (!w || typeof w.matchMedia !== 'function') return false;
  try {
    return Boolean(w.matchMedia(THEME_MEDIA).matches);
  } catch {
    return false;
  }
}

export function readStoredTheme(view) {
  const w = view || (typeof window === 'undefined' ? null : window);
  try {
    const stored = w?.sessionStorage?.getItem(AUTHORITATIVE_THEME_STORAGE_KEY);
    return stored === 'dark' || stored === 'light' ? stored : null;
  } catch {
    return null;
  }
}

export function writeStoredTheme(theme, view) {
  const w = view || (typeof window === 'undefined' ? null : window);
  try {
    w?.sessionStorage?.setItem(AUTHORITATIVE_THEME_STORAGE_KEY, theme === 'dark' ? 'dark' : 'light');
  } catch { /* private mode: the in-memory React state still applies */ }
}

export function resolveInitialTheme(view) {
  return readStoredTheme(view) || (osPrefersDark(view) ? 'dark' : 'light');
}

export function watchOsTheme(view, onChange) {
  const w = view || (typeof window === 'undefined' ? null : window);
  if (!w || typeof w.matchMedia !== 'function') return () => {};
  let query;
  try {
    query = w.matchMedia(THEME_MEDIA);
  } catch {
    return () => {};
  }
  const handler = event => {
    if (!readStoredTheme(w)) onChange(event.matches ? 'dark' : 'light');
  };
  if (typeof query.addEventListener === 'function') {
    query.addEventListener('change', handler);
    return () => query.removeEventListener('change', handler);
  }
  if (typeof query.addListener === 'function') {
    query.addListener(handler);
    return () => query.removeListener(handler);
  }
  return () => {};
}
