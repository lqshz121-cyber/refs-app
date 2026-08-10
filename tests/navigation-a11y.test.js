import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {focusFirstControl, navDrawerAttributes, navDrawerIsInert, readOffCanvas, restoreFocus, watchOffCanvas, NAV_DRAWER_MEDIA} from '../src/nav-drawer.js';

const app=readFileSync('src/legacy-demo-app.jsx','utf8');
const authoritative=readFileSync('src/authoritative-app.jsx','utf8');
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

console.log('navigation-a11y: mobile drawer is inert while off-canvas and closed, returns focus to its opener, and exposes accessible English controls');
