import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {PostgresAccountingKernel} from '../runtime/kernel-repository.mjs';

const read=path=>readFile(new URL(path,import.meta.url),'utf8');

test('migration persists exact retained invoice classifications atomically without accounting authority',async()=>{
  const up=await read('../db/migrations/186_ai_invoice_accounting_classification_evidence.sql');
  for(const token of ['CREATE TABLE ai_invoice_accounting_classification_evidence','wbs_final1_retained_source_row','raw_row_hash=item->>\'source_line_hash\'','AI.ANALYSIS.EXPLAIN','idempotency_receipt','actor_id IS DISTINCT FROM actor','AI_INVOICE_ACCOUNTING_CLASSIFIED','INSERT INTO audit_event','INSERT INTO outbox_event',"'can_create_draft',false","'can_review',false","'can_approve',false","'can_post',false",'reject_mutation'])assert.ok(up.includes(token),`missing ${token}`);
  assert.doesNotMatch(up,/INSERT INTO (staging_item|journal_entry|journal_line|ledger_line)/i);
  assert.match(up,/d\.payload_hash=item->>'source_payload_hash'/);
});

test('rollback refuses to discard retained classification evidence',async()=>{
  const down=await read('../db/migrations/down/186_ai_invoice_accounting_classification_evidence.sql');
  assert.match(down,/IF EXISTS\(SELECT 1 FROM ai_invoice_accounting_classification_evidence\)/);
  assert.match(down,/ERRCODE='55006'/);
});

test('repository hashes, materializes, and reads the exact period-scoped batch',async()=>{
  const calls=[],kernel=new PostgresAccountingKernel({},{sessionProvider:async()=>({})});kernel.inSession=async work=>work({query:async(sql,args)=>{calls.push({sql,args});return {rowCount:1,rows:[sql.includes('batch_hash')?{request_hash:'sha256:'+'a'.repeat(64)}:sql.includes('materialize')?{result:{inserted_count:1}}:{ai_invoice_accounting_classification_evidence_id:'evidence-1'}]};}});
  const batch={schema_version:'AI_INVOICE_ACCOUNTING_CLASSIFICATION_BATCH_V1'};
  assert.deepEqual(await kernel.materializeAiInvoiceAccountingClassifications({tenantId:'tenant',entityId:'entity',accountingPeriodId:'period',batch,idempotencyKey:'idem'}),{inserted_count:1});
  assert.deepEqual(await kernel.listAiInvoiceAccountingClassificationEvidence({tenantId:'tenant',entityId:'entity',accountingPeriodId:'period',limit:25}),[{ai_invoice_accounting_classification_evidence_id:'evidence-1'}]);
  assert.equal(calls.length,3);assert.match(calls[0].sql,/refs_ai_invoice_classification_batch_hash/);assert.match(calls[1].sql,/refs_materialize_ai_invoice_classification_batch/);assert.match(calls[2].sql,/refs_read_ai_invoice_classification_evidence/);
  assert.deepEqual(calls[1].args.slice(0,3),['tenant','entity','period']);assert.equal(calls[1].args[4],'idem');
});
