// ---------------------------------------------------------------------------
// Off-canvas navigation drawer: state, inertness, and focus return.
//
// The bug this module exists to prevent (WCAG 2.4.3 Focus Order, Level A, and
// 2.4.7 Focus Visible, AA):
//
//   At <=1024px the sidebar is pushed off-canvas with `transform:translateX(-100%)`.
//   A transform moves paint, not participation: the subtree stays in the DOM,
//   stays in the accessibility tree, and stays in the tab order. Measured in a
//   real browser at 768px on 2026-08-06 the shell had 42 tab stops, 16 of them
//   off-screen, and the FIRST tab stop in DOM order was the invisible "Control"
//   rail button at left:-281px. Pressing Tab once on a tablet made focus vanish.
//
// The fix has to keep the slide transition, so `display:none` and
// `visibility:hidden` are both out - they cancel the transition and make the
// drawer pop. `inert` is the property that matches the intent exactly: the
// element still lays out and still animates, but it is removed from the tab
// order, from hit testing, and from the accessibility tree.
//
// Everything here is pure so the regression verifier can exercise the state
// machine without a DOM.
// ---------------------------------------------------------------------------

// The single source of truth for the breakpoint. index.html's
// `@media(max-width:1280px)` block is what actually pushes the drawer
// off-canvas; the verifier asserts the two numbers still agree.
// The demonstrated two-column navigation needs roughly 310px before a page
// receives any reading width.  Keeping it visible in a split desktop window
// left Reports with a few hundred pixels and caused cards to overlap.  Treat
// this intermediate width as a drawer layout, just as the complete shell does
// on a tablet, so the API-backed page remains readable.
export const NAV_DRAWER_BREAKPOINT = 1280;
export const NAV_DRAWER_MEDIA = `(max-width:${NAV_DRAWER_BREAKPOINT}px)`;

// Off-canvas AND closed is the only state in which the drawer is unreachable
// paint. At desktop widths the drawer is permanently visible, so it must never
// be inert there - that would make the whole product unnavigable by keyboard.
export function navDrawerIsInert(offCanvas, open) {
  return Boolean(offCanvas) && !open;
}

// React 18 does not know `inert` as a boolean DOM property, so a literal `true`
// is dropped with a warning. The empty string is the HTML spec spelling of a
// present boolean attribute and React forwards it verbatim.
//
// `aria-hidden` rides along for the same reason a belt rides with braces: it is
// the fallback for a user agent that has not shipped `inert`. It can never
// contradict `inert`, because both are derived from the same boolean.
export function navDrawerAttributes(offCanvas, open) {
  const inert = navDrawerIsInert(offCanvas, open);
  return {
    inert: inert ? '' : undefined,
    'aria-hidden': inert ? 'true' : undefined,
  };
}

// Focus lands on the first control the user can actually see. The close button
// only exists in the off-canvas state, which is exactly the state where focus
// has to be moved deliberately.
export const NAV_DRAWER_FIRST_FOCUS = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

export function focusFirstControl(root) {
  if (!root || typeof root.querySelector !== 'function') return false;
  // A selector list resolves in document order, not list order, so the close
  // button is asked for on its own first: it is the control that undoes the
  // action the user just took, and it should be under the next keystroke.
  const target = root.querySelector('.mobile-nav-close') || root.querySelector(NAV_DRAWER_FIRST_FOCUS);
  if (!target || typeof target.focus !== 'function') return false;
  target.focus();
  return true;
}

export function restoreFocus(node) {
  if (!node || typeof node.focus !== 'function') return false;
  node.focus();
  return true;
}

// Reads the viewport class once, synchronously, at mount. Returning the wrong
// answer for even one frame would leave the first Tab pointing at an off-screen
// control, which is the defect itself, so this must not wait for an effect.
export function readOffCanvas(view) {
  const w = view || (typeof window === 'undefined' ? null : window);
  if (!w || typeof w.matchMedia !== 'function') return false;
  try {
    return Boolean(w.matchMedia(NAV_DRAWER_MEDIA).matches);
  } catch (error) {
    return false;
  }
}

// Subscribes to viewport-class changes. Returns an unsubscribe function so the
// caller can hand it straight back from useEffect.
export function watchOffCanvas(view, onChange) {
  const w = view || (typeof window === 'undefined' ? null : window);
  if (!w || typeof w.matchMedia !== 'function') return () => {};
  let query;
  try {
    query = w.matchMedia(NAV_DRAWER_MEDIA);
  } catch (error) {
    return () => {};
  }
  const handler = (event) => onChange(Boolean(event.matches));
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
