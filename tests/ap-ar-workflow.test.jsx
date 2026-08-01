import assert from 'node:assert/strict';
import {approveBillCommand,payBillCommand} from '../src/ap-workflow.js';
import {createInvoiceCommand,receivePaymentCommand} from '../src/ar-workflow.js';
import {applyPostedDocumentTransition,validateDocumentReversal} from '../src/document-posting.js';

const open={period_code:'2026-07',status:'OPEN'};
const closed={period_code:'2026-07',status:'CLOSED'};
const hold={period_code:'2026-07',status:'SOFT_CLOSED'};
const approver={user_id:'ricky'};
const maker={user_id:'sam'};
const allow=()=>true;
const baseBill={bill_id:1,bill_no:'B-1',entity_id:2,period_code:'2026-07',bill_date:'2026-07-20',vendor_id:7,vendor_name:'Vendor Seven',
  amount:600,status:'PENDING_APPROVAL',created_by:'sam',bank_member:'Operating Cash_BA-001',lines:[
    {account_code:'612900',amount:100,description:'A',member:'M1',property_id:1,project_id:11,cost_code:'CC1'},
    {account_code:'164200',amount:200,description:'B',member:'M2',property_id:2,project_id:22,cost_code:'CC2'},
    {account_code:'641600',amount:300,description:'C',member:'M3',property_id:3,project_id:33,cost_code:'CC3'},
  ]};
const baseInvoice={inv_id:2,inv_no:'I-2',entity_id:2,period_code:'2026-07',inv_date:'2026-07-21',customer_id:8,customer_name:'Customer Eight',
  amount:750,status:'DRAFT',created_by:'sam',memo:'Rent',bank_member:'Operating Cash_BA-001'};
const originalBill=structuredClone(baseBill);
const originalInvoice=structuredClone(baseInvoice);

const bill=approveBillCommand({bill:baseBill,user:approver,can:allow,period:open,jeId:101,jeNumber:'JE-101'});
assert.equal(bill.ok,true);
assert.equal(bill.nextDocument.status,'APPROVED_PENDING_POST');
assert.equal(bill.draftJE.posting_status,'DRAFT');
assert.equal(bill.draftJE.lines.length,4);
assert.deepEqual(bill.draftJE.lines.slice(0,3).map(l=>[l.account_code,l.description,l.member,l.property_id,l.project_id,l.cost_code,l.debit_amount]),[
  ['612900','A','M1',1,11,'CC1',100],['164200','B','M2',2,22,'CC2',200],['641600','C','M3',3,33,'CC3',300]]);
assert.deepEqual(bill.draftJE.lines[3],{account_code:'291001',debit_amount:0,credit_amount:600,vendor_id:7,member:'Vendor Seven',description:'Due to/from_Vendor Seven'});
assert.equal(bill.draftJE.lines.reduce((s,l)=>s+l.debit_amount,0),bill.draftJE.lines.reduce((s,l)=>s+l.credit_amount,0));
assert.deepEqual([bill.draftJE.source_object_type,bill.draftJE.source_object_id],['AP_BILL',1]);

const sod=approveBillCommand({bill:baseBill,user:maker,can:allow,period:open,jeId:102,jeNumber:'JE-102'});
assert.deepEqual([sod.ok,sod.code,sod.nextDocument,sod.draftJE],[false,'4009',null,null]);
for(const [period,code] of [[undefined,'PERIOD_NOT_CONFIGURED'],[closed,'4005'],[hold,'4005']]){
  const result=approveBillCommand({bill:baseBill,user:approver,can:allow,period,jeId:103,jeNumber:'JE-103'});
  assert.deepEqual([result.ok,result.code,result.nextDocument,result.draftJE],[false,code,null,null]);
}
const duplicate=approveBillCommand({bill:baseBill,user:approver,can:allow,period:open,jeId:104,jeNumber:'JE-104',existingJEs:[{source_system:'AP',source_doc_id:'AP-BILL:1',posting_status:'DRAFT'}]});
assert.deepEqual([duplicate.ok,duplicate.code],[false,'AP_DUPLICATE_SOURCE']);
assert.equal(approveBillCommand({bill:{...baseBill,bill_date:'2026-06-30'},user:approver,can:allow,period:open,jeId:1041,jeNumber:'JE-1041'}).code,'PERIOD_DATE_MISMATCH');

const paymentIdMissing=payBillCommand({bill:{...baseBill,status:'APPROVED'},user:approver,can:allow,period:open,jeId:105,jeNumber:'JE-105'});
assert.equal(paymentIdMissing.code,'AP_PAYMENT_ID_REQUIRED');
const missingBank=payBillCommand({bill:{...baseBill,status:'APPROVED',bank_member:''},paymentId:'PAY-1',user:approver,can:allow,period:open,jeId:106,jeNumber:'JE-106'});
assert.equal(missingBank.code,'4020');
const paidAgain=payBillCommand({bill:{...baseBill,status:'PAID'},paymentId:'PAY-2',user:approver,can:allow,period:open,jeId:107,jeNumber:'JE-107'});
assert.deepEqual([paidAgain.ok,paidAgain.code,paidAgain.nextDocument,paidAgain.draftJE],[false,'AP_BILL_PAYMENT_STATE',null,null]);
const payment=payBillCommand({bill:{...baseBill,status:'APPROVED'},paymentId:'PAY-3',user:approver,can:allow,period:open,jeId:108,jeNumber:'JE-108'});
assert.equal(payment.ok,true);
assert.equal(payment.nextDocument.status,'PAYMENT_PENDING');
assert.equal(payment.nextDocument.payment_id,'PAY-3');
assert.equal(payment.draftJE.source_doc_id,'AP-PAYMENT:PAY-3');
assert.deepEqual([payment.draftJE.source_object_type,payment.draftJE.source_object_id],['AP_BILL',1]);
assert.equal(payment.draftJE.lines.find(l=>l.account_code==='111000').member,'Operating Cash_BA-001');
const paid=applyPostedDocumentTransition({ap:{bills:[payment.nextDocument]},ar:{invoices:[]},je:{...payment.draftJE,posting_status:'POSTED',posted_by:'poster'}});
assert.equal(paid.ap.bills[0].status,'PAID');
assert.equal(paid.ap.bills[0].pay_je_number,'JE-108');
assert.equal(applyPostedDocumentTransition({ap:{bills:[payment.nextDocument]},ar:{invoices:[]},je:{...payment.draftJE,je_id:999,posting_status:'POSTED'}}).code,'SOURCE_JE_LINK_MISMATCH');
assert.equal(applyPostedDocumentTransition({ap:{bills:[payment.nextDocument]},ar:{invoices:[]},je:{...payment.draftJE,source_doc_id:'AP-PAYMENT:FORGED',posting_status:'POSTED'}}).code,'SOURCE_TRACE_MISMATCH');
assert.equal(validateDocumentReversal({...payment.draftJE,posting_status:'POSTED'}).code,'JE_BUSINESS_REVERSAL_REQUIRED');
const paymentDuplicate=payBillCommand({bill:{...baseBill,status:'APPROVED'},paymentId:'PAY-3',user:approver,can:allow,period:open,jeId:109,jeNumber:'JE-109',existingJEs:[{source_system:'AP_PAYMENT',source_doc_id:'AP-PAYMENT:PAY-3',posting_status:'DRAFT'}]});
assert.equal(paymentDuplicate.code,'AP_DUPLICATE_SOURCE');

const invoice=createInvoiceCommand({invoice:baseInvoice,user:maker,can:allow,period:open,jeId:201,jeNumber:'JE-201'});
assert.equal(invoice.ok,true);
assert.equal(invoice.nextDocument.status,'OPEN_PENDING_POST');
assert.equal(invoice.draftJE.posting_status,'DRAFT');
assert.equal(invoice.draftJE.lines[0].account_code,'120200');
assert.equal(invoice.draftJE.lines[0].member,'Customer Eight');
assert.deepEqual([invoice.draftJE.source_object_type,invoice.draftJE.source_object_id],['AR_INVOICE',2]);
const missingInvoicePeriod=createInvoiceCommand({invoice:baseInvoice,user:maker,can:allow,period:undefined,jeId:202,jeNumber:'JE-202'});
assert.equal(missingInvoicePeriod.code,'PERIOD_NOT_CONFIGURED');
const closedInvoice=createInvoiceCommand({invoice:baseInvoice,user:maker,can:allow,period:closed,jeId:203,jeNumber:'JE-203'});
assert.equal(closedInvoice.code,'4005');
assert.equal(createInvoiceCommand({invoice:{...baseInvoice,inv_date:'2026-06-30'},user:maker,can:allow,period:open,jeId:2031,jeNumber:'JE-2031'}).code,'PERIOD_DATE_MISMATCH');

const receiptIdMissing=receivePaymentCommand({invoice:{...baseInvoice,status:'OPEN'},user:maker,can:allow,period:open,jeId:204,jeNumber:'JE-204'});
assert.equal(receiptIdMissing.code,'AR_PAYMENT_ID_REQUIRED');
const missingReceiptBank=receivePaymentCommand({invoice:{...baseInvoice,status:'OPEN',bank_member:''},paymentId:'RCPT-1',user:maker,can:allow,period:open,jeId:205,jeNumber:'JE-205'});
assert.equal(missingReceiptBank.code,'4020');
const paidInvoice=receivePaymentCommand({invoice:{...baseInvoice,status:'PAID'},paymentId:'RCPT-2',user:maker,can:allow,period:open,jeId:206,jeNumber:'JE-206'});
assert.deepEqual([paidInvoice.ok,paidInvoice.code,paidInvoice.nextDocument,paidInvoice.draftJE],[false,'AR_INVOICE_PAYMENT_STATE',null,null]);
const receipt=receivePaymentCommand({invoice:{...baseInvoice,status:'OPEN'},paymentId:'RCPT-3',user:maker,can:allow,period:open,jeId:207,jeNumber:'JE-207'});
assert.equal(receipt.ok,true);
assert.equal(receipt.nextDocument.status,'PAYMENT_PENDING');
assert.equal(receipt.nextDocument.payment_id,'RCPT-3');
assert.equal(receipt.draftJE.source_doc_id,'AR-PAYMENT:RCPT-3');
assert.deepEqual([receipt.draftJE.source_object_type,receipt.draftJE.source_object_id],['AR_INVOICE',2]);
assert.equal(receipt.draftJE.lines.find(l=>l.account_code==='111000').member,'Operating Cash_BA-001');
const received=applyPostedDocumentTransition({ap:{bills:[]},ar:{invoices:[receipt.nextDocument]},je:{...receipt.draftJE,posting_status:'POSTED',posted_by:'poster'}});
assert.equal(received.ar.invoices[0].status,'PAID');
assert.equal(received.ar.invoices[0].pay_je_number,'JE-207');
assert.equal(applyPostedDocumentTransition({ap:{bills:[]},ar:{invoices:[receipt.nextDocument]},je:{...receipt.draftJE,source_object_id:999,posting_status:'POSTED'}}).code,'SOURCE_DOCUMENT_NOT_FOUND');
const receiptDuplicate=receivePaymentCommand({invoice:{...baseInvoice,status:'OPEN'},paymentId:'RCPT-3',user:maker,can:allow,period:open,jeId:208,jeNumber:'JE-208',existingJEs:[{source_system:'AR_PAYMENT',source_doc_id:'AR-PAYMENT:RCPT-3',posting_status:'DRAFT'}]});
assert.equal(receiptDuplicate.code,'AR_DUPLICATE_SOURCE');

for(const result of [bill,payment,invoice,receipt]){
  assert.equal(result.ok,true);
  for(const key of ['source_system','source_doc_id','source_object_type','source_object_id','rule_code','setting_used','mapping_used']) assert.ok(result.draftJE[key],`${key} missing`);
  assert.equal(result.draftJE.posting_status,'DRAFT');
  assert.notEqual(result.nextDocument.status,'POSTED');
  assert.notEqual(result.nextDocument.status,'PAID');
}

const denied=createInvoiceCommand({invoice:baseInvoice,user:maker,can:()=>false,period:open,jeId:209,jeNumber:'JE-209'});
assert.deepEqual([denied.ok,denied.code,denied.nextDocument,denied.draftJE],[false,'AR_PERMISSION_DENIED',null,null]);
assert.deepEqual(baseBill,originalBill,'AP command must not mutate its input');
assert.deepEqual(baseInvoice,originalInvoice,'AR command must not mutate its input');

console.log('ap-ar-workflow: all assertions passed');
