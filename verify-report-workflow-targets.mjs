import assert from 'node:assert/strict';
import { localReportCapability, localReportWorkflowTarget } from './src/report-workflow-targets.js';

assert.deepEqual(localReportWorkflowTarget('AP Aging'), { route: 'ap', context: { route: 'ap', tab: '璐﹂緞 Aging' } });
assert.deepEqual(localReportWorkflowTarget('Accounts receivable aging summary'), { route: 'ar', context: { route: 'ar', tab: 'AR Aging' } });
assert.deepEqual(localReportWorkflowTarget('Reconciliation History'), { route: 'bankrec', context: { route: 'bankrec' } });
assert.equal(localReportWorkflowTarget('Spreadsheet sync'), null, 'excluded external report surface has no local workflow');
assert.deepEqual(localReportCapability('Balance Sheet'), { state:'LOCAL_LEDGER', label:'Local ledger workflow' });
assert.deepEqual(localReportCapability('Cash Flow'), { state:'LOCAL_LEDGER', label:'Local ledger workflow' });
assert.deepEqual(localReportCapability('General Ledger'), { state:'LOCAL_LEDGER', label:'Local ledger workflow' });
assert.deepEqual(localReportCapability('Adjusted Trial Balance'), { state:'REFERENCE_ONLY', label:'Reference only — unavailable' });
assert.deepEqual(localReportCapability('AP Aging'), { state:'LOCAL_WORKFLOW', label:'Local workflow' });
assert.deepEqual(localReportCapability('Inventory Rollforward'), { state:'REFERENCE_ONLY', label:'Reference only — unavailable' });
assert.equal(localReportCapability('Data Sync Report').state, 'REFERENCE_ONLY');
console.log('report workflow targets: only local close workflows are routable');
