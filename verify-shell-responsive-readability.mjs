import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const css = read('./index.html');
const app = read('./src/app.jsx');

assert.match(css, /\.nav-item-label\{[\s\S]*?font-size:13px; letter-spacing:-\.012em;/, 'secondary navigation long labels use the compact readable label treatment');
assert.match(app, /demo-data-badge[\s\S]*?demo-label-full[\s\S]*?demo-label-short[\s\S]*?demo-label-xs/, 'demonstration-data status has explicit responsive labels');
assert.match(css, /@media\(max-width:1280px\)\{[\s\S]*?\.demo-label-full\{display:none;\}[\s\S]*?\.demo-label-short\{display:inline;\}/, 'tablet header uses a concise demonstration-data label');
assert.match(css, /@media\(max-width:768px\)\{[\s\S]*?\.demo-label-short\{display:none;\}[\s\S]*?\.demo-label-xs\{display:inline;\}/, 'phone header uses the compact Demo label');
assert.match(css, /@media\(max-width:1440px\)\{[\s\S]*?\.user-chip\{flex-basis:154px; min-width:154px;\}/, 'desktop header reserves a legible identity width');
assert.match(css, /@media\(max-width:1024px\)\{[\s\S]*?\.sidebar\{position:fixed;[\s\S]*?\.sidebar\.mobile-open\{transform:translateX\(0\);\}/, 'tablet navigation remains an off-canvas, reachable panel');

console.log('shell-responsive-readability: compact header labels, identity space, readable navigation labels, and mobile navigation contract passed');
