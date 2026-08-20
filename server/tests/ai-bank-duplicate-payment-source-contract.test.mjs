import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const here=resolve(fileURLToPath(new URL('.',import.meta.url)));
const up=await readFile(resolve(here,'../db/migrations/203_ai_bank_duplicate_payment_source_read.sql'),'utf8');
const down=await readFile(resolve(here,'../db/migrations/down/203_ai_bank_duplicate_payment_source_read.sql'),'utf8');

test('duplicate-payment source reader is exact-period, signed, admitted, payment-only and bounded',()=>{
  assert.match(up,/refs_assert_scope\(p_tenant,p_entity,'AI\.ANALYSIS\.EXPLAIN'\)/);assert.match(up,/period\.period_id=p_period/);assert.match(up,/bank\.transaction_date BETWEEN selected_period\.starts_on AND selected_period\.ends_on/);assert.match(up,/bank\.amount<0/);assert.match(up,/receipt\.signature_verified=true AND receipt\.admission_status='ADMITTED'/);assert.match(up,/p_limit<1 OR p_limit>500/);
});

test('reader binds bank, source document, signed transaction and receipt without data mutation',()=>{
  for(const relation of ['bank_source bank','source_document document','wbs_bank_statement_transaction txn','wbs_bank_statement_receipt receipt'])assert.match(up,new RegExp(relation));
  assert.match(up,/document\.payload_hash~'\^sha256:/);assert.doesNotMatch(up,/\b(INSERT|UPDATE|DELETE)\b/i);assert.match(down,/DROP FUNCTION IF EXISTS refs_read_ai_bank_duplicate_payment_sources/);
});
