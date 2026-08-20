import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';

const read=path=>readFile(new URL(path,import.meta.url),'utf8');

test('amortization proposal requires one exact retained prepaid classification',async()=>{
  const up=await read('../db/migrations/195_ai_invoice_classification_amortization_lineage.sql');
  for(const token of [
    'ai_invoice_accounting_classification_evidence_id','source_document_line_id','invoice_classification_hash',
    "e.source_payload_hash=NEW.source_payload_hash","e.classifier_version='AI_INVOICE_ACCOUNTING_CLASSIFICATION_V2'",
    "e.classification='PREPAID_AMORTIZATION'","e.status='REVIEW_REQUIRED'",'IF match_count<>1 THEN',
    "USING ERRCODE='23514'"
  ]) assert.ok(up.includes(token),`missing ${token}`);
  assert.match(up,/BEFORE INSERT ON ai_amortization_schedule/);
});

test('classification link is atomic, auditable, and grants no accounting action',async()=>{
  const up=await read('../db/migrations/195_ai_invoice_classification_amortization_lineage.sql');
  for(const token of [
    'AI_AMORTIZATION_INVOICE_CLASSIFICATION_LINK_V1','AI_AMORTIZATION_CLASSIFICATION_LINKED',
    'INSERT INTO audit_event','INSERT INTO outbox_event',"'can_create_draft',false","'can_review',false",
    "'can_approve',false","'can_post',false"
  ]) assert.ok(up.includes(token),`missing ${token}`);
  assert.doesNotMatch(up,/INSERT INTO (staging_item|journal_entry|journal_line|ledger_line)/i);
});

test('unlinked legacy schedule cannot create a Draft and the transaction rolls back',async()=>{
  const up=await read('../db/migrations/195_ai_invoice_classification_amortization_lineage.sql');
  assert.match(up,/BEFORE INSERT ON ai_amortization_draft_evidence/);
  assert.match(up,/AI amortization Draft requires retained prepaid invoice classification lineage/);
  assert.match(up,/e\.classification='PREPAID_AMORTIZATION'/);
});

test('rollback cannot erase retained amortization classification lineage',async()=>{
  const down=await read('../db/migrations/down/195_ai_invoice_classification_amortization_lineage.sql');
  assert.match(down,/IF EXISTS\(SELECT 1 FROM ai_amortization_schedule WHERE ai_invoice_accounting_classification_evidence_id IS NOT NULL\)/);
  assert.match(down,/ERRCODE='55006'/);
});
