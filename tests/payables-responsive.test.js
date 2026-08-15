import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const styles=readFileSync('index.html','utf8');
const workspace=readFileSync('src/authoritative-workspace.jsx','utf8');

assert.match(workspace,/className="filter-bar authoritative-list-filters"/,
  'the responsive contract must cover the authoritative AP/AR filter surface');
assert.match(workspace,/<label>\{bill\?'Vendor':'Customer'\} <select/,
  'the responsive contract must cover the authoritative Vendor selector');
assert.match(styles,/@media\s*\(max-width:1400px\)\s*\{\.authoritative-list-filters\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\);\}/,
  'authoritative Payables filters must collapse before sidebar-reduced desktop widths can overflow');
assert.match(styles,/\.authoritative-list-filters input,\.authoritative-list-filters select\{min-width:0;width:100%;max-width:100%;\}/,
  'authoritative Payables controls must shrink inside their grid cells');
assert.match(styles,/@media\s*\(max-width:720px\)[\s\S]*?\.authoritative-list-filters\{grid-template-columns:minmax\(0,1fr\);\}/,
  'phone widths must collapse authoritative Payables filters to one safe column');
assert.match(styles,/\.authoritative-document-workspace,\.authoritative-document-workspace>\*,\.authoritative-document-table,\.authoritative-adjustment-table\{min-width:0;max-width:100%;\}/,
  'the authoritative workspace must remain shrinkable while tables own their horizontal scrolling');
assert.match(styles,/\.report-workbench\{margin:14px 0; padding:16px; min-width:0; max-width:100%;\}/,
  'nested retained-evidence workbenches must not preserve an intrinsic width that overflows a 360px page');

console.log('payables-responsive: authoritative Payables filters collapse before sidebar-reduced desktop and phone widths');
