import assert from 'node:assert/strict';
import { localJournalPostingEvidence } from './src/journal-posting-evidence.js';

const posted = localJournalPostingEvidence({posting_status:'POSTED',source_system:'PM',history:[{a:'POST'}],lines:[{account_code:'164200',debit_amount:100,property_id:1},{account_code:'111000',credit_amount:100}]}, {doc_no:'PM-1'});
assert.equal(posted.postingState, 'LOCAL_POSTED_BALANCED');
assert.equal(posted.sourceState, 'RETAINED_LOCAL_SOURCE');
assert.equal(posted.historyState, 'LOCAL_HISTORY_PRESENT_UNVERIFIED');
assert.equal(posted.dimensionState, 'DIMENSION_EVIDENCE_PRESENT');
const missingDimension = localJournalPostingEvidence({posting_status:'POSTED',source_system:'MAN',lines:[{account_code:'164200',debit_amount:100},{account_code:'111000',credit_amount:100}]});
assert.equal(missingDimension.dimensionState, 'DIMENSION_REVIEW_REQUIRED');
assert.equal(missingDimension.sourceState, 'MANUAL_SOURCE_UNVERIFIED');
assert.equal(localJournalPostingEvidence({posting_status:'DRAFT',lines:[{debit_amount:10},{credit_amount:10}]}).postingState, 'NOT_POSTED');
assert.equal(localJournalPostingEvidence({posting_status:'POSTED',lines:[{debit_amount:10},{credit_amount:9}]}).postingState, 'OUT_OF_BALANCE');
console.log('journal posting evidence: posted balance, retained source, and dimension-review boundaries verified');
