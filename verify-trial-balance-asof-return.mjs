import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const ui = readFileSync(new URL('./src/modules-more.jsx', import.meta.url), 'utf8');
assert.match(ui, /asOf:preset\.asOf === true/, 'Returned report drills restore their cumulative as-of marker');
assert.match(ui, /asOf:options\.asOf === true/, 'JE report returns retain the caller cumulative/period semantic');
assert.match(ui, /drillLabel:label,asOf:drill\.asOf === true/, 'A JE opened from TB cumulative detail returns to cumulative detail');
assert.match(ui, /sourceTargetFor\(j,\{asOf:drill\.asOf === true\}\)/, 'A source opened from TB cumulative detail retains the same cumulative semantic');
console.log('trial balance as-of return: TB cumulative account drill retains opening-to-as-of semantics through JE return');
