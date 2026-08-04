import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('.', import.meta.url).pathname.replace(/^\/(.:)/, '$1');
const read = file => readFileSync(new URL(file, import.meta.url), 'utf8');
const dashboard = read('src/modules-core.jsx');
const styles = read('index.html');

assert.match(dashboard, /<div className="qbo-quicklinks" aria-label="Quick links">/, 'Dashboard quick links need a named landmark');
assert.match(styles, /\.qbo-quicklinks\{display:flex;flex-wrap:wrap;gap:8px/, 'Quick links need a responsive layout rather than browser-default buttons');
assert.match(styles, /\.qbo-quicklinks button\{appearance:none;display:inline-flex/, 'Quick links need product button styling');
assert.match(styles, /\.qbo-quicklinks button:focus-visible\{outline:2px solid var\(--accent\)/, 'Quick links need a keyboard focus indicator');
console.log('PASS: Dashboard quick links have responsive product styling and keyboard focus.');
