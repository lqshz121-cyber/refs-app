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
console.log(`mtest components=${components.length} failed=${failed}`);
if(failed) process.exitCode=1;
