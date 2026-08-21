import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const styles=readFileSync('index.html','utf8');
const workspace=readFileSync('src/authoritative-workspace.jsx','utf8');

assert.match(styles,/\.authoritative-topbar \.authoritative-shell-select::after\{content:'⌄'; position:absolute;/,
  'the authoritative scope chevron must stay valid UTF-8 so later responsive media rules remain parseable');
assert.doesNotMatch(styles,/content:'鈱\?;/,
  'a deployment must never publish the mojibake sequence that swallows all later responsive CSS');
assert.match(workspace,/authoritative-list-filters authoritative-compact-list-filters/,
  'the responsive contract must cover the shared authoritative AP/AR filter surface');
assert.match(workspace,/className="authoritative-list-more-filters"/,
  'secondary AP/AR filters must use one keyboard-native collapsed disclosure');
assert.match(workspace,/<summary>\{bill\?'Filter':'More filters'\}\{moreFilterCount\?/,
  'the collapsed disclosure must use the observed concise Expenses label and surface the active secondary-filter count');
assert.match(workspace,/<label>\{bill\?'Payee':'Customer'\} <select/,
  'the responsive contract must retain the observed AP Payee and authoritative AR Customer selectors');
assert.match(workspace,/type="text" inputMode="numeric" autoComplete="off" maxLength=\{10\} pattern="\[0-9\]\{4\}-\[0-9\]\{2\}-\[0-9\]\{2\}" placeholder="YYYY-MM-DD"/,
  'date filters must expose one stable English YYYY-MM-DD contract instead of a browser-localized native control');
assert.doesNotMatch(workspace,/<input type="date"[^>]*filterDraft/,
  'AP/AR filter dates must never regress to locale-dependent native placeholders');
assert.match(styles,/\.authoritative-compact-list-filters\{grid-template-columns:minmax\(220px,2fr\) minmax\(150px,1fr\) auto auto auto;\}/,
  'wide AP/AR lists must keep Search, Status, Filter, Reset and result count on one compact row');
assert.match(styles,/\.authoritative-list-more-filter-grid\{display:grid;grid-template-columns:repeat\(4,minmax\(0,1fr\)\)/,
  'expanded secondary filters must use a contained grid instead of lengthening the default page');
assert.match(styles,/@media\(max-width:1400px\)\{\.authoritative-compact-list-filters,\.authoritative-list-more-filter-grid\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\);\}\}/,
  'the primary and secondary Expenses grids must collapse before sidebar-reduced desktop widths');
assert.match(styles,/@media\(max-width:720px\)\{\.authoritative-compact-list-filters,\.authoritative-list-more-filter-grid\{grid-template-columns:minmax\(0,1fr\);\}/,
  'primary and secondary filters must collapse safely at phone widths');
assert.match(styles,/@media\s*\(max-width:1400px\)\s*\{\.authoritative-list-filters\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\);\}/,
  'authoritative Payables filters must collapse before sidebar-reduced desktop widths can overflow');
assert.match(styles,/\.authoritative-list-filters input,\.authoritative-list-filters select\{min-width:0;width:100%;max-width:100%;\}/,
  'authoritative Payables controls must shrink inside their grid cells');
assert.match(styles,/@media\(max-width:900px\)\{[\s\S]*?\.expense-toolbar>\*\{min-width:0;max-width:100%;\}[\s\S]*?\.expense-toolbar label\{display:grid;grid-template-columns:minmax\(0,1fr\);gap:4px;width:100%;\}/,
  'legacy Payables toolbar labels and selects must also fit their tablet grid tracks');
assert.match(styles,/@media\s*\(max-width:720px\)[\s\S]*?\.authoritative-list-filters\{grid-template-columns:minmax\(0,1fr\);\}/,
  'phone widths must collapse authoritative Payables filters to one safe column');
assert.match(styles,/@media\(min-width:421px\) and \(max-width:720px\)\{\.authoritative-expense-filter-card \.authoritative-compact-list-filters\{grid-template-columns:minmax\(120px,1fr\) auto auto auto;/,
  'observed 525px Expenses must keep its secondary controls in one compact row below Search');
assert.match(styles,/\.authoritative-expense-filter-card \.authoritative-compact-list-filters>label:first-child\{grid-column:1\/-1;\}/,
  'Expenses Search must retain a full-width first row while secondary controls stay compact');
assert.match(styles,/\.authoritative-document-workspace,\.authoritative-document-workspace>\*,\.authoritative-document-table,\.authoritative-adjustment-table\{min-width:0;max-width:100%;\}/,
  'the authoritative workspace must remain shrinkable while tables own their horizontal scrolling');
assert.match(styles,/\.authoritative-register-table,\.authoritative-coa-table,\.authoritative-journal-table,\.authoritative-journal-line-table,\.authoritative-general-ledger-table,\.authoritative-document-table,\.authoritative-adjustment-table\{max-height:60vh;overflow:auto;overscroll-behavior:contain;\}/,
  'phone-width Bills and Vendor credits must stay in contained scroll regions instead of lengthening the full page');
assert.match(styles,/\.report-workbench\{margin:0;padding:14px 0 0;min-width:0;max-width:100%;\}/,
  'nested retained-evidence workbenches must remain shrinkable while the compact Reports hierarchy avoids redundant outer spacing');

console.log('payables-responsive: authoritative Payables filters collapse before sidebar-reduced desktop and phone widths');
