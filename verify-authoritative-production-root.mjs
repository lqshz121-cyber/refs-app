import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const entry = read('./src/app.jsx');
const build = read('./build.mjs');

assert.match(build, /entryPoints:\[join\(root,'src\/app\.jsx'\)\]/, 'the shipped bundle must start at src/app.jsx');
assert.match(entry, /<AuthoritativeApp environment=\{globalThis\}\s*\/>/, 'the production root must mount AuthoritativeApp');
assert.match(entry, /boundary\.surface !== SURFACE_AUTHORITATIVE/, 'every non-authoritative runtime surface must fail closed');
assert.doesNotMatch(entry, /legacy-demo-app|\.\/seed(?:\.js)?|localStorage|repo\.save|SURFACE_DEMONSTRATION/, 'the production root must have no legacy data path');

const bundleUrl = new URL('./dist/bundle.js', import.meta.url);
assert.ok(existsSync(bundleUrl), 'dist/bundle.js is missing; run npm.cmd run build first');
const bundle = read('./dist/bundle.js');
for (const marker of [
  'localStorage.getItem',
  'localStorage.setItem',
  'localStorage.removeItem',
  'refs_seedv',
  'refs_jes',
  'refs_bank',
  'Ricky (Controller)',
  'Create local invoice',
]) {
  assert.ok(!bundle.includes(marker), `the production bundle still carries legacy business-state marker ${marker}`);
}

console.log('PASS: production bundle has one authoritative root and no seed/localStorage business-state path');
