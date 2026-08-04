import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./src/modules-more.jsx', import.meta.url), 'utf8');
const start = source.indexOf('export function GLTrialBalance');
const end = source.indexOf('export function Reports', start);
const gl = source.slice(start, end);
assert.match(gl, /report-replacement-view/);
assert.match(gl, /\{!drill && <>/);
assert.match(gl, /Back to \{tab\}/);
assert.match(gl, /Transaction detail/);
assert.ok(gl.indexOf('{!drill && <>') < gl.indexOf('{drill && (()=>'), 'statement content must be gated before the replacement detail');
console.log('report drill replacement: detail replaces statement and provides explicit Back to report');
