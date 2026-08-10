// ===========================================================================
// Regression pin for two accessibility defects found in a real browser on
// 2026-08-06 and fixed on branch claude/ui-round3-qb-polish.
//
//   1. WCAG 2.4.3 (A) + 2.4.7 (AA) - off-canvas sidebar keyboard trap.
//      At 768px the shell had 42 tab stops, 16 of them off-screen, and the
//      first tab stop in DOM order was the invisible "Control" rail button at
//      left:-281px. The drawer was hidden with `transform` alone.
//
//   2. WCAG 1.4.3 (AA) + 1.4.11 (AA) - dark mode contrast.
//      Coverage gaps let light surfaces survive into the dark theme; the worst
//      measured pair was 1.11:1.
//
// WHAT THIS FILE CAN AND CANNOT PROVE
// -----------------------------------
// There is no browser in the build environment, so nothing here is a rendered
// measurement. Two kinds of proof are used instead, and each assertion says
// which one it is:
//
//   (a) EXECUTED - the drawer state machine in src/nav-drawer.js is imported
//       and called. That is a real test of real code.
//   (b) ARITHMETIC / STATIC - the drawer's viewport box is computed from the
//       CSS box model and the token values; contrast ratios are computed from
//       the token values with the WCAG 2.x relative-luminance formula. The
//       inputs are read from the shipped stylesheet, so they cannot drift, but
//       a browser could still disagree if some rule outside the inventory below
//       repaints a surface.
//
// The focusable inventory is read from docs/preview/shell-preview.html, which
// tools/build-shell-preview.mjs generates from the product stylesheet and the
// product icon set, so it is the same control set the shell renders.
// ===========================================================================

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  NAV_DRAWER_BREAKPOINT,
  NAV_DRAWER_MEDIA,
  navDrawerAttributes,
  navDrawerIsInert,
  readOffCanvas,
  watchOffCanvas,
} from './src/nav-drawer.js';
import { osPrefersDark, readStoredTheme, resolveInitialTheme } from './src/theme-preference.js';

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const html = read('./index.html');
const appSource = read('./src/app.jsx');
const authoritativeSource = read('./src/authoritative-app.jsx');
const preview = read('./docs/preview/shell-preview.html');
const css = html.match(/<style>([\s\S]*?)<\/style>/)[1];
const cssNoComments = css.replace(/\/\*[\s\S]*?\*\//g, '');

// ---------------------------------------------------------------------------
// Tiny CSS readers. Exact-selector lookups only: this file must never guess at
// the cascade, it only reads declarations it names.
// ---------------------------------------------------------------------------
function ruleBody(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = cssNoComments.match(new RegExp(`(^|[};])\\s*${escaped}\\s*\\{([^}]*)\\}`, 'm'));
  return match ? match[2] : null;
}
function declarations(body) {
  const out = {};
  if (!body) return out;
  for (const piece of body.split(';')) {
    const m = piece.match(/^\s*([a-zA-Z-]+)\s*:\s*(.+?)\s*$/s);
    if (m) out[m[1].toLowerCase()] = m[2].trim();
  }
  return out;
}
const ROOT = declarations(ruleBody(':root'));
const DARK_OWN = declarations(cssNoComments.match(/body\.dark\{([^}]*)\}/)[1]);
const LIGHT = ROOT;
const DARK = { ...ROOT, ...DARK_OWN };

function resolveToken(value, theme, depth = 0) {
  if (value === undefined || value === null) return value;
  if (depth > 12) throw new Error(`custom property cycle at ${value}`);
  const m = String(value).trim().match(/^var\((--[a-zA-Z0-9-]+)\)$/);
  if (!m) return String(value).trim();
  const next = theme[m[1]];
  assert.ok(next !== undefined, `token ${m[1]} is not defined in this theme`);
  return resolveToken(next, theme, depth + 1);
}

// ---------------------------------------------------------------------------
// WCAG 2.x relative luminance and contrast ratio.
// ---------------------------------------------------------------------------
function channels(colour) {
  let c = String(colour).trim();
  if (/^#[0-9a-f]{3}$/i.test(c)) c = '#' + c[1] + c[1] + c[2] + c[2] + c[3] + c[3];
  if (/^#[0-9a-f]{6}$/i.test(c)) {
    const n = parseInt(c.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 1];
  }
  const rgb = c.match(/^rgba?\(([^)]*)\)$/i);
  if (rgb) {
    const parts = rgb[1].split(',').map((s) => parseFloat(s));
    return [parts[0], parts[1], parts[2], parts.length > 3 ? parts[3] : 1];
  }
  if (c.toLowerCase() === 'white') return [255, 255, 255, 1];
  if (c.toLowerCase() === 'black') return [0, 0, 0, 1];
  throw new Error(`cannot read colour: ${colour}`);
}
function luminance([r, g, b]) {
  const lin = (x) => { const v = x / 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}
function contrast(foreground, background) {
  const bg = channels(background);
  const fgRaw = channels(foreground);
  const fg = fgRaw[3] === 1 ? fgRaw : [0, 1, 2].map((i) => fgRaw[i] * fgRaw[3] + bg[i] * (1 - fgRaw[3]));
  const a = luminance(fg);
  const b = luminance(bg);
  const [hi, lo] = a > b ? [a, b] : [b, a];
  return (hi + 0.05) / (lo + 0.05);
}
const round2 = (n) => Math.round(n * 100) / 100;

// ===========================================================================
// PART A - the off-canvas drawer is not a keyboard trap
// ===========================================================================

// A.1 EXECUTED. The state machine, exhaustively.
assert.equal(navDrawerIsInert(true, false), true, 'off-canvas and closed must be inert');
assert.equal(navDrawerIsInert(true, true), false, 'an open drawer must never be inert');
assert.equal(navDrawerIsInert(false, false), false,
  'a desktop drawer is permanently visible and must never be inert - inerting it would make the product unnavigable');
assert.equal(navDrawerIsInert(false, true), false, 'a desktop drawer must never be inert');
assert.deepEqual(navDrawerAttributes(true, false), { inert: '', 'aria-hidden': 'true' },
  'the closed off-canvas drawer must leave both the tab order and the accessibility tree');
assert.deepEqual(navDrawerAttributes(true, true), { inert: undefined, 'aria-hidden': undefined },
  'the open drawer must be fully reachable');
assert.deepEqual(navDrawerAttributes(false, false), { inert: undefined, 'aria-hidden': undefined });
// React 18 drops a boolean `true` for an attribute it does not know. The empty
// string is the HTML spelling of a present boolean attribute.
assert.equal(navDrawerAttributes(true, false).inert, '',
  'inert must be the empty string, not true: React 18 discards unknown boolean props');

// A.2 EXECUTED. The environment probes must be safe where there is no window.
assert.equal(readOffCanvas({}), false, 'a host without matchMedia must not claim to be off-canvas');
assert.equal(typeof watchOffCanvas({}, () => {}), 'function', 'watchOffCanvas must always return an unsubscribe');
assert.equal(readOffCanvas({ matchMedia: (q) => ({ matches: q === NAV_DRAWER_MEDIA }) }), true);

// A.3 STATIC. The stylesheet breakpoint and the module breakpoint are one number.
const offCanvasBlock = cssNoComments.match(/@media\(max-width:1024px\)\{([\s\S]*?)\n\}/);
assert.ok(offCanvasBlock, 'the off-canvas media block must exist');
assert.equal(NAV_DRAWER_BREAKPOINT, 1024,
  'src/nav-drawer.js and the @media(max-width:1024px) block must agree, or the drawer is inert at the wrong widths');

// A.4 STATIC. The hiding technique must stay transform-only, so the slide survives.
const sidebarOffCanvas = offCanvasBlock[1].match(/\.sidebar\{([^}]*)\}/);
assert.ok(sidebarOffCanvas, '.sidebar must be repositioned inside the off-canvas media block');
const offCanvasDecl = declarations(sidebarOffCanvas[1]);
assert.equal(offCanvasDecl.position, 'fixed');
assert.equal(offCanvasDecl.left, '0');
assert.equal(offCanvasDecl.transform, 'translateX(-100%)');
assert.ok(!/display\s*:\s*none/.test(sidebarOffCanvas[1]),
  'display:none would cancel the slide transition; inert is the mechanism, not display');
assert.ok(!/visibility\s*:\s*hidden/.test(sidebarOffCanvas[1]),
  'visibility:hidden would cancel the slide transition; inert is the mechanism, not visibility');
assert.ok(/\.sidebar\.mobile-open\{transform:translateX\(0\);?\}/.test(offCanvasBlock[1].replace(/\s/g, '')),
  'the open drawer must slide back to x=0');

// A.5 ARITHMETIC. Where the closed drawer actually sits, from the box model.
// position:fixed + left:0 puts the border box at x=0. translateX(-100%) shifts
// it left by its own width. Nothing inside can escape: .sidebar is overflow:hidden.
const railWidth = parseFloat(resolveToken(ROOT['--qb-rail-w'], LIGHT));
const panelWidth = parseFloat(resolveToken(ROOT['--qb-navpanel-w'], LIGHT));
const drawerWidth = railWidth + panelWidth;
assert.ok(drawerWidth > 0, 'the drawer must have a resolvable width');
assert.match(declarations(ruleBody('.sidebar')).overflow || '', /hidden/,
  'the drawer clips its own content, so no descendant can sit outside the drawer box');
const closedBox = { left: -drawerWidth, right: -drawerWidth + drawerWidth };
assert.equal(closedBox.right, 0, 'the closed drawer ends exactly at the left viewport edge');
for (const viewport of [320, 360, 480, 768, 1024]) {
  const visibleWidth = Math.max(0, Math.min(closedBox.right, viewport) - Math.max(closedBox.left, 0));
  assert.equal(visibleWidth, 0,
    `at ${viewport}px the closed drawer must have zero intersection with the viewport, got ${visibleWidth}px`);
}

// A.6 STATIC. Every focusable control the drawer really renders.
// Read from the generated preview, which is built from the product stylesheet
// and the product navigation model.
const drawerMarkup = preview.match(/<aside[^>]*class="[^"]*sidebar[^"]*"[\s\S]*?<\/aside>/);
assert.ok(drawerMarkup, 'the preview must contain the sidebar so its control inventory can be counted');
const FOCUSABLE = /<(?:button|a\s[^>]*href=|input|select|textarea|[a-z]+[^>]*\stabindex="(?!-1)[^"]*")/gi;
const focusableInDrawer = drawerMarkup[0].match(FOCUSABLE) || [];
assert.ok(focusableInDrawer.length >= 10,
  `the drawer must contain the controls this test is protecting; found ${focusableInDrawer.length}`);

// A.7 The assertion the defect asks for, stated exactly:
// no focusable element sits outside the viewport when the drawer is closed.
// Every focusable element in A.6 is inside the box computed in A.5, which has
// zero viewport intersection. The only thing that can make that acceptable is
// that none of them is reachable, which is what inert does.
const closedDrawerInert = navDrawerIsInert(true, false);
const reachableOffscreenTabStops = closedDrawerInert ? 0 : focusableInDrawer.length;
assert.equal(reachableOffscreenTabStops, 0,
  `${focusableInDrawer.length} focusable controls sit at x<0 when the drawer is closed; `
  + 'with the drawer not inert every one of them is a tab stop the user cannot see');
// And the inverse, so the pin cannot pass by making the drawer permanently inert.
assert.equal(navDrawerIsInert(true, true), false);
assert.ok(focusableInDrawer.length > 0,
  'an open drawer must expose its controls; a drawer with nothing focusable is not a fixed drawer');

// A.8 STATIC. Both shells bind inert to the drawer-closed predicate, not to a
// hand-written condition that can drift.
for (const [name, source, openState] of [
  ['src/app.jsx', appSource, 'mobileNav'],
  ['src/authoritative-app.jsx', authoritativeSource, 'navOpen'],
]) {
  assert.ok(source.includes(`{...navDrawerAttributes(navOffCanvas, ${openState})}`),
    `${name}: the sidebar must take its inert state from navDrawerAttributes(navOffCanvas, ${openState})`);
  assert.match(source, /readOffCanvas\(\)/,
    `${name}: the viewport class must be read synchronously at mount, not after an effect`);
  assert.match(source, /watchOffCanvas\(null, setNavOffCanvas\)/,
    `${name}: the drawer must stop being inert when the viewport grows past the breakpoint`);
  assert.match(source, /focusFirstControl\(navDrawerRef\.current\)/,
    `${name}: opening the drawer must move focus into it`);
  assert.match(source, /restoreFocus\(navOpenerRef\.current\)/,
    `${name}: closing the drawer must return focus to the control that opened it`);
  assert.match(source, /key === 'Escape'|key==='Escape'/,
    `${name}: Escape must close the drawer`);
  assert.match(source, /ref=\{navOpenerRef\}[^>]*className="mobile-nav-btn"/,
    `${name}: the opener must be the focus-return target`);
  assert.match(source, /className="mobile-nav-close"/,
    `${name}: an off-canvas drawer needs a visible way out`);
}

// A.9 STATIC. inert cannot swallow clicks meant for the page behind it.
assert.match(cssNoComments, /\[inert\]\{[^}]*pointer-events:none/,
  'an inert subtree must not receive pointer events');

// ===========================================================================
// PART B - dark mode meets WCAG AA
// ===========================================================================

// B.1 STATIC. The operating-system preference is honoured at all.
const osBlocks = css.match(/@media\s*\(prefers-color-scheme:\s*dark\)/g) || [];
assert.ok(osBlocks.length >= 1,
  'the stylesheet must react to prefers-color-scheme; before this fix there were zero such blocks');
assert.match(cssNoComments, /:root\{[^}]*color-scheme:light/,
  'the light theme must declare its colour scheme so user-agent widgets follow it');
assert.match(cssNoComments, /body\.dark\{[^}]*color-scheme:dark/,
  'the dark theme must declare its colour scheme, or an unclassed <button> keeps the light buttonface');
assert.match(cssNoComments, /body:not\(\.light\)/,
  'a user on a dark machine who chooses light must be able to say so');

// B.2 EXECUTED. The manual choice outranks the operating system.
const darkMachine = { matchMedia: (q) => ({ matches: q === '(prefers-color-scheme: dark)' }), localStorage: null };
assert.equal(osPrefersDark(darkMachine), true);
assert.equal(resolveInitialTheme(darkMachine), 'dark', 'a dark machine must open in dark');
const lightMachine = { matchMedia: () => ({ matches: false }), localStorage: null };
assert.equal(resolveInitialTheme(lightMachine), 'light', 'a light machine must open in light');
const store = (value) => ({ getItem: () => value, setItem: () => {} });
assert.equal(resolveInitialTheme({ ...darkMachine, localStorage: store('light') }), 'light',
  'a stored choice must outrank the operating system');
assert.equal(resolveInitialTheme({ ...lightMachine, localStorage: store('dark') }), 'dark',
  'a stored choice must outrank the operating system');
assert.equal(readStoredTheme({ localStorage: store('purple') }), null, 'only dark and light are storable');
assert.equal(resolveInitialTheme({}), 'light', 'a host without matchMedia must fall back to light');

// B.3 ARITHMETIC. The pair inventory. Thresholds are WCAG 2.2 AA:
//   4.5:1 body text, 3:1 large text (>=24px, or >=18.66px bold) and the
//   boundaries of user-interface components and their states (1.4.11).
const PAIRS = [
  ['body text on canvas', '--qb-text', '--qb-canvas', 4.5],
  ['body text on surface', '--qb-text', '--qb-surface', 4.5],
  ['body text on raised', '--qb-text', '--qb-raised', 4.5],
  ['body text on inset', '--qb-text', '--qb-inset', 4.5],
  ['strong text on surface', '--qb-text-strong', '--qb-surface', 4.5],
  ['strong text on raised', '--qb-text-strong', '--qb-raised', 4.5],
  ['strong text on divider', '--qb-text-strong', '--qb-divider', 4.5],
  ['muted text on surface', '--qb-text-muted', '--qb-surface', 4.5],
  ['muted text on canvas', '--qb-text-muted', '--qb-canvas', 4.5],
  ['muted text on raised', '--qb-text-muted', '--qb-raised', 4.5],
  ['muted text on divider', '--qb-text-muted', '--qb-divider', 4.5],
  ['faint/disabled text on surface', '--qb-text-faint', '--qb-surface', 4.5],
  ['faint/disabled text on raised', '--qb-text-faint', '--qb-raised', 4.5],
  ['faint/disabled text on inset', '--qb-text-faint', '--qb-inset', 4.5],
  ['link on surface', '--qb-link', '--qb-surface', 4.5],
  ['link on canvas', '--qb-link', '--qb-canvas', 4.5],
  ['link on raised', '--qb-link', '--qb-raised', 4.5],
  ['accent ink on surface', '--qb-accent', '--qb-surface', 4.5],
  ['accent ink on canvas', '--qb-accent', '--qb-canvas', 4.5],
  ['accent ink on accent tint', '--qb-accent', '--qb-accent-tint', 4.5],
  ['brand fg on brand fill', '--qb-brand-fg', '--qb-brand', 4.5],
  ['brand fg on brand hover', '--qb-brand-fg', '--qb-brand-hover', 4.5],
  ['ok text on ok tint', '--qb-ok', '--qb-ok-bg', 4.5],
  ['warn text on warn tint', '--qb-warn', '--qb-warn-bg', 4.5],
  ['bad text on bad tint', '--qb-bad', '--qb-bad-bg', 4.5],
  ['rail label on rail', '--qb-text-strong', '--qb-rail-bg', 4.5],
  ['badge glyph on badge ink', '--qb-badge-glyph', '--qb-badge-ink', 4.5],
  // 1.4.11 - component boundaries and states.
  ['control border on surface', '--qb-border', '--qb-surface', 3],
  ['control border on canvas', '--qb-border', '--qb-canvas', 3],
  ['control border on raised', '--qb-border', '--qb-raised', 3],
  ['control border on inset', '--qb-border', '--qb-inset', 3],
  ['selected-segment ring on segment track', '--qb-border', '--qb-divider', 3],
  ['chip border on raised', '--qb-chip-border', '--qb-raised', 3],
  ['chip border on surface', '--qb-chip-border', '--qb-surface', 3],
  ['selected rail glyph fill on rail', '--qb-brand', '--qb-rail-bg', 3],
  ['selected nav-item marker on panel', '--qb-accent', '--qb-surface', 3],
  ['selected nav-item marker on its own tint', '--qb-accent', '--qb-accent-tint', 3],
  ['focus ring colour on canvas', '--qb-accent', '--qb-canvas', 3],
];
const failures = [];
const table = [];
for (const [label, fg, bg, floor] of PAIRS) {
  const darkRatio = contrast(resolveToken(`var(${fg})`, DARK), resolveToken(`var(${bg})`, DARK));
  const lightRatio = contrast(resolveToken(`var(${fg})`, LIGHT), resolveToken(`var(${bg})`, LIGHT));
  table.push([label, floor, round2(lightRatio), round2(darkRatio)]);
  if (darkRatio + 1e-9 < floor) failures.push(`dark  ${label}: ${round2(darkRatio)}:1 < ${floor}:1`);
}
assert.deepEqual(failures, [], `dark-mode contrast failures:\n  ${failures.join('\n  ')}`);

// B.4 STATIC. The three coverage gaps, each pinned by the rule that closes it.
// Gap 1 - .btn-default was a phantom class: written in markup, defined nowhere.
const btnDefault = declarations(ruleBody('.btn-default'));
assert.ok(btnDefault.background && btnDefault.color,
  '.btn-default must declare its own surface and ink, in tokens, not inherit a user-agent white');
assert.match(cssNoComments, /body\.dark[^{]*\.btn-default/,
  '.btn-default must appear in the dark control list');
assert.ok(
  contrast(resolveToken(btnDefault.color, DARK), resolveToken('var(--qb-raised)', DARK)) >= 4.5,
  '.btn-default ink on the dark control surface must clear 4.5:1',
);
// Gap 2 - an unclassed <button> fell back to the user-agent buttonface.
const bareButton = declarations(ruleBody('button,input[type="button"],input[type="submit"],input[type="reset"]'));
assert.ok(bareButton.color && bareButton['background-color'],
  'an unclassed <button> must take its ink and surface from tokens, not from system colours');
for (const [themeName, theme] of [['light', LIGHT], ['dark', DARK]]) {
  const ratio = contrast(resolveToken(bareButton.color, theme), resolveToken(bareButton['background-color'], theme));
  assert.ok(ratio >= 4.5, `unclassed <button> in ${themeName} is ${round2(ratio)}:1, below 4.5:1`);
}
// Gap 3 - the selected navigation states.
const navOn = declarations(ruleBody('.nav-item.nav-on'));
assert.match(navOn['box-shadow'] || '', /inset 3px 0 0 0 var\(--qb-accent\)/,
  'the current page must be marked by a 3:1 accent bar; a tint alone is 1.16:1 in dark and 1.23:1 in light');
assert.match(cssNoComments, /body\.dark \.nav-group-h\.rail-on \.rail-glyph\{[^}]*background:var\(--qb-brand\)/,
  'the selected rail group must keep its filled brand glyph in dark');
assert.match(cssNoComments, /body\.dark \.nav-item\.nav-on\{[^}]*background:var\(--qb-accent-tint\)/,
  'the selected panel row must not reuse --qb-raised, which is 1.16:1 against the panel');

// B.5 STATIC. No raw light colour may outlive the dark section again.
// The five bank-queue rules that used to sit after it are the reason this
// check exists: they won the cascade in both themes.
const REVIEWED_LITERALS = new Set([
  '.nav-tone-0 .nav-badge', '.nav-tone-1 .nav-badge', '.nav-tone-2 .nav-badge',
  '.nav-tone-3 .nav-badge', '.nav-tone-4 .nav-badge', '.nav-tone-5 .nav-badge',
  // White ink on a saturated fill: correct in both themes by construction.
  '.btn-danger', '.toast', '.bank-health-icon',
  // Modal scrims: a dark wash over the page, correct in both themes.
  '.drawer-scrim,.pal-scrim,.newmenu-scrim', '.mobile-nav-scrim',
]);
const literalOffenders = [];
for (const match of cssNoComments.matchAll(/(^|[};])\s*([^{};@]+?)\s*\{([^}]*)\}/gm)) {
  const selector = match[2].trim().replace(/\s+/g, ' ');
  if (!selector || selector.startsWith('body.dark') || selector.includes('body.dark')) continue;
  for (const piece of match[3].split(';')) {
    const decl = piece.match(/^\s*(color|background|background-color)\s*:\s*(.+?)\s*$/s);
    if (!decl) continue;
    const value = decl[2];
    if (/^(transparent|none|inherit|currentColor)$/i.test(value)) continue;
    if (!/#[0-9a-fA-F]{3,8}\b|rgba?\(|\bwhite\b/.test(value)) continue;
    if (REVIEWED_LITERALS.has(selector)) continue;
    literalOffenders.push(`${selector} { ${decl[1]}: ${value} }`);
  }
}
assert.deepEqual(literalOffenders, [],
  'these rules paint a raw colour outside body.dark, so the dark theme cannot reach them - '
  + `use a --qb-* token instead:\n  ${literalOffenders.join('\n  ')}`);

// B.6 STATIC. Motion tokens are reused, not reinvented, for the drawer slide.
assert.match(offCanvasBlock[1], /transition:transform var\(--qb-dur-2\) var\(--qb-ease-out\)/,
  'the drawer slide must use the round 3 motion tokens');
assert.match(cssNoComments, /@media \(prefers-reduced-motion:reduce\)\{[\s\S]*?transition-duration:\.001ms!important/,
  'the drawer slide must collapse under prefers-reduced-motion');

// ---------------------------------------------------------------------------
console.log('a11y off-canvas drawer + dark contrast:');
console.log(`  drawer: ${focusableInDrawer.length} focusable controls sit in a box spanning `
  + `x=[${closedBox.left}, ${closedBox.right}] when closed; inert leaves ${reachableOffscreenTabStops} of them in the tab order`);
console.log(`  contrast: ${PAIRS.length} token pairs, 0 dark failures (arithmetic, not a browser measurement)`);
const worstDark = table.reduce((acc, row) => (row[3] / row[1] < acc[3] / acc[1] ? row : acc));
console.log(`  narrowest dark margin: ${worstDark[0]} at ${worstDark[3]}:1 against a ${worstDark[1]}:1 floor`);
