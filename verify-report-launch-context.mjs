import assert from 'node:assert/strict';
import { localLedgerReportLaunchContext } from './src/report-launch-context.js';

const context = localLedgerReportLaunchContext('Balance Sheet', 15, { drillLabel: 'Balance Sheet' });
assert.deepEqual(context, {
  route:'gl', tab:'Balance Sheet', fromP:'2026-01', toP:'2026-07', entityId:'15', drillLabel:'Balance Sheet',
});
assert.equal(localLedgerReportLaunchContext('Trial Balance', null).entityId, '');
console.log('report launch context: retained entity and period verified');
