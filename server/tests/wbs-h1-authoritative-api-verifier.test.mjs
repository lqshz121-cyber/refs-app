import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyWbsH1AuthoritativeApi} from '../tools/verify-wbs-h1-authoritative-api.mjs';

const release='a'.repeat(40),entity='11111111-1111-4111-8111-111111111111';
const periods=Array.from({length:6},(_,index)=>{const month=String(index+1).padStart(2,'0');return {entity_id:entity,entity_code:'WBPA',entity_name:'WB Pacific',period_id:`0000000${index+1}-0000-4000-8000-00000000000${index+1}`,period_code:`2026-${month}`};});
const counts={source_record_count:1,source_amount:'125.0000',controlled_test_posted_count:1,formal_mapping_posted_count:1,mapping_missing_count:0,mapping_ready_count:0,mapping_ambiguous_count:0};
const inventory={schema_version:'WBS_H1_IMPORT_INVENTORY_V1',company_code:'WBPA',totals:counts,months:periods.map((row,index)=>({period_code:row.period_code,...counts,source_record_count:index===0?1:0,formal_mapping_posted_count:index===0?1:0}))};
const statements=[
  {statement_type:'TRIAL_BALANCE',ending_debit:'125.0000',ending_credit:'0.0000'},
  {statement_type:'TRIAL_BALANCE',ending_debit:'0.0000',ending_credit:'125.0000'},
  {statement_type:'BALANCE_SHEET',ending_debit:'125.0000',ending_credit:'0.0000'},
  {statement_type:'INCOME_STATEMENT',ending_debit:'125.0000',ending_credit:'0.0000'}
];
const response=(body,status=200)=>({ok:status>=200&&status<300,status,json:async()=>body});

test('verifies every authorized H1 company and posted report without exposing business amounts',async()=>{
  const calls=[];const result=await verifyWbsH1AuthoritativeApi({apiBaseUrl:'https://api.example.test',accessToken:'abcdefghijklmnop',releaseSha:release,expectedCompanyCodes:'WBPA',fetchImpl:async(url,options)=>{calls.push({url,options});if(url.endsWith('/health/ready'))return response({status:'ready',release});if(url.endsWith('/api/v1/accounting-scopes'))return response({ok:true,data:periods});if(url.includes('h1-import-inventory'))return response({ok:true,data:inventory});if(url.includes('financial-statements'))return response({ok:true,data:statements});throw new Error(url);}});
  assert.equal(result.pass,true);assert.equal(result.status,'WBS_H1_AUTHORITATIVE_API_VERIFIED');assert.equal(result.authorized_company_count,1);assert.equal(result.companies[0].h1_periods_complete,true);assert.equal(result.companies[0].formal_population_complete,true);assert.equal(result.companies[0].reports_balanced,true);assert.equal(JSON.stringify(result).includes('125.0000'),false);
  assert.ok(calls.every(call=>call.options.method==='GET'&&call.options.cache==='no-store'&&call.options.headers.authorization==='Bearer abcdefghijklmnop'));
});

test('fails the acceptance result for missing expected companies or unposted imported rows',async()=>{
  const incomplete={...inventory,totals:{...counts,formal_mapping_posted_count:0},months:inventory.months.map(row=>({...row,formal_mapping_posted_count:0}))};
  const result=await verifyWbsH1AuthoritativeApi({apiBaseUrl:'https://api.example.test',accessToken:'abcdefghijklmnop',releaseSha:release,expectedCompanyCodes:'WBPA,WBRT',fetchImpl:async url=>url.endsWith('/health/ready')?response({status:'ready',release}):url.endsWith('/api/v1/accounting-scopes')?response({ok:true,data:periods}):response({ok:true,data:incomplete})});
  assert.equal(result.pass,false);assert.equal(result.status,'WBS_H1_AUTHORITATIVE_API_INCOMPLETE');assert.deepEqual(result.missing_company_codes,['WBRT']);assert.equal(result.companies[0].formal_population_complete,false);
});

test('rejects a release mismatch before reading any company data',async()=>{
  let calls=0;await assert.rejects(()=>verifyWbsH1AuthoritativeApi({apiBaseUrl:'https://api.example.test',accessToken:'abcdefghijklmnop',releaseSha:release,fetchImpl:async()=>{calls++;return response({status:'ready',release:'b'.repeat(40)});}}),error=>error.code==='WBS_H1_API_RELEASE_MISMATCH');assert.equal(calls,1);
});
