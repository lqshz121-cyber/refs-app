import assert from 'node:assert/strict';
import { localBillVoidEvidence } from './src/bill-void-evidence.js';
const ap={je_number:'BILL-1',entity_id:2,posting_status:'POSTED'};
assert.equal(localBillVoidEvidence({je_number:'BILL-1'},[ap]).state,'VOID_ELIGIBLE_REVIEW');
const pay={je_number:'PAY-1',entity_id:2,posting_status:'POSTED'};
assert.equal(localBillVoidEvidence({je_number:'BILL-1',pay_je_number:'PAY-1'},[ap,pay]).state,'VOID_BLOCKED_PAYMENT_OR_BANK');
const rev={je_number:'REV-1',posting_status:'POSTED',je_type:'REVERSAL',history:[{a:'REVERSAL of BILL-1'}]};
assert.equal(localBillVoidEvidence({je_number:'BILL-1'},[ap,rev]).state,'VOID_EVIDENCE_RETAINED');
console.log('bill void evidence: posted AP, payment/bank block, and retained reversal boundaries verified');
