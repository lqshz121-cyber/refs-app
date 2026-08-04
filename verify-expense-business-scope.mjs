import assert from 'node:assert/strict';
import { localExpenseFeatureState } from './src/expense-business-scope.js';

assert.equal(localExpenseFeatureState('Purchase notifications').state, 'REFERENCE_ONLY');
assert.match(localExpenseFeatureState('Receipt reminders').reason, /External card/);
assert.equal(localExpenseFeatureState('Bills').state, 'LOCAL_EVIDENCE_ALLOWED');
console.log('expense business scope: external card and receipt flows remain reference only');
