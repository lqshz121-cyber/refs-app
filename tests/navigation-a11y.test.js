import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const app=readFileSync('src/app.jsx','utf8');
assert.match(app,/<button className="mobile-nav-scrim" tabIndex=\{-1\} aria-label="Close navigation"/);
assert.match(app,/<button className="mobile-nav-close" aria-label="Close navigation" onClick=\{\(\)=>setMobileNav\(false\)\}>Close<\/button>/);
assert.match(app,/aria-expanded=\{isSingleton\?undefined:opened\}/,'multi-item group headers must expose expanded state');
assert.match(app,/aria-controls=\{isSingleton\?undefined:groupPanelId\}/,'multi-item group headers must identify their controlled panel');
assert.match(app,/aria-current=\{route===k\?'page':undefined\}/,'the active child route must be announced');
assert.match(app,/<div id=\{groupPanelId\} className="nav-group-items">/,'expanded groups must render a stable controlled panel');
console.log('navigation-a11y: mobile drawer and the focused navigation group expose accessible English controls');
