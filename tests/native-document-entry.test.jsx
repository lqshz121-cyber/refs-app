import {BusinessRecordEvidence} from '../src/business-record-detail.jsx';
import {ListedRecordJournal} from '../src/listed-record-journal.jsx';
import {formatExactCurrency} from '../src/exact-currency.js';
import {CreditAllocationHistory} from '../src/credit-allocation-history.jsx';
import {DocumentSettlementHistory} from '../src/document-settlement-history.jsx';
import {NativeRefundEntry,NativeRefundForm} from '../src/native-refund-entry.jsx';
import {NativeCreditAllocationEntry,NativeCreditAllocationForm} from '../src/native-credit-allocation.jsx';
import {AuthoritativeAdjustmentDetail} from '../src/authoritative-workspace.jsx';
import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {NativeDocumentEntry,NativeDocumentEntryForm} from '../src/native-document-entry.jsx';
import {NativeSettlementEntry,NativeSettlementForm} from '../src/native-settlement-entry.jsx';
import {AuthoritativeDocumentWorkspace} from '../src/authoritative-workspace.jsx';
const config={entityId:'11111111-1111-4111-8111-111111111111',periodId:'22222222-2222-4222-8222-222222222222'};
assert.equal(formatExactCurrency('9007199254740993.1234','USD'),'$9,007,199,254,740,993.1234');
assert.equal(formatExactCurrency('0.0001','USD'),'$0.0001');
assert.equal(formatExactCurrency('-0.1234','USD'),'-$0.1234');
assert.equal(formatExactCurrency('-1234.5000','USD'),'-$1,234.50');
assert.equal(formatExactCurrency('12.0000','JPY'),'¥12');
assert.equal(formatExactCurrency('12.1234','JPY'),'¥12.1234');
assert.equal(formatExactCurrency('12.1000','KWD'),'KWD 12.100');
assert.equal(formatExactCurrency(null,'USD'),'Not available');
assert.equal(formatExactCurrency('1e20','USD'),'Not available');
const access={entity_id:config.entityId,actor_id:'oidc|maker',session_refresh_required:false,permissions:['AP.BILL.CREATE','AR.INVOICE.CREATE','ATTACHMENT.CREATE']};
for(const recordKind of ['AP_BILL','AR_INVOICE','AP_VENDOR_CREDIT','AR_CREDIT_MEMO']){
 const permissions=[recordKind.startsWith('AP')?'AP.VIEW':'AR.VIEW','GL.JE.VIEW'];
 const render=patch=>renderToStaticMarkup(<ListedRecordJournal config={config} recordKind={recordKind} access={{...access,permissions,...patch}} row={{}}/>);
 assert.match(render({}),/>View journal</);
 assert.equal(render({permissions:[permissions[0]]}),'');
 assert.equal(render({permissions:['GL.JE.VIEW']}),'');
 assert.equal(render({session_refresh_required:true}),'');
 assert.equal(render({entity_id:'another-company'}),'');
}
const scope={entity_id:config.entityId,period_id:config.periodId,entity_name:'Scoped company',period_code:'2026-08',base_currency:'USD',period_start:'2026-08-01',period_end:'2026-08-31',period_status:'OPEN'};
const accounts=[{period_id:config.periodId,account_code:'610000',account_name:'Office',active:true,requires_member:false},{period_id:config.periodId,account_code:'291001',account_name:'Control',active:true,requires_member:true}];
const refundAccess={...access,permissions:['AR.REFUND.CREATE','ATTACHMENT.CREATE']};
const credit={business_adjustment_id:config.periodId,adjustment_kind:'AR_CREDIT_MEMO',status:'POSTED',period_id:config.periodId,amount:'12.3400',currency:'USD',version:'1',accounting_date:'2026-08-01'};
for(const [kind,side,permission] of [['AP_VENDOR_CREDIT','AP','AP.VENDOR_CREDIT.APPLY'],['AR_CREDIT_MEMO','AR','AR.CREDIT_MEMO.APPLY']]){
  const allocationAccess={...access,permissions:[permission]},adjustment={...credit,adjustment_kind:kind};
  assert.equal(renderToStaticMarkup(<NativeCreditAllocationEntry config={config} kind={kind} sourceAdjustmentId={credit.business_adjustment_id} access={access}/>),'');
  const detail=renderToStaticMarkup(<AuthoritativeAdjustmentDetail config={config} entityId={config.entityId} adjustment={adjustment} side={side} currentActorAccess={allocationAccess}/>);
  assert.match(detail,/Apply credit/);
  assert.doesNotMatch(renderToStaticMarkup(<AuthoritativeAdjustmentDetail config={config} entityId={config.entityId} adjustment={{...adjustment,status:'DRAFT'}} side={side} currentActorAccess={allocationAccess}/>),/Apply credit/);
  const form=renderToStaticMarkup(<NativeCreditAllocationForm config={config} kind={kind} sourceAdjustmentId={credit.business_adjustment_id} access={allocationAccess}/>);
  assert.match(form,/applies existing posted credit immediately/);assert.match(form,/inputMode="decimal"/);assert.doesNotMatch(form,/Save draft|Open saved draft/);
}
assert.equal(renderToStaticMarkup(<NativeRefundEntry config={config} sourceAdjustmentId={credit.business_adjustment_id} access={access}/>),'');
assert.match(renderToStaticMarkup(<NativeRefundEntry config={config} sourceAdjustmentId={credit.business_adjustment_id} access={refundAccess} scopes={[scope]}/>),/Refund credit/);
const refundForm=renderToStaticMarkup(<NativeRefundForm config={config} sourceAdjustmentId={credit.business_adjustment_id} access={refundAccess}/>);
assert.match(refundForm,/Refund customer credit/);assert.match(refundForm,/inputMode="decimal"/);assert.match(refundForm,/Supporting document/);assert.match(refundForm,/disabled="">Save draft/);assert.doesNotMatch(refundForm,/Post journal|Approve|type="number"/);
const creditView=row=>renderToStaticMarkup(<AuthoritativeAdjustmentDetail adjustment={row} side="AR" entityId={config.entityId} config={config} currentActorAccess={refundAccess} scopes={[scope]}/>);
assert.match(creditView(credit),/Refund credit/);assert.doesNotMatch(creditView({...credit,status:'DRAFT'}),/Refund credit/);assert.doesNotMatch(creditView({...credit,adjustment_kind:'AR_REFUND'}),/Refund credit/);
for(const kind of ['AP_BILL','AR_INVOICE']){
  assert.equal(renderToStaticMarkup(<NativeDocumentEntry config={config} kind={kind} scope={scope}/>),'');
  assert.equal(renderToStaticMarkup(<NativeDocumentEntry config={config} kind={kind} scope={{...scope,period_status:'CLOSED'}} access={access}/>),'');
  const entry=renderToStaticMarkup(<NativeDocumentEntry config={config} kind={kind} scope={scope} access={access}/>);assert.match(entry,/aria-expanded="false"/);assert.match(entry,/New (bill|invoice)/);
  const form=renderToStaticMarkup(<NativeDocumentEntryForm config={config} kind={kind} access={access} scope={scope} accounts={accounts}/>);
  assert.match(form,/Scoped company/);assert.match(form,/inputMode="decimal"/);assert.match(form,/min="2026-08-01" max="2026-08-31"/);assert.match(form,/610000 · Office/);assert.doesNotMatch(form,/291001|localStorage|Post journal|Approve|type="number"/);assert.match(form,/Uploaded when you save/);assert.doesNotMatch(form,/Upload and verify support/);assert.match(form,/disabled="">Create draft/);
}
const page=renderToStaticMarkup(<AuthoritativeDocumentWorkspace kind="AP" config={config} currentActorAccess={access} scope={scope} accounts={accounts}/>);
assert.match(page,/DRAFT ENTRY/);assert.match(page,/New bill/);
const readonly=renderToStaticMarkup(<AuthoritativeDocumentWorkspace kind="AP" config={config}/>);assert.match(readonly,/READ ONLY/);assert.doesNotMatch(readonly,/New bill/);
console.log('Native document entry SSR: scoped capability gates, labels, precision and draft-only actions passed.');

for(const kind of ['AP_PAYMENT','AR_RECEIPT']){
  const settlementAccess={...access,permissions:[kind==='AP_PAYMENT'?'AP.PAYMENT.CREATE':'AR.RECEIPT.CREATE','ATTACHMENT.CREATE']};
  assert.equal(renderToStaticMarkup(<NativeSettlementEntry config={config} kind={kind}/>),'');
  const entry=renderToStaticMarkup(<NativeSettlementEntry config={config} kind={kind} access={settlementAccess}/>);assert.match(entry,/Record payment|Receive payment/);assert.match(entry,/aria-expanded="false"/);
  const form=renderToStaticMarkup(<NativeSettlementForm config={config} kind={kind} access={settlementAccess} accounts={accounts}/>);assert.match(form,/inputMode="decimal"/);assert.match(form,/Uploaded when you save/);assert.doesNotMatch(form,/Upload and verify|type="number"|Post journal/);assert.match(form,/disabled="">Save draft/);
}

const paymentPeriods=[{entity_id:config.entityId,period_id:config.periodId,period_code:'2026-08',period_status:'CLOSED'},{entity_id:config.entityId,period_id:'33333333-3333-4333-8333-333333333333',period_code:'2026-09',period_status:'OPEN'},{entity_id:'44444444-4444-4444-8444-444444444444',period_id:'55555555-5555-4555-8555-555555555555',period_code:'OTHER COMPANY',period_status:'OPEN'}];
const paymentPeriodView=renderToStaticMarkup(<NativeSettlementEntry config={config} kind="AP_PAYMENT" scopes={paymentPeriods} access={{...access,permissions:['AP.PAYMENT.CREATE','ATTACHMENT.CREATE']}}/>);
assert.match(paymentPeriodView,/Payment period/);assert.match(paymentPeriodView,/2026-09/);assert.doesNotMatch(paymentPeriodView,/2026-08|OTHER COMPANY/);

assert.equal(renderToStaticMarkup(<DocumentSettlementHistory config={config} kind="AP_PAYMENT" access={access}/>),'');
for(const [kind,permission,label] of [['AP_PAYMENT','AP.VIEW','Payment history'],['AR_RECEIPT','AR.VIEW','Receipt history']]){const markup=renderToStaticMarkup(<DocumentSettlementHistory config={config} kind={kind} access={{...access,permissions:[permission]}}/>);assert.match(markup,new RegExp(label));assert.match(markup,/Refresh history/);assert.doesNotMatch(markup,/No payments|No receipts|Save draft/);}

for(const kind of ['AP_VENDOR_CREDIT','AR_CREDIT_MEMO','AP_BILL','AR_INVOICE']){
 const historyAccess={...access,permissions:[kind.startsWith('AP')?'AP.VIEW':'AR.VIEW']};
 assert.match(renderToStaticMarkup(<CreditAllocationHistory config={config} kind={kind} subjectId={config.periodId} access={historyAccess}/>),/Credit allocation history/);
 assert.equal(renderToStaticMarkup(<CreditAllocationHistory config={config} kind={kind} subjectId={config.periodId} access={access}/>),'');
 assert.equal(renderToStaticMarkup(<CreditAllocationHistory config={config} kind={kind} subjectId={config.periodId} access={{...historyAccess,session_refresh_required:true}}/>),'');
}

const exactRecordMarkup=renderToStaticMarkup(<BusinessRecordEvidence config={config} record={{record_kind:'AP_BILL',record_id:config.periodId,number:'EXACT-1',status:'OPEN',revision:'0',accounting_date:'2026-08-01',amount:'9007199254740993.1234',open_balance:'1.2345',currency:'USD',journal_entry_id:null}}/>);assert.match(exactRecordMarkup,/9007199254740993\.1234/);assert.match(exactRecordMarkup,/Back to credit history/);
const linkedRecord={record_id:config.periodId,number:'LINK-1',revision:'1',accounting_date:'2026-08-01',amount:'12.3400',open_balance:'1.2345',currency:'USD',journal_entry_id:null};
const linkedAccess={...access,permissions:['AP.PAYMENT.CREATE','AR.RECEIPT.CREATE','AR.REFUND.CREATE','AP.VENDOR_CREDIT.APPLY','AR.CREDIT_MEMO.APPLY','ATTACHMENT.CREATE']};
const linkedProps={config,access:linkedAccess,scopes:paymentPeriods,onOpenDraft:()=>{},onRefresh:()=>{}};
const linkedView=(record,props={})=>renderToStaticMarkup(<BusinessRecordEvidence {...linkedProps} {...props} record={{...linkedRecord,...record}}/>);
for(const [record_kind,label] of [['AP_BILL','Record payment'],['AR_INVOICE','Receive payment']]){
  const row={record_kind,status:'OPEN'};
  assert.match(linkedView(row),new RegExp(label));
  assert.match(linkedView(row),/2026-09/);assert.doesNotMatch(linkedView(row),/OTHER COMPANY/);
  for(const status of ['DRAFT','PAID','VOID'])assert.doesNotMatch(linkedView({...row,status}),new RegExp(label));
  assert.doesNotMatch(linkedView({...row,open_balance:'0.0000'}),new RegExp(label));
  for(const props of [{access},{onOpenDraft:undefined},{onRefresh:undefined}])assert.doesNotMatch(linkedView(row,props),new RegExp(label));
}
for(const record_kind of ['AP_VENDOR_CREDIT','AR_CREDIT_MEMO']){
  const row={record_kind,status:'POSTED',open_balance:null};
  assert.match(linkedView(row),/Apply credit/);
  for(const props of [{access},{onRefresh:undefined}])assert.doesNotMatch(linkedView(row,props),/Apply credit|Refund credit/);
  assert.doesNotMatch(linkedView({...row,status:'DRAFT'}),/Apply credit|Refund credit/);
  if(record_kind==='AR_CREDIT_MEMO'){
    assert.match(linkedView(row),/Refund credit/);
    assert.doesNotMatch(linkedView(row,{onOpenDraft:undefined}),/Refund credit/);
  }else assert.doesNotMatch(linkedView(row),/Refund credit/);
}
console.log('Linked record actions: AP/AR status, capability, callback and period gates passed.');
