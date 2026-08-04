import assert from 'node:assert/strict';
import { BANK_ACCOUNTS } from './src/data.js';
import { BANK_TXNS, JOURNAL_ENTRIES } from './src/seed.js';
import { localBankTransactionEvidence } from './src/bank-transaction-evidence.js';

const rent = localBankTransactionEvidence(BANK_TXNS[0], JOURNAL_ENTRIES, BANK_ACCOUNTS);
assert.equal(rent.state, 'VALID_LOCAL_MATCH');
assert.equal(rent.queue, 'Posted');
assert.equal(rent.canDrill, true);
const loan = localBankTransactionEvidence(BANK_TXNS[2], JOURNAL_ENTRIES, BANK_ACCOUNTS);
assert.equal(loan.state, 'CASH_ACCOUNT_MISMATCH');
assert.equal(loan.queue, 'Review');
assert.equal(localBankTransactionEvidence({...BANK_TXNS[0], matched_je:'JE-2026-07-1007'}, JOURNAL_ENTRIES, BANK_ACCOUNTS).state, 'CROSS_ENTITY_JE');
assert.equal(localBankTransactionEvidence({...BANK_TXNS[0], amount:45999}, JOURNAL_ENTRIES, BANK_ACCOUNTS).state, 'CASH_DIRECTION_OR_AMOUNT_MISMATCH');
assert.equal(localBankTransactionEvidence({...BANK_TXNS[1], ui_status:'Excluded'}, JOURNAL_ENTRIES, BANK_ACCOUNTS).state, 'EXCLUDED_NEEDS_AUDIT_REASON');
console.log('bank transaction local evidence: entity/cash/direction/amount/posted proof gates verified');
