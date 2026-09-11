import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {formatFreshPostgresVerification,readFreshPostgresVerification,readTapSummary,verifyFreshPostgresTap} from '../runtime/postgres-fresh-tap.mjs';

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
  assert.match(source,/--test-name-pattern/);
  assert.match(source,/REFS_PG_TEST_TIMEOUT_MS must be an integer between 1000 and 900000 milliseconds/);
  assert.match(source,/postgresTestArgs\.push\(`--test-timeout=\$\{postgresTestTimeoutMs\}`\)/);
  assert.match(source,/postgresTestArgs\.push\('tests\/postgres-kernel\.test\.mjs'\)/);
  assert.match(source,/process\.execPath,postgresTestArgs/);
  assert.match(source,/shell:process\.platform==='win32'&&command==='docker'/);
  assert.match(source,/verifyFreshPostgresTap\(tap,\{expectedPatternPassCount\}\)/);
  assert.match(source,/formatFreshPostgresVerification\(verified\)/);
});

const summary=({tests,pass,fail=0,cancelled=0,skipped=0,todo=0})=>`TAP version 13\n1..${tests}\n# tests ${tests}\n# pass ${pass}\n# fail ${fail}\n# cancelled ${cancelled}\n# skipped ${skipped}\n# todo ${todo}\n`;

test('full fresh gate accepts only a complete non-skipped TAP population',()=>{
  const complete=summary({tests:266,pass:266});
  assert.deepEqual(readTapSummary(complete),{tests:266,pass:266,fail:0,cancelled:0,skipped:0,todo:0});
  assert.equal(verifyFreshPostgresTap(complete).mode,'FULL');
  assert.throws(()=>verifyFreshPostgresTap(summary({tests:266,pass:265,skipped:1})),/non-skipped tests/);
  assert.throws(()=>verifyFreshPostgresTap(summary({tests:0,pass:0})),/non-skipped tests/);
  assert.throws(()=>verifyFreshPostgresTap('# tests 266\n# pass 266\n'),/no complete TAP summary/);
  const incompleteTail=`${summary({tests:1,pass:1})}# tests 266\n# pass 266\n# fail 0\n# cancelled 0\n# skipped 0\n`;
  assert.equal(readTapSummary(incompleteTail),null,'summary fields must come from one complete final TAP block');
  assert.throws(()=>verifyFreshPostgresTap(incompleteTail),/no complete TAP summary/);
});

test('pattern fresh gate requires every declared match while allowing only unmatched skips',()=>{
  const selected=summary({tests:266,pass:7,skipped:259});
  const verified=verifyFreshPostgresTap(selected,{expectedPatternPassCount:7});
  assert.equal(verified.mode,'PATTERN');
  const receipt=formatFreshPostgresVerification(verified);
  assert.deepEqual(readFreshPostgresVerification(receipt),verified);
  assert.throws(()=>verifyFreshPostgresTap(selected,{expectedPatternPassCount:8}),/every declared match to pass/);
  assert.throws(()=>verifyFreshPostgresTap(summary({tests:266,pass:7,skipped:258,todo:1}),{expectedPatternPassCount:7}),/every declared match to pass/);
  assert.throws(()=>verifyFreshPostgresTap(selected,{expectedPatternPassCount:0}),/positive declared match count/);
});
