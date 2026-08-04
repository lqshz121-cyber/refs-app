import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./src/modules-more.jsx', import.meta.url), 'utf8');
const start = source.indexOf('export function IntegrationHub');
const legacyStart = source.indexOf('const [batches', start);
assert.ok(start >= 0 && legacyStart > start, 'Integration Hub English shell must precede the legacy implementation');
const shell = source.slice(start, legacyStart);
assert.match(shell, /Integration Hub/);
assert.match(shell, /Local source contracts/);
assert.doesNotMatch(shell, /\p{Script=Han}/u, 'Integration Hub shell must not contain Chinese characters');
console.log('PASS Integration Hub renders the English-only local-evidence shell');
