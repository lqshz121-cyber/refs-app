import assert from 'node:assert/strict';
import { localReportWorkflowContext } from './src/report-workflow-return.js';

const target = { route: 'ar', context: { route: 'ar', tab: 'AR Aging' } };
assert.deepEqual(localReportWorkflowContext(target, 'Accounts receivable aging summary'), {
  route: 'ar', tab: 'AR Aging', reportCenterReturn: { route: 'reports', reportName: 'Accounts receivable aging summary' },
});
assert.equal(localReportWorkflowContext(null, 'AP Aging'), null);
console.log('report-workflow-return: OK');
