import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const here=resolve(fileURLToPath(new URL('.',import.meta.url)));
const up=await readFile(resolve(here,'../db/migrations/125_ai_cost_dimension_findings.sql'),'utf8');
const down=await readFile(resolve(here,'../db/migrations/down/125_ai_cost_dimension_findings.sql'),'utf8');

test('cost findings identify missing dimensions without inventing them or creating accounting work',()=>{
  assert.match(up,/CREATE TABLE ai_cost_dimension_finding/);assert.match(up,/source_module<>'cost'/);assert.match(up,/missing_project/);assert.match(up,/missing_property/);assert.match(up,/No dimension was inferred/);
  assert.match(up,/AI_COST_DIMENSION_FINDING_MATERIALIZED/);assert.match(up,/INSERT INTO outbox_event/);
  for(const field of ['can_create_draft','can_review','can_approve','can_post'])assert.match(up,new RegExp(`'${field}',false`));
  assert.doesNotMatch(up,/INSERT INTO journal_entry/i);assert.doesNotMatch(up,/UPDATE source_document/i);assert.doesNotMatch(up,/UPDATE source_document_line/i);
});

test('cost evidence is immutable, scoped, bounded, and retained on rollback',()=>{
  assert.match(up,/CREATE TRIGGER ai_cost_dimension_finding_append_only BEFORE UPDATE OR DELETE/);assert.match(up,/refs_read_ai_cost_dimension_findings/);assert.match(up,/p_limit<1 OR p_limit>100/);assert.match(up,/refs_assert_scope\(p_tenant,p_entity,'AI\.AMORTIZATION\.PROPOSE'\)/);
  assert.match(down,/Cannot remove retained AI cost dimension findings/);
});
