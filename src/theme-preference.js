// ---------------------------------------------------------------------------
// Theme resolution: operating system first, the user's own choice after that.
//
// Before this module the app had zero `prefers-color-scheme` handling. A user
// whose machine is set to dark got the light build and had to find the moon
// glyph in the top bar on every visit.
//
// The contract, in order of authority:
//   1. A stored choice. Once the user has pressed the toggle, that is the
//      answer, and the OS flipping later must not overrule it.
//   2. The OS preference, read at boot and followed live while no choice
//      is stored.
//   3. Light.
//
// The class written to <body> is always explicit - 'dark' or 'light', never the
// empty string - because index.html's first-paint rule keys off `body:not(.light)`
// and needs a way to say "the user chose light on a dark machine".
// ---------------------------------------------------------------------------

export const THEME_STORAGE_KEY = 'refs_theme';
export const THEME_MEDIA = '(prefers-color-scheme: dark)';

export function osPrefersDark(view) {
  const w = view || (typeof window === 'undefined' ? null : window);
  if (!w || typeof w.matchMedia !== 'function') return false;
  try {
    return Boolean(w.matchMedia(THEME_MEDIA).matches);
  } catch (error) {
    return false;
  }
}

export function readStoredTheme(view) {
  const w = view || (typeof window === 'undefined' ? null : window);
  try {
    const stored = w && w.localStorage ? w.localStorage.getItem(THEME_STORAGE_KEY) : null;
    return stored === 'dark' || stored === 'light' ? stored : null;
  } catch (error) {
    return null;
  }
}

export function writeStoredTheme(theme, view) {
  const w = view || (typeof window === 'undefined' ? null : window);
  try {
    // Literal key: the frontend data boundary verifier requires every
    // localStorage write site to name its key inline so it can be audited.
    if (w && w.localStorage) w.localStorage.setItem('refs_theme', theme === 'dark' ? 'dark' : 'light');
  } catch (error) { /* private mode: the session-local choice still applies */ }
}

// The initial theme. Stored choice wins; otherwise the machine decides.
export function resolveInitialTheme(view) {
  const stored = readStoredTheme(view);
  if (stored) return stored;
  return osPrefersDark(view) ? 'dark' : 'light';
}

// Follow the OS live, but only for a user who has not expressed a choice.
export function watchOsTheme(view, onChange) {
  const w = view || (typeof window === 'undefined' ? null : window);
  if (!w || typeof w.matchMedia !== 'function') return () => {};
  let query;
  try {
    query = w.matchMedia(THEME_MEDIA);
  } catch (error) {
    return () => {};
  }
  const handler = (event) => {
    if (readStoredTheme(w)) return;
    onChange(event.matches ? 'dark' : 'light');
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
