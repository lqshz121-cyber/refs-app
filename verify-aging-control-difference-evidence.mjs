import assert from 'node:assert/strict';
import { localAgingControlDifferenceEvidence } from './src/aging-local-evidence.js';

const source={je_number:'BILL-1',source_system:'PAYABLE',posting_status:'POSTED',entity_id:2,je_date:'2026-07-01',lines:[{account_code:'291001',credit_amount:1000}]};
const manual={je_number:'MAN-1',source_system:'MAN',posting_status:'POSTED',entity_id:2,je_date:'2026-07-10',lines:[{account_code:'291001',credit_amount:100}]};
const row={included:true,outstanding_amount:1000,evidence:{apJournal:source},payment_evidence:{state:'PAYMENT_REVERSAL_BANK_REVIEW',rows:[]}};
const result=localAgingControlDifferenceEvidence({reportType:'AP',rows:[row],allRows:[row],journals:[source,manual],accountCode:'291001',entityId:2,asOfDate:'2026-07-31',normalSide:'CREDIT'});
assert.equal(result.state,'LOCAL_CONTROL_REVIEW');
assert.ok(result.issues.some(item=>item.category==='POSTED_CONTROL_UNMODELED'&&item.journal?.je_number==='MAN-1'));
assert.ok(result.issues.some(item=>item.category==='BANK_MATCHED_REVERSAL_REVIEW'));
console.log('aging control difference evidence: unmodeled control JE and bank-reversal review retain classified local drills');
