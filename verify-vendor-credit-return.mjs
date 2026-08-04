import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { localVendorCreditLinkedBillReturn, localVendorCreditJournalReturnContext, localVendorCreditReturnScopeLabel } from './src/vendor-credit-return.js';

assert.equal(localVendorCreditLinkedBillReturn('JE-CR-9'), 'JE-CR-9');
assert.equal(localVendorCreditLinkedBillReturn(null), null);
assert.deepEqual(localVendorCreditJournalReturnContext('JE-CR-9'), {route:'ap',tab:'Bills',creditKey:'JE-CR-9'});
assert.match(localVendorCreditReturnScopeLabel({creditKey:'JE-CR-9'}), /JE-CR-9/);
const apUi = readFileSync(new URL('./src/module-ap.jsx', import.meta.url), 'utf8');
assert.match(apUi, /setBillReturnCreditKey\(localVendorCreditLinkedBillReturn\(r\.journal\.je_number\)\);openBillDetail\(r\.bill\.bill_id\)/, 'credit-application linked Bill retains the Credit return origin');
console.log('vendor credit return: linked Bill retains local credit origin');
