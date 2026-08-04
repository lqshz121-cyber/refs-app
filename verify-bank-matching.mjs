import assert from 'node:assert/strict';
import { JOURNAL_ENTRIES, BANK_TXNS } from './src/seed.js';
import { eligibleBankMatchCandidates, localBankPostingTrace } from './src/bank-matching.js';

const receipt = BANK_TXNS.find(txn=>txn.bank_txn_id===1);
const exact = eligibleBankMatchCandidates(JOURNAL_ENTRIES, receipt);
assert(exact.some(journal=>journal.je_number==='JE-2026-07-1004'), 'expected the 46,000 rent-receipt JE as a candidate');
assert.equal(eligibleBankMatchCandidates(JOURNAL_ENTRIES, {...receipt,direction:'DEBIT'}).some(journal=>journal.je_number==='JE-2026-07-1004'), false, 'opposite direction must be rejected');
assert.equal(eligibleBankMatchCandidates(JOURNAL_ENTRIES, {...receipt,amount:45999}).some(journal=>journal.je_number==='JE-2026-07-1004'), false, 'different amount must be rejected');
const trace = localBankPostingTrace(receipt, JOURNAL_ENTRIES);
assert.deepEqual(trace, {journalNumber:'JE-2026-07-1004', isPosted:true, canDrillGL:true, canDrillTB:true, status:'POSTED_LOCAL_EVIDENCE'}, 'posted matched evidence exposes read-only GL/TB drill trace');
assert.equal(localBankPostingTrace({matched_je:'Missing'}, JOURNAL_ENTRIES).canDrillGL, false, 'unknown evidence cannot promise a GL drill');
console.log('bank match eligibility: exact amount/direction accepted; mismatches rejected');
