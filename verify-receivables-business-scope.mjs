import assert from 'node:assert/strict';
import { RECEIVABLES_BUSINESS_SCOPE, isReceivablesCapabilityExcluded } from './src/receivables-business-scope.js';

assert.ok(RECEIVABLES_BUSINESS_SCOPE.included.some(item => item.includes('invoice')));
assert.ok(RECEIVABLES_BUSINESS_SCOPE.included.some(item => item.includes('AR aging')));
assert.equal(isReceivablesCapabilityExcluded('Payment links'), true);
assert.equal(isReceivablesCapabilityExcluded('Sales channels'), true);
assert.equal(isReceivablesCapabilityExcluded('Online card collection'), true);
assert.equal(isReceivablesCapabilityExcluded('Record local receipt'), false);
console.log('receivables business scope: local close and excluded sales surfaces verified');
