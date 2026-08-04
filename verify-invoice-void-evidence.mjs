import assert from 'node:assert/strict';
import { localInvoiceVoidEvidence } from './src/invoice-void-evidence.js';
const source={je_number:'INV-1',entity_id:2,posting_status:'POSTED',lines:[]};
assert.equal(localInvoiceVoidEvidence({je_number:'INV-1',status:'OPEN'},[source]).state,'VOID_ELIGIBLE_REVIEW');
const payment={je_number:'PAY-1',entity_id:2,posting_status:'POSTED',lines:[]};
assert.equal(localInvoiceVoidEvidence({je_number:'INV-1',pay_je_number:'PAY-1'},[source,payment]).state,'VOID_BLOCKED_RECEIPT_OR_BANK');
const reversal={je_number:'REV-1',entity_id:2,posting_status:'POSTED',je_type:'REVERSAL',history:[{a:'REVERSAL of INV-1'}],lines:[]};
assert.equal(localInvoiceVoidEvidence({je_number:'INV-1'},[source,reversal]).state,'VOID_EVIDENCE_RETAINED');
console.log('invoice void evidence: posted-source, receipt/bank block, and retained reversal boundaries verified');
