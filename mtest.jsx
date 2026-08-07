import React from 'react';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { JOURNAL_ENTRIES, EXCEPTIONS, CLOSE_TASKS, FY2026 } from './src/seed.js';
import { COA, PERIODS, PERIOD_EVENTS, ENTITIES } from './src/data.js';
import { loanRule, money, pmRule, statements, sum, trialBalance, validateJE, ENGINE_RULE_CATALOG } from './src/engine.js';
import { localIncomeStatementSection } from './src/income-statement-classification.js';
import { periodControlExceptions, resolvePostingPeriod, PERIOD_STATUS_NOT_CONFIGURED } from './src/period-control.js';
import { Dashboard, JEEditor, JEWorkspace, LoanWorkspace, PMPickup, ClosingWorkspace, ExceptionCenter, CloseMgmt } from './src/modules-core.jsx';
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
import { PeriodManagement } from './src/module-periods.jsx';
import { PERIOD_EVENT_CLOSED, PERIOD_EVENT_OPENED, PERIOD_EVENT_REOPENED, PERIOD_PERMISSION_DENIED, PERIOD_REASON_REQUIRED, PERIOD_UNRESOLVED_WORK, PERM_PERIOD_CLOSE, PERM_PERIOD_OPEN, PERM_PERIOD_REOPEN, closePeriodCommand, openPeriodCommand, reopenPeriodCommand } from './src/period-lifecycle.js';
import { App, AuthoritativeApp, authoritativeRuntimeConfigured, AuthoritativeAdjustmentSummary, AuthoritativeCreditApplicationForm, AuthoritativeDocumentTable, AuthoritativeDraftForm, AuthoritativeRefundForm, AuthoritativeWorkflowAdjustmentTable, AuthoritativeWorkflowTable, validateAuthoritativeDocumentDraft } from './src/app.jsx';
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
  period:{period_code:'2026-07',status:'OPEN'}, periods:PERIODS, periodEvents:PERIOD_EVENTS, currentPeriod:'2026-07',
  can:()=>true, actions, toast:noop, goto:noop,
};
const components=[Dashboard,JEWorkspace,LoanWorkspace,PMPickup,ClosingWorkspace,ExceptionCenter,CloseMgmt,
  GLTrialBalance,Reports,CompanySetting,LoanRegister,ProjectCost,Assets,Intercompany,IntegrationHub,MasterData,
  MappingCenter,RuleCenter,AdminModule,APWorkspace,ARWorkspace,BankTransactions,COAWorkspace,AccountRegister,
  SubsidiaryLedger,UnitCostLedger,SourceDocs,PeriodManagement];

let failed=0;
for (const Component of components) {
  try { renderToStaticMarkup(<Component ctx={ctx}/>); console.log('PASS',Component.name); }
  catch (error) { failed++; console.error('FAIL',Component.name,error.message); }
}
// ---------------------------------------------------------------------------
// GL report tabs, rendered against a REAL entity that has posted activity.
//
// The component loop above renders GLTrialBalance with entity:0, which makes
// hasReportEntity false and short-circuits every statement body. That is how
// `ReferenceError: opex is not defined` (src/modules-more.jsx) survived a green
// SSR gate. These cases select the tab through navContext and use entities that
// actually carry POSTED journals, so each statement body is executed and its
// totals are checked against an independent computation from the same seed.
// ---------------------------------------------------------------------------
const REPORT_TABS=['Trial Balance','Balance Sheet','Income Statement','GL Detail','Cash Flow'];
const reportCtxFor=(entityId,reportTab)=>({...ctx,entity:entityId,navContext:{route:'gl',tab:reportTab,entityId}});
const renderReportTab=(entityId,reportTab)=>renderToStaticMarkup(<GLTrialBalance ctx={reportCtxFor(entityId,reportTab)}/>);
// Entity 4: revenue, COGS and non-COGS operating expense - the full Income
// Statement body. Entity 114: revenue and COGS only, so the operating-expense
// row set is empty. Entity 2: posted balance-sheet activity but no P&L at all.
for (const entityId of [4,114,2]) {
  for (const reportTab of REPORT_TABS) {
    try { const markup=renderReportTab(entityId,reportTab);
      if(!markup.length) throw new Error('empty markup');
      console.log('PASS GL report tab',JSON.stringify(reportTab),'renders for entity',entityId); }
    catch (error) { failed++; console.error('FAIL GL report tab',JSON.stringify(reportTab),'for entity',entityId,'->',error.message); }
  }
}
const incomeStatementMarkup=renderReportTab(4,'Income Statement');
const postedFor=entityId=>[...JOURNAL_ENTRIES,...FY2026].filter(j=>j.posting_status==='POSTED'&&j.entity_id===entityId&&j.period_code>='2026-01'&&j.period_code<='2026-07');
const expectedIncome=(entityId)=>{ const rows=trialBalance(postedFor(entityId)).rows;
  const rev=rows.filter(r=>r.type==='REVENUE'), exp=rows.filter(r=>r.type==='EXPENSE');
  const cogs=exp.filter(r=>localIncomeStatementSection(r)==='Cost of goods sold');
  const opex=exp.filter(r=>!cogs.includes(r));
  const revT=sum(rev,r=>-r.balance), cogsT=sum(cogs,r=>r.balance), opexT=sum(opex,r=>r.balance);
  return {revT,cogsT,opexT,net:revT-cogsT-opexT,opexRows:opex.length,cogsRows:cogs.length}; };
const income4=expectedIncome(4);
const expectIS=(name,ok)=>{console.log(ok?'PASS':'FAIL',name);if(!ok)failed++;};
expectIS('Income Statement renders a total operating expense line for a real posting entity',
  income4.cogsRows>0&&income4.opexRows>0&&incomeStatementMarkup.includes('Total Operating Expenses'));
expectIS('Income Statement total income, gross profit, operating expense and net income all tie to the same POSTED rows',
  [money(income4.revT),money(income4.revT-income4.cogsT),money(income4.opexT),money(income4.net)].every(value=>incomeStatementMarkup.includes(value)));
const income114=expectedIncome(114);
expectIS('Income Statement renders when the only expense in scope is cost of goods sold',
  income114.cogsRows>0&&income114.opexRows===0&&renderReportTab(114,'Income Statement').includes(money(income114.net)));
// The "no P&L activity" entity is resolved from the seed, never named by a
// literal. Entity 2 used to be that fixture; it stopped being one when the
// service hub started booking its own side of every intercompany service pair
// (490600 Outsourcing Service Income). The property under test is unchanged -
// an entity with posted balance-sheet activity and no revenue or expense row
// must state an empty scope, not present a statement of zeroes.
const postedEntityIds=[...new Set([...JOURNAL_ENTRIES,...FY2026].filter(j=>j.posting_status==='POSTED').map(j=>j.entity_id))].sort((a,b)=>a-b);
const noProfitAndLossEntity=postedEntityIds.find(entityId=>{ const rows=trialBalance(postedFor(entityId)).rows;
  return rows.length>0 && !rows.some(row=>row.type==='REVENUE'||row.type==='EXPENSE'); });
const noProfitAndLossMarkup=noProfitAndLossEntity==null?'':renderReportTab(noProfitAndLossEntity,'Income Statement');
expectIS('Income Statement states an empty scope instead of a zero statement when an entity has no P&L activity',
  noProfitAndLossEntity!=null&&expectedIncome(noProfitAndLossEntity).revT===0&&expectedIncome(noProfitAndLossEntity).cogsRows===0&&expectedIncome(noProfitAndLossEntity).opexRows===0&&
  noProfitAndLossMarkup.includes('No revenue or expense activity in this Income Statement scope')&&
  !noProfitAndLossMarkup.includes('Total Income')&&!noProfitAndLossMarkup.includes('Net Income'));
// An entity that earns revenue and carries no expense at all takes the third
// Income Statement branch: no Cost of Goods Sold section, so the total line is
// Total Expenses rather than Total Operating Expenses.
const revenueOnlyEntity=postedEntityIds.find(entityId=>{ const income=expectedIncome(entityId);
  return income.revT>0 && income.cogsRows===0 && income.opexRows===0; });
const revenueOnlyIncome=revenueOnlyEntity==null?null:expectedIncome(revenueOnlyEntity);
const revenueOnlyMarkup=revenueOnlyEntity==null?'':renderReportTab(revenueOnlyEntity,'Income Statement');
expectIS('Income Statement labels the total Total Expenses and ties net income when the scope carries revenue and no cost of goods sold',
  revenueOnlyEntity!=null&&revenueOnlyMarkup.includes('Total Expenses')&&!revenueOnlyMarkup.includes('Total Operating Expenses')&&
  [money(revenueOnlyIncome.revT),money(revenueOnlyIncome.net)].every(value=>revenueOnlyMarkup.includes(value)));
// The Trial Balance tab is cumulative - "As of {toP}", built from
// postedJournalEntriesAsOf - while the Income Statement is the 2026-01~2026-07
// movement window. The two sets were identical until the seed grew a 2025-12
// opening trial balance, which is why a movement-window total used to match a
// cumulative statement. The expected figure is recomputed here straight off the
// seed in integer cents, without trialBalance() and without the component's own
// as-of helper, and the cumulative total is asserted to be strictly larger than
// the movement window so that dropping the opening balances fails this case.
const trialBalanceMarkup=renderReportTab(4,'Trial Balance');
const asOfPostedFor=entityId=>[...JOURNAL_ENTRIES,...FY2026].filter(j=>j.posting_status==='POSTED'&&j.entity_id===entityId&&j.period_code<='2026-07');
const grossCents=journals=>journals.reduce((totals,j)=>(j.lines||[]).reduce((carry,l)=>({debit:carry.debit+Math.round((l.debit_amount||0)*100),credit:carry.credit+Math.round((l.credit_amount||0)*100)}),totals),{debit:0,credit:0});
const trialBalance4AsOf=grossCents(asOfPostedFor(4)), trialBalance4Window=grossCents(postedFor(4));
expectIS('Trial Balance renders balanced cumulative totals, opening balances included, for a real posting entity',
  trialBalance4AsOf.debit===trialBalance4AsOf.credit&&trialBalance4AsOf.debit>trialBalance4Window.debit&&
  trialBalanceMarkup.includes(money(trialBalance4AsOf.debit/100))&&trialBalanceMarkup.includes('Balanced'));
// The Balance Sheet is cumulative for the same reason the Trial Balance is, and
// the assertion names the Total Assets line rather than looking the figure up
// anywhere on the page: the movement-window total used to satisfy a bare
// includes() because the General Ledger overview strip was printing it.
const balanceSheetMarkup=renderReportTab(4,'Balance Sheet');
const bs4AsOf=statements(asOfPostedFor(4));
const bs4Window=statements(postedFor(4));
expectIS('Balance Sheet renders cumulative total assets and ties assets to liabilities plus equity plus earnings',
  bs4AsOf.assets!==bs4Window.assets&&
  balanceSheetMarkup.includes(`Total Assets`)&&balanceSheetMarkup.includes(money(bs4AsOf.assets))&&
  !new RegExp(`Total Assets[^]{0,400}?${money(bs4Window.assets).replace(/[$,.]/g,'\\$&')}`).test(balanceSheetMarkup)&&
  Math.abs(bs4AsOf.assets-(bs4AsOf.liabilities+bs4AsOf.equity+bs4AsOf.netIncome))<0.01&&balanceSheetMarkup.includes('Balanced'));
// One screen, one meaning for the word Assets. The General Ledger overview strip
// sits directly above the statement body; before the opening balance sheet
// existed it happened to agree with it, because there was nothing to be
// cumulative about. It must agree by construction, not by coincidence.
expectIS('the General Ledger overview strip states assets on the same cumulative basis as the Balance Sheet',
  balanceSheetMarkup.includes(`<i>Assets as of 2026-07</i><b>${money(bs4AsOf.assets)}</b>`)&&
  trialBalanceMarkup.includes(`<i>Assets as of 2026-07</i><b>${money(bs4AsOf.assets)}</b>`)&&
  !balanceSheetMarkup.includes(`<i>Assets</i><b>${money(bs4Window.assets)}</b>`));
expectIS('Cash Flow renders posted cash evidence for a real posting entity',
  renderReportTab(4,'Cash Flow').includes('Cash movement evidence'));
const glDetailMarkup4=renderReportTab(4,'GL Detail');
expectIS('GL Detail renders posted journal lines for a real posting entity',
  postedFor(4).length>0&&postedFor(4).some(j=>glDetailMarkup4.includes(j.je_number)));

// ---------------------------------------------------------------------------
// Period control fails closed.
// ---------------------------------------------------------------------------
const expectPeriod=(name,ok)=>{console.log(ok?'PASS':'FAIL',name);if(!ok)failed++;};
const periodMaster=[{entity_id:2,period_code:'2026-06',status:'CLOSED'},{entity_id:2,period_code:'2026-07',status:'OPEN'},{entity_id:4,period_code:'2026-07',status:'OPEN'}];
const openTarget={entity_id:4,period_code:'2026-07'};
const unseededTarget={entity_id:77,period_code:'2026-07'};
const closedTarget={entity_id:2,period_code:'2026-06'};
expectPeriod('period control permits a genuinely open entity period',resolvePostingPeriod(periodMaster,openTarget).ok===true&&resolvePostingPeriod(periodMaster,openTarget).period.status==='OPEN');
const unseeded=resolvePostingPeriod(periodMaster,unseededTarget);
expectPeriod('period control refuses an entity period with no record instead of synthesising OPEN',
  unseeded.ok===false&&unseeded.code==='JE_PERIOD_NOT_CONFIGURED'&&unseeded.period.status===PERIOD_STATUS_NOT_CONFIGURED&&/no period control record/.test(unseeded.message));
expectPeriod('period control refuses a closed period and names the reason',
  resolvePostingPeriod(periodMaster,closedTarget).code==='4005'&&/CLOSED/.test(resolvePostingPeriod(periodMaster,closedTarget).message));
expectPeriod('period control refuses an entry that names no valid entity or period',
  resolvePostingPeriod(periodMaster,{entity_id:null,period_code:'2026-07'}).code==='JE_PERIOD_UNIDENTIFIED'&&resolvePostingPeriod(periodMaster,{entity_id:4,period_code:'2027-13'}).code==='JE_PERIOD_UNIDENTIFIED');
const balancedLines=[{account_code:'651000',debit_amount:100,credit_amount:0},{account_code:'111000',debit_amount:0,credit_amount:100,member:'Operating Cash_BA-003'}];
const periodProbe={je_id:9101,je_number:'JE-9101',entity_id:77,period_code:'2026-07',je_type:'AUTO',source_system:'MAN',posting_status:'DRAFT',lines:balancedLines};
expectPeriod('validateJE blocks a journal whose owning period has no record',
  validateJE(periodProbe,resolvePostingPeriod(periodMaster,periodProbe).period).some(e=>e.code==='JE_PERIOD_NOT_CONFIGURED'));
expectPeriod('validateJE blocks when no period object is supplied at all',
  validateJE(periodProbe).some(e=>e.code==='JE_PERIOD_NOT_CONFIGURED'));
expectPeriod('validateJE raises no period error for a genuinely open period',
  validateJE({...periodProbe,entity_id:4},resolvePostingPeriod(periodMaster,{entity_id:4,period_code:'2026-07'}).period).every(e=>!['4005','JE_PERIOD_NOT_CONFIGURED'].includes(e.code)));
expectPeriod('JE workflow transition is blocked when the owning period has no record',
  validateJETransition({je:{...periodProbe,je_type:'MANUAL',created_by:'maker',attachment_ids:['DOC-1'],has_attachment:true},next:'PENDING_REVIEW',user:{user_id:'maker'},period:resolvePostingPeriod(periodMaster,periodProbe).period,documents:[{document_id:'DOC-1',hash:'sha256:'+'a'.repeat(64),storage_ref:'indexeddb://refs-attachments/DOC-1',storage_state:'STORED'}],can:()=>true}).code==='JE_PERIOD_NOT_CONFIGURED');
// ---------------------------------------------------------------------------
// The seeded population of period-control breaches is recomputed here from the
// seed and the period master on every run. It is deliberately NOT pinned to a
// count or to a journal number: regenerating src/seed.js renumbers every
// generated journal and changes which entity/period pairs carry activity, and a
// control test that has to be edited after each seed change stops being a
// control test. What must hold is the property - every POSTED journal whose own
// entity and own period the master marks anything other than OPEN is detected,
// named individually, attributed to its entity and period, and left untouched.
// ---------------------------------------------------------------------------
const seededPeriodEvidence=periodControlExceptions({journals:[...JOURNAL_ENTRIES,...FY2026],periods:PERIODS});
const seededPostedJournals=[...JOURNAL_ENTRIES,...FY2026].filter(j=>j.posting_status==='POSTED');
const seededPeriodStatus=(entityId,periodCode)=>{ const record=PERIODS.find(p=>Number(p.entity_id)===Number(entityId)&&String(p.period_code)===String(periodCode)); return record?String(record.status):null; };
const seededClosedJournals=seededPostedJournals.filter(j=>{ const status=seededPeriodStatus(j.entity_id,j.period_code); return status!==null&&status!=='OPEN'; });
const reportedClosedPostings=seededPeriodEvidence.closedPeriodPostings;
expectPeriod('every journal already posted into a CLOSED period is detected and named individually',
  seededClosedJournals.length>0&&
  seededPeriodEvidence.totals.closedPeriodJournals===seededClosedJournals.length&&
  reportedClosedPostings.length===seededClosedJournals.length&&
  seededClosedJournals.every(j=>reportedClosedPostings.some(row=>row.je_number===j.je_number&&row.entity_id===Number(j.entity_id)&&row.period_code===j.period_code&&row.period_status==='CLOSED'&&row.exception_type==='POSTED_INTO_CLOSED_PERIOD'))&&
  reportedClosedPostings.every(row=>row.root_cause.includes(row.je_number)&&row.root_cause.includes(row.period_code)));
// Immutability, asserted against the ledger rather than against two remembered
// journal numbers: nothing detected here may have been re-dated out of the
// closed period, so each reported entry is still POSTED, still carries the
// period it breached, and still carries a document date inside that period.
expectPeriod('detected closed-period postings are reported, never rewritten',
  reportedClosedPostings.length>0&&
  reportedClosedPostings.every(row=>row.status==='OPEN'&&/reversing this entry in an open period/.test(row.required_action))&&
  reportedClosedPostings.every(row=>{ const je=seededPostedJournals.find(j=>j.je_number===row.je_number);
    return !!je&&je.posting_status==='POSTED'&&je.period_code===row.period_code&&String(je.je_date||'').slice(0,7)===je.period_code; }));
const seededConfiguredPairs=new Set(PERIODS.map(p=>`${Number(p.entity_id)}|${p.period_code}`));
const seededUnconfiguredPairs=new Set(seededPostedJournals.map(j=>`${Number(j.entity_id)}|${j.period_code}`).filter(key=>!seededConfiguredPairs.has(key)));
const seededUnconfiguredJournalCount=seededPostedJournals.filter(j=>!seededConfiguredPairs.has(`${Number(j.entity_id)}|${j.period_code}`)).length;
expectPeriod('entity/period pairs carrying posted journals with no period record are reported as a control gap',
  seededUnconfiguredPairs.size>0&&
  seededPeriodEvidence.totals.unconfiguredCombinations===seededUnconfiguredPairs.size&&
  seededPeriodEvidence.totals.unconfiguredJournals===seededUnconfiguredJournalCount&&
  seededPeriodEvidence.unconfiguredPeriodPostings.length===seededUnconfiguredPairs.size&&
  seededPeriodEvidence.unconfiguredPeriodPostings.every(row=>seededUnconfiguredPairs.has(`${row.entity_id}|${row.period_code}`)&&row.journal_count>0&&row.period_status===PERIOD_STATUS_NOT_CONFIGURED)&&
  seededPeriodEvidence.state==='PERIOD_CONTROL_EXCEPTIONS_FOUND');
const periodExceptionMarkup=renderToStaticMarkup(<ExceptionCenter ctx={{...ctx,jes:[...JOURNAL_ENTRIES,...FY2026],periods:PERIODS,periodExceptions:seededPeriodEvidence}}/>);
// The exception table paginates, so the count a human reads has to come from
// the totals strip rather than from how many rows happen to fit on page one.
expectPeriod('Exception Center surfaces the closed-period postings to a human',
  periodExceptionMarkup.includes('POSTED_INTO_CLOSED_PERIOD')&&
  periodExceptionMarkup.includes('PERIOD_CONTROL_EXCEPTIONS_FOUND')&&
  periodExceptionMarkup.includes(`<i>Posted into a CLOSED period</i><b>${reportedClosedPostings.length}</b>`)&&
  periodExceptionMarkup.includes(`<i>Entity/period pairs with no period record</i><b>${seededUnconfiguredPairs.size}</b>`)&&
  periodExceptionMarkup.includes(`<i>Posted journals in those pairs</i><b>${seededUnconfiguredJournalCount}</b>`)&&
  periodExceptionMarkup.includes(reportedClosedPostings[0].je_number)&&
  periodExceptionMarkup.includes(reportedClosedPostings[0].object_ref));
expectPeriod('Exception Center reports a clean period control state when there is nothing to report',
  renderToStaticMarkup(<ExceptionCenter ctx={{...ctx,jes:[],periods:PERIODS,periodExceptions:periodControlExceptions({journals:[],periods:PERIODS})}}/>).includes('PERIOD_CONTROL_CLEAN'));
const editorJE={...periodProbe,je_type:'MANUAL',created_by:'maker',has_attachment:true,description:'Period control probe',history:[{a:'CREATE',by:'maker',at:'2026-07-31'}]};
const jeEditorCtx=periods=>({...ctx,jes:[editorJE],periods,resolvePeriodFor:target=>resolvePostingPeriod(periods,target),entity:77});
const blockedEditorMarkup=renderToStaticMarkup(<JEEditor je={editorJE} ctx={jeEditorCtx(periodMaster)}/>);
expectPeriod('Journal Entry editor states the specific period-control reason and blocks the workflow action',
  blockedEditorMarkup.includes('JE_PERIOD_NOT_CONFIGURED')&&blockedEditorMarkup.includes('>BLOCKED<')&&blockedEditorMarkup.includes('NOT_CONFIGURED')&&/<button[^>]*disabled[^>]*>Submit for review<\/button>/.test(blockedEditorMarkup));
const openEditorMarkup=renderToStaticMarkup(<JEEditor je={editorJE} ctx={jeEditorCtx([...periodMaster,{entity_id:77,period_code:'2026-07',status:'OPEN'}])}/>);
expectPeriod('Journal Entry editor permits the workflow action once the period is genuinely open',
  openEditorMarkup.includes('>PERMITTED<')&&!openEditorMarkup.includes('JE_PERIOD_NOT_CONFIGURED')&&/<button(?![^>]*disabled)[^>]*>Submit for review<\/button>/.test(openEditorMarkup));
const editorWithoutResolver=renderToStaticMarkup(<JEEditor je={editorJE} ctx={{...ctx,jes:[editorJE],periods:periodMaster,entity:77}}/>);
expectPeriod('Journal Entry editor resolves period control from the period master even without an injected resolver',
  editorWithoutResolver.includes('JE_PERIOD_NOT_CONFIGURED')&&editorWithoutResolver.includes('>BLOCKED<'));
// The application shell is the place the control previously failed open. Assert
// against the source that the synthesised OPEN period cannot come back.
const appSource=readFileSync('src/app.jsx','utf8');
// The period master is now application state, because the product can open and
// close periods. That makes the "never synthesise OPEN" property MORE important,
// not less: the state has to be seeded from the authored master in src/data.js
// and every posting path has to resolve against that live state, never against
// a fabricated record.
expectPeriod('the application shell never synthesises an OPEN period when no record exists',
  !/\|\|\s*\{\s*period_code\s*:[^}]*status\s*:\s*'OPEN'/.test(appSource)&&
  !/status\s*:\s*'OPEN'\s*,?\s*\}\s*;?\s*\/\/?\s*$/m.test(appSource)&&
  appSource.includes("useState(()=>load('periods',PERIODS))")&&
  appSource.includes('resolvePostingPeriod(periods, ')&&
  appSource.includes('resolvePostingPeriod(periods, target)')&&
  !/resolvePostingPeriod\(\s*\[/.test(appSource));
// Read-only reporting must show the closed-period money, not hide it. The proof
// is arithmetic rather than a journal number on page one of a paginated table:
// the rendered cumulative Trial Balance total for the entity that owns the
// closed period equals the total INCLUDING its closed-period postings and is
// strictly larger than the total without them, and no posting-control block
// code appears anywhere on a report surface.
const closedPeriodEntity=reportedClosedPostings[0].entity_id;
const closedPeriodNumbers=new Set(reportedClosedPostings.filter(row=>row.entity_id===closedPeriodEntity).map(row=>row.je_number));
const closedEntityAsOf=grossCents(asOfPostedFor(closedPeriodEntity));
const closedEntityAsOfWithoutBreaches=grossCents(asOfPostedFor(closedPeriodEntity).filter(j=>!closedPeriodNumbers.has(j.je_number)));
const closedEntityTrialBalanceMarkup=renderReportTab(closedPeriodEntity,'Trial Balance');
const closedEntityGLDetailMarkup=renderReportTab(closedPeriodEntity,'GL Detail');
const postingBlockCodes=['JE_PERIOD_NOT_CONFIGURED','JE_PERIOD_UNIDENTIFIED','Posting is blocked'];
expectPeriod('read-only reporting is unaffected by period control',
  closedPeriodNumbers.size>0&&closedEntityAsOf.debit>closedEntityAsOfWithoutBreaches.debit&&
  closedEntityTrialBalanceMarkup.includes('Trial Balance')&&
  closedEntityTrialBalanceMarkup.includes(money(closedEntityAsOf.debit/100))&&
  postedFor(closedPeriodEntity).some(j=>closedEntityGLDetailMarkup.includes(j.je_number))&&
  postingBlockCodes.every(code=>!closedEntityTrialBalanceMarkup.includes(code)&&!closedEntityGLDetailMarkup.includes(code)));

// ---------------------------------------------------------------------------
// Period LIFECYCLE. period-control.js decides whether a period permits posting;
// period-lifecycle.js is the only thing that can create or change the record it
// reads. These cases assert the commands, not the resolver.
// ---------------------------------------------------------------------------
const lifeMaster=[{period_id:1,entity_id:2,period_code:'2026-06',status:'CLOSED'},{period_id:2,entity_id:2,period_code:'2026-07',status:'OPEN'}];
const lifeAt='2026-08-07 10:00:00';
const allow=()=>true, deny=()=>false;
const openArgs={periods:lifeMaster,events:[],entityId:9,periodCode:'2026-07',actor:'ricky',at:lifeAt,reason:'Opening July for entity 9 to record the July pickup.',can:allow};
const opened=openPeriodCommand(openArgs);
expectPeriod('opening a period creates the record and one attributed PERIOD_OPENED event',
  opened.ok&&opened.periods.length===lifeMaster.length+1&&opened.events.length===1&&
  opened.event.event_type===PERIOD_EVENT_OPENED&&opened.event.actor==='ricky'&&opened.event.at===lifeAt&&
  opened.event.entity_id===9&&opened.event.period_code==='2026-07'&&opened.event.reason===openArgs.reason&&
  opened.record.status==='OPEN'&&lifeMaster.length===2);
expectPeriod('opening a period is refused without PERIOD.PERIOD.OPEN and changes nothing',
  (()=>{const r=openPeriodCommand({...openArgs,can:deny});
    return !r.ok&&r.code===PERIOD_PERMISSION_DENIED&&r.message.includes(PERM_PERIOD_OPEN)&&r.periods===lifeMaster&&r.events.length===0;})());
expectPeriod('opening a period is refused without a reason',
  (()=>{const r=openPeriodCommand({...openArgs,reason:'ok'});return !r.ok&&r.code===PERIOD_REASON_REQUIRED&&r.periods===lifeMaster;})());
expectPeriod('opening a period that already has a record is refused rather than silently re-opened',
  (()=>{const r=openPeriodCommand({...openArgs,entityId:2,periodCode:'2026-06'});
    return !r.ok&&r.code==='PERIOD_ALREADY_CONFIGURED'&&/reopen command/.test(r.message);})());
const closeArgs={periods:lifeMaster,events:[],entityId:2,periodCode:'2026-07',actor:'ricky',at:lifeAt,reason:'July close signed off.',can:allow};
expectPeriod('closing a period is refused while a journal in that entity and period is still in workflow',
  (()=>{const r=closePeriodCommand({...closeArgs,journals:[{je_id:1,je_number:'JE-D',entity_id:2,period_code:'2026-07',posting_status:'DRAFT'}]});
    return !r.ok&&r.code===PERIOD_UNRESOLVED_WORK&&/still in the Draft to Post workflow/.test(r.message)&&r.periods===lifeMaster;})());
expectPeriod('closing a period is refused while an exception raised in that period is still open',
  (()=>{const r=closePeriodCommand({...closeArgs,exceptions:[{exception_id:1,entity_id:2,occurred_date:'2026-07-30',status:'OPEN',object_ref:'X'}]});
    return !r.ok&&r.code===PERIOD_UNRESOLVED_WORK&&/still open/.test(r.message);})());
expectPeriod('closing a period is refused while a bank item dated in that period is unmatched',
  (()=>{const r=closePeriodCommand({...closeArgs,bankItems:[{entity_id:2,txn_date:'2026-07-31',match_status:'UNMATCHED',reference:'ACH'}]});
    return !r.ok&&r.code===PERIOD_UNRESOLVED_WORK&&/not matched/.test(r.message);})());
const closed=closePeriodCommand({...closeArgs,journals:[{je_id:2,je_number:'JE-P',entity_id:2,period_code:'2026-07',posting_status:'POSTED'}]});
expectPeriod('closing a clean period amends the record in place, keeps it, and writes a PERIOD_CLOSED event',
  closed.ok&&closed.periods.length===lifeMaster.length&&
  closed.record.status==='CLOSED'&&closed.record.closed_by==='ricky'&&closed.record.closed_at===lifeAt&&
  closed.event.event_type===PERIOD_EVENT_CLOSED&&closed.event.prior_status==='OPEN'&&
  closed.periods.some(p=>p.entity_id===2&&p.period_code==='2026-07'));
expectPeriod('closing a period never touches posted evidence',
  (()=>{const posted={je_id:2,je_number:'JE-P',entity_id:2,period_code:'2026-07',posting_status:'POSTED',je_date:'2026-07-31'};
    const before=JSON.stringify(posted);
    closePeriodCommand({...closeArgs,journals:[posted]});
    return JSON.stringify(posted)===before;})());
const reopenArgs={periods:lifeMaster,events:[],entityId:2,periodCode:'2026-06',actor:'ricky',at:lifeAt,can:allow};
expectPeriod('reopening is refused without PERIOD.PERIOD.REOPEN even when the actor may close',
  (()=>{const r=reopenPeriodCommand({...reopenArgs,reason:'Audit adjustment agreed with the reviewer.',can:perm=>perm===PERM_PERIOD_CLOSE});
    return !r.ok&&r.code===PERIOD_PERMISSION_DENIED&&r.message.includes(PERM_PERIOD_REOPEN);})());
expectPeriod('reopening is refused without a substantive reason and writes no event',
  (()=>{const r=reopenPeriodCommand({...reopenArgs,reason:'fix it'});
    return !r.ok&&r.code===PERIOD_REASON_REQUIRED&&r.events.length===0&&r.event===null&&r.periods===lifeMaster;})());
const reopened=reopenPeriodCommand({...reopenArgs,reason:'Reopened to book the audit-agreed accrual reversal for June.'});
expectPeriod('reopening a closed period writes an auditable PERIOD_REOPENED event carrying the reason',
  reopened.ok&&reopened.record.status==='OPEN'&&reopened.record.reopened_count===1&&
  reopened.event.event_type===PERIOD_EVENT_REOPENED&&reopened.event.prior_status==='CLOSED'&&
  reopened.event.reason==='Reopened to book the audit-agreed accrual reversal for June.'&&
  reopened.event.actor==='ricky'&&reopened.event.at===lifeAt&&reopened.event.entity_id===2&&reopened.event.period_code==='2026-06');
expectPeriod('reopening a period that is not closed is refused',
  (()=>{const r=reopenPeriodCommand({...reopenArgs,periodCode:'2026-07',reason:'Reopening the July period for a late adjustment.'});
    return !r.ok&&r.code==='PERIOD_NOT_CLOSED';})());
expectPeriod('no command can produce "no record", so absence never becomes an outcome',
  opened.periods.every(p=>p.status==='OPEN'||p.status==='CLOSED')&&
  closed.periods.length===lifeMaster.length&&reopened.periods.length===lifeMaster.length);

// The seeded master, and what the surface says about it.
const seededOpen=PERIODS.filter(p=>p.status==='OPEN');
expectPeriod('the seeded period master opens the current period for every entity and nothing else',
  seededOpen.length===ENTITIES.length&&seededOpen.every(p=>p.period_code==='2026-07')&&
  new Set(seededOpen.map(p=>p.entity_id)).size===ENTITIES.length&&
  PERIODS.filter(p=>p.status==='CLOSED').length===1&&
  PERIODS.every(p=>p.opened_by&&p.opened_at&&p.open_reason)&&
  PERIOD_EVENTS.filter(e=>e.event_type===PERIOD_EVENT_OPENED).length===ENTITIES.length+1&&
  PERIOD_EVENTS.filter(e=>e.event_type===PERIOD_EVENT_CLOSED).length===1&&
  PERIOD_EVENTS.every(e=>e.actor&&e.at&&e.reason));
const periodsCtx={...ctx,jes:[...JOURNAL_ENTRIES,...FY2026],periods:PERIODS,periodEvents:PERIOD_EVENTS,exceptions:EXCEPTIONS,closeTasks:CLOSE_TASKS,entity:0};
const periodsMarkup=renderToStaticMarkup(<PeriodManagement ctx={periodsCtx}/>);
expectPeriod('Period Management states the fail-closed rule and counts the open periods it can prove',
  periodsMarkup.includes('Period Management')&&
  periodsMarkup.includes('a missing record is never read as permission')&&
  periodsMarkup.includes(`<i>Open - posting permitted</i><b>${ENTITIES.length}</b>`)&&
  periodsMarkup.includes('<i>No period record</i><b>0</b>'));
const controllerCommands=['Open period','Close period','Reopen period'];
expectPeriod('a role holding no period permission is shown statements of fact, never executable period controls',
  (()=>{const denied=renderToStaticMarkup(<PeriodManagement ctx={{...periodsCtx,can:deny}}/>);
    return controllerCommands.every(label=>denied.includes(label))&&
      denied.includes(`Your role does not hold ${PERM_PERIOD_OPEN}`)&&
      denied.includes(`Your role does not hold ${PERM_PERIOD_CLOSE}`)&&
      denied.includes(`Your role does not hold ${PERM_PERIOD_REOPEN}`)&&
      !/<button[^>]*>(?:Open|Close|Reopen) \d+ selected<\/button>/.test(denied);})());
expectPeriod('a role holding the permissions gets real controls that are disabled until a selection and a reason exist',
  /<button[^>]*disabled[^>]*>Close 0 selected<\/button>/.test(periodsMarkup)&&
  /Select one or more entity periods first/.test(periodsMarkup)&&
  !periodsMarkup.includes(`Your role does not hold ${PERM_PERIOD_CLOSE}`));

const authoritativeBankCtx={...ctx,authoritativeMode:true,bank:{accounts:{'BA-003':{bank_name:'Pacific Bank',stmt_date:'2026-07-31',stmt_end:0,gl_book_balance:0,txns:[{bank_txn_id:1,external_id:'BANK-1',txn_date:'2026-07-31',amount:1,direction:'DEBIT',reference:'Fee',match_status:'UNMATCHED'}],outstanding_checks:[],deposits_in_transit:[]}},history:[]}};
const authoritativeBankMarkup=renderToStaticMarkup(<BankTransactions ctx={authoritativeBankCtx}/>);
if(!authoritativeBankMarkup.includes('BANK_API_UNAVAILABLE')||!authoritativeBankMarkup.includes('disabled')){failed++;console.error('FAIL authoritative Bank screen is not fail-closed');}else console.log('PASS authoritative Bank screen is fail-closed');
const authoritativeReconciliationMarkup=renderToStaticMarkup(<BankRec2 ctx={authoritativeBankCtx}/>);
if(!authoritativeReconciliationMarkup.includes('RECONCILIATION_API_UNAVAILABLE')){failed++;console.error('FAIL authoritative reconciliation screen is not fail-closed');}else console.log('PASS authoritative reconciliation screen is fail-closed');
globalThis.__REFS_RUNTIME_MODE__='REQUIRES_AUTHORITATIVE_API';globalThis.__REFS_ACCOUNTING_API__=null;
const lockedRuntimeMarkup=renderToStaticMarkup(<App/>);
delete globalThis.__REFS_RUNTIME_MODE__;delete globalThis.__REFS_ACCOUNTING_API__;
if(!lockedRuntimeMarkup.includes('Authoritative API required')){failed++;console.error('FAIL unconfigured production runtime is not locked');}else console.log('PASS unconfigured production runtime is locked before app state');
const missingModeMarkup=renderToStaticMarkup(<App/>);
if(!missingModeMarkup.includes('Runtime configuration did not load')||missingModeMarkup.includes('Ricky (Controller)')){failed++;console.error('FAIL missing runtime mode falls back to local mock');}else console.log('PASS missing runtime mode fails closed with an explicit configuration error');
globalThis.__REFS_RUNTIME_MODE__='UNRECOGNIZED_MODE';
const unknownModeMarkup=renderToStaticMarkup(<App/>);
delete globalThis.__REFS_RUNTIME_MODE__;
if(!unknownModeMarkup.includes('Runtime configuration is not recognised')||unknownModeMarkup.includes('Ricky (Controller)')){failed++;console.error('FAIL unknown runtime mode falls back to local mock');}else console.log('PASS unknown runtime mode fails closed with an explicit unrecognised-mode error');
globalThis.__REFS_RUNTIME_MODE__='LOCAL_MOCK';
const unstampedMockMarkup=renderToStaticMarkup(<App/>);
if(!unstampedMockMarkup.includes('Deployment assets disagree')||unstampedMockMarkup.includes('WanBridge Real Estate Financial System')){failed++;console.error('FAIL a demonstration adapter renders without a demonstration build stamp');}else console.log('PASS a demonstration adapter without a demonstration build stamp fails closed');
globalThis.__BUILD={sha:'0000000',time:'2026-01-01 00:00 UTC',channel:'AUTHORITATIVE',authoritative:true};
const authoritativeStampMockMarkup=renderToStaticMarkup(<App/>);
if(!authoritativeStampMockMarkup.includes('Deployment assets disagree')||authoritativeStampMockMarkup.includes('WanBridge Real Estate Financial System')){failed++;console.error('FAIL an authoritative build stamp serves a demonstration adapter');}else console.log('PASS an authoritative build stamp refuses a demonstration adapter');
globalThis.__BUILD={sha:'0000000',time:'2026-01-01 00:00 UTC',channel:'PUBLIC_DEMONSTRATION',authoritative:false};
const explicitMockMarkup=renderToStaticMarkup(<App/>);
if(!explicitMockMarkup.includes('WanBridge Real Estate Financial System')||explicitMockMarkup.includes('Authoritative API required')){failed++;console.error('FAIL explicit LOCAL_MOCK mode is unavailable');}else console.log('PASS only an explicitly stamped LOCAL_MOCK build enters the demonstration');
globalThis.__REFS_RUNTIME_MODE__='REQUIRES_AUTHORITATIVE_API';
const demonstrationStampAuthoritativeMarkup=renderToStaticMarkup(<App/>);
delete globalThis.__REFS_RUNTIME_MODE__;delete globalThis.__BUILD;
if(!demonstrationStampAuthoritativeMarkup.includes('Deployment assets disagree')){failed++;console.error('FAIL a demonstration build stamp is accepted as an authoritative deployment');}else console.log('PASS a demonstration build stamp cannot serve an authoritative deployment');
globalThis.__REFS_RUNTIME_MODE__='REQUIRES_AUTHORITATIVE_API';globalThis.__REFS_ACCOUNTING_API__={baseUrl:'https://api.example',entityId:'11111111-1111-4111-8111-111111111111',periodId:'33333333-3333-4333-8333-333333333333',cashAccountCode:'111000',getAccessToken:async()=>null};globalThis.__REFS_OIDC__=null;
const configuredWithoutOidcMarkup=renderToStaticMarkup(<App/>);
delete globalThis.__REFS_RUNTIME_MODE__;delete globalThis.__REFS_ACCOUNTING_API__;delete globalThis.__REFS_OIDC__;
if(!configuredWithoutOidcMarkup.includes('Authoritative API required')||configuredWithoutOidcMarkup.includes('Ricky (Controller)')){failed++;console.error('FAIL configured production runtime falls back to a local demo identity');}else console.log('PASS configured production runtime blocks without OIDC bootstrap');
const configuredEnvironment={__REFS_ACCOUNTING_API__:{baseUrl:'https://api.example',entityId:'11111111-1111-4111-8111-111111111111',periodId:'33333333-3333-4333-8333-333333333333',cashAccountCode:'111000',getAccessToken:async()=>null},__REFS_OIDC__:{issuer:'https://identity.example',authorizationEndpoint:'https://identity.example/authorize',tokenEndpoint:'https://identity.example/token',redirectUri:'https://app.example/callback',clientId:'refs-web',audience:'refs-api',scope:'openid profile'}};
const configuredRuntimeMarkup=renderToStaticMarkup(<AuthoritativeApp environment={configuredEnvironment}/>);
if(!authoritativeRuntimeConfigured(configuredEnvironment)||!configuredRuntimeMarkup.includes('Authoritative accounting')||configuredRuntimeMarkup.includes('Authoritative API required')||configuredRuntimeMarkup.includes('Ricky (Controller)')){failed++;console.error('FAIL fully configured authoritative runtime is unreachable');}else console.log('PASS fully configured authoritative runtime bypasses the demo and lock screen');
const authoritativeRowsMarkup=renderToStaticMarkup(<><AuthoritativeDocumentTable title="Authoritative AP bills" kind="AP" documents={[{journal_entry_id:'je-1',bill_no:'BILL-100',vendor_name:'Authoritative Vendor',due_date:'2026-08-31',amount:125.25,open_balance:25.25,currency:'USD',status:'PARTIALLY_PAID'}]}/><AuthoritativeAdjustmentSummary title="Authoritative AP adjustments" adjustments={[{business_adjustment_id:'adj-1',adjustment_kind:'AP_VENDOR_CREDIT',amount:5,currency:'USD',status:'POSTED'}]}/></>);
if(!authoritativeRowsMarkup.includes('BILL-100')||!authoritativeRowsMarkup.includes('Authoritative Vendor')||!authoritativeRowsMarkup.includes('AP_VENDOR_CREDIT')||authoritativeRowsMarkup.includes('Ricky (Controller)')){failed++;console.error('FAIL authoritative workspace does not render only API-shaped business rows');}else console.log('PASS authoritative workspace renders API-shaped business rows without local identity');
const workflowMarkup=renderToStaticMarkup(<AuthoritativeWorkflowTable title="Authoritative workflow" kind="AP" onWorkflow={noop} workingJournalIds={new Set()} documents={['DRAFT','PENDING_REVIEW','PENDING_APPROVAL','APPROVED'].map((journal_status,index)=>({journal_entry_id:`00000000-0000-4000-8000-00000000000${index+1}`,journal_revision:index,journal_status,bill_no:`B-${index+1}`,vendor_name:'Vendor',currency:'USD',amount:1,open_balance:1,status:'DRAFT'}))}/>);
if(!['SUBMIT','REVIEW','APPROVE','POST'].every(action=>workflowMarkup.includes(`>${action}<`))){failed++;console.error('FAIL authoritative workflow omits a server transition action');}else console.log('PASS authoritative workflow exposes the complete server transition sequence');
const adjustmentWorkflowMarkup=renderToStaticMarkup(<AuthoritativeWorkflowAdjustmentTable title="Authoritative adjustment workflow" onWorkflow={noop} workingJournalIds={new Set()} adjustments={[{business_adjustment_id:'adj-1',journal_entry_id:'00000000-0000-4000-8000-000000000010',journal_revision:2,journal_status:'PENDING_APPROVAL',adjustment_kind:'AR_CREDIT_MEMO',amount:3,currency:'USD',status:'DRAFT'}]}/>);
if(!adjustmentWorkflowMarkup.includes('>APPROVE<')||adjustmentWorkflowMarkup.includes('Ricky (Controller)')){failed++;console.error('FAIL authoritative adjustment workflow is not server-driven');}else console.log('PASS authoritative adjustment workflow exposes server approval only');
const authoritativeConfig={cashAccountCode:'111000'};
const postedCredit={business_adjustment_id:'00000000-0000-4000-8000-000000000020',adjustment_kind:'AR_CREDIT_MEMO',status:'POSTED',amount:3,currency:'USD'};
const postedInvoice={business_document_id:'00000000-0000-4000-8000-000000000021',inv_no:'INV-21',status:'OPEN',journal_status:'POSTED',open_balance:5,currency:'USD'};
const creditApplicationMarkup=renderToStaticMarkup(<AuthoritativeCreditApplicationForm config={authoritativeConfig} kind="AR_CREDIT_MEMO" credits={[postedCredit]} documents={[postedInvoice]} onCompleted={async()=>({ok:true})}/>);
if(!creditApplicationMarkup.includes('Apply Credit memo')||!creditApplicationMarkup.includes('INV-21')||creditApplicationMarkup.includes('localStorage')){failed++;console.error('FAIL authoritative credit application is not API-shaped');}else console.log('PASS authoritative credit application only selects API returned posted records');
const refundMarkup=renderToStaticMarkup(<AuthoritativeRefundForm config={authoritativeConfig} credits={[postedCredit]} onCompleted={async()=>({ok:true})}/>);
if(!refundMarkup.includes('Create refund Draft')||!refundMarkup.includes('Credit memo')){failed++;console.error('FAIL authoritative refund form is absent');}else console.log('PASS authoritative refund creates Draft through server command');
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
