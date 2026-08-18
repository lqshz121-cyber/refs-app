import assert from 'node:assert/strict';
import fs from 'node:fs';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {accountingApiConfig,importAuthoritativeWbsBankToTestReconciliation,importAuthoritativeWbsPayablesToTestAccounting,wbsTestBankImportIdempotencyKey,wbsTestImportIdempotencyKey} from '../src/accounting-api.js';
import {AuthoritativeWbsLivePilotObservation,WBS_LIVE_PILOT_SURFACE_TOOLS,wbsLivePilotErrorGuidance} from '../src/authoritative-wbs-live-pilot-observation.jsx';

const periodId='22222222-2222-4222-8222-222222222222';
const config={entityId:'11111111-1111-4111-8111-111111111111',periodId,baseUrl:'https://accounting.example',getAccessToken:async()=> 'a'.repeat(48),scopePresentation:{entityLabel:'Test entity'}};
const render=tools=>renderToStaticMarkup(<AuthoritativeWbsLivePilotObservation config={config} tools={tools} fetcher={async()=>{throw new Error('SSR must not call WBS');}}/>);

const dashboard=render(WBS_LIVE_PILOT_SURFACE_TOOLS.dashboard);
for(const label of ['Payables','Bank transactions','AutoRec details','AutoRec banks','Journal entries'])assert.match(dashboard,new RegExp(`>${label}<`));
for(const boundary of ['READ ONLY','No demo or browser-stored data'])assert.match(dashboard,new RegExp(boundary,'i'));
assert.match(dashboard,/Live connection not checked/);
assert.match(dashboard,/Refresh live WBS data/);
for(const liveFact of ['Live WBS connection status','Last successful API read','Record count','Test entity','Production WBS API'])assert.match(dashboard,new RegExp(liveFact));

const payables=render(WBS_LIVE_PILOT_SURFACE_TOOLS.payables);
assert.match(payables,/WBS read-only view:<\/b> Payables/);
for(const boundary of ['OPERATOR ATTESTED','UNSIGNED','EXCEPTION REVIEW REQUIRED','NOT POSTED','outside Raw, Staging, AP Bills, Journals, GL, and Posted totals'])assert.match(payables,new RegExp(boundary,'i'));
assert.match(payables,/Retain as exception evidence/);assert.match(payables,/Refresh retained evidence/);
const source=fs.readFileSync('src/authoritative-wbs-live-pilot-observation.jsx','utf8');
for(const retainedUi of ['Real retained WBS Payable exception rows','Company scope status','View retained rows','View details','AWAITING SIGNED REDELIVERY','GL / REPORT','Next owner'])assert.match(source,new RegExp(retainedUi));
assert.match(source,/row\.document_number\|\|`Source \$\{row\.source_record_id\}`/,'retained immutable evidence must expose its server-provided source record when the Provider supplied no invoice number');
assert.match(source,/row\.accounting_date\|\|'Not supplied by Provider'/,'a missing provider accounting date must be explicit rather than presented as a false zero or generic unavailable state');
assert.match(source,/refreshAuthoritativeWbsOperatorPayableExceptionRows/);
assert.match(payables,/title="Unavailable until authenticated exception-evidence access and a live WBS Payables observation with at least one row are available"/,'the disabled exception-retain button must explain its unavailable state');
assert.match(fs.readFileSync('src/authoritative-wbs-live-pilot-observation.jsx','utf8'),/refreshAuthoritativeWbsOperatorPayableAttestations\(\{config,fetcher\}\).*canAttest:true/s,'the existing protected retained-evidence GET must drive operator button capability');
assert.match(fs.readFileSync('src/authoritative-wbs-live-pilot-observation.jsx','utf8'),/companyCode:scopeCompany\?requestedCompanyCode\|\|null:null,dateFrom:requestedCompanyCode&&scopeDates\?dateFrom:null,dateTo:requestedCompanyCode&&scopeDates\?dateTo:null/,'a date range may only be sent when the selected Provider tool supports dates and one explicit native company scope is present');
assert.match(fs.readFileSync('src/authoritative-wbs-live-pilot-observation.jsx','utf8'),/Approved WBS company code.*WBS observation date from.*WBS observation date to/s,'the authoritative UI must expose the exact Provider-native company and date scope');
assert.match(source,/useState\('2026-01-01'\).*useState\('2026-12-31'\)/s,'the approved first authoritative WBS read must default to the complete 2026 scope');
assert.match(fs.readFileSync('src/authoritative-wbs-live-pilot-observation.jsx','utf8'),/!hasExactAttestationScope.*UNASSIGNED COMPANY - exception intake available/s,'mixed or unresolved company results must remain visible and retainable only as exception evidence');
assert.match(fs.readFileSync('src/authoritative-overview.jsx','utf8'),/AuthoritativeWbsLivePilotObservation[\s\S]*showRows=\{true\}/,'the authoritative overview must expose real read-only observation rows with their NOT_ADMITTED boundary visible');
assert.match(wbsLivePilotErrorGuidance('ACCOUNTING_API_SERVER_ERROR'),/retry after the production WBS service is available/);
assert.match(wbsLivePilotErrorGuidance('WBS_LIVE_PILOT_PROTOCOL'),/immutable company, accounting-date, currency, and source-record evidence/);
assert.match(wbsLivePilotErrorGuidance('WBS_LIVE_PILOT_SCOPE_INVALID'),/exact Provider company code/);
assert.match(fs.readFileSync('src/authoritative-wbs-live-pilot-observation.jsx','utf8'),/disabled=\{!retainPathReady\|\|capabilityState\.phase!==\'READY\'\|\|!capabilityState\.canAttest/,'operator actions must remain disabled until the protected persistence path is live');
assert.doesNotMatch(payables,/<select/);
assert.doesNotMatch(payables,/Bank transactions|AutoRec details|Journal entries/);

const bank=render(WBS_LIVE_PILOT_SURFACE_TOOLS.bank);
assert.match(bank,/WBS read-only view:<\/b> Bank transactions/);
assert.doesNotMatch(bank,/>AutoRec banks</);
assert.doesNotMatch(bank,/>Payables<|>Journal entries</);

const journal=render(WBS_LIVE_PILOT_SURFACE_TOOLS.journal);
assert.match(journal,/WBS read-only view:<\/b> Journal entries/);
assert.doesNotMatch(journal,/<select/);
assert.doesNotMatch(journal,/>Payables<|>Bank transactions</);

assert.match(source,/limit:10/);
assert.match(source,/refreshAuthoritativeWbsLivePilot/);
assert.doesNotMatch(source,/localStorage|sessionStorage|seed\.js|repo\.js|method:\s*['"](?:PUT|PATCH|DELETE)['"]|vendor_name|vendor_no|payee/);
assert.match(source,/attestAuthoritativeWbsPayableObservation/);assert.match(source,/Confirm exception retain/);assert.match(source,/attestationConfirmation\?attest\(\):setAttestationConfirmation\(true\)/);assert.match(source,/It will not create a Draft or post anything/);assert.doesNotMatch(source,/globalThis\.confirm/);
assert.match(source,/const retainPathReady=true/);assert.match(source,/disabled=\{!retainPathReady\|\|capabilityState/);assert.doesNotMatch(source,/!hasExactAttestationScope\|\|attestationState/);
for(const host of ['authoritative-overview.jsx','authoritative-workspace.jsx','authoritative-bank-workspace.jsx','authoritative-journal-workspace.jsx','authoritative-wbs-transition-workspace.jsx']){
  assert.match(fs.readFileSync(`src/${host}`,'utf8'),/AuthoritativeWbsLivePilotObservation/,`${host} must use the shared read-only WBS observation`);
}
const documents=fs.readFileSync('src/authoritative-workspace.jsx','utf8');
assert.match(documents,/bill&&<AuthoritativeWbsLivePilotObservation/,'only AP may map the provider payables observation; AR must not fabricate a receivables view');

assert.doesNotMatch(payables,/Import to test AP and post|TEST ONLY/,'test import must not appear without explicit test-import configuration and a successful Payables observation');
assert.match(source,/config\?\.wbsTestImportMode==='ENABLED'&&\(scopedPayables\|\|scopedBank\)&&state\.phase==='READY'&&observation\?\.record_count>0/,'test import visibility must require explicit configuration and a successful nonempty Payables or Bank observation');
for(const label of ['Import to test AP and post','TEST ONLY','Imported','Replayed','Posted','Failed'])assert.match(source,new RegExp(label));
for(const label of ['Import to test Bank reconciliation','DRAFT RECONCILIATION','Transactions','Reconciliation ID'])assert.match(source,new RegExp(label));
assert.match(source,/importAuthoritativeWbsBankToTestReconciliation/,'the shared WBS surface must call the closed Bank test-import client for a Bank observation');

const observation={schema_version:'WBS_LIVE_PILOT_OBSERVATION_V1',status:'NOT_ADMITTED',observation_mode:'UNSIGNED_PILOT',source_system:'WBS',tool:'list_payables',environment:'PRODUCTION',entity_id:config.entityId,captured_at:'2026-08-18T12:00:00.000Z',provider_content_sha256:'a'.repeat(64),observation_hash:`sha256:${'b'.repeat(64)}`,record_count:1,signature_verified:false,scope:{company_codes:['WBPA'],date_range:['2026-01-01','2026-12-31']},rows:[{source_record_hash:`sha256:${'c'.repeat(64)}`,accounting_date:'2026-08-18',currency:'USD',amount:'10.0000',status:'OPEN'}],can_import:false,can_create_transaction:false,can_match:false,can_allocate:false,can_create_draft:false,can_approve:false,can_post:false,can_reverse:false};

async function testImportClientContract(){
  const runtime=accountingApiConfig({__REFS_ACCOUNTING_API__:{...config,wbsTestImportMode:'ENABLED'}});
  assert.equal(runtime.wbsTestImportMode,'ENABLED');
  assert.equal(accountingApiConfig({__REFS_ACCOUNTING_API__:{...config,wbsTestImportMode:'enabled'}}).wbsTestImportMode,'DISABLED');
  const commandIdentity={observationHash:observation.observation_hash,periodId,companyCode:'WBPA',dateFrom:'2026-01-01',dateTo:'2026-12-31'};
  const expectedKey=await wbsTestImportIdempotencyKey(commandIdentity);
  assert.match(expectedKey,/^wbs-test-import-[0-9a-f]{64}$/);
  assert.equal(await wbsTestImportIdempotencyKey(commandIdentity),expectedKey,'the exact observation and scope must deterministically reuse one command key');
  assert.notEqual(await wbsTestImportIdempotencyKey({...commandIdentity,observationHash:`sha256:${'d'.repeat(64)}`}),expectedKey,'a new observation must receive a new command key');
  assert.notEqual(await wbsTestImportIdempotencyKey({...commandIdentity,dateFrom:'2026-02-01'}),expectedKey,'a new scope must receive a new command key');
  let request;
  const result=await importAuthoritativeWbsPayablesToTestAccounting({config:runtime,observation,companyCode:'WBPA',dateFrom:'2026-01-01',dateTo:'2026-12-31',fetcher:async(url,options)=>{request={url,options};return {ok:true,status:201,headers:{get:name=>name==='content-type'?'application/json':null},json:async()=>({ok:true,data:{status:'WBS_TEST_PAYABLE_IMPORT_COMPLETE',test_only:true,imported_count:1,replayed_count:0,posted_count:1,failed_count:0}})};}});
  assert.equal(result.ok,true,JSON.stringify(result));assert.equal(result.idempotent,false);
  assert.match(request.url,/\/api\/v1\/entities\/11111111-1111-4111-8111-111111111111\/wbs\/test-import\/payables$/);
  assert.equal(request.options.method,'POST');assert.equal(request.options.credentials,'include');assert.equal(request.options.cache,'no-store');assert.equal(request.options.headers['idempotency-key'],expectedKey);assert.equal(request.options.headers.authorization,`Bearer ${'a'.repeat(48)}`);
  assert.deepEqual(JSON.parse(request.options.body),{periodId,companyCode:'WBPA',dateFrom:'2026-01-01',dateTo:'2026-12-31',limit:10});
  const retryKeys=[];
  const networkFailure=await importAuthoritativeWbsPayablesToTestAccounting({config:runtime,observation,companyCode:'WBPA',dateFrom:'2026-01-01',dateTo:'2026-12-31',fetcher:async(_url,options)=>{retryKeys.push(options.headers['idempotency-key']);throw new Error('network unavailable');}});
  assert.equal(networkFailure.code,'ACCOUNTING_API_UNREACHABLE');
  const retry=await importAuthoritativeWbsPayablesToTestAccounting({config:runtime,observation,companyCode:'WBPA',dateFrom:'2026-01-01',dateTo:'2026-12-31',fetcher:async(_url,options)=>{retryKeys.push(options.headers['idempotency-key']);return {ok:true,status:200,headers:{get:()=> 'application/json'},json:async()=>({ok:true,data:{status:'WBS_TEST_PAYABLE_IMPORT_COMPLETE',test_only:true,imported_count:0,replayed_count:1,posted_count:1,failed_count:0}})};}});
  assert.equal(retry.ok,true,JSON.stringify(retry));assert.equal(retry.idempotent,true);assert.deepEqual(retryKeys,[expectedKey,expectedKey],'a network retry must reuse the same idempotency key');
  let calls=0;const denied=await importAuthoritativeWbsPayablesToTestAccounting({config:{...runtime,wbsTestImportMode:'DISABLED'},observation,companyCode:'WBPA',dateFrom:'2026-01-01',dateTo:'2026-12-31',fetcher:async()=>{calls++;}});assert.equal(denied.code,'WBS_TEST_IMPORT_COMMAND_INVALID');assert.equal(calls,0);
  const unsafe=await importAuthoritativeWbsPayablesToTestAccounting({
    config:runtime,observation,companyCode:'WBPA',dateFrom:'2026-01-01',dateTo:'2026-12-31',
    fetcher:async()=>({ok:true,status:201,headers:{get:()=> 'application/json'},json:async()=>({ok:true,data:{status:'WBS_TEST_PAYABLE_IMPORT_COMPLETE',test_only:true,imported_count:1,replayed_count:0,posted_count:1,failed_count:0,production:true}})})
  });
  assert.equal(unsafe.code,'WBS_TEST_IMPORT_PROTOCOL');
}

testImportClientContract().then(()=>console.log('authoritative WBS live-pilot bridge: read-only observation plus explicit TEST ONLY import contract passed')).catch(error=>{console.error(error);process.exitCode=1;});

async function testBankImportClientContract(){
  const runtime=accountingApiConfig({__REFS_ACCOUNTING_API__:{...config,wbsTestImportMode:'ENABLED'}});
  const bankObservation={...observation,tool:'list_bank_transactions',provider_content_sha256:'d'.repeat(64),observation_hash:`sha256:${'e'.repeat(64)}`,rows:[{source_record_hash:`sha256:${'f'.repeat(64)}`,accounting_date:'2026-08-18',currency:'USD',amount:'12.3000',direction:'CREDIT',status:'Y'}]};
  const identity={observationHash:bankObservation.observation_hash,periodId,companyCode:'WBPA',dateFrom:'2026-01-01',dateTo:'2026-12-31',limit:10};
  const expectedKey=await wbsTestBankImportIdempotencyKey(identity);
  assert.match(expectedKey,/^wbs-test-bank-[0-9a-f]{64}$/);assert.equal(await wbsTestBankImportIdempotencyKey(identity),expectedKey);
  const data={wbs_controlled_test_bank_import_id:'00000001-0000-4000-8000-000000000001',reconciliation_id:'00000002-0000-4000-8000-000000000001',bank_source_ids:['00000003-0000-4000-8000-000000000001'],bank_account_ref:'WBS_TEST_BANK',statement_ending_date:'2026-08-18',transaction_count:1,status:'DRAFT',provenance_mode:'CONTROLLED_TEST_UNSIGNED',test_only:true,idempotent:false};
  let request;
  const result=await importAuthoritativeWbsBankToTestReconciliation({config:runtime,observation:bankObservation,companyCode:'WBPA',dateFrom:'2026-01-01',dateTo:'2026-12-31',fetcher:async(url,options)=>{request={url,options};return {ok:true,status:201,headers:{get:name=>name==='content-type'?'application/json':null},json:async()=>({ok:true,data})};}});
  assert.equal(result.ok,true,JSON.stringify(result));assert.equal(result.idempotent,false);
  assert.match(request.url,/\/api\/v1\/entities\/11111111-1111-4111-8111-111111111111\/wbs\/test-import\/bank-transactions$/);
  assert.equal(request.options.method,'POST');assert.equal(request.options.cache,'no-store');assert.equal(request.options.headers['idempotency-key'],expectedKey);assert.deepEqual(JSON.parse(request.options.body),{periodId,companyCode:'WBPA',dateFrom:'2026-01-01',dateTo:'2026-12-31',limit:10});
  const replay=await importAuthoritativeWbsBankToTestReconciliation({config:runtime,observation:bankObservation,companyCode:'WBPA',dateFrom:'2026-01-01',dateTo:'2026-12-31',fetcher:async()=>({ok:true,status:200,headers:{get:()=> 'application/json'},json:async()=>({ok:true,data:{...data,idempotent:true}})})});
  assert.equal(replay.ok,true,JSON.stringify(replay));assert.equal(replay.idempotent,true);assert.equal(replay.data.idempotent,true);
  const unsafe=await importAuthoritativeWbsBankToTestReconciliation({config:runtime,observation:bankObservation,companyCode:'WBPA',dateFrom:'2026-01-01',dateTo:'2026-12-31',fetcher:async()=>({ok:true,status:201,headers:{get:()=> 'application/json'},json:async()=>({ok:true,data:{...data,production:true}})})});
  assert.equal(unsafe.code,'WBS_TEST_BANK_IMPORT_PROTOCOL');
}

testBankImportClientContract().then(()=>console.log('authoritative WBS live-pilot bridge: explicit TEST ONLY Bank reconciliation import contract passed')).catch(error=>{console.error(error);process.exitCode=1;});
