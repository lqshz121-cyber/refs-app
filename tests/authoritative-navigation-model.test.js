import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { AUTHORITATIVE_API_ROUTES, AUTHORITATIVE_NAVIGATION, AUTHORITATIVE_ROUTES, navigationItemForRoute } from '../src/authoritative-navigation.js';

assert.ok(AUTHORITATIVE_NAVIGATION.length >= 10, 'the formal navigation must retain the full product taxonomy');
assert.equal(new Set(AUTHORITATIVE_ROUTES).size, AUTHORITATIVE_ROUTES.length, 'every formal route needs a stable unique identity');
assert.deepEqual([...AUTHORITATIVE_API_ROUTES].sort(), ['vendors','customers','account-inquiry','accounting-analysis-report','accruals','ai-audit','ai-je-workbench','amortization','audit-log','bank','bank-accounts','bank-batch-pipeline','bill-payments','chart-of-accounts','checks-payments','consolidation','construction-loan','fixed-assets','general-ledger','integration-hub','integration-transactions','intercompany','journals','loan-register','mapping','overview','payables','period-management','project-cost-cwip','property-ops-pickup','receivables','receipts','reconciliation','recurring-transactions','revenue-recognition','reports','rules','settings','source-documents','staging','mapping-exceptions','subsidiary-ledger','unit-cost-ledger','wbs-autorec-evidence','wbs-payable-review'].sort());
for (const group of AUTHORITATIVE_NAVIGATION) {
  assert.ok(group.items.length > 0, `${group.label} may not be empty`);
  for (const item of group.items) assert.ok(AUTHORITATIVE_ROUTES.includes(item.route));
}
assert.equal(navigationItemForRoute('project-cost-cwip').availability, 'API_READ');
assert.equal(navigationItemForRoute('unit-cost-ledger').availability, 'API_READ');
assert.equal(navigationItemForRoute('property-ops-pickup').availability, 'API_READ');
assert.equal(navigationItemForRoute('construction-loan').availability, 'API_READ');
assert.equal(navigationItemForRoute('loan-register').availability, 'API_READ');
assert.equal(navigationItemForRoute('amortization').availability, 'API_READ');
assert.equal(navigationItemForRoute('accruals').availability, 'API_READ');
assert.equal(navigationItemForRoute('bill-payments').availability, 'API_READ');
assert.equal(navigationItemForRoute('subsidiary-ledger').availability, 'API_READ');
assert.equal(navigationItemForRoute('intercompany').availability, 'API_READ');
assert.equal(navigationItemForRoute('consolidation').availability, 'API_READ');
assert.equal(navigationItemForRoute('wbs-autorec-evidence').availability, 'API_READ');
assert.equal(navigationItemForRoute('integration-hub').label, 'WBS Data Import');
assert.equal(navigationItemForRoute('integration-hub').availability, 'API_READ');
assert.equal(navigationItemForRoute('wbs-payable-review').availability, 'API_READ');
assert.equal(navigationItemForRoute('bank-batch-pipeline').availability, 'API_READ');
assert.equal(navigationItemForRoute('bank').availability, 'API_READ');
assert.equal(navigationItemForRoute('accounting-analysis-report').availability, 'API_READ');
assert.equal(navigationItemForRoute('audit-log').availability, 'API_READ');
assert.equal(navigationItemForRoute('mapping').availability, 'API_READ');
assert.equal(navigationItemForRoute('period-management').availability, 'API_READ');
assert.equal(navigationItemForRoute('settings').availability, 'API_READ');
assert.equal(navigationItemForRoute('receipts').availability, 'API_READ');
assert.equal(navigationItemForRoute('integration-transactions').availability, 'API_READ');
assert.equal(navigationItemForRoute('rules').availability, 'API_READ');
assert.equal(navigationItemForRoute('recurring-transactions').availability, 'API_READ');
assert.equal(navigationItemForRoute('revenue-recognition').availability, 'API_READ');
assert.equal(navigationItemForRoute('checks-payments').availability, 'API_READ');
assert.equal(navigationItemForRoute('approvals').availability, 'API_COMMAND');
assert.match(navigationItemForRoute('approvals').requirements.join(' '), /server-authorized Journal workflow/);
assert.equal(navigationItemForRoute('closing-accounting').availability, 'API_COMMAND');
assert.match(navigationItemForRoute('closing-accounting').requirements.join(' '), /segregation-of-duties controls/);
assert.equal(navigationItemForRoute('master-data').availability, 'API_COMMAND');
assert.equal(navigationItemForRoute('bank-accounts').availability, 'API_READ');
assert.match(navigationItemForRoute('master-data').requirements.join(' '), /Vendor, Customer, and Chart of Accounts/);
for (const route of AUTHORITATIVE_API_ROUTES) {
  const item = navigationItemForRoute(route);
  assert.ok(item, `every API-backed route ${route} must resolve to a navigation item`);
  assert.equal(item.availability, 'API_READ', `${route} is listed as API-backed so it must declare API_READ availability`);
}
const sourceDocuments = navigationItemForRoute('source-documents');
assert.equal(sourceDocuments.availability, 'API_READ');
assert.equal(sourceDocuments.requirements.length, 2, 'source documents retain the separate attachment-read boundary');
assert.match(sourceDocuments.requirements.join(' '), /attachment-read contract/);
const source = readFileSync(new URL('../src/authoritative-app.jsx', import.meta.url), 'utf8');
assert.match(source, /AuthoritativeNavigationShell/, 'the production app must render the reusable formal shell');
assert.match(source, /AuthoritativeUnavailableWorkspace/, 'unsupported modules must render an explicit fail-closed workspace');
assert.doesNotMatch(source, /legacy-demo-app|\.\/repo\.js|\.\/seed\.js|module-wbs|module-aiaudit|module-ai-je-workbench/,
  'the authoritative shell may not import demo, mock, or browser-state workspaces');
const shellSource = readFileSync(new URL('../src/authoritative-navigation-shell.jsx', import.meta.url), 'utf8');
assert.match(shellSource, /ITEM_ICONS\[item\.route\]/, 'secondary navigation must use a purpose-specific icon for each workspace');
assert.match(shellSource, /GROUP_ICONS\[group\.label\]/, 'primary navigation icons must follow the stable workspace identity rather than its current list position');
assert.match(shellSource, /'mapping-exceptions':'shield'/, 'Mapping Exceptions must use the shared exception/control glyph rather than the completion check');
assert.match(shellSource, /payables:'wallet',[\s\S]*?receivables:'inbox'/, 'Payables and Receivables must remain distinguishable within the same shared stroke-icon system');
assert.doesNotMatch(shellSource, /GROUP_ICONS\[index\]/, 'reordering a workspace must never silently assign another workspace icon');
assert.doesNotMatch(shellSource, /String\(index \+ 1\)\.padStart/, 'secondary navigation must not use numeric-only badges');
console.log('authoritative navigation model: complete catalog retains only API-backed reads and fails closed elsewhere');
