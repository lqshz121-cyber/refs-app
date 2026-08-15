import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const up=await readFile(new URL('../db/migrations/131_current_actor_access_read.sql',import.meta.url),'utf8');
const down=await readFile(new URL('../db/migrations/down/131_current_actor_access_read.sql',import.meta.url),'utf8');

test('current actor access reader is bound to the authenticated tenant actor and entity',()=>{
  assert.match(up,/CREATE OR REPLACE FUNCTION public\.refs_read_current_actor_access/);
  assert.match(up,/v_actor text:=public\.refs_current_actor\(\)/);
  assert.match(up,/refs_current_tenant\(\) IS DISTINCT FROM p_tenant/);
  assert.match(up,/COALESCE\(g->>'entity_id',''\) ~\* '\^\[0-9a-f\]/);
  assert.match(up,/THEN \(g->>'entity_id'\)::uuid=p_entity/);
  assert.match(up,/c\.bound_backend_pid=pg_backend_pid\(\)/);
  assert.match(up,/c\.bound_txid=txid_current\(\)/);
  assert.match(up,/\(g->>'entity_id'\)::uuid=p_entity/);
  assert.doesNotMatch(up,/p_actor/);
  assert.doesNotMatch(up,/INSERT INTO|UPDATE public\.|DELETE FROM/);
});

test('current actor access reader exposes only effective permission codes and grant revision',()=>{
  assert.match(up,/array_agg\(DISTINCT g->>'permission' ORDER BY g->>'permission'\)/);
  assert.match(up,/runtime_actor_grant_set/);
  assert.match(up,/runtime_actor_grant g/);
  assert.match(up,/v_permissions IS DISTINCT FROM v_configured_permissions/);
  assert.match(up,/COALESCE\(v_version,0\)/);
  assert.match(up,/REVOKE ALL ON FUNCTION public\.refs_read_current_actor_access/);
  assert.match(up,/GRANT EXECUTE ON FUNCTION public\.refs_read_current_actor_access\(uuid,uuid\) TO refs_app/);
  assert.match(down,/DROP FUNCTION public\.refs_read_current_actor_access\(uuid,uuid\)/);
});
