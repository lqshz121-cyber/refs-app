import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {createAccountingApi} from '../api/accounting-http.mjs';

const up=await readFile(new URL('../db/migrations/100_wbs_payable_exact_attachment_binding.sql',import.meta.url),'utf8');
const down=await readFile(new URL('../db/migrations/down/100_wbs_payable_exact_attachment_binding.sql',import.meta.url),'utf8');
const candidateRead=await readFile(new URL('../db/migrations/099_wbs_payable_review_candidate_read.sql',import.meta.url),'utf8');

test('migration freezes exact WBS row and immutable attachment version without accounting writes',()=>{
  assert.match(up,/CREATE TABLE wbs_payable_attachment_binding/);
  for(const field of ['wbs_inbound_row_id','source_version','receipt_hash','provider_receipt_hash','evidence_hash','attachment_content_hash','attachment_storage_version'])assert.match(up,new RegExp(field));
  assert.match(up,/UNIQUE\(tenant_id,entity_id,attachment_id\)/);
  assert.match(up,/wbs_payable_attachment_binding_append_only/);
  assert.match(up,/refs_assert_scope\(p_tenant,p_entity,'WBS\.PAYABLE\.REVIEW'\)/);
  assert.match(up,/refs_assert_scope\(p_tenant,p_entity,'AP\.VIEW'\)/);
  assert.match(up,/environment='PRODUCTION'/);
  assert.match(up,/wbs_snapshot_delivery_attestation/);
  assert.match(up,/source_module='BGDATA\.payable'/);
  assert.match(up,/ingestion_kind='TRANSACTION_CANDIDATE'/);
  assert.match(up,/finalization_status='VERIFIED_CLEAN'/);
  assert.match(up,/event_type='ATTACHMENT_FINALIZED'/);
  assert.match(up,/WBS Payable attachment binding SoD violation/);
  assert.match(up,/WBS_PAYABLE_ATTACHMENT_BOUND/);
  assert.match(up,/wbs_payable_review_attachment_exact_binding/);
  assert.doesNotMatch(candidateRead,/FROM public\.attachment\s+candidate/i);
  assert.match(candidateRead,/refs_read_wbs_payable_attachment_choices/);
  assert.match(candidateRead,/SELECT '\[\]'::jsonb,0::integer/);
  for(const exact of [
    /b\.wbs_inbound_row_id=p_row/,/b\.source_version=p_source_version/,/b\.receipt_hash=p_receipt_hash/,
    /b\.provider_receipt_hash=p_provider_receipt_hash/,/b\.evidence_hash=p_evidence_hash/,
    /a\.content_hash=b\.attachment_content_hash/,/a\.storage_version=b\.attachment_storage_version/,
    /a\.finalization_status='VERIFIED_CLEAN'/,/a\.scan_status='CLEAN'/
  ])assert.match(up,exact);
  for(const forbidden of [/INSERT INTO raw_event/i,/INSERT INTO source_document/i,/INSERT INTO staging_item/i,/INSERT INTO business_document/i,/INSERT INTO journal_entry/i,/INSERT INTO journal_line/i,/INSERT INTO ledger_line/i])assert.doesNotMatch(up,forbidden);
  assert.match(down,/Cannot remove retained WBS Payable attachment bindings/);
  assert.match(down,/SELECT '\[\]'::jsonb,0::integer/);
});

test('HTTP binding derives identity and remains non-actionable',async()=>{
  const tenantId=randomUUID(),entityId=randomUUID(),rowId=randomUUID(),attachmentId=randomUUID(),seen=[];
  const hash=letter=>`sha256:${letter.repeat(64)}`;
  const api=createAccountingApi({authenticate:async()=>({trusted:true,tenantId,actorId:'independent-binder'}),kernelFactory:async()=>({bindWbsPayableAttachment:async request=>(seen.push(request),{wbs_payable_attachment_binding_id:randomUUID(),wbs_inbound_row_id:rowId,attachment_id:attachmentId,status:'BOUND_EVIDENCE_ONLY',revision:0,idempotent:false,can_review:false,can_create_draft:false,can_approve:false,can_post:false})})});
  const body={attachmentId,expectedSourceVersion:'snapshot:payable-row-1',expectedReceiptHash:hash('a'),expectedProviderReceiptHash:hash('b'),expectedEvidenceHash:hash('c'),expectedAttachmentContentHash:hash('d'),expectedAttachmentStorageVersion:'object-version-1',reason:'Bind exact clean invoice evidence to one signed payable row'};
  const path=`/api/v1/entities/${entityId}/wbs/inbound/payables/${rowId}/attachments/bindings`;
  const created=await api({method:'POST',url:path,headers:{'Idempotency-Key':'wbs-payable-bind-http-0001','If-Match':'"0"'},body});
  assert.equal(created.status,201);assert.equal(created.headers.etag,'"0"');
  assert.deepEqual(seen,[{tenantId,entityId,wbsInboundRowId:rowId,...body,expectedRevision:0,idempotencyKey:'wbs-payable-bind-http-0001'}]);
  assert.deepEqual({review:created.body.data.can_review,draft:created.body.data.can_create_draft,approve:created.body.data.can_approve,post:created.body.data.can_post},{review:false,draft:false,approve:false,post:false});
  assert.equal((await api({method:'POST',url:path,headers:{'Idempotency-Key':'wbs-payable-bind-http-0002'},body})).status,428);
  assert.equal((await api({method:'POST',url:path,headers:{'Idempotency-Key':'wbs-payable-bind-http-0003','If-Match':'"0"'},body:{...body,entityId}})).body.code,'IDENTITY_FIELD_FORBIDDEN');
  assert.equal((await api({method:'POST',url:path,headers:{'Idempotency-Key':'wbs-payable-bind-http-0004','If-Match':'"0"'},body:{...body,unexpected:'x'}})).body.code,'UNEXPECTED_FIELD');
  const unsafe=createAccountingApi({authenticate:async()=>({trusted:true,tenantId,actorId:'binder'}),kernelFactory:async()=>({bindWbsPayableAttachment:async()=>({status:'BOUND_EVIDENCE_ONLY',can_review:true,can_create_draft:false,can_approve:false,can_post:false})})});
  assert.equal((await unsafe({method:'POST',url:path,headers:{'Idempotency-Key':'wbs-payable-bind-http-0005','If-Match':'"0"'},body})).body.code,'WBS_PAYABLE_ATTACHMENT_BIND_RESULT_INVALID');
});
