import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {summarizeCompanyPeriod,verifyWbsH1CompanyAccounting} from '../tools/verify-wbs-h1-company-accounting.mjs';

const memberItems=(exceptionCount=0,difference='0.0000')=>({schema_version:'AP_CONTROL_MEMBER_OPEN_ITEMS_V1',totals:{exception_count:exceptionCount,difference}});

test('company verifier returns bounded counts and exact balanced trial balance without business values',()=>{
  const result=summarizeCompanyPeriod({periodCode:'2026-01',memberItems:memberItems(),documents:{scope:{total_count:'1'}},journals:{scope:{total_count:'1'}},ledger:[{total_count:'2'}],statements:[
    {statement_type:'TRIAL_BALANCE',ending_debit:'125.0000',ending_credit:'0.0000'},
    {statement_type:'TRIAL_BALANCE',ending_debit:'0.0000',ending_credit:'125.0000'},
    {statement_type:'BALANCE_SHEET',ending_debit:'125.0000',ending_credit:'0.0000'},
    {statement_type:'INCOME_STATEMENT',ending_debit:'125.0000',ending_credit:'0.0000'}
  ]});
  assert.deepEqual(result,{period_code:'2026-01',ap_bill_count:1,journal_count:1,posted_ledger_line_count:2,report_row_count:4,
    report_types:['BALANCE_SHEET','INCOME_STATEMENT','TRIAL_BALANCE'],trial_balance_balanced:true,trial_balance_difference:'0.0000',ap_member_exception_count:0,ap_member_difference:'0.0000',ap_member_reconciled:true});
  assert.equal(JSON.stringify(result).includes('125'),false);
});

test('company verifier fails the balance flag on exact four-decimal drift',()=>{
  const result=summarizeCompanyPeriod({periodCode:'2026-06',memberItems:memberItems(),documents:{scope:{total_count:0}},journals:{scope:{total_count:0}},ledger:[],statements:[
    {statement_type:'TRIAL_BALANCE',ending_debit:'1.0000',ending_credit:'0.9999'}
  ]});
  assert.equal(result.trial_balance_balanced,false);
  assert.equal(result.trial_balance_difference,'0.0001');
});

test('balanced totals cannot hide offsetting vendor exceptions or absent reports',()=>{
  const input={periodCode:'2026-01',documents:{scope:{total_count:1}},journals:{scope:{total_count:1}},ledger:[],statements:[]};
  const result=summarizeCompanyPeriod({...input,memberItems:memberItems(2)});
  assert.equal(result.ap_member_reconciled,false);assert.equal(result.trial_balance_balanced,false);
  assert.throws(()=>summarizeCompanyPeriod(input),/AP member reconciliation/);
  assert.throws(()=>summarizeCompanyPeriod({...input,memberItems:memberItems(0,null)}),/invalid MONEY4/);
});

test('single-period verifier is read-only, scopes PRIMARY periods and fails closed on AP mismatches',async()=>{
  const tenantId=randomUUID(),entityId=randomUUID(),periodId=randomUUID(),queries=[];
  const adminPool={async query(sql,args){
    queries.push(sql);assert.match(sql,/^SELECT /);assert.doesNotMatch(sql,/INSERT|UPDATE|DELETE|runtime_actor_grant/);
    if(sql.includes('FROM entity'))return {rows:[{entity_id:entityId,entity_code:'WBPA',name:'Synthetic company'}]};
    assert.match(sql,/ledger_code='PRIMARY'/);assert.deepEqual(args[2],['2026-01']);
    return {rows:[{period_id:periodId,period_code:'2026-01',status:'OPEN'}]};
  }};
  let exceptions=0;
  const reader={
    async listBusinessDocuments(scope){assert.equal(scope.periodId,periodId);return {scope:{total_count:1}};},
    async listJournalEntries(){return {scope:{total_count:1}};},async listGeneralLedger(){return [{total_count:4}];},
    async getFinancialStatements(){return ['BALANCE_SHEET','INCOME_STATEMENT','TRIAL_BALANCE'].map(statement_type=>({statement_type,ending_debit:'0.0000',ending_credit:'0.0000'}));},
    async readApControlMemberOpenItems(scope){assert.equal(scope.periodId,periodId);return {...memberItems(exceptions),entity_id:entityId,period_id:periodId};}
  };
  const input={adminPool,runtimePool:{},issuerPool:{},reader,tenantId,companyCode:'WBPA',periodCode:'2026-01',actorId:'already-authorized-reader'};
  assert.equal((await verifyWbsH1CompanyAccounting(input)).pass,true);
  exceptions=2;const denied=await verifyWbsH1CompanyAccounting(input);
  assert.equal(denied.pass,false);assert.equal(denied.status,'WBS_H1_COMPANY_ACCOUNTING_INCOMPLETE');
  assert.equal(queries.length,4);
  await assert.rejects(verifyWbsH1CompanyAccounting({...input,periodCode:'2026-07'}),/2026 H1/);
});
