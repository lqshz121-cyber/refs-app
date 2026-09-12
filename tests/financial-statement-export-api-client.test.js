import assert from 'node:assert/strict';
import test from 'node:test';
import {exportAuthoritativeFinancialStatementSnapshot} from '../src/accounting-api.js';

const config={baseUrl:'https://accounting.example',entityId:'00000002-1111-4111-8111-000000000002',periodId:'00000003-1111-4111-8111-000000000003',getAccessToken:async()=>'token-token-token'};
const csv='financial_statement_snapshot_id,version\n00000004-1111-4111-8111-000000000004,1\r\n';
const digest='sha256:'.concat('0'.repeat(64));
const response=(headers={})=>({ok:true,headers:{get:name=>headers[name.toLowerCase()]??null},text:async()=>csv});

test('report export client verifies content hash, snapshot hash, and safe filename',async()=>{
  const cryptoApi={subtle:{digest:async()=>new Uint8Array(32)}};
  const result=await exportAuthoritativeFinancialStatementSnapshot({config,cryptoApi,fetcher:async(url,options)=>{assert.match(url,/financial-statement-snapshot\/export\?periodId=/);assert.equal(options.method,'GET');assert.equal(options.cache,'no-store');return response({'content-type':'text/csv; charset=utf-8','x-report-export-hash':digest,'x-report-snapshot-hash':digest,'content-disposition':'attachment; filename="financial-statement.csv"'});}});
  assert.equal(result.ok,true);assert.equal(result.data.filename,'financial-statement.csv');assert.equal(result.data.contentHash,digest);
});

test('report export client rejects malformed or drifted downloads',async()=>{
  const cryptoApi={subtle:{digest:async()=>new Uint8Array(32)}};
  const bad=await exportAuthoritativeFinancialStatementSnapshot({config,cryptoApi,fetcher:async()=>response({'content-type':'application/json','x-report-export-hash':digest,'x-report-snapshot-hash':digest,'content-disposition':'attachment; filename="x.csv"'})});assert.equal(bad.ok,false);assert.equal(bad.code,'STATEMENT_EXPORT_PROTOCOL');
  const drift=await exportAuthoritativeFinancialStatementSnapshot({config,cryptoApi,fetcher:async()=>response({'content-type':'text/csv; charset=utf-8','x-report-export-hash':'sha256:'.concat('f'.repeat(64)),'x-report-snapshot-hash':digest,'content-disposition':'attachment; filename="x.csv"'})});assert.equal(drift.ok,false);assert.equal(drift.code,'STATEMENT_EXPORT_PROTOCOL');
});
