import assert from 'node:assert/strict';
import { localReconciliationHistoryRoute } from './src/reconciliation-history-route.js';

const history = [{id:7,account:'BA-003'}, {id:'eight',account:'BA-004'}];
assert.equal(localReconciliationHistoryRoute(history, 7)?.account, 'BA-003');
assert.equal(localReconciliationHistoryRoute(history, 'eight')?.account, 'BA-004');
assert.equal(localReconciliationHistoryRoute(history, 'missing'), null);
assert.equal(localReconciliationHistoryRoute(history, null), null);
console.log('reconciliation history route: retained snapshot selection verified');
