import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {MIGRATION_MANIFEST} from '../runtime/migration-manifest.mjs';

const file=name=>new URL(`../db/migrations/${name}`,import.meta.url);

test('migration 278 exposes only a scoped grant-sync revision reader',async()=>{
  const name='278_runtime_grant_revision_reader.sql';
  const up=await readFile(file(name),'utf8');
  const down=await readFile(file(`down/${name}`),'utf8');
  assert.match(up,/CREATE FUNCTION refs_current_actor_grant_set_version\(p_tenant uuid,p_actor text,p_entity uuid\)/);
  assert.match(up,/session_user<>'refs_grant_sync'/);
  assert.match(up,/tenant_id=p_tenant AND actor_id=p_actor AND entity_id=p_entity/);
  assert.match(up,/GRANT EXECUTE ON FUNCTION refs_current_actor_grant_set_version\(uuid,text,uuid\) TO refs_grant_sync/);
  assert.doesNotMatch(up,/INSERT|UPDATE|DELETE FROM runtime_actor_grant/i);
  assert.match(down,/DROP FUNCTION refs_current_actor_grant_set_version\(uuid,text,uuid\)/);
  assert.ok(MIGRATION_MANIFEST.some(row=>row.name===name));
});
