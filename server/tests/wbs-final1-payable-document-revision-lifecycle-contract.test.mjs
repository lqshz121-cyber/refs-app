import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';

const read=path=>readFile(new URL(path,import.meta.url),'utf8');

test('migration 298 retains an append-only, scoped, current-only signed tax revision chain',async()=>{
  const sql=await read('../db/migrations/298_wbs_final1_payable_document_revision_lifecycle.sql');
  for(const token of [
    'CREATE TABLE wbs_final1_payable_document_revision',
    "revision_kind text NOT NULL CHECK(revision_kind IN('ORIGINAL','CORRECTION'))",
    "retention_origin text NOT NULL CHECK(retention_origin IN('BACKFILL_297','SIGNED_FINAL1_298'))",
    'Every 297 TAX_STATEMENT is the immutable first revision of its chain',
    'wbs_final1_payable_document_revision_append_only',
    'ENABLE ROW LEVEL SECURITY',
    'wbs_final1_payable_document_revision_current',
    "'CURRENT'::text AS lifecycle_status",
    "'SUPERSEDED'",
    "document_revision_kind'='WITHDRAWN'",
    'pg_advisory_xact_lock',
    'Correction predecessor is no longer the current revision',
    'v_predecessor.accounting_period_id<>v_retained.accounting_period_id',
    'A booked tax statement cannot be superseded by source retention',
    'refs_read_wbs_final1_payable_document_revisions',
    "refs_assert_scope(p_tenant,p_entity,'WBS.PAYABLE.REVIEW')",
    'refs_read_ai_invoice_classification_source_v4',
    'refs_read_ai_invoice_decision_population_page_v297',
    'refs_retain_ai_accounting_decision_batch_v297',
    "'can_create_draft',false",
    "'can_review',false",
    "'can_approve',false",
    "'can_post',false"
  ])assert.match(sql,new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
  assert.doesNotMatch(sql,/UPDATE\s+wbs_final1_payable_document_revision|DELETE\s+FROM\s+wbs_final1_payable_document_revision/i);
  assert.match(sql,/LEFT JOIN wbs_final1_payable_document_revision_current c[\s\S]+e\.document_kind IS DISTINCT FROM 'TAX_STATEMENT'/);
  assert.match(sql,/REVOKE ALL ON wbs_final1_payable_document_revision FROM PUBLIC,refs_app/);
  assert.doesNotMatch(sql,/GRANT SELECT ON wbs_final1_payable_document_revision TO refs_app/);
});

test('migration 298 down refuses retained signed revisions and restores the 297 boundary',async()=>{
  const sql=await read('../db/migrations/down/298_wbs_final1_payable_document_revision_lifecycle.sql');
  assert.match(sql,/retention_origin='SIGNED_FINAL1_298'/);
  assert.match(sql,/ERRCODE='55000'/);
  assert.match(sql,/RENAME TO refs_retain_ai_accounting_decision_batch/);
  assert.match(sql,/RENAME TO refs_read_ai_invoice_decision_population_page/);
  assert.match(sql,/RENAME TO refs_retain_wbs_final1_source_evidence_with_signed_controls/);
  assert.match(sql,/CREATE UNIQUE INDEX wbs_final1_payable_tax_statement_identity_uniq/);
});

test('runtime verifies signed revision fields, uses v4, exposes scoped history, and keeps accounting actions false',async()=>{
  const [delivery,normalizer,classifier,repository]=await Promise.all([
    read('../runtime/wbs-provider-final1-delivery.mjs'),read('../runtime/wbs-provider-final1-payable-normalizer.mjs'),
    read('../runtime/ai-invoice-accounting-classifier.mjs'),read('../runtime/kernel-repository.mjs')
  ]);
  for(const source of [delivery,normalizer])for(const token of ['WBS_FINAL1_PAYABLE_DOCUMENT_REVISION_V1','ORIGINAL','CORRECTION','WITHDRAWN','predecessor_document_revision_hash'])assert.match(source,new RegExp(token));
  assert.match(classifier,/document_lifecycle_status==='CURRENT'/);
  assert.match(classifier,/document_revision_kind==='ORIGINAL'/);
  assert.match(repository,/refs_read_ai_invoice_classification_source_v4/);
  assert.match(repository,/refs_read_wbs_final1_payable_document_revisions/);
  for(const source of [classifier,normalizer])for(const action of ['can_create_draft:false','can_review:false','can_approve:false','can_post:false'])assert.match(source,new RegExp(action));
});
