import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {MIGRATION_MANIFEST} from '../runtime/migration-manifest.mjs';

const sql=await readFile(new URL('../db/migrations/002_accounting_runtime.sql',import.meta.url),'utf8');
const repository=await readFile(new URL('../runtime/kernel-repository.mjs',import.meta.url),'utf8');
const issuer=await readFile(new URL('../runtime/context-issuer.mjs',import.meta.url),'utf8');

test('migration manifest freezes normalized up and down artifacts without AutoRec scope',async()=>{
  assert.deepEqual(MIGRATION_MANIFEST.map(item=>item.name),['001_wbs_accounting_core.sql','002_accounting_runtime.sql','003_attachment_runtime.sql']);
  for(const item of MIGRATION_MANIFEST){
    for(const direction of ['up','down']){
      const relative=direction==='up'?`../db/migrations/${item.name}`:`../db/migrations/down/${item.name}`;
      const raw=await readFile(new URL(relative,import.meta.url),'utf8');
      const checksum=createHash('sha256').update(raw.replace(/\r\n/g,'\n')).digest('hex');
      assert.equal(checksum,item[direction],`${direction} checksum mismatch for ${item.name}`);
    }
  }
});

test('outbox entity column exists before entity-scoped RLS policy',()=>{
  const column=sql.indexOf('ALTER TABLE outbox_event\n  ADD COLUMN entity_id');
  const policy=sql.indexOf("'bank_source','bank_match','reconciliation','source_link','audit_event','outbox_event'");
  assert.ok(column>0&&policy>column);
});

test('runtime identity uses opaque DB-owned transaction context, not caller claims',()=>{
  assert.match(sql,/CREATE TABLE runtime_auth_context/);
  assert.match(sql,/bound_txid=txid_current\(\)/);
  assert.match(sql,/CREATE TABLE runtime_actor_grant/);
  assert.match(sql,/jsonb_agg\(jsonb_build_object\('entity_id',g\.entity_id,'permission',g\.permission\)/);
  assert.doesNotMatch(repository,/set_config\('refs\.(tenant_id|entity_ids|permissions|actor_id)/);
  assert.match(repository,/refs_bootstrap_context/);
  assert.match(sql,/REVOKE ALL ON TABLE runtime_auth_context,runtime_actor_grant,runtime_actor_grant_set,runtime_grant_sync_receipt FROM PUBLIC,refs_app,refs_runtime,refs_context_issuer,refs_grant_sync/);
});

test('isolated issuer derives authorization from DB grants and supports revoke and cleanup',()=>{
  assert.match(sql,/session_user<>'refs_context_issuer'/);
  assert.match(sql,/FROM runtime_actor_grant/);
  assert.match(sql,/refs_revoke_context/);
  assert.match(sql,/refs_cleanup_contexts/);
  assert.match(issuer,/randomBytes\(32\)/);
  assert.match(issuer,/principalProvider/);
  assert.doesNotMatch(issuer,/entityIds|permissions/);
});

test('posting enforces evidence, accounting controls and production-safe signature',()=>{
  assert.doesNotMatch(sql,/p_inject_failure/);
  assert.match(sql,/Manual and reclass journals require a verified clean attachment/);
  assert.match(sql,/Automatic journals require immutable source evidence/);
  assert.match(sql,/jl\.member_ref IS NOT NULL AND m\.member_ref IS NULL/);
  assert.match(sql,/receipt:=refs_reserve_idempotency[\s\S]+receipt\.status='SUCCEEDED'[\s\S]+je\.status<>'APPROVED'/);
});

test('outbox is entity-scoped and its entity ownership is immutable',()=>{
  assert.match(sql,/ADD COLUMN entity_id uuid/);
  assert.match(sql,/refs_entity_has_permission\(entity_id,'OUTBOX\.DISPATCH'\)/);
  assert.match(sql,/NEW\.tenant_id,NEW\.entity_id,NEW\.aggregate_type/);
  assert.doesNotMatch(sql,/GRANT SELECT ON ALL TABLES/);
});
