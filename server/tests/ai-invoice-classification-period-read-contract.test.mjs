import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';

const read=path=>readFileSync(new URL(path,import.meta.url),'utf8');
const up=read('../db/migrations/223_ai_invoice_classification_period_source_read.sql');
const down=read('../db/migrations/down/223_ai_invoice_classification_period_source_read.sql');
const repository=read('../runtime/kernel-repository.mjs');
const server=read('../runtime/accounting-server.mjs');

test('invoice population reader is exact-period, analysis-only, retained-payable, bounded, and raw-byte free',()=>{
  assert.match(up,/refs_assert_scope\(p_tenant,p_entity,'AI\.ANALYSIS\.EXPLAIN'\)/);
  assert.match(up,/r\.accounting_period_id=p_period AND r\.domain='PAYABLES'/);
  assert.match(up,/p_limit<1 OR p_limit>500/);assert.match(up,/LIMIT p_limit/);
  assert.match(up,/count\(\*\)[\s\S]+>p_limit[\s\S]+ERRCODE='54000'/);
  assert.match(up,/wbs_final1_retained_source_row/);assert.match(up,/r\.raw_row_hash/);
  assert.match(up,/posted_debit_account_classes text\[\]/);assert.match(up,/jl\.debit_amount>0/);
  for(const accountClass of ['ASSET','LIABILITY','EQUITY','REVENUE','EXPENSE','UNCLASSIFIED'])assert.match(up,new RegExp(`'${accountClass}'`));
  for(const forbidden of ['raw_event.payload','request_raw','response_raw','package_raw','credential','authorization'])assert.doesNotMatch(up,new RegExp(forbidden,'i'));
  assert.match(up,/false|NOT_RECORDED/);assert.doesNotMatch(up,/\b(?:INSERT|UPDATE|DELETE)\b/i);
});

test('production classification uses the dedicated reader and rollback removes only that function',()=>{
  assert.match(repository,/readAiInvoiceClassificationSource/);assert.match(repository,/refs_read_ai_invoice_classification_source\(\$1,\$2,\$3,\$4\)/);
  assert.match(server,/classificationInputReader:scope=>kernel\.readAiInvoiceClassificationSource\(scope\)/);
  assert.doesNotMatch(server,/aiInvoiceAccountingClassificationServiceFactory[\s\S]{0,250}listSourceDocuments/);
  assert.match(down,/DROP FUNCTION refs_read_ai_invoice_classification_source\(uuid,uuid,uuid,integer\)/);
});
