import test from 'node:test';
import assert from 'node:assert/strict';
import {FIXTURES,fixtureResult,readTapSummary,selectFixtures} from '../runtime/run-postgres-fixture-suite.mjs';

test('PostgreSQL fixture suite names each isolated accounting closure explicitly',()=>{
  assert.deepEqual(FIXTURES.map(item=>item.id),['controlled-ap-close','ar-rent-pickup-close','signed-wbs-payable-post','signed-bank-same-source-close','bank-reconcile-close','bank-match-unmatch-controls','reconciliation-governance-snapshot','reconciliation-lifecycle-close','ai-exception-lineage','ai-amortization-human-close','dimension-profitability-close','cash-flow-close','cwip-rollforward-close','construction-loan-rollforward-close','prepaid-rollforward-close','intercompany-reconciliation-close','budget-vs-actual-close','consolidation-close']);
  assert.ok(FIXTURES.every(item=>typeof item.pattern==='string'&&item.pattern.length>20));
  assert.deepEqual(selectFixtures().map(item=>item.id),FIXTURES.map(item=>item.id));
  assert.deepEqual(selectFixtures(['--fixture','bank-reconcile-close']).map(item=>item.id),['bank-reconcile-close']);
  assert.deepEqual(selectFixtures(['--fixture','signed-bank-same-source-close']).map(item=>item.id),['signed-bank-same-source-close']);
});

test('PostgreSQL fixture suite fails closed for malformed or unknown selection',()=>{
  assert.throws(()=>selectFixtures(['--fixture']),/Usage/);
  assert.throws(()=>selectFixtures(['--fixture','not-a-fixture']),/Unknown PostgreSQL fixture/);
});

test('PostgreSQL fixture suite fails closed unless its named test actually passes without skips',()=>{
  const output='# tests 1\n# pass 1\n# fail 0\n# skipped 0\n';
  assert.deepEqual(readTapSummary(output),{tests:1,pass:1,fail:0,skipped:0});
  assert.equal(fixtureResult({id:'fixture',exitCode:0,output,durationMs:1}).exitCode,0);
  for(const rejected of [
    '# tests 0\n# pass 0\n# fail 0\n# skipped 0\n',
    '# tests 1\n# pass 0\n# fail 0\n# skipped 1\n',
    '# tests 1\n# pass 1\n# fail 1\n# skipped 0\n',
    'no TAP summary'
  ])assert.equal(fixtureResult({id:'fixture',exitCode:0,output:rejected,durationMs:1}).exitCode,1);
});
