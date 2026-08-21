import test from 'node:test';
import assert from 'node:assert/strict';
import {PostgresAccountingKernel} from '../runtime/kernel-repository.mjs';

test('scope catalog repository is tenant-bound and returns only context-allowed entities',async()=>{
  const calls=[];const kernel=Object.create(PostgresAccountingKernel.prototype);
  kernel.inSession=work=>work({query:async(sql,args)=>{calls.push({sql,args});return {rows:[{period_start:new Date(2026,0,1),period_end:new Date(2026,0,31)}]};}});
  const rows=await kernel.listAccountingScopes({tenantId:'tenant'});
  assert.equal(calls[0].args[0],'tenant');assert.match(calls[0].sql,/e\.tenant_id=\$1/);assert.match(calls[0].sql,/refs_entity_allowed\(e\.entity_id\) IS TRUE/);
  assert.deepEqual(rows,[{period_start:'2026-01-01',period_end:'2026-01-31'}]);
});
