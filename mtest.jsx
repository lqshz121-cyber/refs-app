import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { JOURNAL_ENTRIES, EXCEPTIONS, CLOSE_TASKS, FY2026 } from './src/seed.js';
import { COA } from './src/data.js';
import { loanRule, pmRule, ENGINE_RULE_CATALOG } from './src/engine.js';
import { Dashboard, JEWorkspace, LoanWorkspace, PMPickup, ClosingWorkspace, ExceptionCenter, CloseMgmt } from './src/modules-core.jsx';
import { GLTrialBalance, Reports, CashModule, LoanRegister, ProjectCost, Assets, Intercompany, IntegrationHub, MasterData, MappingCenter, RuleCenter, AdminModule } from './src/modules-more.jsx';
import { APWorkspace, apAgingDocuments } from './src/module-ap.jsx';
import { ARWorkspace, arAgingDocuments } from './src/module-ar.jsx';
import { BankTransactions } from './src/module-banktx.jsx';
import { BankRec2 } from './src/module-bankrec.jsx';
import { bankSuggestion, splitDifference, buildBankDraft, buildBankWorkflowException, validateBankDraft, findBankMatchCandidates, validateBankMatch, createBankDraftTransition, excludeBankTransition, matchBankTransition, batchBankTransition, undoBankTransition } from './src/bank-workflow.js';
import { authorizeJECommand, copyJEAsDraft, createReclassDraft, createRecurringTemplate, createReversal, rejectJETransition, reserveJESources, resolveJEPeriod, saveJEDraft, transitionJE, validateAttachmentReferences, validateJETransition, validateNewJEBatch, validateNewJESpec, verifyAttachmentContent } from './src/je-workflow.js';
import { COAWorkspace } from './src/module-coa.jsx';
import { AccountRegister } from './src/module-register.jsx';
import { SubsidiaryLedger } from './src/module-subledger.jsx';
import { UnitCostLedger } from './src/module-unitcost.jsx';
import { SourceDocs } from './src/module-sourcedocs.jsx';
import { App, AuthoritativeAdjustmentSummary, AuthoritativeDocumentTable, AuthoritativeDraftForm, AuthoritativeWorkflowAdjustmentTable, AuthoritativeWorkflowTable, validateAuthoritativeDocumentDraft } from './src/app.jsx';
import { CompanySetting } from './src/module-setting.jsx';
import { approveBillCommand, payBillCommand } from './src/ap-workflow.js';
import { createInvoiceCommand, receivePaymentCommand } from './src/ar-workflow.js';
import { applyPostedDocumentBatch, applyPostedDocumentTransition, documentJENumber, validateDocumentReversal } from './src/document-posting.js';

const noop=()=>{};
const actions=new Proxy({}, {get:()=>noop});
const ctx={
  jes:[...JOURNAL_ENTRIES,...FY2026], exceptions:EXCEPTIONS, closeTasks:CLOSE_TASKS,
  ap:{bills:[],dupBlocked:0}, ar:{invoices:[]}, bank:{accounts:{'BA-003':{
    bank_name:'Pacific Bank',stmt_date:'2026-07-31',stmt_end:0,gl_book_balance:0,txns:[],
  }},history:[]}, coa:COA,
  user:{user_id:'ricky',name:'Ricky',role_code:'CONTROLLER'}, entity:0,
  period:{period_code:'2026-07',status:'OPEN'}, can:()=>true, actions, toast:noop, goto:noop,
};
const components=[Dashboard,JEWorkspace,LoanWorkspace,PMPickup,ClosingWorkspace,ExceptionCenter,CloseMgmt,
  GLTrialBalance,Reports,CompanySetting,LoanRegister,ProjectCost,Assets,Intercompany,IntegrationHub,MasterData,
  MappingCenter,RuleCenter,AdminModule,APWorkspace,ARWorkspace,BankTransactions,COAWorkspace,AccountRegister,
  SubsidiaryLedger,UnitCostLedger,SourceDocs];

let failed=0;
for (const Component of components) {
  try { renderToStaticMarkup(<Component ctx={ctx}/>); console.log('PASS',Component.name); }
  catch (error) { failed++; console.error('FAIL',Component.name,error.message); }
}
const authoritativeBankCtx={...ctx,authoritativeMode:true,bank:{accounts:{'BA-003':{bank_name:'Pacific Bank',stmt_date:'2026-07-31',stmt_end:0,gl_book_balance:0,txns:[{bank_txn_id:1,external_id:'BANK-1',txn_date:'2026-07-31',amount:1,direction:'DEBIT',reference:'Fee',match_status:'UNMATCHED'}],outstanding_checks:[],deposits_in_transit:[]}},history:[]}};
const authoritativeBankMarkup=renderToStaticMarkup(<BankTransactions ctx={authoritativeBankCtx}/>);
if(!authoritativeBankMarkup.includes('BANK_API_UNAVAILABLE')||!authoritativeBankMarkup.includes('disabled')){failed++;console.error('FAIL authoritative Bank screen is not fail-closed');}else console.log('PASS authoritative Bank screen is fail-closed');
const authoritativeReconciliationMarkup=renderToStaticMarkup(<BankRec2 ctx={authoritativeBankCtx}/>);
if(!authoritativeReconciliationMarkup.includes('RECONCILIATION_API_UNAVAILABLE')){failed++;console.error('FAIL authoritative reconciliation screen is not fail-closed');}else console.log('PASS authoritative reconciliation screen is fail-closed');
globalThis.__REFS_RUNTIME_MODE__='REQUIRES_AUTHORITATIVE_API';globalThis.__REFS_ACCOUNTING_API__=null;
const lockedRuntimeMarkup=renderToStaticMarkup(<App/>);
delete globalThis.__REFS_RUNTIME_MODE__;delete globalThis.__REFS_ACCOUNTING_API__;
if(!lockedRuntimeMarkup.includes('Authoritative API required')){failed++;console.error('FAIL unconfigured production runtime is not locked');}else console.log('PASS unconfigured production runtime is locked before app state');
globalThis.__REFS_RUNTIME_MODE__='REQUIRES_AUTHORITATIVE_API';globalThis.__REFS_ACCOUNTING_API__={baseUrl:'https://api.example',entityId:'11111111-1111-4111-8111-111111111111',periodId:'33333333-3333-4333-8333-333333333333',cashAccountCode:'111000',getAccessToken:async()=>null};globalThis.__REFS_OIDC__=null;
const configuredWithoutOidcMarkup=renderToStaticMarkup(<App/>);
delete globalThis.__REFS_RUNTIME_MODE__;delete globalThis.__REFS_ACCOUNTING_API__;delete globalThis.__REFS_OIDC__;
if(!configuredWithoutOidcMarkup.includes('Authoritative API required')||configuredWithoutOidcMarkup.includes('Ricky (Controller)')){failed++;console.error('FAIL configured production runtime falls back to a local demo identity');}else console.log('PASS configured production runtime blocks without OIDC bootstrap');
const authoritativeRowsMarkup=renderToStaticMarkup(<><AuthoritativeDocumentTable title="Authoritative AP bills" kind="AP" documents={[{journal_entry_id:'je-1',bill_no:'BILL-100',vendor_name:'Authoritative Vendor',due_date:'2026-08-31',amount:125.25,open_balance:25.25,currency:'USD',status:'PARTIALLY_PAID'}]}/><AuthoritativeAdjustmentSummary title="Authoritative AP adjustments" adjustments={[{business_adjustment_id:'adj-1',adjustment_kind:'AP_VENDOR_CREDIT',amount:5,currency:'USD',status:'POSTED'}]}/></>);
if(!authoritativeRowsMarkup.includes('BILL-100')||!authoritativeRowsMarkup.includes('Authoritative Vendor')||!authoritativeRowsMarkup.includes('AP_VENDOR_CREDIT')||authoritativeRowsMarkup.includes('Ricky (Controller)')){failed++;console.error('FAIL authoritative workspace does not render only API-shaped business rows');}else console.log('PASS authoritative workspace renders API-shaped business rows without local identity');
const workflowMarkup=renderToStaticMarkup(<AuthoritativeWorkflowTable title="Authoritative workflow" kind="AP" onWorkflow={noop} workingJournalIds={new Set()} documents={['DRAFT','PENDING_REVIEW','PENDING_APPROVAL','APPROVED'].map((journal_status,index)=>({journal_entry_id:`00000000-0000-4000-8000-00000000000${index+1}`,journal_revision:index,journal_status,bill_no:`B-${index+1}`,vendor_name:'Vendor',currency:'USD',amount:1,open_balance:1,status:'DRAFT'}))}/>);
if(!['SUBMIT','REVIEW','APPROVE','POST'].every(action=>workflowMarkup.includes(`>${action}<`))){failed++;console.error('FAIL authoritative workflow omits a server transition action');}else console.log('PASS authoritative workflow exposes the complete server transition sequence');
const adjustmentWorkflowMarkup=renderToStaticMarkup(<AuthoritativeWorkflowAdjustmentTable title="Authoritative adjustment workflow" onWorkflow={noop} workingJournalIds={new Set()} adjustments={[{business_adjustment_id:'adj-1',journal_entry_id:'00000000-0000-4000-8000-000000000010',journal_revision:2,journal_status:'PENDING_APPROVAL',adjustment_kind:'AR_CREDIT_MEMO',amount:3,currency:'USD',status:'DRAFT'}]}/>);
if(!adjustmentWorkflowMarkup.includes('>APPROVE<')||adjustmentWorkflowMarkup.includes('Ricky (Controller)')){failed++;console.error('FAIL authoritative adjustment workflow is not server-driven');}else console.log('PASS authoritative adjustment workflow exposes server approval only');
const authoritativeDraft=validateAuthoritativeDocumentDraft({kind:'AP_BILL',documentNumber:'BILL-101',counterpartyRef:'VENDOR-1',counterpartyName:'Authoritative Vendor',currency:'usd',accountingDate:'2026-08-04',dueDate:'2026-08-31',amount:'125.2500',offsetAccountCode:'641600',description:'Authoritative source'});const authoritativeDraftMarkup=renderToStaticMarkup(<AuthoritativeDraftForm config={{}} onCreated={async()=>({ok:true})}/>);
if(!authoritativeDraft.ok||authoritativeDraft.document.amount!=='125.2500'||validateAuthoritativeDocumentDraft({...authoritativeDraft.document,kind:'AR_INVOICE',amount:'1.00000'}).ok||!authoritativeDraftMarkup.includes('Create Draft only')||authoritativeDraftMarkup.includes('Post')){failed++;console.error('FAIL authoritative Draft form does not preserve Draft-only validation');}else console.log('PASS authoritative Draft form is validated and Draft-only');

const expectRule=(name,actual,code,dr,cr)=>{
  const ok=actual?.rule_code===code && actual.lines[0].account_code===dr && actual.lines[1].account_code===cr;
  console.log(ok?'PASS':'FAIL',name); if(!ok) failed++;
};
expectRule('loan draw',loanRule({txn_type:'DRAW',amount:1,loan_id:1}),'R-LOAN-01','111000','270100');
expectRule('interest capitalization',loanRule({txn_type:'INTEREST_ACCRUAL',construction_status:'UNDER_CONSTRUCTION',amount:1,loan_id:1}),'R-LOAN-03','164500','220410');
expectRule('interest expense',loanRule({txn_type:'INTEREST_ACCRUAL',construction_status:'COMPLETED',amount:1,loan_id:1}),'R-LOAN-04','795000','220410');
expectRule('interest payment',loanRule({txn_type:'INTEREST_PAYMENT',amount:1,loan_id:1}),'R-LOAN-05','220410','111000');
expectRule('loan repayment',loanRule({txn_type:'REPAYMENT',amount:1,loan_id:1}),'R-LOAN-08','270100','111000');
const deposit=pmRule({charge_code:'SEC_DEPOSIT',property_code:'P0020',amount:1,cash_accrual:'CASH'});
expectRule('security deposit',deposit,'R-PM-16','111000','225000');
const catalogRepayment=ENGINE_RULE_CATALOG.find(r=>r.rule_code==='R-LOAN-08');
if (!catalogRepayment || catalogRepayment.trigger!=='LOAN.REPAYMENT') { failed++; console.error('FAIL Rule Center catalog repayment'); }
else console.log('PASS Rule Center catalog repayment');

const expectBank=(name,ok)=>{console.log(ok?'PASS':'FAIL',name);if(!ok)failed++;};
const bankTxn={bank_txn_id:5,external_id:'BANKTXN-Z-4480',txn_date:'2026-07-31',amount:85,direction:'DEBIT',reference:'MONTHLY SERVICE FEE',suggest:'FEE',entity_id:4,match_status:'UNMATCHED'};
const bankBase={accounts:{'BA-003':{txns:[bankTxn]}},matches:[],draft_links:[],history:[]};
const bankSpec=buildBankDraft(bankTxn,'BA-003',[{account_code:'651000',amount:85,memo:'Monthly fee'}]);
const draftJE={...bankSpec,je_id:9901,je_number:'JE-BANK-9901',posting_status:'DRAFT'};
expectBank('bank suggestion uses approved fee mapping',bankSuggestion(bankTxn).account_code==='651000');
expectBank('bank split blocks non-zero difference',splitDifference(85,[{amount:40},{amount:40}])===5&&buildBankDraft(bankTxn,'BA-003',[{account_code:'651000',amount:80}]).difference===5);
expectBank('bank draft trace and cash member pass boundary validation',validateBankDraft({txn:bankTxn,spec:bankSpec,jes:[]}).ok&&bankSpec.source_doc_id===bankTxn.external_id&&bankSpec.lines.find(l=>l.account_code==='111000')?.member==='Operating Cash_BA-003');
expectBank('bank missing mapping is blocked',validateBankDraft({txn:bankTxn,spec:{unmapped:true},jes:[]}).code==='BANK_MAPPING_MISSING');
expectBank('bank missing trace is blocked',validateBankDraft({txn:bankTxn,spec:{...bankSpec,source_doc_id:null},jes:[]}).code==='BANK_TRACE_MISSING');
expectBank('bank missing cash member is blocked',validateBankDraft({txn:bankTxn,spec:{...bankSpec,lines:bankSpec.lines.map(l=>l.account_code==='111000'?{...l,member:null}:l)},jes:[]}).code==='BANK_CASH_MEMBER_MISSING');
expectBank('bank unbalanced draft is blocked',validateBankDraft({txn:bankTxn,spec:{...bankSpec,lines:bankSpec.lines.map((l,i)=>i?{...l,credit_amount:80}:l)},jes:[]}).code==='BANK_DRAFT_INVALID');
expectBank('bank duplicate source is idempotently blocked',validateBankDraft({txn:bankTxn,spec:bankSpec,jes:[draftJE]}).code==='BANK_DUPLICATE_SOURCE');
const created=createBankDraftTransition({bank:bankBase,jes:[],acctCode:'BA-003',txnId:5,spec:bankSpec,je:draftJE});
expectBank('bank create transition links source to Draft atomically',created.ok&&created.bank.accounts['BA-003'].txns[0].draft_je_id===9901&&created.jes[0].posting_status==='DRAFT'&&created.bank.draft_links.length===1);
const undone=undoBankTransition({bank:created.bank,jes:created.jes,acctCode:'BA-003',txnId:5});
expectBank('bank Draft undo removes JE and restores source',undone.ok&&undone.kind==='DELETE_DRAFT'&&undone.jes.length===0&&undone.bank.accounts['BA-003'].txns[0].match_status==='UNMATCHED');
for(const status of ['PENDING_REVIEW','APPROVED','POSTED']){
  const blocked=undoBankTransition({bank:created.bank,jes:[{...draftJE,posting_status:status}],acctCode:'BA-003',txnId:5});
  expectBank(`bank ${status} undo is blocked without reopening source`,!blocked.ok&&blocked.code==='BANK_UNDO_NON_DRAFT'&&created.bank.accounts['BA-003'].txns[0].ui_status==='Categorized');
}
expectBank('bank orphan Draft link is blocked',undoBankTransition({bank:created.bank,jes:[],acctCode:'BA-003',txnId:5}).code==='BANK_DRAFT_LINK_MISSING');
const excludedState=excludeBankTransition({bank:bankBase,jes:[],acctCode:'BA-003',txnId:5});
const restoredState=undoBankTransition({bank:excludedState.bank,jes:[],acctCode:'BA-003',txnId:5});
expectBank('bank exclude and restore create no JE',excludedState.ok&&restoredState.ok&&restoredState.kind==='RESTORE'&&restoredState.jes.length===0&&restoredState.bank.accounts['BA-003'].txns[0].ui_status==null);
expectBank('bank processed source cannot be excluded',excludeBankTransition({bank:created.bank,jes:created.jes,acctCode:'BA-003',txnId:5}).code==='BANK_SOURCE_ALREADY_PROCESSED');

const matchTxn={bank_txn_id:2,external_id:'BANKTXN-Z-4471',amount:1250,direction:'CREDIT',currency:'USD',reference:'ACH UNKNOWN TENANT',match_status:'UNMATCHED'};
const postedCandidate={je_id:1010,je_number:'JE-2026-07-1010',entity_id:4,je_date:'2026-07-29',description:'Unapplied tenant receipt',posting_status:'POSTED',currency:'USD',lines:[{account_code:'111000',debit_amount:1250,credit_amount:0,member:'Operating Cash_BA-003'},{account_code:'120200',debit_amount:0,credit_amount:1250,member:'Tenant'}]};
const matchBank={accounts:{'BA-003':{txns:[matchTxn]}},matches:[],draft_links:[]};
const candidates=findBankMatchCandidates({txn:matchTxn,jes:[postedCandidate],bank:matchBank,acctCode:'BA-003',entityId:4});
expectBank('bank match finds a real eligible posted candidate',candidates.length===1&&candidates[0].je_id===1010);
expectBank('bank match missing candidate is blocked',validateBankMatch({txn:matchTxn,candidate:null,bank:matchBank,acctCode:'BA-003',entityId:4,jes:[postedCandidate]}).code==='BANK_MATCH_NOT_FOUND');
expectBank('bank processed source cannot be rematched',validateBankMatch({txn:{...matchTxn,match_status:'MATCHED'},candidate:candidates[0],bank:matchBank,acctCode:'BA-003',entityId:4,jes:[postedCandidate]}).code==='BANK_SOURCE_ALREADY_PROCESSED');
expectBank('bank match amount mismatch is blocked',findBankMatchCandidates({txn:{...matchTxn,amount:1200},jes:[postedCandidate],bank:matchBank,acctCode:'BA-003',entityId:4}).length===0);
expectBank('bank match cross entity is blocked',validateBankMatch({txn:matchTxn,candidate:candidates[0],bank:matchBank,acctCode:'BA-003',entityId:3,jes:[postedCandidate]}).code==='BANK_MATCH_ENTITY');
expectBank('bank match non-Posted candidate is blocked',validateBankMatch({txn:matchTxn,candidate:candidates[0],bank:matchBank,acctCode:'BA-003',entityId:4,jes:[{...postedCandidate,posting_status:'PENDING_REVIEW'}]}).code==='BANK_MATCH_NOT_POSTED');
expectBank('bank match wrong account member is blocked',validateBankMatch({txn:matchTxn,candidate:candidates[0],bank:matchBank,acctCode:'BA-003',entityId:4,jes:[{...postedCandidate,lines:postedCandidate.lines.map((l,i)=>i?l:{...l,member:'Operating Cash_BA-001'})}]}).code==='BANK_MATCH_ACCOUNT');
expectBank('bank match rejects an existing active BANK JE for same source',validateBankMatch({txn:matchTxn,candidate:candidates[0],bank:matchBank,acctCode:'BA-003',entityId:4,jes:[postedCandidate,{...draftJE,source_doc_id:matchTxn.external_id,posting_status:'POSTED'}]}).code==='BANK_DUPLICATE_SOURCE');
const matched=matchBankTransition({bank:matchBank,jes:[postedCandidate],acctCode:'BA-003',txnId:2,candidate:candidates[0],entityId:4,userId:'ricky'});
expectBank('bank match saves exact source, JE and cash-line linkage',matched.ok&&matched.bank.matches[0].je_id===1010&&matched.bank.accounts['BA-003'].txns[0].matched_cash_line===0);
expectBank('bank already occupied candidate is blocked',validateBankMatch({txn:{...matchTxn,external_id:'BANKTXN-OTHER'},candidate:candidates[0],bank:matched.bank,acctCode:'BA-003',entityId:4,jes:[postedCandidate]}).code==='BANK_MATCH_OCCUPIED');
const unmatched=undoBankTransition({bank:matched.bank,jes:matched.jes,acctCode:'BA-003',txnId:2});
expectBank('bank unmatch removes linkage without changing Posted JE',unmatched.ok&&unmatched.kind==='UNMATCH'&&unmatched.bank.matches.length===0&&unmatched.jes[0].posting_status==='POSTED');
const feeTxn={...bankTxn};
const interestTxn={bank_txn_id:6,external_id:'BANKTXN-Z-4481',txn_date:'2026-07-31',amount:250,direction:'CREDIT',reference:'INTEREST INCOME',suggest:'INTEREST',entity_id:4,match_status:'UNMATCHED'};
const batchBank={accounts:{'BA-003':{txns:[feeTxn,interestTxn]}},matches:[],draft_links:[]};
let batchId=9950;
const batchResult=batchBankTransition({bank:batchBank,jes:[],acctCode:'BA-003',entityId:4,userId:'ricky',makeJE:spec=>({...spec,je_id:++batchId,je_number:'JE-BATCH-'+batchId,posting_status:'DRAFT'}),items:[
  {txnId:5,mode:'DRAFT',spec:buildBankDraft(feeTxn,'BA-003',[{account_code:'651000',amount:85}])},
  {txnId:6,mode:'DRAFT',spec:buildBankDraft(interestTxn,'BA-003',[{account_code:'449200',amount:250}])},
]});
expectBank('bank batch commits multiple items on one evolving snapshot',batchResult.results.every(r=>r.ok)&&batchResult.jes.length===2&&batchResult.bank.draft_links.length===2&&new Set(batchResult.jes.map(j=>j.source_doc_id)).size===2);
const partialBatch=batchBankTransition({bank:batchBank,jes:[draftJE],acctCode:'BA-003',entityId:4,userId:'ricky',makeJE:spec=>({...spec,je_id:9999,je_number:'JE-BATCH-9999',posting_status:'DRAFT'}),items:[
  {txnId:5,mode:'DRAFT',spec:bankSpec},{txnId:6,mode:'DRAFT',spec:buildBankDraft(interestTxn,'BA-003',[{account_code:'449200',amount:250}])},
]});
expectBank('bank batch preserves successes while reporting duplicate blocks',!partialBatch.results[0].ok&&partialBatch.results[1].ok&&partialBatch.jes.some(j=>j.source_doc_id===interestTxn.external_id));
const mixedBank={accounts:{'BA-003':{txns:[matchTxn,feeTxn]}},matches:[],draft_links:[]};
const mixedBatch=batchBankTransition({bank:mixedBank,jes:[postedCandidate],acctCode:'BA-003',entityId:4,userId:'ricky',makeJE:spec=>({...spec,je_id:9997,je_number:'JE-BATCH-9997',posting_status:'DRAFT'}),items:[
  {txnId:2,mode:'MATCH',candidate:candidates[0]},{txnId:5,mode:'DRAFT',spec:bankSpec},
]});
expectBank('bank mixed Match and Categorize batch preserves both link types',mixedBatch.results.every(r=>r.ok)&&mixedBatch.bank.matches.length===1&&mixedBatch.bank.draft_links.length===1&&mixedBatch.jes.length===2);
const missingTxn={...interestTxn,bank_txn_id:7,external_id:'BANKTXN-MISSING',suggest:null};
const missingBank={accounts:{'BA-003':{txns:[feeTxn,missingTxn]}},matches:[],draft_links:[]};
const partialMissing=batchBankTransition({bank:missingBank,jes:[],acctCode:'BA-003',entityId:4,userId:'ricky',makeJE:spec=>({...spec,je_id:9998,je_number:'JE-BATCH-9998',posting_status:'DRAFT'}),items:[
  {txnId:5,mode:'DRAFT',spec:bankSpec},{txnId:7,mode:'DRAFT',spec:{unmapped:true}},
]});
const missingFailure=partialMissing.results.find(r=>!r.ok);
const missingException=buildBankWorkflowException({txn:missingTxn,failure:missingFailure,exceptionId:123,entityId:4});
expectBank('bank batch keeps success and yields traceable missing-mapping exception',partialMissing.results.filter(r=>r.ok).length===1&&missingFailure.code==='BANK_MAPPING_MISSING'&&missingException.object_ref==='BANKTXN-MISSING'&&missingException.exception_type==='BANK_MAPPING_MISSING');

const expectJE=(name,ok)=>{console.log(ok?'PASS':'FAIL',name);if(!ok)failed++;};
const apBill={bill_id:77,bill_no:'BILL-77',entity_id:4,period_code:'2026-07',bill_date:'2026-07-31',amount:125,vendor_id:1,vendor_name:'Vendor A',status:'PENDING_APPROVAL',created_by:'maker',lines:[{account_code:'612900',amount:25,description:'Fee'},{account_code:'164200',amount:100,description:'CWIP',cost_code:'2HD'}]};
const apDraft=approveBillCommand({bill:apBill,user:{user_id:'approver'},can:()=>true,period:{period_code:'2026-07',status:'OPEN'},jeId:7701,jeNumber:'JE-7701'});
expectJE('AP approval creates multi-line Draft and pending-post source',apDraft.ok&&apDraft.draftJE.posting_status==='DRAFT'&&apDraft.draftJE.lines.length===3&&apDraft.nextDocument.status==='APPROVED_PENDING_POST');
const apPosted=applyPostedDocumentTransition({ap:{bills:[apDraft.nextDocument]},ar:{invoices:[]},je:{...apDraft.draftJE,posting_status:'POSTED',posted_by:'poster'}});
expectJE('AP source becomes approved only after linked JE posts',apPosted.ok&&apPosted.ap.bills[0].status==='APPROVED');
const apPostedReplay=applyPostedDocumentTransition({ap:apPosted.ap,ar:apPosted.ar,je:{...apDraft.draftJE,posting_status:'POSTED',posted_by:'poster'}});
expectJE('AP posted callback replay is idempotent',apPostedReplay.ok&&apPostedReplay.idempotent&&apPostedReplay.ap.bills[0].status==='APPROVED');
expectJE('Rejected/Draft JE cannot advance the AP source',applyPostedDocumentTransition({ap:{bills:[apDraft.nextDocument]},ar:{invoices:[]},je:{...apDraft.draftJE,posting_status:'DRAFT'}}).code==='SOURCE_LINK_MISSING');
const apPay=payBillCommand({bill:{...apPosted.ap.bills[0],bank_member:'Operating Cash_BA-003'},user:{user_id:'treasury'},can:()=>true,period:{period_code:'2026-07',status:'OPEN'},paymentId:'PAY-77-A',paymentDate:'2026-07-31',paymentPeriodCode:'2026-07',jeId:7702,jeNumber:'JE-7702'});
expectJE('AP payment uses occurrence id and remains Draft/PAYMENT_PENDING',apPay.ok&&apPay.draftJE.source_doc_id==='AP-PAYMENT:PAY-77-A'&&apPay.draftJE.posting_status==='DRAFT'&&apPay.nextDocument.status==='PAYMENT_PENDING');
const apPaid=applyPostedDocumentTransition({ap:{bills:[apPay.nextDocument]},ar:{invoices:[]},je:{...apPay.draftJE,posting_status:'POSTED',posted_by:'poster'}});
expectJE('AP payment source becomes Paid only after exact linked JE posts',apPaid.ok&&apPaid.ap.bills[0].status==='PAID'&&apPaid.ap.bills[0].pay_je_number==='JE-7702');
expectJE('AP callback blocks wrong JE and forged trace',applyPostedDocumentTransition({ap:{bills:[apPay.nextDocument]},ar:{invoices:[]},je:{...apPay.draftJE,je_id:999,posting_status:'POSTED'}}).code==='SOURCE_JE_LINK_MISMATCH'&&applyPostedDocumentTransition({ap:{bills:[apPay.nextDocument]},ar:{invoices:[]},je:{...apPay.draftJE,source_doc_id:'FORGED',posting_status:'POSTED'}}).code==='SOURCE_TRACE_MISMATCH');
expectJE('business-linked JE requires source reversal workflow',validateDocumentReversal({...apPay.draftJE,posting_status:'POSTED'}).code==='JE_BUSINESS_REVERSAL_REQUIRED');
expectJE('AP accounting date cannot borrow another period',approveBillCommand({bill:{...apBill,bill_date:'2026-06-30'},user:{user_id:'approver'},can:()=>true,period:{period_code:'2026-07',status:'OPEN'},jeId:7799,jeNumber:'JE-7799'}).code==='PERIOD_DATE_MISMATCH');
const juneBill={...apPosted.ap.bills[0],bill_id:78,bill_no:'BILL-78',period_code:'2026-06',accounting_date:'2026-06-20',bill_date:'2026-06-20',status:'APPROVED',bank_member:'Operating Cash_BA-003'};
const julyPay=payBillCommand({bill:juneBill,user:{user_id:'treasury'},can:()=>true,period:{period_code:'2026-07',status:'OPEN'},paymentId:'PAY-78-A',paymentDate:'2026-07-31',paymentPeriodCode:'2026-07',jeId:7802,jeNumber:'JE-7802'});
expectJE('cross-period AP payment uses its own open occurrence period',julyPay.ok&&julyPay.draftJE.period_code==='2026-07'&&julyPay.draftJE.je_date==='2026-07-31'&&documentJENumber('2026-08-05',7802)==='20260805007802');
expectJE('document JE number rejects invalid dates and ids',documentJENumber('2026-13-99',7802)===null&&documentJENumber('2026-08-05',0)===null&&documentJENumber('',7802)===null);
expectJE('AP payment missing occurrence date fails closed',payBillCommand({bill:juneBill,user:{user_id:'treasury'},can:()=>true,period:{period_code:'2026-07',status:'OPEN'},paymentId:'PAY-78-MISSING',jeId:7803,jeNumber:'JE-7803'}).code==='PERIOD_DATE_MISMATCH');
const arInvoice={inv_id:88,inv_no:'INV-88',entity_id:4,period_code:'2026-07',inv_date:'2026-07-31',amount:500,customer_id:1,customer_name:'Customer A',status:'DRAFT',created_by:'ar-maker'};
const arDraft=createInvoiceCommand({invoice:arInvoice,user:{user_id:'ar-maker'},can:()=>true,period:{period_code:'2026-07',status:'OPEN'},jeId:8801,jeNumber:'JE-8801'});
expectJE('AR invoice creates Draft and remains pending post',arDraft.ok&&arDraft.draftJE.posting_status==='DRAFT'&&arDraft.nextDocument.status==='OPEN_PENDING_POST');
const arPosted=applyPostedDocumentTransition({ap:{bills:[]},ar:{invoices:[arDraft.nextDocument]},je:{...arDraft.draftJE,posting_status:'POSTED',posted_by:'poster'}});
const arReceipt=receivePaymentCommand({invoice:{...arPosted.ar.invoices[0],bank_member:'Operating Cash_BA-003'},user:{user_id:'ar-user'},can:()=>true,period:{period_code:'2026-07',status:'OPEN'},paymentId:'RCPT-88-A',paymentDate:'2026-07-31',paymentPeriodCode:'2026-07',jeId:8802,jeNumber:'JE-8802'});
expectJE('AR source opens only after post and receipt remains Draft',arPosted.ok&&arPosted.ar.invoices[0].status==='OPEN'&&arReceipt.ok&&arReceipt.draftJE.posting_status==='DRAFT'&&arReceipt.nextDocument.status==='PAYMENT_PENDING');
const arPaid=applyPostedDocumentTransition({ap:{bills:[]},ar:{invoices:[arReceipt.nextDocument]},je:{...arReceipt.draftJE,posting_status:'POSTED',posted_by:'poster'}});
expectJE('AR receipt source becomes Paid only after exact linked JE posts',arPaid.ok&&arPaid.ar.invoices[0].status==='PAID'&&arPaid.ar.invoices[0].pay_je_number==='JE-8802');
const arInvoice2={...arPosted.ar.invoices[0],inv_id:89,inv_no:'INV-89',status:'OPEN',bank_member:'Operating Cash_BA-003'};
const arReceipt2=receivePaymentCommand({invoice:arInvoice2,user:{user_id:'ar-user'},can:()=>true,period:{period_code:'2026-07',status:'OPEN'},paymentId:'RCPT-89-A',paymentDate:'2026-07-31',paymentPeriodCode:'2026-07',jeId:8902,jeNumber:'JE-8902'});
const sourceBatch=applyPostedDocumentBatch({ap:{bills:[apPay.nextDocument,julyPay.nextDocument]},ar:{invoices:[arReceipt.nextDocument,arReceipt2.nextDocument]},jes:[{...apPay.draftJE,posting_status:'POSTED'},{...julyPay.draftJE,posting_status:'POSTED'},{...arReceipt.draftJE,posting_status:'POSTED'},{...arReceipt2.draftJE,posting_status:'POSTED'}]});
expectJE('concurrent AP/AR post callbacks accumulate without stale overwrite',sourceBatch.ok&&sourceBatch.ap.bills.every(x=>x.status==='PAID')&&sourceBatch.ar.invoices.every(x=>x.status==='PAID'));
expectJE('AP aging starts after liability post and remains through payment Draft',apAgingDocuments([{status:'PENDING_APPROVAL'},{status:'APPROVED_PENDING_POST'},{status:'APPROVED'},{status:'PAYMENT_PENDING'},{status:'PAID'}]).map(x=>x.status).join(',')==='APPROVED,PAYMENT_PENDING');
expectJE('AR aging retains receipt Draft until cash JE posts',arAgingDocuments([{status:'DRAFT'},{status:'OPEN_PENDING_POST'},{status:'OPEN'},{status:'PAYMENT_PENDING'},{status:'PAID'}]).map(x=>x.status).join(',')==='OPEN,PAYMENT_PENDING');
const maker={user_id:'maker'},reviewer={user_id:'reviewer'},approver={user_id:'approver'},poster={user_id:'poster'};
const canAll=()=>true;
const docs=[{document_id:'DOC-1',hash:'sha256:'+'a'.repeat(64),storage_ref:'indexeddb://refs-attachments/DOC-1',storage_state:'STORED'}];
const manualDraft={je_id:7001,je_number:'JE-7001',entity_id:4,period_code:'2026-07',je_date:'2026-07-31',je_type:'MANUAL',source_system:'MAN',posting_status:'DRAFT',created_by:'maker',has_attachment:true,attachment_ids:['DOC-1'],description:'Monthly accrual',revision:0,history:[{a:'CREATE',by:'maker',at:'2026-07-31'}],lines:[{account_code:'651000',debit_amount:100,credit_amount:0},{account_code:'111000',debit_amount:0,credit_amount:100,member:'Operating Cash_BA-003'}]};
expectJE('JE illegal Draft to Posted jump is blocked',validateJETransition({je:manualDraft,next:'POSTED',user:maker,period:{status:'OPEN'},documents:docs,can:canAll}).code==='JE_ILLEGAL_TRANSITION');
expectJE('JE manual attachment gate blocks submission',validateJETransition({je:{...manualDraft,has_attachment:false,attachment_ids:[]},next:'PENDING_REVIEW',user:maker,period:{status:'OPEN'},documents:docs,can:canAll}).code==='4010');
expectJE('JE unresolved attachment reference is blocked',validateAttachmentReferences({...manualDraft,attachment_ids:['MISSING']},docs).code==='JE_ATTACHMENT_REFERENCE');
const submitted=transitionJE({je:manualDraft,next:'PENDING_REVIEW',user:maker,period:{status:'OPEN'},documents:docs,can:canAll});
const reviewed=transitionJE({je:submitted.je,next:'PENDING_APPROVAL',user:reviewer,period:{status:'OPEN'},documents:docs,can:canAll});
expectJE('JE Draft to Review to Approval queue is sequential',submitted.ok&&reviewed.ok&&reviewed.je.reviewer==='reviewer');
expectJE('JE maker cannot approve own entry',transitionJE({je:reviewed.je,next:'APPROVED',user:maker,period:{status:'OPEN'},documents:docs,can:canAll}).code==='JE_SOD_MAKER');
const approved=transitionJE({je:reviewed.je,next:'APPROVED',user:approver,period:{status:'OPEN'},documents:docs,can:canAll});
expectJE('JE approver recorded at action boundary',approved.ok&&approved.je.approver==='approver');
expectJE('JE maker cannot post own entry',transitionJE({je:approved.je,next:'POSTED',user:maker,period:{status:'OPEN'},documents:docs,can:canAll}).code==='JE_SOD_MAKER');
expectJE('JE approver cannot also post entry',transitionJE({je:approved.je,next:'POSTED',user:approver,period:{status:'OPEN'},documents:docs,can:canAll}).code==='JE_SOD_APPROVER_POSTER');
const posted=transitionJE({je:approved.je,next:'POSTED',user:poster,period:{status:'OPEN'},documents:docs,can:canAll,at:'2026-07-31T00:00:00.000Z'});
expectJE('JE separate poster completes Posted state',posted.ok&&posted.je.posted_by==='poster'&&posted.je.posted_at==='2026-07-31T00:00:00.000Z');
expectJE('JE Posted cannot Cancel Post or move backward',validateJETransition({je:posted.je,next:'APPROVED',user:poster,period:{status:'OPEN'},documents:docs,can:canAll}).code==='JE_IMMUTABLE');
expectJE('JE closed period blocks workflow',validateJETransition({je:manualDraft,next:'PENDING_REVIEW',user:maker,period:{period_code:'2026-07',status:'CLOSED'},documents:docs,can:canAll}).code==='4005');
const saved=saveJEDraft({current:manualDraft,draft:{...manualDraft,description:'Edited accrual'},user:maker});
expectJE('JE Save persists revision, content and audit history',saved.ok&&saved.je.revision===1&&saved.je.description==='Edited accrual'&&saved.je.history.at(-1).a==='SAVE');
const copied=copyJEAsDraft({source:posted.je,newId:7002,newNumber:'JE-7002',user:maker});
expectJE('JE Copy creates distinct manual Draft without copied attachment/source trace',copied.ok&&copied.je.je_id===7002&&copied.je.je_type==='MANUAL'&&copied.je.has_attachment===false&&copied.je.source_doc_id==null);
const recurringTemplate=createRecurringTemplate({source:manualDraft,templateId:'REC-1',user:maker});
expectJE('JE recurring creates persistent business template payload',recurringTemplate.ok&&recurringTemplate.template.source_je_id===7001&&recurringTemplate.template.payload.lines.length===2);
const reclass=createReclassDraft({source:posted.je,newId:7003,newNumber:'JE-7003',user:maker});
expectJE('JE Reclass creates linked Draft and never mutates Posted source',reclass.ok&&reclass.je.posting_status==='DRAFT'&&reclass.je.reclass_of===posted.je.je_id&&posted.je.posting_status==='POSTED');
const reversal=createReversal({source:posted.je,newId:7004,user:poster,period:{status:'OPEN'},can:canAll});
expectJE('JE Reverse creates a balanced traced Draft without changing the Posted source',reversal.ok&&reversal.source.posting_status==='POSTED'&&reversal.reversal.posting_status==='DRAFT'&&reversal.reversal.reversal_of===posted.je.je_id&&reversal.reversal.source_doc_id&&reversal.reversal.rule_code&&reversal.reversal.lines[0].credit_amount===100);
expectJE('JE Reverse is blocked in a closed period',createReversal({source:posted.je,newId:7005,user:poster,period:{period_code:'2026-07',status:'CLOSED'},can:canAll}).code==='4005');
expectJE('JE reject requires a reason',rejectJETransition({je:submitted.je,user:reviewer,reason:'',can:canAll}).code==='JE_REJECTION_REASON');
expectJE('JE reject returns review item to Draft with reason history',rejectJETransition({je:submitted.je,user:reviewer,reason:'Fix account coding',can:canAll}).je?.history.at(-1).reason==='Fix account coding');
const canReviewOnly=perm=>perm==='GL.JE.REVIEW';
expectJE('JE review permission cannot reject approval-stage work',rejectJETransition({je:reviewed.je,user:reviewer,reason:'Needs changes',can:canReviewOnly}).code==='JE_PERMISSION_DENIED');
const autoNoTrace={...manualDraft,je_type:'AUTO',source_system:'BANK',source_doc_id:null,rule_code:null};
expectJE('JE automatic source trace is mandatory',validateJETransition({je:autoNoTrace,next:'PENDING_REVIEW',user:maker,period:{status:'OPEN'},documents:docs,can:canAll}).code==='JE_AUTO_TRACE_MISSING');
const tracedAuto={...manualDraft,je_type:'AUTO',source_system:'BANK',source_doc_id:'BANK-7001',source_object_type:'AP_BILL',source_object_id:77,rule_code:'R-BANK-01',setting_used:'SET-BANK',mapping_used:'MAP-BANK'};
const protectedAuto=saveJEDraft({current:tracedAuto,draft:{...tracedAuto,source_doc_id:'TAMPERED',source_object_type:'AR_INVOICE',source_object_id:88,rule_code:'TAMPERED',setting_used:null,mapping_used:null},user:maker});
expectJE('JE automatic source, object link, setting, mapping and rule trace are immutable on Save',protectedAuto.ok&&protectedAuto.je.source_doc_id==='BANK-7001'&&protectedAuto.je.source_object_type==='AP_BILL'&&protectedAuto.je.source_object_id===77&&protectedAuto.je.rule_code==='R-BANK-01'&&protectedAuto.je.setting_used==='SET-BANK'&&protectedAuto.je.mapping_used==='MAP-BANK');
const overriddenAuto=saveJEDraft({current:tracedAuto,draft:{...tracedAuto,lines:[{...tracedAuto.lines[0],debit_amount:110},{...tracedAuto.lines[1],credit_amount:110}],override_reason:'Controller corrected amount'},user:reviewer});
expectJE('JE automatic line edits preserve structured human override diff',overriddenAuto.ok&&overriddenAuto.je.human_overrides.length===1&&overriddenAuto.je.history.at(-1).a==='SAVE WITH HUMAN OVERRIDE'&&overriddenAuto.je.human_overrides[0].before[0].debit_amount===100&&overriddenAuto.je.human_overrides[0].after[0].debit_amount===110);
expectJE('JE read-only actor is blocked at command boundary',authorizeJECommand({can:()=>false}).code==='JE_PERMISSION_DENIED');
expectJE('JE period resolver uses JE entity and period, not selected entity',resolveJEPeriod([{entity_id:2,period_code:'2026-07',status:'OPEN'},{entity_id:4,period_code:'2026-07',status:'CLOSED'}],manualDraft).period?.status==='CLOSED');
expectJE('JE missing owned period fails closed',resolveJEPeriod([],manualDraft).code==='JE_PERIOD_NOT_CONFIGURED');
const batchSpec={entity_id:4,period_code:'2026-07',je_type:'AUTO',source_system:'INTERNAL',source_doc_id:'BATCH:4:2026-07:1',rule_code:'R-BATCH-1',setting_used:'SET@1',mapping_used:'MAP@1'};
expectJE('JE automatic creation spec requires complete trace',validateNewJESpec({spec:{...batchSpec,mapping_used:null},can:canAll}).code==='JE_AUTO_TRACE_MISSING');
expectJE('JE automatic creation spec rejects duplicate source',validateNewJESpec({spec:batchSpec,existingJEs:[{...batchSpec,posting_status:'DRAFT'}],can:canAll}).code==='JE_DUPLICATE_SOURCE');
const reverseBatchSpec={...batchSpec,period_code:'2026-08',source_doc_id:'BATCH:4:2026-08:REV',idempotency_key:'BATCH:4:2026-08:REV'};
expectJE('JE batch validates primary and reversal periods atomically',validateNewJEBatch({specs:[batchSpec,reverseBatchSpec],periods:[{entity_id:4,period_code:'2026-07',status:'OPEN'},{entity_id:4,period_code:'2026-08',status:'OPEN'}],can:canAll}).ok);
expectJE('JE batch creates nothing when any owned period is missing',validateNewJEBatch({specs:[batchSpec,reverseBatchSpec],periods:[{entity_id:4,period_code:'2026-07',status:'OPEN'}],can:canAll}).code==='JE_PERIOD_NOT_CONFIGURED');
const reservations=new Set();const reservedFirst=reserveJESources(reservations,[batchSpec,reverseBatchSpec]);const overlapSpec={...batchSpec,source_doc_id:reverseBatchSpec.source_doc_id};
expectJE('JE overlapping batches reserve every source atomically',reservedFirst.ok&&reserveJESources(reservations,[overlapSpec]).code==='JE_DUPLICATE_ACTION');
const sharedReservations=new Set();expectJE('JE single and batch creation share one source reservation namespace',reserveJESources(sharedReservations,[batchSpec]).ok&&reserveJESources(sharedReservations,[batchSpec,reverseBatchSpec]).code==='JE_DUPLICATE_ACTION');
const storedDoc={...docs[0],size:4,type:'application/pdf'};const storedJE={...manualDraft,attachment_ids:['DOC-1']};
Promise.all([
  verifyAttachmentContent({je:storedJE,documents:[storedDoc],loadBlob:async()=>null,hashBlob:async blob=>blob.hash}),
  verifyAttachmentContent({je:storedJE,documents:[storedDoc],loadBlob:async()=>({size:4,type:'application/pdf',hash:'sha256:'+'b'.repeat(64)}),hashBlob:async blob=>blob.hash}),
  verifyAttachmentContent({je:storedJE,documents:[{...storedDoc,hash:'sha256:'+'c'.repeat(64)}],loadBlob:async()=>({size:4,type:'application/pdf',hash:'sha256:'+'d'.repeat(64)}),hashBlob:async blob=>blob.hash}),
  verifyAttachmentContent({je:storedJE,documents:[storedDoc],loadBlob:async()=>{throw new Error('IndexedDB unavailable');}}),
  verifyAttachmentContent({je:storedJE,documents:[storedDoc],loadBlob:async()=>({size:4,type:'application/pdf'}),hashBlob:async()=>{throw new Error('WebCrypto unavailable');}}),
]).then(([missingBlob,tamperedBlob,forgedMetadata,storageFailure,cryptoFailure])=>{
  expectJE('JE deleted attachment Blob blocks workflow',missingBlob.code==='JE_ATTACHMENT_BLOB');
  expectJE('JE tampered attachment Blob blocks workflow',tamperedBlob.code==='JE_ATTACHMENT_HASH');
  expectJE('JE forged attachment metadata cannot replace content verification',forgedMetadata.code==='JE_ATTACHMENT_HASH');
  expectJE('JE attachment storage rejection returns a controlled workflow failure',storageFailure.code==='JE_ATTACHMENT_STORAGE');
  expectJE('JE attachment crypto rejection returns a controlled workflow failure',cryptoFailure.code==='JE_ATTACHMENT_STORAGE');
  console.log(`mtest components=${components.length} failed=${failed}`);if(failed)process.exitCode=1;
});
