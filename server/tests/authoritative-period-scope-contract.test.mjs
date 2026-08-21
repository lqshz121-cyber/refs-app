import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const read=path=>readFile(new URL(path,import.meta.url),'utf8');

test('migration252 adds closed AP AR adjustment document and Journal period reads without replacing legacy readers',async()=>{
  const [up,down,repository,http]=await Promise.all([
    read('../db/migrations/252_authoritative_document_journal_period_scope.sql'),
    read('../db/migrations/down/252_authoritative_document_journal_period_scope.sql'),
    read('../runtime/kernel-repository.mjs'),
    read('../api/accounting-http.mjs'),
  ]);
  for(const signature of [
    'refs_read_business_document_period_scope(uuid,uuid,text,uuid)',
    'refs_list_business_documents_period(uuid,uuid,text,uuid,integer,integer)',
    'refs_read_business_adjustment_period_scope(uuid,uuid,text,uuid)',
    'refs_list_business_adjustments_period(uuid,uuid,text,uuid,integer,integer)',
    'refs_read_journal_period_scope(uuid,uuid,uuid)',
    'refs_list_journal_entries_period(uuid,uuid,uuid,integer,integer)',
  ]){
    assert.match(up,new RegExp(`REVOKE ALL ON FUNCTION ${signature.replace(/[()]/g,'\\$&')} FROM PUBLIC`));
    assert.match(up,new RegExp(`GRANT EXECUTE ON FUNCTION ${signature.replace(/[()]/g,'\\$&')} TO refs_app`));
    assert.match(down,new RegExp(`DROP FUNCTION IF EXISTS ${signature.replace(/[()]/g,'\\$&')}`));
  }
  assert.match(up,/j\.journal_type::text,j\.status::text/);
  assert.match(up,/j\.status::text,j\.revision/);
  assert.match(up,/business_document_period_read_idx/);
  assert.match(up,/business_adjustment_period_read_idx/);
  assert.match(up,/journal_entry_period_read_idx/);
  assert.doesNotMatch(up,/CREATE OR REPLACE FUNCTION refs_list_business_documents\b/);
  assert.doesNotMatch(up,/CREATE OR REPLACE FUNCTION refs_list_business_adjustments\b/);
  assert.doesNotMatch(up,/CREATE OR REPLACE FUNCTION refs_list_journal_entries\b/);
  for(const call of ['refs_read_business_document_period_scope','refs_list_business_documents_period','refs_read_business_adjustment_period_scope','refs_list_business_adjustments_period','refs_read_journal_period_scope','refs_list_journal_entries_period'])assert.match(repository,new RegExp(call));
  assert.match(repository,/async listBusinessDocuments[\s\S]*return this\.inSession[\s\S]*refs_read_business_document_period_scope[\s\S]*refs_list_business_documents_period/);
  assert.match(repository,/async listBusinessAdjustments[\s\S]*return this\.inSession[\s\S]*refs_read_business_adjustment_period_scope[\s\S]*refs_list_business_adjustments_period/);
  assert.match(repository,/async listJournalEntries[\s\S]*return this\.inSession[\s\S]*refs_read_journal_period_scope[\s\S]*refs_list_journal_entries_period/);
  assert.match(http,/parts\[5\]==='adjustments'[\s\S]*requireExactQuery\(parsedUrl\.searchParams,\['periodId','limit','offset'\]\)/);
});
