import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

test('Property Rent current-release runbook documents a direct GET-only verifier without release-bundle coupling',async()=>{
  const text=await readFile(new URL('../STAGE3-PROPERTY-RENT-AUTHORITATIVE-E2E.md',import.meta.url),'utf8');
  for(const name of ['REFS_STAGING_API_BASE_URL','REFS_STAGING_WEB_ORIGIN','REFS_RELEASE_SHA','REFS_STAGE3_PROPERTY_RENT_E2E_READ_ACCESS_TOKEN','REFS_STAGE3_PROPERTY_RENT_E2E_SCENARIO_PATH'])assert.match(text,new RegExp(name));
  assert.match(text,/node runtime\/verify-stage3-property-rent-authoritative-e2e\.mjs/);
  assert.match(text,/authenticated, `GET`-only/);
  assert.match(text,/must never be printed or written to an artifact/);
  assert.match(text,/period-scoped Property Rent pickup queue/);
  assert.match(text,/receivable and revenue General Ledger legs/);
  assert.match(text,/`PROPERTY` dimension-profitability report/);
  assert.match(text,/Mixed releases, cross-period rows, JavaScript\/numeric amounts.*incomplete lineage fail closed/);
  assert.match(text,/does not prove provider admission completeness/);
});
