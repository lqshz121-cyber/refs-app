import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('./index.html', import.meta.url), 'utf8');
const reports = readFileSync(new URL('./src/modules-more.jsx', import.meta.url), 'utf8');

assert.match(reports, /<div className="gl-overview-strip">[\s\S]*?<span><i>View<\/i>[\s\S]*?<span><i>Scope evidence<\/i>[\s\S]*?<span><i>Assets as of/, 'the report snapshot retains all seven shared metrics');
assert.match(css, /\.gl-overview-strip\{grid-template-columns:repeat\(7,minmax\(164px,1fr\)\);overflow-x:auto;grid-auto-flow:column;scrollbar-gutter:stable;\}/, 'seven report metrics occupy one horizontal strip with safe overflow');
assert.match(css, /\.gl-overview-strip\{grid-template-columns:repeat\(7,minmax\(164px,1fr\)\);overflow-x:auto;\}/, 'narrow layouts keep the snapshot as a horizontally scrollable row');

console.log('gl-overview-strip-layout: all report snapshot metrics stay on one horizontal strip');
