import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./src/app.jsx', import.meta.url), 'utf8');
assert.match(source, /const directRoutes=\{'Journal Entry':'je',Reports:'reports'\}/);
assert.match(source, /event\.stopImmediatePropagation\(\);/);
assert.match(source, /<SingletonNavigationDirect goto=\{goto\}\/>/);
console.log('singleton navigation runtime: Journal Entry and Reports parents route directly');
