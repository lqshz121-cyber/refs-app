import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const css = read('./index.html');
const shell = read('./src/authoritative-navigation-shell.jsx');

// The production navigation uses compact, self-authored SVG marks.  The visible
// label remains the complete workspace name; implementation states do not take
// space in a CFO's menu.
assert.match(shell, /ITEM_ICON_BY_ROUTE/, 'production navigation maps each route to a semantic icon');
assert.match(shell, /<Icon name=\{ITEM_ICON_BY_ROUTE\[item\.route\] \|\| 'document'\} size=\{18\}\/>/, 'each production row renders a compact SVG icon');
assert.doesNotMatch(shell, /API_READ|API_UNAVAILABLE|Unavailable|slice\(0,1\)/, 'production rows do not expose API labels or letter marks');
for (const tone of [0, 1, 2, 3, 4, 5]) {
  assert.match(css, new RegExp(`\\.nav-tone-${tone} \\.nav-badge\\{`), `navigation tone ${tone} styles its icon mark`);
  assert.match(css, new RegExp(`\\.nav-tone-${tone} \\.nav-group-h\\.rail-on \\.rail-glyph\\{`), `navigation tone ${tone} gives its active rail glyph a family accent`);
}
assert.match(css, /\.authoritative-app \.authoritative-sidebar \.nav-panel \.nav-item-label\{white-space:normal; overflow:visible; text-overflow:clip;/, 'production navigation labels never truncate with an ellipsis');
assert.match(css, /\.badge\{[\s\S]*?border:0; outline:0; box-shadow:none;/, 'status badges have no box edge or shadow');
assert.match(css, /\.source-drill\{[\s\S]*?padding:0; border:0;[\s\S]*?background:transparent; box-shadow:none;/, 'drillable source badges reset browser button chrome');
assert.match(css, /\.source-drill:hover \.badge,\.source-drill:focus-visible \.badge/, 'source badge interaction is visible without a rectangular button');

console.log('badge-visual-contract: production navigation uses semantic SVG icons and complete labels; source/status badges render as chrome-free pills');
