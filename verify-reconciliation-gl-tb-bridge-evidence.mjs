import assert from 'node:assert/strict';
import { localReconciliationGlTbBridgeEvidence } from './src/reconciliation-local-evidence.js';

const master = [{bank_account_code:'BA-1',entity_id:2,cash_scope:'Operating',gl_account_code:'111000'}];
const journal = {je_number:'JE-1',je_date:'2026-07-01',entity_id:2,posting_status:'POSTED',lines:[{account_code:'111000',debit_amount:100,credit_amount:0,property_id:11,project_id:21}]};
const bankAccounts = {'BA-1':{period:'2026-07',stmt_date:'2026-07-31',gl_book_balance:100,txns:[{bank_txn_id:1,txn_date:'2026-07-01',amount:100,direction:'CREDIT',match_status:'MATCHED',matched_je:'JE-1'}]}};
const retained = localReconciliationGlTbBridgeEvidence({bankAccounts,journals:[journal],bankAccountMaster:master,entityId:2,asOfDate:'2026-07-31',propertyId:'11',projectId:'21'});
assert.equal(retained.state,'LOCAL_BANK_GL_TB_EVIDENCE_RETAINED');
assert.equal(retained.rows[0].matched,true);
assert.equal(retained.rows[0].cleared,false);
assert.equal(retained.rows[0].signedOff,false);
const scopedOut = localReconciliationGlTbBridgeEvidence({bankAccounts,journals:[journal],bankAccountMaster:master,entityId:2,asOfDate:'2026-07-31',propertyId:'12',projectId:'21'});
assert.equal(scopedOut.rows[0].state,'DIMENSION_SCOPE_REVIEW');
console.log('reconciliation GL/TB bridge evidence: matched, cleared, and signed-off remain independent local facts');
