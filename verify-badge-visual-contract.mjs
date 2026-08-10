import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const css = read('./index.html');
const app = read('./src/legacy-demo-app.jsx');

// Navigation and data evidence deliberately use different treatments: coloured
// letter squares orient the secondary navigation, while compact source/status
// pills do not inherit a browser button edge or shadow.
assert.match(app, /className="nav-badge"/, 'secondary navigation keeps its coloured letter badge');
for (const tone of [0, 1, 2, 3, 4, 5]) {
  assert.match(css, new RegExp(`\\.nav-tone-${tone} \\.nav-badge\\{`), `navigation tone ${tone} styles its letter badge`);
  assert.match(css, new RegExp(`\\.nav-tone-${tone} \\.nav-group-h\\.rail-on \\.rail-glyph\\{`), `navigation tone ${tone} gives its active rail glyph a family accent`);
}
assert.match(css, /\.badge\{[\s\S]*?border:0; outline:0; box-shadow:none;/, 'status badges have no box edge or shadow');
assert.match(css, /\.source-drill\{[\s\S]*?padding:0; border:0;[\s\S]*?background:transparent; box-shadow:none;/, 'drillable source badges reset browser button chrome');
assert.match(css, /\.source-drill:hover \.badge,\.source-drill:focus-visible \.badge/, 'source badge interaction is visible without a rectangular button');

console.log('badge-visual-contract: coloured navigation letters retained; source/status badges render as chrome-free pills');
