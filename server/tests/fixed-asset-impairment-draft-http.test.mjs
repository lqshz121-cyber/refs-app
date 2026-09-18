// P08 HTTP contract: the impairment Draft command — closed payload, assessment hash echoed, never posts.
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createAccountingApi} from '../api/accounting-http.mjs';
const tenantId=randomUUID(),entityId=randomUUID(),assessmentId=randomUUID(),registerId=randomUUID(),journalEntryId=randomUUID(),bindingId=randomUUID(),attachmentId=randomUUID();
const AH='sha256:'+'c'.repeat(64);
const H={'idempotency-key':'p08-http-key-1','content-type':'application/json'};
const url=`/api/v1/entities/${entityId}/fixed-assets/impairment-assessments/${assessmentId}/drafts`;
const body={journalNumber:'P08-IMP-1',journalDate:'2026-07-20',expectedAssessmentHash:AH,attachmentIds:[attachmentId],reason:'book the independently reviewed impairment'};
const receipt={schema_version:'FIXED_ASSET_IMPAIRMENT_DRAFT_V1',journal_entry_id:journalEntryId,fixed_asset_impairment_draft_binding_id:bindingId,
  impairment_assessment_evidence_id:assessmentId,fixed_asset_register_evidence_id:registerId,impairment_loss:'5000.0000',impairment_assessment_hash:AH,status:'DRAFT',revision:0,idempotent:false};
const api=kernel=>createAccountingApi({authenticate:async()=>({trusted:true,tenantId,actorId:'impmaker'}),kernelFactory:async()=>kernel});
const failing=code=>async()=>{const e=new Error('kernel');e.code=code;throw e;};

test('P08: impairment Draft is idempotent, hash-bound, closed, and maps kernel codes',async()=>{
  const observed=[];
  const a=api({createFixedAssetImpairmentDraft:async args=>(observed.push(args),receipt)});
  const r=await a({method:'POST',url,body,headers:H});
  assert.equal(r.status,201);assert.equal(r.headers.etag,'"0"');assert.equal(r.headers['cache-control'],'no-store');assert.deepEqual(r.body.data,receipt);
  assert.deepEqual(observed[0],{tenantId,entityId,impairmentAssessmentEvidenceId:assessmentId,journalNumber:'P08-IMP-1',journalDate:'2026-07-20',
    expectedAssessmentHash:AH,reason:'book the independently reviewed impairment',attachmentIds:[attachmentId],idempotencyKey:'p08-http-key-1'});
  assert.ok(!Object.keys(observed[0]).some(k=>/amount|loss/i.test(k)),'the command carries no amount: the loss comes from the assessment');
  assert.equal((await api({createFixedAssetImpairmentDraft:async()=>({...receipt,idempotent:true})})({method:'POST',url,body,headers:H})).status,200);
  for(const bad of [{...body,expectedAssessmentHash:'nope'},{...body,attachmentIds:[]},{...body,reason:'short'},{...body,journalNumber:''},
    {...body,journalDate:'2026-13-01'},{...body,impairmentLoss:'1.0000'}])
    assert.equal((await a({method:'POST',url,body:bad,headers:H})).status,400,JSON.stringify(bad).slice(0,70));
  const missing={...body};delete missing.reason;
  assert.equal((await a({method:'POST',url,body:missing,headers:H})).status,400);
  assert.equal((await a({method:'POST',url,body,headers:{'content-type':'application/json'}})).status,400,'Idempotency-Key required');
  assert.equal((await a({method:'POST',url,body,headers:{...H,'if-match':'"0"'}})).status,400);
  assert.equal((await a({method:'POST',url:`/api/v1/entities/${entityId}/fixed-assets/impairment-assessments/nope/drafts`,body,headers:H})).status,400);
  assert.equal((await api({createFixedAssetImpairmentDraft:failing('40001')})({method:'POST',url,body,headers:H})).status,412);
  for(const [code,status] of [['42501',403],['P0002',404],['23514',422],['23505',409],['55000',423]])
    assert.equal((await api({createFixedAssetImpairmentDraft:failing(code)})({method:'POST',url,body,headers:H})).status,status,code);
  assert.equal((await api({createFixedAssetImpairmentDraft:async()=>({...receipt,status:'POSTED'})})({method:'POST',url,body,headers:H})).status,502);
  assert.equal((await api({createFixedAssetImpairmentDraft:async()=>({...receipt,impairment_assessment_hash:'sha256:'+'d'.repeat(64)})})({method:'POST',url,body,headers:H})).status,502);
  assert.equal((await api({})({method:'POST',url,body,headers:H})).status,503);
});
