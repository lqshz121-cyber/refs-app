import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const reports = readFileSync(new URL('./src/modules-more.jsx', import.meta.url), 'utf8');
const css = readFileSync(new URL('./index.html', import.meta.url), 'utf8');

const trialBalance = reports.slice(reports.indexOf("{tab==='Trial Balance'"), reports.indexOf("{tab==='Balance Sheet'"));
assert.match(trialBalance, /<div className="table-wrap trial-balance-table">/, 'Trial Balance must use its own compact table wrapper');
assert.doesNotMatch(trialBalance, /table-journal-entries/, 'Trial Balance must not inherit Journal Entries minimum widths');
assert.doesNotMatch(trialBalance, /Export CSV/, 'read-only Trial Balance must not show an export affordance');
assert.match(css, /\.trial-balance-table \.tbl\{min-width:640px; width:100%; table-layout:fixed;\}/, 'Trial Balance fills the report canvas with four fixed accounting columns');

console.log('trial-balance-layout: compact four-column table fills the report canvas without export chrome');
