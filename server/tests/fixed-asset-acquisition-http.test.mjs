import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createAccountingApi} from '../api/accounting-http.mjs';

const tenantId=randomUUID(),entityId=randomUUID(),assetId=randomUUID(),periodId=randomUUID();
const body={periodId,journalNumber:'FA-2026-001',journalDate:'2026-07-01',expectedSourceVersion:1,attachmentIds:[randomUUID()],reason:'Recognize reviewed acquisition'};
const receipt={schema_version:'FIXED_ASSET_ACQUISITION_DRAFT_V1',journal_entry_id:randomUUID(),status:'DRAFT',revision:0,idempotent:false,binding_id:randomUUID(),asset_id:assetId,source_document_id:randomUUID(),source_document_version:1,source_payload_hash:'sha256:'+'a'.repeat(64),source_link_id:randomUUID()};
const request={method:'POST',url:`/api/v1/entities/${entityId}/fixed-assets/register/${assetId}/acquisitions`,headers:{'idempotency-key':'asset-http-test-001'},body};
const setup=(action=async()=>receipt)=>{const calls=[];return {calls,api:createAccountingApi({authenticate:async()=>({trusted:true,tenantId,actorId:'maker'}),kernelFactory:async principal=>({createFixedAssetAcquisition:async args=>{calls.push({principal,args});return action(args);}})})};};

test('acquisition HTTP passes authenticated scope to native command and returns a Draft receipt and replay',async()=>{
 const {api,calls}=setup(async()=>({...receipt,idempotent:calls.length>1}));
 const first=await api(request),replay=await api(request);
 assert.equal(first.status,201);assert.equal(replay.status,200);assert.equal(first.headers.etag,'"0"');assert.equal(first.headers['cache-control'],'no-store');
 assert.deepEqual(calls[0].args,{...body,tenantId,entityId,assetId,idempotencyKey:request.headers['idempotency-key']});assert.equal(calls[0].principal.actorId,'maker');
 assert.equal(first.body.data.status,'DRAFT');assert.equal(replay.body.data.journal_entry_id,first.body.data.journal_entry_id);
});
test('acquisition HTTP rejects injected authority, amounts, stale-format versions and malformed commands before persistence',async()=>{
 const {api,calls}=setup();
 const invalidBodies=[...['tenantId','entityId','actorId','requestHash','lines','amount'].map(key=>({...body,[key]:'injected'})),...['1',0,-1,1.5,Number.MAX_SAFE_INTEGER+1].map(expectedSourceVersion=>({...body,expectedSourceVersion})),{...body,journalDate:'2026-02-30'},{...body,journalNumber:' padded '},{...body,attachmentIds:[]},{...body,attachmentIds:[body.attachmentIds[0],body.attachmentIds[0].toUpperCase()]},{...body,reason:'short'}];
 for(const invalid of invalidBodies)assert.equal((await api({...request,body:invalid})).status,400,JSON.stringify(invalid));
 assert.equal((await api({...request,headers:{}})).status,400);
 assert.equal((await api({...request,headers:{...request.headers,'if-match':'"1"'}})).status,400);
 assert.equal((await api({...request,url:request.url+'?actorId=other'})).status,400);
 assert.equal(calls.length,0);
});
test('acquisition HTTP preserves database denial and presents missing original evidence as a conflict',async()=>{
 for(const [code,status] of [['42501',403],['55006',500],['23514',422],['23505',409],['40001',503]]){
  const {api}=setup(async()=>{throw Object.assign(new Error('Database denied command'),{code});});assert.equal((await api(request)).status,status);
 }
 for(const [code,message,status,responseCode] of [
  ['40001','Acquisition source changed',412,'PRECONDITION_FAILED'],
  ['55006','Acquisition requires verified original payable evidence',409,'FIXED_ASSET_ORIGINAL_SOURCE_REQUIRED'],
  ['55006','Retained source attachment identity is ambiguous; acquisition evidence must be corrected',409,'FIXED_ASSET_ATTACHMENT_IDENTITY_AMBIGUOUS']]){
  const {api}=setup(async()=>{throw Object.assign(new Error(message),{code});});const response=await api(request);assert.equal(response.status,status);assert.equal(response.body.code,responseCode);assert.equal(response.headers['retry-after'],undefined);
 }
 const unauthenticated=createAccountingApi({authenticate:async()=>null,kernelFactory:async()=>{throw new Error('must not run');}});assert.equal((await unauthenticated(request)).status,401);
 const unavailable=createAccountingApi({authenticate:async()=>({trusted:true,tenantId,actorId:'maker'}),kernelFactory:async()=>({})});assert.equal((await unavailable(request)).status,503);
});
test('acquisition HTTP rejects malformed or cross-asset successful receipts',async()=>{
 for(const invalid of [null,{...receipt,asset_id:randomUUID()},{...receipt,status:'POSTED'},{...receipt,revision:1},{...receipt,source_document_version:2},{...receipt,can_post:true},{...receipt,source_payload_hash:'fake'}]){
  const {api}=setup(async()=>invalid);assert.equal((await api(request)).status,502);
 }
});
