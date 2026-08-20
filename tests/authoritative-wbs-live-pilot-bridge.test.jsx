import assert from 'node:assert/strict';
import fs from 'node:fs';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {accountingApiConfig,importAuthoritativeWbsBankToTestReconciliation,importAuthoritativeWbsPayablesToTestAccounting,importAuthoritativeWbsTestRange,runAuthoritativeWbsTestBankMatch,runAuthoritativeWbsTestBankRangeWorkflow,wbsTestBankImportIdempotencyKey,wbsTestImportIdempotencyKey} from '../src/accounting-api.js';
import {AuthoritativeWbsLivePilotObservation,WBS_LIVE_PILOT_SURFACE_TOOLS,wbsLivePilotErrorGuidance} from '../src/authoritative-wbs-live-pilot-observation.jsx';

const periodId='22222222-2222-4222-8222-222222222222';
const config={entityId:'11111111-1111-4111-8111-111111111111',periodId,baseUrl:'https://accounting.example',getAccessToken:async()=> 'a'.repeat(48),scopePresentation:{entityLabel:'Test entity'}};
const render=tools=>renderToStaticMarkup(<AuthoritativeWbsLivePilotObservation config={config} tools={tools} fetcher={async()=>{throw new Error('SSR must not call WBS');}}/>);

const dashboard=render(WBS_LIVE_PILOT_SURFACE_TOOLS.dashboard);
for(const label of ['Payables','Bank transactions','AutoRec details','AutoRec banks','Journal entries'])assert.match(dashboard,new RegExp(`>${label}<`));
for(const boundary of ['READ ONLY','Unsigned pilot','Not admitted','Not postable','No demo or browser-stored data'])assert.match(dashboard,new RegExp(boundary,'i'));
for(const copy of ['Read-only WBS evidence for the signed-in company.','Select a scope and refresh.','No credentials, raw IDs, accounting records, or actions are exposed.'])assert.match(dashboard,new RegExp(copy.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')),'the default WBS observation must use concise user-facing language');
assert.match(dashboard,/>Refresh</);
for(const liveFact of ['Live WBS connection status','Last API read','Rows','Test entity','Period'])assert.match(dashboard,new RegExp(liveFact));
assert.doesNotMatch(dashboard,/<i>Status<\/i>|<i>Source<\/i>/,'status and source must not be repeated below the connection header');

const payables=render(WBS_LIVE_PILOT_SURFACE_TOOLS.payables);
assert.match(payables,/WBS read-only view:<\/b> Payables/);
for(const boundary of ['OPERATOR ATTESTED','UNSIGNED','EXCEPTION REVIEW REQUIRED','NOT POSTED','outside Raw, Staging, AP Bills, Journals, GL, and Posted totals'])assert.match(payables,new RegExp(boundary,'i'));
assert.match(payables,/Retain as exception evidence/);assert.match(payables,/Refresh retained evidence/);
const source=fs.readFileSync('src/authoritative-wbs-live-pilot-observation.jsx','utf8');
for(const copy of ['The selected WBS scope is read only.','cannot move to Review, Draft, or Post.','Loading WBS evidence','Loading up to ten sanitized rows for this read-only view.'])assert.match(source,new RegExp(copy.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')),'WBS scope and loading states must remain concise while preserving the no-action boundary');
assert.doesNotMatch(source,/Production API evidence for the signed-in company|accounting API sends the entered Provider-native scope|requesting at most ten sanitized rows from this fixed GET-only view|Live connection not checked/,'the WBS first screen must not expose transport-oriented prose');
const stylesheet=fs.readFileSync('index.html','utf8');
assert.match(source,/className="table-wrap authoritative-wbs-live-pilot-table"/,'the bounded live observation must retain a stable responsive table region');
assert.match(stylesheet,/\.authoritative-wbs-live-pilot-table\{max-height:60vh;overflow:auto;overscroll-behavior:contain;\}/,'the live observation table must not stretch the whole page at narrow widths');
assert.equal((source.match(/className="table-wrap authoritative-wbs-retained-evidence-table"/g)||[]).length,2,'both retained exception batch and row lists must use the shared responsive evidence region');
assert.match(stylesheet,/\.authoritative-wbs-retained-evidence-table\{max-height:60vh;overflow:auto;overscroll-behavior:contain;\}/,'retained exception evidence must not stretch the whole page at narrow widths');
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
assert.match(documents,/bill&&<AuthoritativeSecondaryDisclosure[\s\S]*AuthoritativeWbsLivePilotObservation/,'only AP may map the provider payables observation; AR must not fabricate a receivables view');
assert.match(documents,/AuthoritativeSecondaryDisclosure/,'secondary WBS evidence must remain available without extending the default AP page');
for(const host of ['authoritative-overview.jsx','authoritative-workspace.jsx','authoritative-bank-workspace.jsx','authoritative-journal-workspace.jsx']){
  assert.match(fs.readFileSync(`src/${host}`,'utf8'),/AuthoritativeSecondaryDisclosure/,`${host} must collapse secondary WBS evidence through the shared presentation component`);
}
const disclosure=fs.readFileSync('src/authoritative-secondary-disclosure.jsx','utf8');
assert.match(disclosure,/<details className="authoritative-secondary-disclosure"/);
assert.doesNotMatch(disclosure,/fetch|localStorage|sessionStorage|accounting-api|wbs-live-pilot/,'the disclosure component must own presentation only');

assert.doesNotMatch(payables,/Import to test AP and post|TEST ONLY/,'test import must not appear without explicit test-import configuration and a successful Payables observation');
assert.match(source,/config\?\.wbsTestImportMode==='ENABLED'&&\(scopedPayables\|\|scopedBank\)&&state\.phase==='READY'&&observation\?\.record_count>0/,'test import visibility must require explicit configuration and a successful nonempty Payables or Bank observation');
for(const label of ['Import to test AP and post','TEST ONLY','Imported','Replayed','Posted','Failed'])assert.match(source,new RegExp(label));
for(const label of ['Import to test Bank reconciliation','DRAFT RECONCILIATION','Transactions','Reconciliation ID'])assert.match(source,new RegExp(label));
assert.match(source,/importAuthoritativeWbsBankToTestReconciliation/,'the shared WBS surface must call the closed Bank test-import client for a Bank observation');
for(const label of ['Run 2026 H1 Bank workflow','2026 H1 monthly Bank reconciliations','Match','Adjustment','Clear','Signoff','Reopen','Replay'])assert.match(source,new RegExp(label));
for(const label of ['Run isolated July Bank Match','SERVER SELECTED','POSTED PAYMENT','ACTIVE MATCH','NO H1 RECONCILIATION CHANGE'])assert.match(source,new RegExp(label));

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

async function testRangeImportClientContract(){
  const runtime=accountingApiConfig({__REFS_ACCOUNTING_API__:{...config,wbsTestImportMode:'ENABLED'}}),requests=[];
  const monthData=index=>{const month=index+1,periodCode=`2026-${String(month).padStart(2,'0')}`,dateTo=new Date(Date.UTC(2026,month,0)).toISOString().slice(0,10),periodId=`${String(index+20).padStart(8,'0')}-0000-4000-8000-000000000001`,reconciliationId=`${String(index+30).padStart(8,'0')}-0000-4000-8000-000000000001`,sourceId=`${String(index+40).padStart(8,'0')}-0000-4000-8000-000000000001`;return {status:'WBS_TEST_MONTH_IMPORT_COMPLETE',period_code:periodCode,date_from:`${periodCode}-01`,date_to:dateTo,page_size:10,payables:{provider_page_count:124,h1_record_count:1237,record_count:1,imported_count:1,replayed_count:0,posted_count:1},bank:{provider_page_count:1,record_count:1,reconciliation:{bank_account_ref:`WBS_TEST_BANK_${periodCode.replace('-','_')}`,period_code:periodCode,period_id:periodId,reconciliation_id:reconciliationId,transaction_count:1},bank_source_ids:[sourceId]},test_only:true};};
  const result=await importAuthoritativeWbsTestRange({config:runtime,companyCode:'WBPA',dateFrom:'2026-01-01',dateTo:'2026-06-30',fetcher:async(url,options)=>{const index=requests.length;requests.push({url,options});return {ok:true,status:201,headers:{get:()=> 'application/json'},json:async()=>({ok:true,data:monthData(index)})};}});
  assert.equal(result.ok,true,JSON.stringify(result));assert.equal(requests.length,6);assert.equal(result.data.status,'WBS_TEST_H1_IMPORT_COMPLETE');assert.equal(result.data.payables.posted_count,6);assert.equal(result.data.bank.reconciliations.length,6);assert.ok(requests.every(request=>/\/wbs\/test-import\/range$/.test(request.url)&&/^wbs-test-month-[0-9a-f]{64}$/.test(request.options.headers['idempotency-key'])));assert.deepEqual(JSON.parse(requests[0].options.body),{companyCode:'WBPA',dateFrom:'2026-01-01',dateTo:'2026-01-31',pageSize:10,maxPages:1000});
  const resumedRequests=[];let completedMonth=0;const resumed=await importAuthoritativeWbsTestRange({config:runtime,companyCode:'WBPA',fetcher:async(_url,options)=>{resumedRequests.push(options);if(resumedRequests.length===1){const complete=monthData(0);return {ok:true,status:201,headers:{get:()=> 'application/json'},json:async()=>({ok:true,data:{...complete,status:'WBS_TEST_MONTH_IMPORT_PARTIAL',bank:{provider_page_count:201,record_count:2001,reconciliation:null,bank_source_ids:[],checkpoint:{stage_id:'00000999-0000-4000-8000-000000000001',next_chunk_index:20,chunk_count:21,transaction_count:2001}}}})};}const data=monthData(completedMonth++);return {ok:true,status:201,headers:{get:()=> 'application/json'},json:async()=>({ok:true,data})};}});assert.equal(resumed.ok,true,JSON.stringify(resumed));assert.equal(resumedRequests.length,7);assert.equal(resumedRequests[0].headers['idempotency-key'],resumedRequests[1].headers['idempotency-key']);
  let unsafeIndex=0;const unsafe=await importAuthoritativeWbsTestRange({config:runtime,companyCode:'WBPA',dateFrom:'2026-01-01',dateTo:'2026-06-30',fetcher:async()=>{const data=monthData(unsafeIndex++);return {ok:true,status:201,headers:{get:()=> 'application/json'},json:async()=>({ok:true,data:{...data,bank:{...data.bank,raw_provider_rows:[]}}})};}});assert.equal(unsafe.code,'WBS_TEST_RANGE_IMPORT_PROTOCOL');
}

testRangeImportClientContract().then(()=>console.log('authoritative WBS live-pilot bridge: paged H1 TEST ONLY import contract passed')).catch(error=>{console.error(error);process.exitCode=1;});

async function testH1BankWorkflowClientContract(){
  const runtime=accountingApiConfig({__REFS_ACCOUNTING_API__:{...config,wbsTestImportMode:'ENABLED'}}),reconciliations=[{bank_account_ref:'WBS_TEST_BANK_2026_01',period_code:'2026-01',period_id:'00000002-0000-4000-8000-000000000001',reconciliation_id:'00000001-0000-4000-8000-000000000001',transaction_count:161}],resultRow={status:'CONTROLLED_TEST_BANK_WORKFLOW_REOPENED',test_only:true,provenance_mode:'CONTROLLED_TEST_UNSIGNED',idempotent:false,reconciliation_id:'00000001-0000-4000-8000-000000000001',processed_count:161,matched_count:0,adjusted_count:161,cleared_count:161,journal_entry_ids:Array.from({length:161},(_,index)=>`${String(index+100).padStart(8,'0')}-0000-4000-8000-000000000001`),revision:167,snapshot_id:'00000003-0000-4000-8000-000000000001',snapshot_hash:`sha256:${'a'.repeat(64)}`},partial={status:'CONTROLLED_TEST_BANK_WORKFLOW_PARTIAL',test_only:true,provenance_mode:'CONTROLLED_TEST_UNSIGNED',idempotent:false,reconciliation_id:'00000001-0000-4000-8000-000000000001',total_count:161,processed_count:100,matched_count:0,adjusted_count:100,cleared_count:100,remaining_count:61,revision:100};
  const requests=[];const result=await runAuthoritativeWbsTestBankRangeWorkflow({config:runtime,reconciliations,fetcher:async(url,options)=>{requests.push({url,options});return {ok:true,status:200,headers:{get:()=> 'application/json'},json:async()=>({ok:true,data:requests.length===1?partial:resultRow})};}});
  assert.equal(result.ok,true,JSON.stringify(result));assert.equal(requests.length,2);assert.match(requests[0].url,/\/wbs\/test-import\/bank-workflow\/run$/);assert.match(requests[0].options.headers['idempotency-key'],/^wbs-test-bank-month-[0-9a-f]{64}$/);assert.equal(requests[1].options.headers['idempotency-key'],requests[0].options.headers['idempotency-key']);assert.deepEqual(JSON.parse(requests[0].options.body),{periodId:reconciliations[0].period_id,reconciliationId:reconciliations[0].reconciliation_id,reason:'Complete 2026 H1 controlled Bank workflow',maxItems:100});
  const replay=await runAuthoritativeWbsTestBankRangeWorkflow({config:runtime,reconciliations,fetcher:async(_url,options)=>{assert.equal(options.headers['idempotency-key'],requests[0].options.headers['idempotency-key']);return {ok:true,status:200,headers:{get:()=> 'application/json'},json:async()=>({ok:true,data:{...resultRow,idempotent:true}})};}});assert.equal(replay.ok,true,JSON.stringify(replay));assert.equal(replay.data.idempotent,true);
  const stalled=await runAuthoritativeWbsTestBankRangeWorkflow({config:runtime,reconciliations,fetcher:async()=>({ok:true,status:200,headers:{get:()=> 'application/json'},json:async()=>({ok:true,data:partial})})});assert.equal(stalled.code,'CONTROLLED_TEST_BANK_WORKFLOW_PROTOCOL');
}

testH1BankWorkflowClientContract().then(()=>console.log('authoritative WBS live-pilot bridge: H1 Bank workflow client closes the monthly UI path')).catch(error=>{console.error(error);process.exitCode=1;});

async function testIsolatedBankMatchClientContract(){
  const runtime=accountingApiConfig({__REFS_ACCOUNTING_API__:{...config,wbsTestImportMode:'ENABLED'}}),data={status:'CONTROLLED_TEST_BANK_MATCH_ACTIVE',test_only:true,provenance_mode:'CONTROLLED_TEST_UNSIGNED',idempotent:false,period_id:'00000001-0000-4000-8000-000000000001',bank_account_ref:'WBS_TEST_BANK',bank_source_id:'00000002-0000-4000-8000-000000000001',business_document_id:'00000003-0000-4000-8000-000000000001',payment_amount:'40.0000',currency:'USD',payment_occurrence_id:'00000004-0000-4000-8000-000000000001',journal_entry_id:'00000005-0000-4000-8000-000000000001',journal_line_id:'00000006-0000-4000-8000-000000000001',ledger_line_id:'00000007-0000-4000-8000-000000000001',bank_match_id:'00000008-0000-4000-8000-000000000001',revision:0};
  const requests=[];const fetcher=async(url,options)=>{requests.push({url,options});return {ok:true,status:requests.length===1?201:200,headers:{get:()=> 'application/json'},json:async()=>({ok:true,data:{...data,idempotent:requests.length>1}})};};
  const first=await runAuthoritativeWbsTestBankMatch({config:runtime,fetcher}),replay=await runAuthoritativeWbsTestBankMatch({config:runtime,fetcher});
  assert.equal(first.ok,true,JSON.stringify(first));assert.equal(replay.ok,true,JSON.stringify(replay));assert.equal(replay.data.idempotent,true);
  assert.match(requests[0].url,/\/wbs\/test-import\/bank-match\/run$/);assert.deepEqual(JSON.parse(requests[0].options.body),{reason:'Create one isolated TEST_ONLY posted-payment Bank Match'});assert.match(requests[0].options.headers['idempotency-key'],/^wbs-test-bank-match-[0-9a-f]{64}$/);assert.equal(requests[1].options.headers['idempotency-key'],requests[0].options.headers['idempotency-key']);
  const unsafe=await runAuthoritativeWbsTestBankMatch({config:runtime,fetcher:async()=>({ok:true,status:201,headers:{get:()=> 'application/json'},json:async()=>({ok:true,data:{...data,production:true}})})});assert.equal(unsafe.code,'CONTROLLED_TEST_BANK_MATCH_PROTOCOL');
}

testIsolatedBankMatchClientContract().then(()=>console.log('authoritative WBS live-pilot bridge: isolated TEST_ONLY Bank Match client is closed and replayable')).catch(error=>{console.error(error);process.exitCode=1;});
