import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const here=resolve(fileURLToPath(new URL('.',import.meta.url)));
const migration=await readFile(resolve(here,'../db/migrations/120_ai_amortization_schedule_read.sql'),'utf8');
const down=await readFile(resolve(here,'../db/migrations/down/120_ai_amortization_schedule_read.sql'),'utf8');
const repository=await readFile(resolve(here,'../runtime/kernel-repository.mjs'),'utf8');
const http=await readFile(resolve(here,'../api/accounting-http.mjs'),'utf8');

test('AI amortization reader is authorized, bounded, and returns immutable schedule line evidence only',()=>{
  assert.match(migration,/PERFORM refs_assert_scope\(p_tenant,p_entity,'AI\.AMORTIZATION\.VIEW'\)/);
  assert.match(migration,/p_limit<1 OR p_limit>100/);
  assert.match(migration,/jsonb_agg\(jsonb_build_object\('line_no'/);
  assert.match(migration,/false,false,false,false/);
  assert.match(migration,/GRANT EXECUTE ON FUNCTION refs_read_ai_amortization_schedules/);
  assert.doesNotMatch(migration,/INSERT INTO journal_entry/i);
  assert.doesNotMatch(migration,/UPDATE ai_amortization_schedule/i);
});

test('repository and HTTP route expose a no-store reader plus a separate no-action proposal command',()=>{
  assert.match(repository,/async listAiAmortizationSchedules\(\{tenantId,entityId,limit=50\}\)/);
  assert.match(repository,/refs_read_ai_amortization_schedules\(\$1,\$2,\$3\)/);
  assert.match(http,/parts\[4\]==='ai'&&parts\[5\]==='amortization'&&parts\[6\]==='schedules'/);
  assert.match(http,/AI_AMORTIZATION_SCHEDULE_READ_UNAVAILABLE/);
  assert.match(http,/cache-control':'no-store/);
  assert.match(repository,/async proposeAiAmortizationSchedule\(\{tenantId,entityId,sourceDocumentId/);
  assert.match(http,/AI_AMORTIZATION_PROPOSAL_UNAVAILABLE/);
  assert.match(http,/AI amortization proposal must remain an immutable, no-action proposal/);
});

test('down migration removes only the reader and permission, not retained schedule evidence',()=>{
  assert.match(down,/DROP FUNCTION refs_read_ai_amortization_schedules/);
  assert.doesNotMatch(down,/DROP TABLE/i);
});
