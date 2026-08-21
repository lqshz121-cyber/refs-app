import test from 'node:test';
import assert from 'node:assert/strict';
import {runWbsH1CompanyBatch,selectWbsH1CompanyBatch} from '../tools/import-wbs-h1-all-companies.mjs';

const tenant_id='6fb25daf-0799-4805-bede-be54230da33c';
const company=(company_code,index)=>({tenant_id,entity_id:`0000000${index}-0000-4000-8000-00000000000${index}`,company_code});

test('selects deterministic bounded company batches and exact single-company reruns',()=>{
  const rows=[company('CCC',3),company('AAA',1),company('BBB',2)];
  assert.deepEqual(selectWbsH1CompanyBatch(rows,{startAfter:'AAA',limit:1}).map(row=>row.company_code),['BBB']);
  assert.deepEqual(selectWbsH1CompanyBatch(rows,{companyCode:'CCC',limit:10}).map(row=>row.company_code),['CCC']);
  assert.throws(()=>selectWbsH1CompanyBatch([...rows,company('AAA',4)],{limit:10}),/not unique/);
});

test('continues across empty and failed months while retrying a durable Bank checkpoint',async()=>{
  const calls=[],progress=[];let partial=true;
  const service={async importRange(input){calls.push(input);if(input.companyCode==='AAA'&&input.dateFrom==='2026-01-01')throw Object.assign(new Error('empty'),{code:'WBS_TEST_IMPORT_EMPTY'});if(input.companyCode==='BBB'&&input.dateFrom==='2026-02-01')throw Object.assign(new Error('bad'),{code:'PROVIDER_DOWN'});if(partial){partial=false;return {status:'WBS_TEST_MONTH_IMPORT_PARTIAL'};}return {status:'WBS_TEST_MONTH_IMPORT_COMPLETE',payables:{record_count:2},bank:{record_count:3}};}};
  const summary=await runWbsH1CompanyBatch({companies:[company('AAA',1),company('BBB',2)],months:['2026-01','2026-02'],service,onProgress:row=>progress.push(row)});
  assert.equal(summary.status,'WBS_H1_COMPANY_BATCH_PARTIAL');assert.equal(summary.complete_count,2);assert.equal(summary.empty_count,1);assert.equal(summary.failed_count,1);assert.equal(summary.partial_retry_count,1);
  assert.equal(calls.length,5);assert.equal(progress.length,4);assert.deepEqual(progress.map(row=>row.status),['WBS_H1_COMPANY_MONTH_EMPTY','WBS_H1_COMPANY_MONTH_COMPLETE','WBS_H1_COMPANY_MONTH_COMPLETE','WBS_H1_COMPANY_MONTH_FAILED']);
  assert.equal(calls[1].idempotencyKey,calls[2].idempotencyKey);assert.match(calls[1].idempotencyKey,/^wbs-h1:[0-9a-f]{24}:2026-02$/);
});
