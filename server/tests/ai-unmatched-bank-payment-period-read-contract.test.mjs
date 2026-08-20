import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';

const up=await readFile(new URL('../db/migrations/228_ai_unmatched_bank_payment_period_read.sql',import.meta.url),'utf8');
const down=await readFile(new URL('../db/migrations/down/228_ai_unmatched_bank_payment_period_read.sql',import.meta.url),'utf8');

test('period-scoped unmatched bank read uses analysis-only authority and exact primary-period dates',()=>{
  assert.match(up,/refs_assert_scope\(p_tenant,p_entity,'AI\.ANALYSIS\.EXPLAIN'\)/);
  assert.match(up,/p\.period_id=p_period AND p\.ledger_code='PRIMARY'/);
  assert.match(up,/f\.transaction_date BETWEEN period_row\.starts_on AND period_row\.ends_on/);
  assert.match(up,/p_period,/);assert.match(up,/false,false,false,false/);
  assert.doesNotMatch(up,/AI\.AMORTIZATION\.PROPOSE/);
  assert.doesNotMatch(up,/\bINSERT\b|\bUPDATE\b|\bDELETE\b/i);
});

test('period-scoped reader is bounded, granted only for execution, and reversible',()=>{
  assert.match(up,/p_limit<1 OR p_limit>100/);
  assert.match(up,/REVOKE ALL ON FUNCTION refs_read_ai_unmatched_bank_payment_findings_for_period/);
  assert.match(up,/GRANT EXECUTE ON FUNCTION refs_read_ai_unmatched_bank_payment_findings_for_period\(uuid,uuid,uuid,integer\) TO refs_app/);
  assert.match(down,/DROP FUNCTION IF EXISTS refs_read_ai_unmatched_bank_payment_findings_for_period\(uuid,uuid,uuid,integer\)/);
});

test('repository exposes only the exact four-argument period reader',async()=>{
  const source=await readFile(new URL('../runtime/kernel-repository.mjs',import.meta.url),'utf8');
  assert.match(source,/listAiUnmatchedBankPaymentFindingsForPeriod\(\{tenantId,entityId,periodId,limit=50\}\)/);
  assert.match(source,/refs_read_ai_unmatched_bank_payment_findings_for_period\(\$1,\$2,\$3,\$4\)/);
});
