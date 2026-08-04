import assert from 'node:assert/strict';
import { localInvoiceReceiptBalanceEvidence } from './src/customer-receipt-reversal-evidence.js';
import { localArAgingEvidenceRows } from './src/aging-local-evidence.js';

const invoice={inv_id:8,inv_no:'INV-8',entity_id:2,customer_id:5,customer_name:'Tenant A',status:'OPEN',amount:1000,due_date:'2026-07-01',je_number:'INV-JE',pay_je_number:'REC-8'};
const source={je_number:'INV-JE',posting_status:'POSTED',entity_id:2,lines:[{account_code:'120200',debit_amount:1000}]};
const receipt={je_number:'REC-8',posting_status:'POSTED',entity_id:2,payee:'Tenant A',je_date:'2026-07-10',lines:[{account_code:'111000',debit_amount:700},{account_code:'120200',credit_amount:700}]};
const reversal={je_number:'REV-8',je_type:'REVERSAL',posting_status:'POSTED',entity_id:2,je_date:'2026-07-20',history:[{a:'REVERSAL of REC-8'}],lines:[{account_code:'111000',credit_amount:700},{account_code:'120200',debit_amount:700}]};
assert.equal(localInvoiceReceiptBalanceEvidence(invoice,[source,receipt,reversal],'2026-07-15').receivedAmount,700);
assert.equal(localInvoiceReceiptBalanceEvidence(invoice,[source,receipt,reversal],'2026-07-31').state,'RECEIPT_REVERSED_EVIDENCE');
const row=localArAgingEvidenceRows([invoice],[source,receipt,reversal],[],'2026-07-31').at(0);
assert.equal(row.outstanding_amount,1000);
const blocked=localInvoiceReceiptBalanceEvidence(invoice,[source,receipt,reversal],'2026-07-31',[{match_status:'MATCHED',direction:'CREDIT',matched_je:'REC-8'}]);
assert.equal(blocked.state,'RECEIPT_REVERSAL_BANK_REVIEW');
assert.equal(blocked.receivedAmount,700);
console.log('customer receipt reversal: cutoff-aware local AR restoration and bank-match review boundary verified');
