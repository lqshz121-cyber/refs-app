import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {createAccountingApi} from '../api/accounting-http.mjs';

const migration=await readFile(new URL('../db/migrations/417_wbs_autorec_reverse_workflow.sql',import.meta.url),'utf8');
const down=await readFile(new URL('../db/migrations/down/417_wbs_autorec_reverse_workflow.sql',import.meta.url),'utf8');
const http=await readFile(new URL('../api/accounting-http.mjs',import.meta.url),'utf8');
const openapi=JSON.parse(await readFile(new URL('../api/openapi-accounting.json',import.meta.url),'utf8'));

test('AutoRec reverse migration is append-only, scoped, idempotent, and two-leg exact inverse',()=>{
  for(const token of ['wbs_autorec_reversal','BANK.AUTOREC.G11.REVERSE_DRAFT','BANK.AUTOREC.G11.REVERSE','REQUEST_REVERSE','COMPLETE_REVERSE','WBS_AUTOREC_REVERSAL','refs_request_wbs_autorec_reverse','refs_create_wbs_autorec_reverse_draft','refs_complete_wbs_autorec_reverse','idempotency_receipt','audit_event'])assert.match(migration,new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
  assert.match(migration,/status='POSTED'/);assert.match(migration,/original\.journal_type<>'AUTO'/);assert.match(migration,/credit_amount<>ol\.debit_amount/);assert.match(migration,/next_state='REVERSED'/);
  assert.match(down,/DROP TABLE IF EXISTS wbs_autorec_reversal/);assert.match(down,/DROP FUNCTION IF EXISTS refs_complete_wbs_autorec_reverse/);
});

test('AutoRec reverse HTTP routes are backend-only and documented for QB chatbox consumption',()=>{
  for(const token of ['reverse-request','reverse-drafts','reverse-complete','requestWbsAutoRecReverse','createWbsAutoRecReverseDraft','completeWbsAutoRecReverse'])assert.match(http,new RegExp(token));
  for(const [path,id] of [['/entities/{entityId}/wbs/auto-reconciliation/executions','executeWbsAutoRecExecution'],['/entities/{entityId}/wbs/auto-reconciliation/match-reviews/{reviewId}/reverse-request','requestWbsAutoRecReverse'],['/entities/{entityId}/wbs/auto-reconciliation/match-reviews/{reviewId}/reverse-drafts/{eventType}','createWbsAutoRecReverseDraft'],['/entities/{entityId}/wbs/auto-reconciliation/match-reviews/{reviewId}/reverse-complete','completeWbsAutoRecReverse']])assert.equal(openapi.paths[path].post.operationId,id);
});

test('AutoRec reverse HTTP commands forward trusted entity scope and stable idempotency',async()=>{
  const tenantId=randomUUID(),entityId=randomUUID(),reviewId=randomUUID(),calls=[];
  const api=createAccountingApi({authenticate:async()=>({trusted:true,tenantId,actorId:'reverse-maker'}),kernelFactory:async()=>({
    requestWbsAutoRecReverse:async args=>(calls.push(['request',args]),{command:'REQUEST_REVERSE',next_state:'REVERSE_DRAFT_REQUIRED',idempotent:false}),
    createWbsAutoRecReverseDraft:async args=>(calls.push(['draft',args]),{journal_type:'WBS_AUTOREC_REVERSAL',status:'DRAFT',idempotent:false}),
    completeWbsAutoRecReverse:async args=>(calls.push(['complete',args]),{command:'COMPLETE_REVERSE',next_state:'REVERSED',idempotent:false}),
    executeWbsAutoRecIntent:async args=>(calls.push(['execute',args]),{...args.intent,execution_receipt_id:randomUUID(),version:1,idempotent:false})
  })});
  const h={'Idempotency-Key':'autorec-reverse-0001'};
  let response=await api({method:'POST',url:`/api/v1/entities/${entityId}/wbs/auto-reconciliation/match-reviews/${reviewId}/reverse-request`,headers:h,body:{reason:'Reverse after approved exception review.'}});
  assert.equal(response.status,201);assert.equal(calls[0][1].tenantId,tenantId);assert.equal(calls[0][1].entityId,entityId);assert.equal(calls[0][1].reviewId,reviewId);
  response=await api({method:'POST',url:`/api/v1/entities/${entityId}/wbs/auto-reconciliation/match-reviews/${reviewId}/reverse-drafts/payable-incur`,headers:{'Idempotency-Key':'autorec-reverse-draft-01'},body:{originalJournalEntryId:randomUUID(),periodId:randomUUID(),reason:'Create payable reversal Draft from posted G11 evidence.'}});
  assert.equal(response.status,201);assert.equal(calls[1][1].eventType,'PAYABLE_INCUR');
  response=await api({method:'POST',url:`/api/v1/entities/${entityId}/wbs/auto-reconciliation/match-reviews/${reviewId}/reverse-complete`,headers:{'Idempotency-Key':'autorec-reverse-complete-01'},body:{reason:'Complete both posted AutoRec reversal legs.'}});
  assert.equal(response.status,201);assert.equal(calls[2][1].reviewId,reviewId);
});
