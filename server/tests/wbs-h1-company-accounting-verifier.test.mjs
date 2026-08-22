import test from 'node:test';
import assert from 'node:assert/strict';
import {summarizeCompanyPeriod} from '../tools/verify-wbs-h1-company-accounting.mjs';

test('company verifier returns bounded counts and exact balanced trial balance without business values',()=>{
  const result=summarizeCompanyPeriod({periodCode:'2026-01',documents:{scope:{total_count:'1'}},journals:{scope:{total_count:'1'}},ledger:[{total_count:'2'}],statements:[
    {statement_type:'TRIAL_BALANCE',ending_debit:'125.0000',ending_credit:'0.0000'},
    {statement_type:'TRIAL_BALANCE',ending_debit:'0.0000',ending_credit:'125.0000'},
    {statement_type:'BALANCE_SHEET',ending_debit:'125.0000',ending_credit:'0.0000'},
    {statement_type:'INCOME_STATEMENT',ending_debit:'125.0000',ending_credit:'0.0000'}
  ]});
  assert.deepEqual(result,{period_code:'2026-01',ap_bill_count:1,journal_count:1,posted_ledger_line_count:2,report_row_count:4,
    report_types:['BALANCE_SHEET','INCOME_STATEMENT','TRIAL_BALANCE'],trial_balance_balanced:true,trial_balance_difference:'0.0000'});
  assert.equal(JSON.stringify(result).includes('125'),false);
});

test('company verifier fails the balance flag on exact four-decimal drift',()=>{
  const result=summarizeCompanyPeriod({periodCode:'2026-06',documents:{scope:{total_count:0}},journals:{scope:{total_count:0}},ledger:[],statements:[
    {statement_type:'TRIAL_BALANCE',ending_debit:'1.0000',ending_credit:'0.9999'}
  ]});
  assert.equal(result.trial_balance_balanced,false);
  assert.equal(result.trial_balance_difference,'0.0001');
});
