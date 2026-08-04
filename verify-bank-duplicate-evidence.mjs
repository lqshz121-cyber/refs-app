import assert from 'node:assert/strict';
import { localBankDuplicateEvidence } from './src/bank-duplicate-evidence.js';
const tx=[{bank_txn_id:1,bank_account_code:'A',external_id:'X'},{bank_txn_id:2,bank_account_code:'A',external_id:'X',matched_je:'J2'},{bank_txn_id:3,bank_account_code:'A',external_id:'Y'}];
const rows=localBankDuplicateEvidence({bankTransactions:tx,journals:[{je_number:'J2',posting_status:'POSTED'}],bankAccounts:[{bank_account_code:'A',entity_id:2}]});
assert.equal(rows[0].state,'SUSPECTED_DUPLICATE_BLOCKED'); assert.equal(rows[2].state,'UNIQUE_LOCAL_IDENTIFIER');
console.log('bank duplicate evidence: retained identifier collision blocks local posting/match review');
