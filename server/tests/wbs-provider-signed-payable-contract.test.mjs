import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createAccountingApi} from '../api/accounting-http.mjs';

const tenantId='11111111-1111-4111-8111-111111111111',entityId='22222222-2222-4222-8222-222222222222';

test('migration 111 freezes append-only nonce, TTL, raw hashes, server scope and one atomic inbound command',async()=>{
  const sql=await readFile(new URL('../db/migrations/111_wbs_provider_signed_payable_admission.sql',import.meta.url),'utf8');
  const down=await readFile(new URL('../db/migrations/down/111_wbs_provider_signed_payable_admission.sql',import.meta.url),'utf8');
  for(const token of ['CREATE TABLE wbs_provider_signed_payable_admission','UNIQUE(tenant_id,issuer,key_id,nonce)','expires_at-signed_at<=interval \'15 minutes\'','request_raw_hash','response_raw_hash','package_raw_hash','receipt_hash','ENABLE ROW LEVEL SECURITY','append_only','refs_assert_scope(p_tenant,p_entity,\'WBS.SNAPSHOT.IMPORT\')','source_entity_id IS DISTINCT FROM p_delivery->>\'company_code\'','refs_record_wbs_snapshot_receipts','refs_persist_wbs_inbound_snapshot_rows','WBS_PROVIDER_SIGNED_PAYABLE_ADMITTED',"'can_create_draft',false","'can_approve',false","'can_post',false"]){assert.match(sql,new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));}
  assert.doesNotMatch(sql,/refs_create_auto_journal|refs_post_journal|INSERT INTO journal_entry|INSERT INTO ledger_line/);
  assert.match(down,/DROP FUNCTION IF EXISTS refs_admit_wbs_provider_signed_payables/);assert.match(down,/DROP TABLE IF EXISTS wbs_provider_signed_payable_admission/);
});

test('HTTP derives identity, accepts only opaque signed bytes/receipt, and returns service result',async()=>{
  const calls=[],principal={trusted:true,tenantId,actorId:'oidc|provider-service'};
  const api=createAccountingApi({authenticate:async()=>principal,kernelFactory:async()=>({}),wbsProviderSignedPayableServiceFactory:async seenPrincipal=>({admit:async input=>{calls.push([seenPrincipal,input]);return {status:'PERSISTED_PAYABLE_STAGING_REVIEW_REQUIRED',signature_verified:true,can_create_draft:false,can_approve:false,can_post:false,idempotent:false};}})});
  const body={receipt:{issuer:'provider'},requestRawBase64:'e30=',responseRawBase64:'e30=',packageRawBase64:'e30='};
  const response=await api({method:'POST',url:`/api/v1/entities/${entityId}/wbs/provider-signed/payables/admissions`,headers:{'Idempotency-Key':'provider-signed-http-0001'},body});
  assert.equal(response.status,201);assert.equal(calls.length,1);assert.equal(calls[0][0],principal);assert.deepEqual(calls[0][1],{tenantId,entityId,...body,idempotencyKey:'provider-signed-http-0001'});
  for(const forbidden of ['tenantId','entityId','actorId','providerTrust']){const rejected=await api({method:'POST',url:`/api/v1/entities/${entityId}/wbs/provider-signed/payables/admissions`,headers:{'Idempotency-Key':'provider-signed-http-0002'},body:{...body,[forbidden]:'spoof'}});assert.equal(rejected.status,400);}
});
