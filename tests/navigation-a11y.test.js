import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {focusFirstControl, navDrawerAttributes, navDrawerIsInert, readOffCanvas, restoreFocus, watchOffCanvas, NAV_DRAWER_MEDIA} from '../src/nav-drawer.js';

const app=readFileSync('src/legacy-demo-app.jsx','utf8');
const authoritative=readFileSync('src/authoritative-app.jsx','utf8');
const authoritativeShell=readFileSync('src/authoritative-navigation-shell.jsx','utf8');
const unavailableWorkspace=readFileSync('src/authoritative-unavailable-workspace.jsx','utf8');
const styles=readFileSync('index.html','utf8');
assert.match(app,/<button className="mobile-nav-scrim" tabIndex=\{-1\} aria-label="Close navigation"/);
assert.match(app,/<button className="mobile-nav-close" aria-label="Close navigation" onClick=\{\(\)=>setMobileNav\(false\)\}>Close<\/button>/);
assert.match(app,/aria-expanded=\{isSingleton\?undefined:opened\}/,'multi-item group headers must expose expanded state');
assert.match(app,/aria-controls=\{isSingleton\?undefined:groupPanelId\}/,'multi-item group headers must identify their controlled panel');
assert.match(app,/aria-current=\{route===k\?'page':undefined\}/,'the active child route must be announced');
assert.match(app,/<div id=\{groupPanelId\} className="nav-group-items">/,'expanded groups must render a stable controlled panel');

// ---------------------------------------------------------------------------
// Off-canvas drawer, WCAG 2.4.3 (A) and 2.4.7 (AA).
//
// Below 1024px the sidebar is moved out of the viewport by `transform` alone.
// A transform moves paint, not participation, so before this the drawer kept
// every one of its controls in the tab order while invisible: measured at 768px
// on 2026-08-06, 42 tab stops with 16 off-screen and the FIRST tab stop of the
// document invisible at left:-281px.
//
// `inert` is the only mechanism that removes the subtree from the tab order and
// the accessibility tree while leaving it laid out, so the slide transition
// survives. display:none and visibility:hidden both cancel the transition.
// ---------------------------------------------------------------------------
assert.equal(navDrawerIsInert(true,false),true,'closed at a narrow width: nothing inside may be reachable');
assert.equal(navDrawerIsInert(true,true),false,'open: everything inside must be reachable');
assert.equal(navDrawerIsInert(false,false),false,'at desktop widths the drawer is permanently visible and must never be inert');
assert.equal(navDrawerIsInert(false,true),false,'at desktop widths the drawer is permanently visible and must never be inert');
assert.deepEqual(navDrawerAttributes(true,false),{inert:'','aria-hidden':'true'});
assert.deepEqual(navDrawerAttributes(true,true),{inert:undefined,'aria-hidden':undefined});
assert.equal(navDrawerAttributes(true,false).inert,'','React 18 drops a boolean true for an attribute it does not know');

// The viewport class is read synchronously at mount. One frame of the wrong
// answer is one frame in which the first Tab lands off-screen.
assert.equal(readOffCanvas({matchMedia:q=>({matches:q===NAV_DRAWER_MEDIA})}),true);
assert.equal(readOffCanvas({matchMedia:()=>({matches:false})}),false);
assert.equal(readOffCanvas({}),false,'a host without matchMedia must not claim to be off-canvas');
assert.equal(readOffCanvas({matchMedia(){throw new Error('unsupported query');}}),false);
assert.equal(typeof watchOffCanvas({},()=>{}),'function','watchOffCanvas must always return an unsubscribe');

// A legacy MediaQueryList exposes addListener, not addEventListener.
let legacyHandler=null; let legacyRemoved=false;
const legacyStop=watchOffCanvas({matchMedia:()=>({matches:false,
  addListener:h=>{legacyHandler=h;}, removeListener:()=>{legacyRemoved=true;}})},()=>{});
assert.equal(typeof legacyHandler,'function');
legacyStop();
assert.equal(legacyRemoved,true,'the viewport subscription must be removable');

// Focus goes into the drawer on open and comes back to the opener on close, so
// it is never abandoned inside a subtree that is about to become inert.
const focused=[];
const closeButton={focus(){focused.push('close');}};
const railButton={focus(){focused.push('rail');}};
const drawer={querySelector:sel=>sel==='.mobile-nav-close'?closeButton:railButton};
assert.equal(focusFirstControl(drawer),true);
assert.deepEqual(focused,['close'],'opening must land on the control that undoes the action');
assert.equal(focusFirstControl({querySelector:sel=>sel==='.mobile-nav-close'?null:railButton}),true);
assert.deepEqual(focused,['close','rail'],'with no close button, focus falls to the first control in the drawer');
assert.equal(focusFirstControl(null),false);
assert.equal(focusFirstControl({}),false);
const opener={focus(){focused.push('opener');}};
assert.equal(restoreFocus(opener),true);
assert.deepEqual(focused,['close','rail','opener']);
assert.equal(restoreFocus(null),false,'a missing opener must not throw on close');

// Both shells wire the same contract. The authoritative shell previously had no
// opener at all, so below 1024px its navigation was off-screen with no way back.
for (const [name,source,open] of [['src/legacy-demo-app.jsx',app,'mobileNav'],['src/authoritative-app.jsx',authoritative,'navOpen']]) {
  assert.ok(source.includes(`{...navDrawerAttributes(navOffCanvas, ${open})}`),`${name}: the sidebar must be inert exactly when it is off-canvas and closed`);
  assert.match(source,/readOffCanvas\(\)/,`${name}: the viewport class must be read at mount`);
  assert.match(source,/watchOffCanvas\(null, setNavOffCanvas\)/,`${name}: growing past the breakpoint must un-inert the drawer`);
  assert.match(source,/focusFirstControl\(navDrawerRef\.current\)/,`${name}: opening must move focus into the drawer`);
  assert.match(source,/restoreFocus\(navOpenerRef\.current\)/,`${name}: closing must return focus to the opener`);
  assert.match(source,/(key === 'Escape'|key==='Escape')/,`${name}: Escape must close the drawer`);
  assert.match(source,/aria-controls="(primary|authoritative)-navigation" aria-expanded=\{(mobileNav|navOpen)\}/,`${name}: the opener must announce what it controls and whether it is open`);
  assert.match(source,/className="mobile-nav-close"/,`${name}: an off-canvas drawer needs a visible way out`);
}

// The authoritative surface must expose the same presentation-only theme
// control as the legacy shell.  It is deliberately an explicit button rather
// than a system-only preference, so keyboard and touch users can always
// choose a contrast mode without changing any accounting state.
assert.match(authoritative, /from '\.\/authoritative-theme-preference\.js'/,
  'the authoritative shell must use the session-only presentation preference helper');
assert.doesNotMatch(authoritative, /from '\.\/theme-preference\.js'/,
  'the authoritative shell must not import the demonstration localStorage preference helper');
assert.match(authoritative, /resolveInitialTheme\(environment\)/,
  'the authoritative shell must honour the reader or OS theme at startup');
assert.match(authoritative, /watchOsTheme\(environment, next => setTheme\(next\)\)/,
  'the authoritative shell must follow OS changes until the reader chooses a theme');
assert.match(authoritative, /writeStoredTheme\(next, environment\)/,
  'a reader-selected theme must use the audited presentation-preference store');
assert.match(authoritative, /aria-pressed=\{theme === 'dark'\}/,
  'the theme toggle must announce its selected state');
assert.match(authoritative, /Switch to (?:light|dark) theme/,
  'the theme toggle must have an understandable accessible name');

// The authoritative shell deliberately reuses the complete two-level REFS
// workspace layout: a compact workflow rail and a full-width readable page
// panel.  Only its navigation model is shared; its data remains API-only.
assert.match(styles,/\.authoritative-app \.authoritative-sidebar\{flex-direction:row; align-items:stretch;\}/,
  'the authoritative shell must use the readable rail-and-panel layout');
assert.match(styles,/\.authoritative-app \.authoritative-sidebar \.nav-rail \.nav-group-h/,
  'the production workflow rail must keep compact, stable group controls');
assert.match(styles,/\.authoritative-app \.authoritative-sidebar \.nav-panel \.nav-item-label\{white-space:nowrap/,
  'the production page panel must keep the demo shell’s stable single-line rows');
assert.match(styles,/\.authoritative-app \.sidebar\{position:sticky; top:0; left:auto; transform:none; width:var\(--nav-w\); flex:0 0 var\(--nav-w\); box-shadow:none;\}/,
  'the QBO-like rail and panel must remain anchored through wider tablet layouts');
assert.match(styles,/@media\(min-width:901px\)\{\s*\.authoritative-app \.sidebar\{position:sticky/,
  'the authoritative rail must stay visible from 901px upward, where the drawer state machine is not off-canvas');
assert.equal(NAV_DRAWER_MEDIA,'(max-width:900px)',
  'the authoritative drawer state machine must not hide desktop navigation at zoomed 1024px layouts');
assert.match(authoritativeShell,/className="nav-rail"/,
  'the reusable production shell must render a workflow rail');
assert.match(authoritativeShell,/className="nav-panel"/,
  'the reusable production shell must render a full page navigation panel');
assert.match(authoritativeShell,/aria-label="Accounting workspace groups"/,
  'the production workflow rail must expose an accessible landmark name');
assert.match(authoritativeShell,/aria-label=\{`\$\{activeGroup\.label\} navigation`\}/,
  'the selected production group must expose a named page navigation landmark');
assert.match(authoritativeShell,/className="nav-panel-title"/,
  'the production panel must retain the demo shell’s group title hierarchy');
assert.doesNotMatch(authoritativeShell,/authoritative-new-disabled|\+ New/,
  'the authoritative shell must not render an inert New control when no authorised API action exists');
assert.match(authoritativeShell,/from '\.\/ui\.jsx'/,
  'the presentation shell must reuse the local, self-authored rail icon vocabulary');
assert.match(authoritativeShell,/ITEM_ICONS/,
  'each visible catalog entry must use a self-authored icon rather than an abbreviation badge');
assert.match(authoritativeShell,/<Icon name=\{ITEM_ICONS\[itemIndex % ITEM_ICONS\.length\]\} size=\{18\}\/>/,
  'the readable navigation row must render its icon at a compact, consistent size');
assert.doesNotMatch(authoritativeShell,/compactLabel|authoritative-nav-status|API_READ|Unavailable/,
  'navigation rows must not expose implementation statuses or letter abbreviations to finance readers');
assert.match(unavailableWorkspace,/WORKSPACE SETUP|SETUP REQUIRED|SETUP NEEDED/,
  'an unconfigured workspace must explain setup in finance-reader language');
assert.match(unavailableWorkspace,/requirements\.map\(requirement=><li key=\{requirement\}>\{requirement\}<\/li>\)/,
  'a setup page must retain each route-specific prerequisite instead of hiding the actual connection or access gap');
assert.match(unavailableWorkspace,/Who completes this:|Next step:/,
  'a setup page must explain both the responsible party and the safe reader next step');
assert.doesNotMatch(unavailableWorkspace,/config\?\.entityId \|\| 'Not configured'|config\?\.periodId \|\| 'Not configured'/,
  'raw scope identifiers must not be rendered as the visible workspace value');
assert.doesNotMatch(authoritativeShell,/legacy-demo-app|from ['"]\.\/data|from ['"]\.\/seed|from ['"]\.\/repo|localStorage/,
  'the full production shell must not import or persist demonstration business state');

// Stage 5 responsive matrix. Every supported operational width has an
// explicit layout boundary, and evidence tables remain keyboard-focusable
// regions with a contained horizontal overflow instead of forcing the page
// itself to scroll sideways.
for (const width of [1440,1280,1024,768,430,360]) {
  assert.match(styles,new RegExp(`@media\\(max-width:${width}px\\)|@media \\(max-width:${width}px\\)`),
    `responsive layout must retain an explicit ${width}px boundary`);
}
assert.match(styles,/\.table-wrap\{[\s\S]*?overflow:auto;/,
  'wide accounting evidence must scroll inside its own table region');
assert.match(styles,/\.table-wrap\{[\s\S]*?overflow:auto;\s*min-width:0;\s*width:100%;[\s\S]*?box-sizing:border-box;/,
  'wide evidence tables must stay shrinkable inside narrow workspace panels');
assert.match(styles,/\.table-wrap:focus-visible\{outline:2px solid var\(--qb-accent\)/,
  'the keyboard-focusable evidence region must keep a visible focus indicator');
for (const file of [
  'src/authoritative-bank-workspace.jsx',
  'src/authoritative-aging-workspace.jsx',
  'src/authoritative-general-ledger-workspace.jsx',
  'src/authoritative-reports-workspace.jsx'
]) {
  const surface=readFileSync(file,'utf8');
  assert.match(surface,/className="table-wrap[^"]*"[^>]*tabIndex=\{0\}[^>]*aria-label=/,
    `${file}: evidence tables must remain keyboard reachable and explain horizontal scrolling`);
}

console.log('navigation-a11y: mobile drawer is inert while off-canvas and closed, returns focus to its opener, and exposes accessible English controls');
