import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {File} from 'node:buffer';
import {StreamingSha256,browserCanonicalRequestHash,canonicalRequestBody,normalizeBrowserWbsH1AccountingControlRow,summarizeBrowserWbsH1AccountingStream,uploadBrowserWbsH1AccountingControl,validateBrowserWbsH1Manifest} from '../src/wbs-h1-accounting-control-upload.js';
import {canonicalRequestBody as serverCanonicalBody,canonicalRequestHash as serverCanonicalHash} from '../server/runtime/request-hash.mjs';
import {normalizeWbsH1AccountingControlRow} from '../server/runtime/wbs-h1-accounting-control-population.mjs';
import {appendAuthoritativeWbsH1ControlLines,createAuthoritativeWbsH1ControlRun,finalizeAuthoritativeWbsH1ControlRun} from '../src/accounting-api.js';

const tenantId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',entityId='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',periodId='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const config={baseUrl:'https://api.example.test',entityId,periodId,getAccessToken:async()=>'browser-token-abcdefghijklmnop'};
const rows=[
  {id:1,com_code:'WBPA',posting_date:'2026-01-15',set_date:'2026-01-15',debtor:'25',lender:'0',account:'6100',payee_no:'V1',pj_code:'P1',cost_code:'C1',come_from:'AP'},
  {id:2,com_code:'WBPA',posting_date:'2026-01-15',set_date:'2026-01-15',debtor:'0',lender:'25',account:'2100',payee_no:'V1',pj_code:'P1',cost_code:'C1',come_from:'AP'}
];
const raw=rows.map(JSON.stringify).join('\n')+'\n',rawBytes=new TextEncoder().encode(raw).byteLength,rawHash=createHash('sha256').update(raw).digest('hex');
const manifest={schema_version:'WBS_H1_2026_LOCAL_SNAPSHOT_V1',date_from:'2026-01-01',date_to:'2026-06-30',generated_at:'2026-08-23T00:00:00.000Z',files:[{domain:'accounting_info',company_code:'WBPA',period:'2026-H1',path:'exports/accounting_info__WBPA__2026-H1.ndjson',rows:2,bytes:rawBytes,sha256:rawHash}]};
const manifestFile=new File([JSON.stringify(manifest)],'manifest.json',{type:'application/json'}),rawFile=new File([raw],'accounting_info__WBPA__2026-H1.ndjson',{type:'application/x-ndjson'});

test('streaming SHA-256 matches standard vectors across chunk boundaries',()=>{
  assert.equal(new StreamingSha256().update('').digestHex(),createHash('sha256').update('').digest('hex'));
  const hash=new StreamingSha256();for(const chunk of ['a','bc','x'.repeat(63),'😀'])hash.update(chunk);
  assert.equal(hash.digestHex(),createHash('sha256').update('abc'+'x'.repeat(63)+'😀').digest('hex'));
});

test('browser canonical body and normalized line are exact server parity',()=>{
  const value={z:[3,{b:true,a:null}],a:'text',skip:undefined};
  assert.equal(canonicalRequestBody(value),serverCanonicalBody(value));assert.equal(browserCanonicalRequestHash(value),serverCanonicalHash(value));
  const scope={tenantId,entityId,companyCode:'WBPA',currency:'USD',sourceVersion:`sha256:${'1'.repeat(64)}`,rowOrdinal:1};
  assert.deepEqual(normalizeBrowserWbsH1AccountingControlRow({...rows[0],posting_date:'2026-02-30'},scope),normalizeWbsH1AccountingControlRow({...rows[0],posting_date:'2026-02-30'},scope));
});

test('manifest and streamed summary bind exact file name, rows, bytes, raw hash and balance',async()=>{
  const sourceManifest=await validateBrowserWbsH1Manifest({manifestFile,rawFile,companyCode:'WBPA'}),sourceVersion=browserCanonicalRequestHash({schema_version:'WBS_H1_ACCOUNTING_CONTROL_SOURCE_V1',manifest:sourceManifest});
  const summary=await summarizeBrowserWbsH1AccountingStream({rawFile,sourceManifest,tenantId,entityId,currency:'USD',sourceVersion});
  assert.equal(summary.expected_row_count,2);assert.equal(summary.expected_debit_amount,'25.0000');assert.equal(summary.expected_credit_amount,'25.0000');assert.equal(summary.accounting_authority,'CONTROL_EVIDENCE_ONLY');
  await assert.rejects(validateBrowserWbsH1Manifest({manifestFile,rawFile:new File([raw+' '],rawFile.name),companyCode:'WBPA'}),/exactly match/);
  const descending=new File([`${JSON.stringify(rows[1])}\n${JSON.stringify(rows[0])}\n`],rawFile.name);await assert.rejects(summarizeBrowserWbsH1AccountingStream({rawFile:descending,sourceManifest:{...sourceManifest,bytes:descending.size,sha256:createHash('sha256').update(await descending.text()).digest('hex')},tenantId,entityId,currency:'USD',sourceVersion}),/strictly ascending/);
});

test('the production-size WBPA manifest entry is accepted structurally without reading or copying its raw file',async()=>{
  const large={...manifest,files:[{...manifest.files[0],rows:202304,bytes:314000000,sha256:'f'.repeat(64)}]},largeManifest=new File([JSON.stringify(large)],'manifest.json'),largeRaw={name:'accounting_info__WBPA__2026-H1.ndjson',size:314000000,stream(){throw new Error('validation must not read raw bytes yet');}};
  const source=await validateBrowserWbsH1Manifest({manifestFile:largeManifest,rawFile:largeRaw,companyCode:'WBPA'});assert.equal(source.rows,202304);assert.equal(source.bytes,314000000);
});

test('human access fails before any large control file is selected or read',async()=>{
  let rawRead=false;const unreadRaw={name:'accounting_info__WBPA__2026-H1.ndjson',size:314000000,stream(){rawRead=true;throw new Error('raw file must remain unread');}};
  const denied=await uploadBrowserWbsH1AccountingControl({config,companyCode:'WBPA',manifestFile,rawFile:unreadRaw,fetcher:async()=>response(200,{tenant_id:tenantId,entity_id:entityId,actor_id:'human-reviewer',grant_set_version:1,permissions:['WBS.AUTOREC.VIEW'],configured_permissions:['WBS.AUTOREC.VIEW','WBS.SNAPSHOT.IMPORT'],session_refresh_required:false})});
  assert.equal(denied.ok,false);assert.equal(denied.code,'WBS_H1_CONTROL_SERVICE_IMPORT_AUTHORIZATION_REQUIRED');assert.equal(rawRead,false);assert.match(denied.message,/no files were selected or transmitted/i);
});

test('browser upload verifies before POST, pages through authenticated no-store API, and remains control-only',async()=>{
  const calls=[],progress=[];
  const fetcher=async(url,options)=>{calls.push({url,options});if(url.endsWith('/access/self'))return response(200,{tenant_id:tenantId,entity_id:entityId,actor_id:'operator',grant_set_version:1,permissions:['WBS.SNAPSHOT.IMPORT'],configured_permissions:['WBS.SNAPSHOT.IMPORT'],session_refresh_required:false});
    const body=JSON.parse(options.body);if(url.endsWith('/h1-accounting-control-runs'))return response(201,{run_id:body.runId,idempotent:false});if(url.endsWith('/lines'))return response(201,{run_id:url.split('/').at(-2),accepted_row_count:body.lines.length});if(url.endsWith('/finalize'))return response(201,{schema_version:'WBS_H1_ACCOUNTING_CONTROL_RECEIPT_V1',run_id:url.split('/').at(-2),receipt_id:randomUUID(),receipt_hash:`sha256:${'e'.repeat(64)}`,accounting_authority:'CONTROL_EVIDENCE_ONLY',can_create_draft:false,can_review:false,can_approve:false,can_post:false,idempotent:false});throw new Error('unexpected URL');};
  const result=await uploadBrowserWbsH1AccountingControl({config,companyCode:'WBPA',manifestFile,rawFile,fetcher,onProgress:item=>progress.push(item)});
  assert.equal(result.ok,true);assert.equal(result.rowCount,2);assert.equal(result.pageCount,1);assert.equal(calls.length,4);assert.equal(calls[0].options.method,'GET');assert.equal(calls.slice(1).every(call=>call.options.method==='POST'&&call.options.cache==='no-store'&&call.options.headers.authorization==='Bearer browser-token-abcdefghijklmnop'),true);assert.equal(calls.some(call=>String(call.options.body).includes('browser-token')),false);assert.equal(progress.at(-1).phase,'COMPLETE');
  const badManifest=new File([JSON.stringify({...manifest,files:[{...manifest.files[0],sha256:'0'.repeat(64)}]})],'manifest.json');let postCount=0;const failed=await uploadBrowserWbsH1AccountingControl({config,companyCode:'WBPA',manifestFile:badManifest,rawFile,fetcher:async(url,options)=>{if(options.method==='POST')postCount++;return fetcher(url,options);}});assert.equal(failed.ok,false);assert.equal(postCount,0);
});

test('create/page/finalize clients reject malformed receipts and preserve the exact idempotency keys',async()=>{
  const hash=`sha256:${'a'.repeat(64)}`,sourceManifest=await validateBrowserWbsH1Manifest({manifestFile,rawFile,companyCode:'WBPA'}),runId=randomUUID(),run={runId,companyCode:'WBPA',currency:'USD',sourceVersion:hash,snapshotTokenHash:hash,providerContentHash:`sha256:${sourceManifest.sha256}`,sourceManifest,capturedAt:sourceManifest.generated_at,expectedRowCount:2,includedH1RowCount:2,excludedRowCount:0,expectedDebitAmount:'25.0000',expectedCreditAmount:'25.0000',populationHash:hash};let call;
  const created=await createAuthoritativeWbsH1ControlRun({config,run,idempotencyKey:'control-create-001',fetcher:async(url,options)=>(call={url,options},response(201,{run_id:runId,idempotent:false}))});assert.equal(created.ok,true);assert.equal(call.options.headers['idempotency-key'],'control-create-001');
  const line=normalizeBrowserWbsH1AccountingControlRow(rows[0],{tenantId,entityId,companyCode:'WBPA',currency:'USD',sourceVersion:hash,rowOrdinal:1});const appended=await appendAuthoritativeWbsH1ControlLines({config,runId,lines:[line],idempotencyKey:'control-page-001',fetcher:async()=>response(201,{run_id:runId,accepted_row_count:2})});assert.equal(appended.ok,false);assert.equal(appended.code,'WBS_H1_ACCOUNTING_CONTROL_APPEND_PROTOCOL');
  const finalized=await finalizeAuthoritativeWbsH1ControlRun({config,runId,idempotencyKey:'control-final-001',fetcher:async()=>response(201,{schema_version:'WBS_H1_ACCOUNTING_CONTROL_RECEIPT_V1',run_id:runId,receipt_id:randomUUID(),receipt_hash:hash,accounting_authority:'CONTROL_EVIDENCE_ONLY',can_create_draft:false,can_review:false,can_approve:false,can_post:true,idempotent:false})});assert.equal(finalized.ok,false);
});

test('a failed page retries the same run and reports exact page and row progress',async()=>{
  let failPage=true;const createRuns=[];
  const fetcher=async(url,options)=>{if(url.endsWith('/access/self'))return response(200,{tenant_id:tenantId,entity_id:entityId,actor_id:'operator',grant_set_version:1,permissions:['WBS.SNAPSHOT.IMPORT'],configured_permissions:['WBS.SNAPSHOT.IMPORT'],session_refresh_required:false});const body=JSON.parse(options.body);if(url.endsWith('/h1-accounting-control-runs')){createRuns.push(body.runId);return response(createRuns.length===1?201:200,{run_id:body.runId,idempotent:createRuns.length>1});}if(url.endsWith('/lines')&&failPage){failPage=false;return {ok:false,status:503,json:async()=>({ok:false,code:'TEMPORARY'})};}if(url.endsWith('/lines'))return response(201,{run_id:url.split('/').at(-2),accepted_row_count:body.lines.length});if(url.endsWith('/finalize'))return response(201,{schema_version:'WBS_H1_ACCOUNTING_CONTROL_RECEIPT_V1',run_id:url.split('/').at(-2),receipt_id:randomUUID(),receipt_hash:`sha256:${'e'.repeat(64)}`,accounting_authority:'CONTROL_EVIDENCE_ONLY',can_create_draft:false,can_review:false,can_approve:false,can_post:false,idempotent:false});throw new Error('unexpected URL');};
  const first=await uploadBrowserWbsH1AccountingControl({config,companyCode:'WBPA',manifestFile,rawFile,fetcher});assert.equal(first.ok,false);assert.equal(first.page,0);assert.equal(first.rows,0);assert.equal(first.resume.runId,first.runId);
  const second=await uploadBrowserWbsH1AccountingControl({config,companyCode:'WBPA',manifestFile,rawFile,fetcher,resume:first.resume});assert.equal(second.ok,true);assert.equal(second.runId,first.runId);assert.equal(second.pageCount,1);assert.equal(second.rowCount,2);assert.deepEqual(createRuns,[first.runId,first.runId]);
});

function response(status,data){return {ok:status>=200&&status<300,status,json:async()=>({ok:true,data})};}
