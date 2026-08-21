import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';

const up=await readFile(new URL('../db/migrations/229_ai_legacy_findings_period_read.sql',import.meta.url),'utf8');
const down=await readFile(new URL('../db/migrations/down/229_ai_legacy_findings_period_read.sql',import.meta.url),'utf8');
const kernel=await readFile(new URL('../runtime/kernel-repository.mjs',import.meta.url),'utf8');
const names=['prepaid_coverage','duplicate_payable','cost_dimension','loan_reference'];

test('legacy immutable findings receive exact primary-period analysis-only readers',()=>{
  for(const name of names){
    assert.match(up,new RegExp(`CREATE FUNCTION refs_read_ai_${name}_findings_for_period\\(`));
    assert.match(up,new RegExp(`GRANT EXECUTE ON FUNCTION refs_read_ai_${name}_findings_for_period\\(uuid,uuid,uuid,integer\\) TO refs_app`));
    assert.match(down,new RegExp(`DROP FUNCTION IF EXISTS refs_read_ai_${name}_findings_for_period\\(uuid,uuid,uuid,integer\\)`));
  }
  assert.equal((up.match(/refs_assert_scope\(p_tenant,p_entity,'AI\.ANALYSIS\.EXPLAIN'\)/g)||[]).length,4);
  // Each reader validates the period before reading and repeats the same exact
  // primary-period predicate in its source join.
  assert.equal((up.match(/p\.period_id=p_period AND p\.ledger_code='PRIMARY'/g)||[]).length,8);
  assert.doesNotMatch(up,/AI\.AMORTIZATION\.PROPOSE/);
  assert.doesNotMatch(up,/\b(?:INSERT|UPDATE|DELETE)\s+(?:INTO|FROM|[A-Za-z_])/i);
});

test('period binding uses authoritative accounting dates and duplicate pairs retain either current-period side',()=>{
  assert.equal((up.match(/d\.accounting_date BETWEEN p\.starts_on AND p\.ends_on/g)||[]).length,3);
  assert.match(up,/d1\.accounting_date BETWEEN p\.starts_on AND p\.ends_on OR d2\.accounting_date BETWEEN p\.starts_on AND p\.ends_on/);
  assert.equal((up.match(/false,false,false,false/g)||[]).length,4);
  assert.equal((up.match(/p_limit<1 OR p_limit>100/g)||[]).length,3);
  assert.equal((up.match(/p_limit<1 OR p_limit>500/g)||[]).length,1);
});

test('repository exposes exact four-argument readers only for the new scan seams',()=>{
  for(const method of ['PrepaidCoverage','DuplicatePayable','CostDimension','LoanReference'])assert.match(kernel,new RegExp(`listAi${method}FindingsForPeriod\\(\\{tenantId,entityId,periodId,limit=50\\}\\)`));
  for(const name of names)assert.match(kernel,new RegExp(`refs_read_ai_${name}_findings_for_period\\(\\$1,\\$2,\\$3,\\$4\\)`));
});

test('duplicate reader supports the complete bounded invoice-classification population',()=>{
  const duplicateBody=up.slice(up.indexOf('CREATE FUNCTION refs_read_ai_duplicate_payable_findings_for_period'),up.indexOf('CREATE FUNCTION refs_read_ai_cost_dimension_findings_for_period'));
  assert.match(duplicateBody,/p_limit>500/);assert.doesNotMatch(duplicateBody,/p_limit>100/);
});
