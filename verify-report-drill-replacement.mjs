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
assert.match(source, /onClick=\{\(\)=>\{launchReport\(r\.name, r\.route\);setMenuReport\(null\)\}\}>Open detail<\/button>/, 'More Options must use the same full-page report launch path');
assert.ok(!source.includes('onClick={()=>{setOpen(r.name);setMenuReport(null)}}>Preview</button>'), 'More Options must not bypass the report launch route');
console.log('report drill replacement: detail replaces statement and provides explicit Back to report');
