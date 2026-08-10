import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const css = read('./index.html');
const app = read('./src/legacy-demo-app.jsx');

assert.match(css, /\.nav-item-label\{[\s\S]*?font-size:13px; letter-spacing:-\.012em;/, 'secondary navigation long labels use the compact readable label treatment');
assert.match(app, /demo-data-badge[\s\S]*?demo-label-full[\s\S]*?demo-label-short[\s\S]*?demo-label-xs/, 'demonstration-data status has explicit responsive labels');
assert.match(app, /user-name-full[\s\S]*?user-name-short[\s\S]*?user\.name\.replace/, 'identity has a full and compact readable label');
assert.match(css, /@media\(max-width:1440px\)\{[\s\S]*?\.demo-label-full\{display:none;\}[\s\S]*?\.demo-label-short\{display:inline;\}/, 'compact desktop and tablet headers use a concise demonstration-data label');
assert.match(css, /@media\(max-width:1440px\)\{[\s\S]*?\.user-name-full\{display:none;\}[\s\S]*?\.user-name-short\{display:inline;\}/, 'compact desktop header switches the identity to an untruncated short label');
assert.match(css, /@media\(max-width:768px\)\{[\s\S]*?\.demo-label-short\{display:none;\}[\s\S]*?\.demo-label-xs\{display:inline;\}/, 'phone header uses the compact Demo label');
assert.match(css, /@media\(max-width:1440px\)\{[\s\S]*?\.user-chip\{flex:0 0 154px; min-width:154px;\}[\s\S]*?\.user-nm \.[\s\S]*?display:none;/, 'compact desktop header reserves identity width and hides the role suffix before clipping the name');
assert.match(css, /@media\(max-width:1024px\)\{[\s\S]*?\.sidebar\{position:fixed;[\s\S]*?width:min\(88vw,320px\); flex-basis:min\(88vw,320px\);[\s\S]*?\.sidebar\.mobile-open\{transform:translateX\(0\);\}/, 'tablet navigation remains an off-canvas, readable, reachable panel');
assert.match(css, /@media\(max-width:430px\)\{[\s\S]*?\.user-chip\{flex:0 0 78px; min-width:78px; max-width:78px; gap:3px; padding:0; overflow:hidden;/, 'phone header keeps sign out reachable without horizontal overflow');

console.log('shell-responsive-readability: compact header labels, identity space, readable navigation labels, and mobile navigation contract passed');
