import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {MIGRATION_MANIFEST} from '../runtime/migration-manifest.mjs';

const file=name=>new URL(`../db/migrations/${name}`,import.meta.url);
const sha=value=>createHash('sha256').update(value).digest('hex');

test('migration 274 closes human grant expiry, service-only, SoD, exact replacement, and context issuance',async()=>{
  const name='274_runtime_grant_sod_expiry.sql',up=await readFile(file(name),'utf8'),down=await readFile(file(`down/${name}`),'utf8');
  for(const token of [
    "ADD COLUMN authority_class text NOT NULL DEFAULT 'LEGACY'","grant_policy_version='SOD_FINITE_V1'",
    'runtime_service_only_permission','runtime_human_permission_authority','refs_grant_request_hash_v2',
    'refs_reconcile_actor_grants_v2',"authority<>'SERVICE'","interval '5 minutes'","interval '24 hours'",
    'Service-only permission denied in human workflow grant','desired_write_class_count>1',
    'Service authority accepts only frozen service permissions',
    'ON CONFLICT(tenant_id,actor_id,entity_id,permission) DO UPDATE',
    'valid_until=EXCLUDED.valid_until','authority_class=EXCLUDED.authority_class',
    'runtime_auth_context_sod_guard','Actor has mutually exclusive workflow authorities',
    'Service-only permission requires an exact SERVICE authority grant','scope->>\'permission\'=g.permission',
    'Human permission grant authority does not match its frozen workflow class','g.authority_class<>expected.authority_class',
    'NEW.expires_at:=LEAST(NEW.expires_at,grant_expiry)','JOIN runtime_actor_grant current_grant',
    'REVOKE EXECUTE ON FUNCTION refs_reconcile_actor_grants(uuid,text,uuid,text[],bigint,text,text) FROM refs_grant_sync',
    'REVOKE EXECUTE ON FUNCTION refs_upgrade_stage1_controlled_test_workflow(uuid,text,uuid,text,text,bigint) FROM refs_grant_sync',
    "g.authority_class='LEGACY' OR g.valid_until IS NULL",'Human write authority requires a finite exact-role grant',
    "'authority_class',authority","'valid_until',canonical_expiry",'ACTOR_GRANTS_RECONCILED',
  ])assert.match(up,new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
  for(const permission of ['WBS.SNAPSHOT.IMPORT','WBS.BANK.ADMIT','OUTBOX.DISPATCH','BANK.AUTOREC.SYNC'])assert.match(up,new RegExp(permission.replaceAll('.','\\.')));
  assert.match(down,/Refusing migration 274 rollback: finite-expiry grant evidence exists/);
  assert.match(down,/BEGIN;\s*REVOKE ALL ON FUNCTION refs_reconcile_actor_grants_v2[\s\S]*LOCK TABLE runtime_grant_sync_receipt IN SHARE MODE;\s*DO \$\$/);
  assert.match(down,/DROP TRIGGER IF EXISTS runtime_auth_context_sod_guard/);
  assert.match(down,/GRANT EXECUTE ON FUNCTION refs_reconcile_actor_grants\(uuid,text,uuid,text\[\],bigint,text,text\) TO refs_grant_sync/);
  const manifest=MIGRATION_MANIFEST.find(item=>item.name===name);
  assert.ok(manifest);assert.equal(manifest.up,sha(up));assert.equal(manifest.down,sha(down));
});
