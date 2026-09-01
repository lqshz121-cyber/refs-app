import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';

const migrationUrl=new URL('../db/migrations/297_wbs_final1_payable_typed_document_evidence.sql',import.meta.url);
const downUrl=new URL('../db/migrations/down/297_wbs_final1_payable_typed_document_evidence.sql',import.meta.url);
const normalizerUrl=new URL('../runtime/wbs-provider-final1-payable-normalizer.mjs',import.meta.url);
const classifierUrl=new URL('../runtime/ai-invoice-accounting-classifier.mjs',import.meta.url);

test('migration 297 retains immutable typed payable evidence and versioned readers',async()=>{
  const sql=await readFile(migrationUrl,'utf8');
  for(const token of [
    'CREATE TABLE wbs_final1_payable_document_evidence',
    'ENABLE ROW LEVEL SECURITY',
    'USING(tenant_id=refs_current_tenant() AND refs_entity_allowed(entity_id))',
    'WITH CHECK(tenant_id=refs_current_tenant() AND refs_entity_allowed(entity_id))',
    'reject_mutation()',
    'CREATE UNIQUE INDEX wbs_final1_payable_tax_statement_identity_uniq',
    "document_kind text CHECK(document_kind IN('INVOICE','TAX_STATEMENT'))",
    "tax_obligation_basis text CHECK(tax_obligation_basis IN('ASSESSED_VALUE','MILLAGE_RATE','FIXED_STATUTORY_AMOUNT'))",
    'refs_wbs_final1_payable_document_evidence_hash',
    'refs_retain_wbs_final1_source_evidence_with_signed_controls_v167',
    'refs_read_ai_invoice_classification_source_v3',
    'refs_read_ai_invoice_decision_population_page_v295',
    "'can_create_draft',false",
    "'can_review',false",
    "'can_approve',false",
    "'can_post',false"
  ])assert.match(sql,new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
  assert.doesNotMatch(sql,/UPDATE\s+wbs_final1_payable_document_evidence|DELETE\s+FROM\s+wbs_final1_payable_document_evidence/i);
  assert.match(sql,/document_kind='INVOICE'[\s\S]+taxing_jurisdiction IS NULL[\s\S]+document_kind='TAX_STATEMENT'/);
  assert.match(sql,/CHECK\(\([\s\S]+\) IS TRUE\)/);
  assert.match(sql,/document_kind IS NOT NULL/);
  assert.match(sql,/document_evidence_schema_version' IS DISTINCT FROM 'WBS_FINAL1_PAYABLE_DOCUMENT_EVIDENCE_V1'/);
  assert.match(sql,/document_kind' IS NULL/);
  assert.match(sql,/jsonb_typeof\(v_raw\) IS DISTINCT FROM 'object'/);
  assert.match(sql,/duplicate tax-statement identity/);
});

test('migration 297 down restores the exact predecessor functions only when evidence is empty',async()=>{
  const sql=await readFile(downUrl,'utf8');
  assert.match(sql,/IF EXISTS\(SELECT 1 FROM wbs_final1_payable_document_evidence\)/);
  assert.match(sql,/RENAME TO refs_retain_wbs_final1_source_evidence_with_signed_controls/);
  assert.match(sql,/RENAME TO refs_read_ai_invoice_decision_population_page/);
  assert.match(sql,/DROP FUNCTION IF EXISTS refs_read_ai_invoice_classification_source_v3/);
  assert.match(sql,/DROP TABLE wbs_final1_payable_document_evidence/);
});

test('runtime uses only typed signed evidence for property-tax recognition',async()=>{
  const [normalizer,classifier]=await Promise.all([readFile(normalizerUrl,'utf8'),readFile(classifierUrl,'utf8')]);
  assert.match(normalizer,/WBS_FINAL1_PAYABLE_DOCUMENT_EVIDENCE_V1/);
  assert.match(normalizer,/TAX_STATEMENT/);
  assert.match(classifier,/AI_PROPERTY_TAX_TYPED_SOURCE_REVIEW_V1/);
  assert.match(classifier,/AI_PAYABLE_DOCUMENT_KIND_EVIDENCE_REQUIRED_V1/);
  for(const removedHeuristic of ['tokenSet','hasAny','hasAll','PROPERTY_TAX_SOURCE_TERMS','STRONG_PROPERTY_DOCUMENT_TERMS','taxObligationIndicated'])assert.doesNotMatch(classifier,new RegExp(`\\b${removedHeuristic}\\b`));
});
