import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const source=await readFile(new URL('../runtime/test-postgres-fresh.mjs',import.meta.url),'utf8');

test('fresh PostgreSQL gate owns a unique test-only compose project and cleanup scope',()=>{
  assert.match(source,/refs_kernel_gate_\$\{process\.pid\}_\$\{Date\.now\(\)\.toString\(36\)\}/);
  assert.match(source,/const database='refs_kernel_gate_test'/);
  assert.match(source,/if\(!database\.endsWith\('_test'\)\)/);
  assert.match(source,/\['compose','-p',project,'-f','compose\.yaml','up','-d','--wait'\]/);
  assert.match(source,/waitForPostgresReadiness\(\{probe:\(\)=>probePostgres\(testEnv\.MIGRATION_DATABASE_URL\)\}\)/);
  assert.match(source,/applicationName:'refs-fresh-gate-readiness'/);
  assert.match(source,/\['compose','-p',project,'-f','compose\.yaml','down','-v','--remove-orphans'\]/);
  assert.doesNotMatch(source,/docker\s+(volume|system)\s+(prune|rm)/i);
});

test('fresh PostgreSQL gate requires all isolated runtime identities and the required PG suite',()=>{
  assert.match(source,/REFS_PG_REQUIRED:'1'/);
  for(const key of ['DATABASE_URL','MIGRATION_DATABASE_URL','CONTEXT_ISSUER_DATABASE_URL','GRANT_SYNC_DATABASE_URL'])assert.match(source,new RegExp(`${key}:`));
  assert.match(source,/\['run','test:postgres'\]/);
});
