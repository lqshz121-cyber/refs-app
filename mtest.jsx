import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { JOURNAL_ENTRIES, EXCEPTIONS, CLOSE_TASKS, FY2026 } from './src/seed.js';
import { COA } from './src/data.js';
import { loanRule, pmRule, ENGINE_RULE_CATALOG } from './src/engine.js';
import { Dashboard, JEWorkspace, LoanWorkspace, PMPickup, ClosingWorkspace, ExceptionCenter, CloseMgmt } from './src/modules-core.jsx';
import { GLTrialBalance, Reports, CashModule, LoanRegister, ProjectCost, Assets, Intercompany, IntegrationHub, MasterData, MappingCenter, RuleCenter, AdminModule } from './src/modules-more.jsx';
import { APWorkspace } from './src/module-ap.jsx';
import { ARWorkspace } from './src/module-ar.jsx';
import { BankTransactions } from './src/module-banktx.jsx';
import { bankSuggestion, splitDifference, buildBankDraft, buildBankWorkflowException, validateBankDraft, findBankMatchCandidates, validateBankMatch, createBankDraftTransition, excludeBankTransition, matchBankTransition, batchBankTransition, undoBankTransition } from './src/bank-workflow.js';
import { COAWorkspace } from './src/module-coa.jsx';
import { AccountRegister } from './src/module-register.jsx';
import { SubsidiaryLedger } from './src/module-subledger.jsx';
import { UnitCostLedger } from './src/module-unitcost.jsx';
import { SourceDocs } from './src/module-sourcedocs.jsx';
import { CompanySetting } from './src/module-setting.jsx';

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
console.log(`mtest components=${components.length} failed=${failed}`);
if(failed) process.exitCode=1;
