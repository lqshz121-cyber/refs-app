import assert from 'node:assert/strict';
import test from 'node:test';
import {PostgresAccountingKernel} from '../runtime/kernel-repository.mjs';

const tenantId='6fb25daf-0799-4805-bede-be54230da33c',entityId='ca8d23c7-0ea6-4860-8e3e-caf9a3e22ce3',periodId='4e0b2744-2366-46d5-8b34-6ccf49deaabf';
const makeKernel=(rows=[])=>{const calls=[],kernel=Object.create(PostgresAccountingKernel.prototype);kernel.inSession=async work=>work({query:async(sql,params)=>{calls.push({sql,params});const resultRows=/FROM accounting_period/.test(sql)?[{period_id:periodId,period_code:'2026-08',period_ordinal:24320}]:rows;return {rows:resultRows,rowCount:resultRows.length};}});return {kernel,calls};};

test('AI accrual repository reads only current Final-1 retained evidence under the explain capability',async()=>{
  const {kernel,calls}=makeKernel([{source_document_id:'00000000-0000-4000-8000-000000000001'}]);
  const history=await kernel.listAiAccrualRetainedHistory({tenantId,entityId,currentPeriodId:periodId,limit:12});
  const current=await kernel.listAiAccrualCurrentSourceIds({tenantId,entityId,currentPeriodId:periodId,recurringObligationId:'WBS-OBL-1'});
  const posted=await kernel.listAiAccrualPostedSourceIds({tenantId,entityId,currentPeriodId:periodId,recurringObligationId:'WBS-OBL-1'});
  const period=await kernel.readAiAccrualAnalysisPeriod({tenantId,entityId,currentPeriodId:periodId});
  assert.equal(history.length,1);assert.deepEqual(current,['00000000-0000-4000-8000-000000000001']);assert.deepEqual(posted,['00000000-0000-4000-8000-000000000001']);assert.equal(period.period_id,periodId);assert.equal(period.company_code,undefined);
  const sql=calls.map(call=>call.sql).join('\n');
  assert.match(sql,/refs_assert_scope\(\$1,\$2,'AI\.ANALYSIS\.EXPLAIN'\)/);assert.match(sql,/wbs_final1_retained_source_row/);assert.match(sql,/d\.source_entity_id/);assert.match(sql,/e\.source_entity_id AS company_code/);assert.match(sql,/e\.is_current/);assert.match(sql,/j\.status='POSTED'/);
  assert.doesNotMatch(sql,/AND NOT \(/);assert.doesNotMatch(sql,/external_dimension_refs\s*\?&\s*ARRAY\['signed_invoice_no'/);assert.doesNotMatch(sql,/external_dimension_refs->'signed_service_period_start'\s*(?:<>|=)\s*'null'::jsonb/);
  assert.match(sql,/FROM accounting_period/);assert.doesNotMatch(sql,/INSERT|UPDATE|DELETE|CREATE\s+JOURNAL/i);
});
