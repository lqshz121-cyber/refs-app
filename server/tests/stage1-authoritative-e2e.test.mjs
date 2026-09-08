import test from 'node:test';
import assert from 'node:assert/strict';
import {stage1AuthoritativeE2eConfig,verifyStage1AuthoritativeE2e,parseStage1BuildStamp} from '../runtime/verify-stage1-authoritative-e2e.mjs';
import {renderBuildChannelStamp} from '../../scripts/runtime-config-lib.mjs';
import {readFile} from 'node:fs/promises';
import {createAccountingApi} from '../api/accounting-http.mjs';
import {PostgresAccountingKernel} from '../runtime/kernel-repository.mjs';
import contract from '../api/openapi-accounting.json' with {type:'json'};

const id=value=>`${value}`.padStart(8,'0')+'-0000-4000-8000-000000000001';
const hashes={receipt:`sha256:${'b'.repeat(64)}`,provider:`sha256:${'c'.repeat(64)}`,evidence:`sha256:${'d'.repeat(64)}`,population:`sha256:${'e'.repeat(64)}`,signedPackage:`sha256:${'f'.repeat(64)}`,signedReceipt:`sha256:${'1'.repeat(64)}`};
const scenario={tenantId:id(1),entityId:id(2),periodId:id(3),wbsInboundRowId:id(4),reviewEvidenceId:id(5),providerSignedAdmissionId:id(12),sourceRecordId:'WBS-PAYABLE-001',sourceVersion:'17',receiptHash:hashes.receipt,providerReceiptHash:hashes.provider,evidenceHash:hashes.evidence,signedPackageHash:hashes.signedPackage,signedReceiptHash:hashes.signedReceipt,attachmentId:id(6),attachmentObjectVersionId:'object-version-17',attachmentSha256:'a'.repeat(64),journalEntryId:id(8),asOf:'2026-08-31',expected:{debitAccountCode:'610000',creditAccountCode:'291001'}};
const environment={REFS_STAGING_API_BASE_URL:'https://api.staging.example',REFS_STAGING_WEB_ORIGIN:'https://web.staging.example',REFS_RELEASE_SHA:'a'.repeat(40),REFS_STAGE1_E2E_READ_ACCESS_TOKEN:'header.payload.signature'};
const sourceDocumentId=id(9),businessDocumentId=id(10);
const ok=(data,scope)=>({status:200,headers:new Headers({'cache-control':'no-store'}),json:async()=>({ok:true,data,...(scope?{scope}:{})}),text:async()=>JSON.stringify({ok:true,data,...(scope?{scope}:{})})});
const releaseOk=(status,release='a'.repeat(40))=>({status:200,headers:new Headers({'cache-control':'no-store'}),json:async()=>({ok:true,status,release}),text:async()=>`window.__BUILD=${JSON.stringify({sha:release,time:'2026-09-06 14:18 UTC'})};\n${renderBuildChannelStamp({})}`});

const evidence=()=>({
  schema_version:'WBS_PAYABLE_ACCEPTANCE_EVIDENCE_V1',scope:{tenant_id:scenario.tenantId,entity_id:scenario.entityId,period_id:scenario.periodId},
  source:{wbs_inbound_row_id:scenario.wbsInboundRowId,source_record_id:scenario.sourceRecordId,source_version:scenario.sourceVersion,receipt_hash:scenario.receiptHash,provider_receipt_hash:scenario.providerReceiptHash,evidence_hash:scenario.evidenceHash,source_document_id:sourceDocumentId,environment:'PRODUCTION',source_module:'BGDATA.payable',ingestion_kind:'TRANSACTION_CANDIDATE',provider_signed_payable_admission_id:scenario.providerSignedAdmissionId,signature_issuer:'provider',signature_key_id:'key-1',signature_algorithm:'Ed25519',signed_package_hash:scenario.signedPackageHash,signed_receipt_hash:scenario.signedReceiptHash,signed_at:'2026-08-01T00:00:00Z'},
  review:{review_evidence_id:scenario.reviewEvidenceId,reviewed_by:'wbs-reviewer',reviewed_at:'2026-08-01T00:00:00Z',attachment_ids:[scenario.attachmentId]},
  attachments:[{attachment_id:scenario.attachmentId,content_hash:`sha256:${scenario.attachmentSha256}`,storage_version:scenario.attachmentObjectVersionId,finalization_status:'VERIFIED_CLEAN',scan_status:'CLEAN',verified_at:'2026-08-01T00:00:00Z',bound_by:'attachment-binder'}],
  draft:{draft_evidence_id:id(11),business_document_id:businessDocumentId,journal_entry_id:scenario.journalEntryId,created_by:'maker',created_at:'2026-08-02T00:00:00Z'},
  business_document:{business_document_id:businessDocumentId,source_document_id:sourceDocumentId,document_kind:'AP_BILL',currency:'USD',gross_amount:'89.1250',open_balance:'89.1250',status:'OPEN',posted_journal_entry_id:scenario.journalEntryId,counterparty_ref:'VENDOR-1',counterparty_name:'Vendor One'},
  journal:{journal_entry_id:scenario.journalEntryId,status:'POSTED',revision:4,created_by:'maker',reviewed_by:'journal-reviewer',approved_by:'approver',posted_by:'poster',posted_at:'2026-08-03T00:00:00Z'},
});
const journal=()=>({status:'POSTED',journal_entry_id:scenario.journalEntryId,lines:[
  {account_code:'610000',debit_amount:'89.1250',credit_amount:'0.0000',source_document_ids:[sourceDocumentId]},
  {account_code:'291001',debit_amount:'0.0000',credit_amount:'89.1250',source_document_ids:[sourceDocumentId]},
]});
const ledgerRows=()=>journal().lines.map((line,index)=>({...line,journal_entry_id:scenario.journalEntryId,ledger_line_id:id(20+index)}));
const statements=()=>journal().lines.map(line=>({statement_type:'TRIAL_BALANCE',account_code:line.account_code,journal_entry_ids:[scenario.journalEntryId],source_document_ids:[sourceDocumentId]}));
const aging=()=>[{business_document_id:businessDocumentId,source_document_id:sourceDocumentId,source_payload_hash:scenario.receiptHash,posted_journal_entry_id:scenario.journalEntryId,gross_amount:'89.1250',open_balance:'89.1250'}];
const agingScope=()=>({entity_id:scenario.entityId,period_id:scenario.periodId,document_kind:'AP_BILL',as_of_date:scenario.asOf,snapshot_id:id(30),snapshot_version:1,snapshot_hash:`sha256:${'2'.repeat(64)}`,counterparty_ref:'VENDOR-1',counterparty_name:'Vendor One',currency:'USD',total_count:1,limit:200,offset:0});
const page=(rows=ledgerRows(),extra={})=>({schema_version:'GENERAL_LEDGER_SNAPSHOT_PAGE_V1',scope:{tenant_id:scenario.tenantId,entity_id:scenario.entityId,period_id:scenario.periodId},limit:200,offset:0,total_count:rows.length,read_count:rows.length,population_complete:true,population_hash:hashes.population,snapshot_token:hashes.population,rows,...extra});

function fetcherFor(overrides={}){
  const calls=[];
  const fetcher=async(url,options)=>{
    calls.push({url,options});
    if(url.endsWith('/health/live'))return releaseOk('live',overrides.apiRelease);
    if(url.endsWith('/health/ready'))return releaseOk('ready',overrides.apiRelease);
    if(url.endsWith('/refs-build.js'))return overrides.buildResponse||releaseOk('live',overrides.webRelease);
    if(url.includes('/acceptance-evidence'))return ok(overrides.evidence??evidence());
    if(url.includes('/journal-entries/'))return ok(overrides.journal??journal());
    if(url.includes('/general-ledger/snapshot-entries'))return ok(overrides.ledgerPage?overrides.ledgerPage(url):page(overrides.ledger??ledgerRows()));
    if(url.includes('/ap/aging-detail'))return overrides.agingPage?overrides.agingPage(url):ok(overrides.aging??aging(),overrides.agingScope??agingScope());
    if(url.includes('/reports/financial-statements'))return ok(overrides.statements??statements());
    throw new Error(`unexpected URL ${url}`);
  };
  return {calls,fetcher};
}

test('Stage 1 parses the emitted build channel without executing deployment JavaScript',()=>{
  const base=`window.__BUILD=${JSON.stringify({sha:'a'.repeat(40),time:'2026-09-06 14:18 UTC'})};\n`;
  assert.deepEqual(parseStage1BuildStamp(base+renderBuildChannelStamp({})),{sha:'a'.repeat(40),time:'2026-09-06 14:18 UTC',channel:'AUTHORITATIVE',authoritative:true});
  assert.equal(parseStage1BuildStamp(`window.__BUILD={"sha":"${'a'.repeat(40)}","channel":"AUTHORITATIVE","authoritative":true};`).authoritative,true);
  assert.throws(()=>parseStage1BuildStamp(base+'globalThis.__stage1Executed=true;'),/unsupported trailing content/);assert.equal(globalThis.__stage1Executed,undefined);
});

test('Stage 1 rejects missing or demo channel stamps before business reads',async()=>{
  for(const suffix of ['',renderBuildChannelStamp({REFS_PUBLIC_RUNTIME_MODE:'LOCAL_MOCK'})]){
    const {calls,fetcher}=fetcherFor({buildResponse:{...releaseOk('live'),text:async()=>`window.__BUILD={"sha":"${'a'.repeat(40)}"};\n${suffix}`}});
    await assert.rejects(()=>verifyStage1AuthoritativeE2e({config:stage1AuthoritativeE2eConfig(environment,scenario),fetcher}),/build stamp is not AUTHORITATIVE/);
    assert.equal(calls.length,3);assert.ok(calls.every(call=>!call.url.includes('/api/v1/')));
  }
});

test('Stage 1 refuses incomplete, placeholder or structurally false coordinates before HTTP',()=>{
  assert.throws(()=>stage1AuthoritativeE2eConfig(environment,{...scenario,journalEntryId:'not-a-uuid'}),/journalEntryId must be a UUID/);
  assert.throws(()=>stage1AuthoritativeE2eConfig(environment,{...scenario,attachmentObjectVersionId:'pending:123'}),/immutable object version/);
  assert.throws(()=>stage1AuthoritativeE2eConfig(environment,{...scenario,providerReceiptHash:'c'.repeat(64)}),/providerReceiptHash must be/);
  assert.throws(()=>stage1AuthoritativeE2eConfig(environment,{...scenario,signedReceiptHash:'1'.repeat(64)}),/signedReceiptHash must be/);
  assert.throws(()=>stage1AuthoritativeE2eConfig({...environment,REFS_STAGE1_E2E_READ_ACCESS_TOKEN:'replace-me-with-a-real-token'},scenario),/placeholder/);
});

test('Stage 1 proves one exact retained Payable through JE, GL, AP Aging and Trial Balance',async()=>{
  const {calls,fetcher}=fetcherFor(),result=await verifyStage1AuthoritativeE2e({config:stage1AuthoritativeE2eConfig(environment,scenario),fetcher});
  assert.equal(result.ok,true);assert.equal(result.journalEntryId,scenario.journalEntryId);assert.equal(calls.length,8);
  assert.ok(calls.every(call=>call.options.method==='GET'));assert.ok(calls.filter(call=>call.url.includes('/api/v1/')).every(call=>call.options.headers.authorization==='Bearer header.payload.signature'));
  assert.ok(calls.some(call=>call.url.includes('/acceptance-evidence')));assert.ok(calls.some(call=>call.url.includes('/ap/aging-detail?')&&call.url.includes(`periodId=${scenario.periodId}`)));
});

test('Stage 1 follows the immutable GL snapshot token until the complete population',async()=>{
  const fillers=Array.from({length:200},(_,index)=>({journal_entry_id:id(100+index),ledger_line_id:id(400+index)}));let pageCalls=0;
  const {calls,fetcher}=fetcherFor({ledgerPage:url=>{pageCalls+=1;const query=new URL(url).searchParams,offset=Number(query.get('offset'));if(offset===0)return page(fillers,{total_count:202,read_count:200,population_complete:false});assert.equal(query.get('snapshotToken'),hashes.population);return page(ledgerRows(),{offset:200,total_count:202,read_count:2,population_complete:true});}});
  assert.equal((await verifyStage1AuthoritativeE2e({config:stage1AuthoritativeE2eConfig(environment,scenario),fetcher})).ok,true);assert.equal(pageCalls,2);
  assert.ok(calls.some(call=>call.url.includes('offset=200')&&call.url.includes(encodeURIComponent(hashes.population))));
});

test('Stage 1 rejects duplicated stable row identities across paged GL and AP Aging reads',async()=>{
  const ledgerFillers=Array.from({length:200},(_,index)=>({journal_entry_id:id(100+index),ledger_line_id:id(400+index)}));
  await assert.rejects(()=>verifyStage1AuthoritativeE2e({config:stage1AuthoritativeE2eConfig(environment,scenario),fetcher:fetcherFor({ledgerPage:url=>{
    const offset=Number(new URL(url).searchParams.get('offset'));
    return offset===0?page(ledgerFillers,{total_count:202,read_count:200,population_complete:false}):page([ledgerFillers[0],ledgerRows()[0]],{offset:200,total_count:202,read_count:2,population_complete:true});
  }}).fetcher}),/repeated a ledger line across pages/);

  const agingFillers=[aging()[0],...Array.from({length:199},(_,index)=>({...aging()[0],business_document_id:id(500+index)}))];
  await assert.rejects(()=>verifyStage1AuthoritativeE2e({config:stage1AuthoritativeE2eConfig(environment,scenario),fetcher:fetcherFor({agingPage:url=>{
    const offset=Number(new URL(url).searchParams.get('offset'));
    return offset===0?ok(agingFillers,{...agingScope(),total_count:201}):ok(aging(),{...agingScope(),total_count:201,offset:200});
  }}).fetcher}),/repeated a business document across pages/);
});

test('Stage 1 rejects drifted signed or attachment evidence and duplicate journal actors',async()=>{
  const wrongSigned=evidence();wrongSigned.source.signed_receipt_hash=`sha256:${'9'.repeat(64)}`;
  await assert.rejects(()=>verifyStage1AuthoritativeE2e({config:stage1AuthoritativeE2eConfig(environment,scenario),fetcher:fetcherFor({evidence:wrongSigned}).fetcher}),/exact retained Ed25519 admission/);
  const wrongAttachment=evidence();wrongAttachment.attachments[0].storage_version='other-version';
  await assert.rejects(()=>verifyStage1AuthoritativeE2e({config:stage1AuthoritativeE2eConfig(environment,scenario),fetcher:fetcherFor({evidence:wrongAttachment}).fetcher}),/attachment version or hash/);
  const badSod=evidence();badSod.journal.posted_by=badSod.journal.approved_by;
  await assert.rejects(()=>verifyStage1AuthoritativeE2e({config:stage1AuthoritativeE2eConfig(environment,scenario),fetcher:fetcherFor({evidence:badSod}).fetcher}),/four distinct retained actors/);
});

test('Stage 1 rejects unrelated POSTED text and missing exact JE or GL lineage',async()=>{
  await assert.rejects(()=>verifyStage1AuthoritativeE2e({config:stage1AuthoritativeE2eConfig(environment,scenario),fetcher:fetcherFor({journal:{journal_entry_id:scenario.journalEntryId,status:'DRAFT',note:'POSTED',lines:journal().lines}}).fetcher}),/scenario POSTED journal/);
  await assert.rejects(()=>verifyStage1AuthoritativeE2e({config:stage1AuthoritativeE2eConfig(environment,scenario),fetcher:fetcherFor({ledger:[]}).fetcher}),/General Ledger lacks the exact debit line/);
});

test('Stage 1 rejects empty AP Aging and Trial Balance responses',async()=>{
  await assert.rejects(()=>verifyStage1AuthoritativeE2e({config:stage1AuthoritativeE2eConfig(environment,scenario),fetcher:fetcherFor({aging:[],agingScope:{...agingScope(),total_count:0}}).fetcher}),/AP Aging lacks the exact open Bill/);
  await assert.rejects(()=>verifyStage1AuthoritativeE2e({config:stage1AuthoritativeE2eConfig(environment,scenario),fetcher:fetcherFor({statements:[]}).fetcher}),/Trial Balance lacks the exact debit/);
});

test('Stage 1 rejects an AP Aging snapshot with a drifted period or population',async()=>{
  await assert.rejects(()=>verifyStage1AuthoritativeE2e({config:stage1AuthoritativeE2eConfig(environment,scenario),fetcher:fetcherFor({agingScope:{...agingScope(),period_id:id(31)}}).fetcher}),/snapshot scope does not match/);
  await assert.rejects(()=>verifyStage1AuthoritativeE2e({config:stage1AuthoritativeE2eConfig(environment,scenario),fetcher:fetcherFor({agingScope:{...agingScope(),total_count:2}}).fetcher}),/snapshot metadata is invalid|no paging progress/);
});

test('Stage 1 fails before business reads when the API and web release differ',async()=>{
  const {calls,fetcher}=fetcherFor({apiRelease:'b'.repeat(40)});
  await assert.rejects(()=>verifyStage1AuthoritativeE2e({config:stage1AuthoritativeE2eConfig(environment,scenario),fetcher}),/release does not match/);
  assert.equal(calls.length,3);assert.ok(calls.every(call=>!call.url.includes('/api/v1/')));
});

test('Stage 1 acceptance projection is complete, exact, privilege-gated and reversible',async()=>{
  const [up,down]=await Promise.all([
    readFile(new URL('../db/migrations/329_wbs_payable_acceptance_evidence_read.sql',import.meta.url),'utf8'),
    readFile(new URL('../db/migrations/down/329_wbs_payable_acceptance_evidence_read.sql',import.meta.url),'utf8'),
  ]);
  for(const token of ['refs_read_wbs_payable_acceptance_evidence',"'WBS.AUTOREC.VIEW'","'AP.VIEW'","imp.environment='PRODUCTION'","sr.source_module='BGDATA.payable'","sr.ingestion_kind='TRANSACTION_CANDIDATE'","wbs_provider_signed_payable_admission pa","pa.algorithm='Ed25519'","a.content_hash=b.attachment_content_hash","a.storage_version=b.attachment_storage_version","a.finalization_status='VERIFIED_CLEAN'","j.status='POSTED'","bd.posted_journal_entry_id=d.journal_entry_id","REVOKE ALL","GRANT EXECUTE"])assert.ok(up.includes(token),token);
  for(const secret of ["'payload_ref'","'storage_ref'","'raw_payload'","'access_token'","'detached_signature'"])assert.equal(up.includes(secret),false,secret);
  assert.match(down,/DROP FUNCTION refs_read_wbs_payable_acceptance_evidence/);
});

test('Stage 1 acceptance repository and HTTP route preserve exact authenticated scope',async()=>{
  const projected={schema_version:'WBS_PAYABLE_ACCEPTANCE_EVIDENCE_V1'},calls=[],kernel=Object.create(PostgresAccountingKernel.prototype);
  kernel.inSession=async work=>work({query:async(text,values)=>(calls.push({text,values}),{rowCount:1,rows:[{result:projected}]})});
  assert.deepEqual(await kernel.getWbsPayableAcceptanceEvidence({tenantId:scenario.tenantId,entityId:scenario.entityId,reviewEvidenceId:scenario.reviewEvidenceId}),projected);
  assert.match(calls[0].text,/refs_read_wbs_payable_acceptance_evidence/);assert.deepEqual(calls[0].values,[scenario.tenantId,scenario.entityId,scenario.reviewEvidenceId]);
  const seen=[],api=createAccountingApi({authenticate:async()=>({trusted:true,tenantId:scenario.tenantId,actorId:'acceptance-reader'}),kernelFactory:async()=>({getWbsPayableAcceptanceEvidence:async input=>(seen.push(input),projected)})}),url=`/api/v1/entities/${scenario.entityId}/wbs/inbound/payables/reviews/${scenario.reviewEvidenceId}/acceptance-evidence`;
  const response=await api({method:'GET',url,headers:{},body:null});assert.equal(response.status,200);assert.equal(response.headers['cache-control'],'no-store');assert.deepEqual(response.body,{ok:true,data:projected});assert.deepEqual(seen,[{tenantId:scenario.tenantId,entityId:scenario.entityId,reviewEvidenceId:scenario.reviewEvidenceId}]);
  assert.equal((await api({method:'GET',url,headers:{'if-match':'"0"'},body:null})).status,400);assert.equal((await api({method:'GET',url,headers:{},body:{}})).status,400);assert.equal((await api({method:'GET',url:`${url}?limit=1`,headers:{},body:null})).status,400);
});

test('OpenAPI publishes the exact no-store acceptance read',()=>{
  const operation=contract.paths['/entities/{entityId}/wbs/inbound/payables/reviews/{reviewEvidenceId}/acceptance-evidence']?.get;
  assert.equal(operation.operationId,'getWbsPayableAcceptanceEvidence');assert.equal(operation.responses['200'].headers['Cache-Control'].schema.const,'no-store');
  assert.deepEqual(operation.parameters.map(parameter=>parameter.$ref||parameter.name),['#/components/parameters/EntityId','reviewEvidenceId']);assert.match(operation.description,/four distinct Journal actors/);assert.match(operation.description,/no raw payload/);
});
