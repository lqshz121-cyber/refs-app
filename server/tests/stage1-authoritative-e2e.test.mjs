import test from 'node:test';
import assert from 'node:assert/strict';
import {stage1AuthoritativeE2eConfig,verifyStage1AuthoritativeE2e} from '../runtime/verify-stage1-authoritative-e2e.mjs';

const id=(value)=>`${value}`.padStart(8,'0')+'-0000-4000-8000-000000000001';
const scenario={tenantId:id(1),entityId:id(2),periodId:id(3),wbsInboundRowId:id(4),reviewEvidenceId:id(5),attachmentId:id(6),attachmentObjectVersionId:id(7),attachmentSha256:'a'.repeat(64),journalEntryId:id(8),asOf:'2026-07-31',expected:{debitAccountCode:'610000',creditAccountCode:'220100'}};
const environment={REFS_STAGING_API_BASE_URL:'https://api.staging.example',REFS_STAGE1_E2E_READ_ACCESS_TOKEN:'header.payload.signature'};
const ok=(data)=>({status:200,headers:new Headers({'cache-control':'no-store'}),json:async()=>({ok:true,data})});

test('Stage 1 verifier refuses incomplete coordinates before it can call a deployment',()=>{
  assert.throws(()=>stage1AuthoritativeE2eConfig(environment,{...scenario,journalEntryId:'not-a-uuid'}),/journalEntryId must be a UUID/);
  assert.throws(()=>stage1AuthoritativeE2eConfig({...environment,REFS_STAGE1_E2E_READ_ACCESS_TOKEN:'replace-me-with-a-real-token'},scenario),/must not be a placeholder/);
});

test('Stage 1 verifier reads retained signed evidence only and checks every cross-source identifier',async()=>{
  const calls=[];const config=stage1AuthoritativeE2eConfig(environment,scenario);
  const result=await verifyStage1AuthoritativeE2e({config,fetcher:async(url,options)=>{calls.push({url,options});return ok({status:'POSTED',wbsInboundRowId:scenario.wbsInboundRowId,attachmentId:scenario.attachmentId,objectVersionId:scenario.attachmentObjectVersionId,content_sha256:scenario.attachmentSha256,journalEntryId:scenario.journalEntryId,periodId:scenario.periodId,accounts:['610000','220100']});}});
  assert.equal(result.ok,true);assert.equal(calls.length,5);assert.ok(calls.every(call=>call.options.method==='GET'));assert.ok(calls.every(call=>call.options.headers.authorization==='Bearer header.payload.signature'));
});

test('Stage 1 verifier fails closed when a retained evidence link is missing',async()=>{
  const config=stage1AuthoritativeE2eConfig(environment,scenario);
  await assert.rejects(()=>verifyStage1AuthoritativeE2e({config,fetcher:async()=>ok({status:'POSTED'})}),/WBS inbound row is absent/);
});
