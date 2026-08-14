import test from 'node:test';
import assert from 'node:assert/strict';
import {FIXTURES,selectFixtures} from '../runtime/run-postgres-fixture-suite.mjs';

test('PostgreSQL fixture suite names each isolated accounting closure explicitly',()=>{
  assert.deepEqual(FIXTURES.map(item=>item.id),['controlled-ap-close','ar-rent-pickup-close','signed-wbs-payable-post','bank-reconcile-close','ai-exception-lineage','real-estate-reports']);
  assert.ok(FIXTURES.every(item=>typeof item.pattern==='string'&&item.pattern.length>20));
  assert.deepEqual(selectFixtures().map(item=>item.id),FIXTURES.map(item=>item.id));
  assert.deepEqual(selectFixtures(['--fixture','bank-reconcile-close']).map(item=>item.id),['bank-reconcile-close']);
});

test('PostgreSQL fixture suite fails closed for malformed or unknown selection',()=>{
  assert.throws(()=>selectFixtures(['--fixture']),/Usage/);
  assert.throws(()=>selectFixtures(['--fixture','not-a-fixture']),/Unknown PostgreSQL fixture/);
});
