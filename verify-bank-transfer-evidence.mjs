import assert from 'node:assert/strict';
import { localBankTransferEvidence } from './src/bank-transfer-evidence.js';
const masters=[{bank_account_code:'A',entity_id:2,cash_scope:'Operating'},{bank_account_code:'B',entity_id:2,cash_scope:'Operating'},{bank_account_code:'E',entity_id:2,cash_scope:'Escrow'}];
const tx=[{bank_txn_id:1,bank_account_code:'A',direction:'DEBIT',amount:100,match_status:'MATCHED',matched_je:'T1'},{bank_txn_id:2,bank_account_code:'B',direction:'CREDIT',amount:100,match_status:'MATCHED',matched_je:'T1'},{bank_txn_id:3,bank_account_code:'E',direction:'DEBIT',amount:50,match_status:'MATCHED',matched_je:'T2'}];
const journals=[{je_number:'T1',posting_status:'POSTED',source_system:'TRANSFER'},{je_number:'T2',posting_status:'POSTED',source_system:'TRANSFER'}];
const rows=localBankTransferEvidence({bankTransactions:tx,journals,bankAccounts:masters});
assert.equal(rows[0].state,'CONFIRMED_LOCAL_TRANSFER_EVIDENCE');
assert.equal(rows[1].state,'HELD_NON_OPERATING_SCOPE');
console.log('bank transfer evidence: two-sided posted transfer and restricted-cash hold verified');
