import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = file => readFileSync(new URL(file, import.meta.url), 'utf8');
const reports = read('src/modules-more.jsx');
const returnContext = read('src/report-return-context.js');
const balanceSheetRegister = read('src/balance-sheet-register-return.js');
const cashFlowRegister = read('src/cash-flow-register-return.js');

assert.match(returnContext, /reportCenterReturn = null/, 'Report return context must accept the Reports Center return state.');
assert.match(returnContext, /reportCenterReturn\?\.route === 'reports'/, 'Report return context must retain only a Reports Center return target.');
assert.match(returnContext, /entityId.*propertyId.*projectId.*loanId.*cashScope/s, 'Report return context must keep the accounting scope.');
assert.match(reports, /preset\.reportReturn\?\.reportCenterReturn\?\.route === 'reports'/, 'GL must recover Reports Center state nested inside a downstream drill.');
assert.match(reports, /reportName:tab,category,search/, 'Reports Center launch must retain the report name, category, and search.');
assert.match(reports, /const reportsReturn = navContext\?\.route === 'reports'/, 'Reports Center must consume a direct Back target.');
assert.match(reports, /useState\(reportsReturn\?\.search \|\| ''\)/, 'Reports Center must restore the search query after Back.');
assert.match(reports, /useState\(reportsReturn\?\.category \|\| 'Standard reports'\)/, 'Reports Center must restore the selected category after Back.');

for (const name of ['openJournalFromReport', 'registerTargetForReport', 'sourceTargetFor', 'cashFlowRegisterTarget', 'agingTarget']) {
  const start = reports.indexOf(name);
  assert.ok(start >= 0, `Expected ${name} report drill to exist.`);
  assert.match(reports.slice(start, start + 1200), /reportCenterReturn/, `${name} must pass Reports Center state downstream.`);
}

assert.match(balanceSheetRegister, /reportCenterReturn = null/, 'Balance Sheet register drill must accept Reports Center state.');
assert.match(balanceSheetRegister, /drillLabel:.*reportCenterReturn/s, 'Balance Sheet register drill must return to the originating Reports Center context.');
assert.match(cashFlowRegister, /reportCenterReturn = null/, 'Cash Flow register drill must accept Reports Center state.');
assert.match(cashFlowRegister, /drillLabel:.*reportCenterReturn/s, 'Cash Flow register drill must return to the originating Reports Center context.');
assert.match(reports, /ctx\.goto\('reports', reportCenterReturn\)/, 'GL report Back must replace the detail page with the Reports Center.');

console.log('PASS: Reports Center category/search and accounting scope survive report, source, register, aging, and reconcile drills.');
