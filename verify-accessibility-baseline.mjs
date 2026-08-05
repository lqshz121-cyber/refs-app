import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('./index.html', import.meta.url), 'utf8');
const ui = readFileSync(new URL('./src/ui.jsx', import.meta.url), 'utf8');

assert.match(html, /<html\s+lang="en">/, 'document language must be declared');
assert.match(html, /<meta\s+charset="UTF-8"\/>/, 'document character encoding must be declared');
assert.match(html, /\.th-sort:focus-visible/, 'sortable headers must have a visible focus treatment');
assert.match(ui, /role=\{interactive \? 'button' : undefined\}/, 'clickable cards must expose button semantics');
assert.match(ui, /event\.key==='Enter'\|\|event\.key===' '/, 'clickable cards must support Enter and Space');
assert.match(ui, /aria-label="Search table records"/, 'table search needs an accessible name');
assert.match(ui, /aria-sort=\{sortK===i/, 'table headers must expose sort state');
assert.match(ui, /role="dialog" aria-modal="true" aria-labelledby=\{titleId\}/, 'drawers must expose modal dialog semantics');
assert.match(ui, /role="tablist"/, 'tabs must expose a tablist');
assert.match(ui, /role="tab" aria-selected=\{active===t\}/, 'tabs must expose selected state');
assert.match(ui, /role="status" aria-live="polite"/, 'toasts must announce status changes');
console.log('accessibility baseline: shared controls provide language, keyboard, focus, dialog, table, tab, and status semantics');
