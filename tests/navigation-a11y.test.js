import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const app=readFileSync('src/app.jsx','utf8');
assert.match(app,/<button className="mobile-nav-scrim" tabIndex=\{-1\} aria-label="Close navigation"/);
assert.match(app,/<button className="mobile-nav-close" aria-label="Close navigation" onClick=\{\(\)=>setMobileNav\(false\)\}>Close<\/button>/);
console.log('navigation-a11y: mobile drawer exposes accessible English controls');
