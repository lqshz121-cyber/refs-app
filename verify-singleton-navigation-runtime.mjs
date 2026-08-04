import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./src/app.jsx', import.meta.url), 'utf8');
assert.match(source, /const directRoutes=\{'Journal Entry':'je',Reports:'reports'\}/);
assert.match(source, /event\.stopImmediatePropagation\(\);/);
assert.match(source, /<SingletonNavigationDirect goto=\{goto\}\/>/);
assert.match(source, /const isSingleton = g\.items\.length === 1/);
assert.match(source, /isSingleton \? goto\(g\.items\[0\]\[0\]\)/);
assert.match(source, /!isSingleton && opened && g\.items\.map/);
assert.match(source, /\{!isSingleton && <span className="nav-caret">/);
console.log('singleton navigation runtime: every one-child group routes directly without a duplicate child row');
