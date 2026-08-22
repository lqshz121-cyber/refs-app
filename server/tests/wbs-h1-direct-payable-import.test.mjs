import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeDirectWbsTestPayables,runDirectWbsTestPayableImport} from '../tools/import-wbs-h1-direct-payables.mjs';

const tenantId='10000000-0000-4000-8000-000000000001',entityId='20000000-0000-4000-8000-000000000001';
const periods=Array.from({length:6},(_,index)=>{const month=String(index+1).padStart(2,'0'),code=`2026-${month}`,end=new Date(Date.UTC(2026,index+1,0)).toISOString().slice(0,10);return {period_id:`30000000-0000-4000-8000-00000000000${index+1}`,period_code:code,starts_on:`${code}-01`,ends_on:end};});

test('normalizes only one exact direct connected company and strict H1 money/date facts',()=>{
  assert.deepEqual(normalizeDirectWbsTestPayables([{uuid:'row-1',company_code:'FDF7',posting_date:'2026-01-02',amount:'1.250'}],{companyCode:'FDF7'}),[
    {ap_guid:'row-1',company_code:'FDF7',posting_date:'2026-01-02',amount:'1.2500',pay_status:'DIRECT_CONNECTED_TEST'}
  ]);
  assert.throws(()=>normalizeDirectWbsTestPayables([{uuid:'row-1',company_code:'OTHER',posting_date:'2026-01-02',amount:'1'}],{companyCode:'FDF7'}),/exact H1 company/);
  assert.throws(()=>normalizeDirectWbsTestPayables([{uuid:'row-1',company_code:'FDF7',posting_date:'2026-02-30',amount:'1'}],{companyCode:'FDF7'}),/exact H1 company/);
});

test('imports bounded month chunks with server scope and complete idempotent receipts',async()=>{
  const calls=[],rows=Array.from({length:11},(_,index)=>({uuid:`row-${index+1}`,company_code:'FDF7',posting_date:'2026-01-02',amount:'1.0000'}));
  const result=await runDirectWbsTestPayableImport({rows,companyCode:'FDF7',entityId,tenantId,periods,service:{async importPayables(input){calls.push(input);return {status:'WBS_TEST_PAYABLE_IMPORT_COMPLETE',imported_count:input.limit,replayed_count:0,posted_count:input.limit,failed_count:0,test_only:true};}}});
  assert.equal(result.status,'WBS_H1_DIRECT_PAYABLE_IMPORT_COMPLETE');assert.equal(result.row_count,11);assert.equal(result.posted_count,11);assert.equal(calls.length,2);
  assert.equal(calls[0].limit,10);assert.equal(calls[1].limit,1);assert.equal(calls[0].periodId,periods[0].period_id);
  assert.equal(calls[0].observation.scope.company_codes[0],'FDF7');assert.equal(calls[0].observation.can_post,false);
});
