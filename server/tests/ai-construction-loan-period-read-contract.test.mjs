import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';

const read=path=>readFileSync(new URL(path,import.meta.url),'utf8');
const up=read('../db/migrations/232_ai_construction_loan_period_source_read.sql'),down=read('../db/migrations/down/232_ai_construction_loan_period_source_read.sql'),repository=read('../runtime/kernel-repository.mjs'),server=read('../runtime/accounting-server.mjs');

test('loan transaction population is exact-period, explanation-only, complete, and raw-byte free',()=>{
  assert.match(up,/refs_assert_scope\(p_tenant,p_entity,'AI\.ANALYSIS\.EXPLAIN'\)/);assert.match(up,/p\.ledger_code='PRIMARY'/);
  assert.match(up,/d\.source_module='loan'/);assert.match(up,/d\.status='READY_FOR_DRAFT'/);assert.match(up,/d\.accounting_date BETWEEN period_row\.starts_on AND period_row\.ends_on/);
  assert.match(up,/statement_balance_kind[\s\S]+CLOSING_PRINCIPAL_BALANCE/);assert.match(up,/population_count>p_limit[\s\S]+ERRCODE='54000'/);assert.match(up,/p_limit<1 OR p_limit>500/);
  assert.match(up,/AI_CONSTRUCTION_LOAN_SOURCE_LINE_V1/);assert.match(up,/refs_jsonb_hash/);
  for(const forbidden of ['raw_event.payload','request_raw','response_raw','package_raw','credential','authorization'])assert.doesNotMatch(up,new RegExp(forbidden,'i'));
  assert.doesNotMatch(up,/\b(?:INSERT|UPDATE|DELETE)\b/i);
});

test('kernel and Full Controller Scan use the dedicated reader and rollback is exact',()=>{
  assert.match(repository,/readAiConstructionLoanSource/);assert.match(repository,/refs_read_ai_construction_loan_source\(\$1,\$2,\$3,\$4\)/);
  assert.match(server,/CONSTRUCTION_LOAN_TRANSACTION:constructionLoanTransaction/);assert.match(server,/createAiConstructionLoanControllerScanService/);
  assert.match(down,/DROP FUNCTION refs_read_ai_construction_loan_source\(uuid,uuid,uuid,integer\)/);
});
