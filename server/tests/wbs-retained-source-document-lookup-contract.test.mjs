import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {MIGRATION_MANIFEST} from '../runtime/migration-manifest.mjs';

const [up,down,review]=await Promise.all([
  readFile(new URL('../db/migrations/332_wbs_retained_source_document_lookup.sql',import.meta.url),'utf8'),
  readFile(new URL('../db/migrations/down/332_wbs_retained_source_document_lookup.sql',import.meta.url),'utf8'),
  readFile(new URL('../db/migrations/287_ai_admitted_source_review_lifecycle.sql',import.meta.url),'utf8')
]);

test('migration 332 indexes the exact admitted-source trigger lookup',()=>{
  assert.match(review,/WHERE retained\.tenant_id=p_tenant AND retained\.entity_id=p_entity AND retained\.source_document_id=p_source_document/);
  assert.match(up,/CREATE INDEX wbs_final1_retained_source_document_lookup_idx\s+ON wbs_final1_retained_source_row\(tenant_id,entity_id,source_document_id\)/);
  assert.doesNotMatch(up,/CREATE\s+UNIQUE\s+INDEX/i);
});

test('migration 332 is checksum-bound and reverses only its index',()=>{
  assert.equal(MIGRATION_MANIFEST.at(-1)?.name,'332_wbs_retained_source_document_lookup.sql');
  assert.match(down,/DROP INDEX IF EXISTS wbs_final1_retained_source_document_lookup_idx/);
  assert.doesNotMatch(down,/DROP TABLE|DELETE FROM|TRUNCATE/i);
});
