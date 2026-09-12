import test from 'node:test';import assert from 'node:assert/strict';
import {safeRuntimeFailureLog} from '../runtime/safe-runtime-log.mjs';

test('runtime startup and shutdown logs retain only fixed, non-secret observability fields',()=>{
  const record=safeRuntimeFailureLog('accounting_server_start_failed','ACCOUNTING_SERVER_START_FAILED');
  assert.deepEqual(JSON.parse(record),{event:'accounting_server_start_failed',code:'ACCOUNTING_SERVER_START_FAILED'});
  assert.doesNotMatch(record,/postgres:|password|secret|token/i);
  assert.throws(()=>safeRuntimeFailureLog('invalid event','BAD-code'));
});
