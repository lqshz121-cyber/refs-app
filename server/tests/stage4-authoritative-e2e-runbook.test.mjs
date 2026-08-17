import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const root=new URL('../',import.meta.url);

test('Stage 4 production verifier has one documented executable read-only entrypoint',async()=>{
  const [packageText,runbook]=await Promise.all([
    readFile(new URL('package.json',root),'utf8'),
    readFile(new URL('STAGE4-AUTHORITATIVE-E2E.md',root),'utf8'),
  ]);
  const scripts=JSON.parse(packageText).scripts;
  assert.equal(scripts['test:stage4:authoritative-e2e'],'node runtime/verify-stage4-authoritative-e2e.mjs');
  for(const name of [
    'REFS_STAGING_API_BASE_URL',
    'REFS_STAGING_WEB_ORIGIN',
    'REFS_RELEASE_SHA',
    'REFS_STAGE4_E2E_READ_ACCESS_TOKEN',
    'REFS_STAGE4_E2E_SCENARIO_PATH',
  ])assert.match(runbook,new RegExp(name));
  assert.match(runbook,/npm\.cmd run test:stage4:authoritative-e2e/);
  assert.match(runbook,/deliberately read-only/i);
  assert.match(runbook,/never printed or written to an artifact/i);
  assert.match(runbook,/statement snapshot row -> live statement row -> GL line -> POSTED JE -> source document/);
});
