import test from 'node:test';import assert from 'node:assert/strict';
import {PostgresAccountingKernel} from '../runtime/kernel-repository.mjs';
test('bank request check uses authenticated inSession and exact database assertion only',async()=>{
  const calls=[];let sessions=0;
  const receiver={async inSession(work){sessions++;return work({async query(sql,args){calls.push({sql,args});return {rows:[{}]};}});}};
  assert.equal(await PostgresAccountingKernel.prototype.assertBoundedWbsBankImportRequest.call(receiver,{tenantId:'tenant',entityId:'entity',periodId:'period',companyCode:'WBPA',dateFrom:'2026-06-01',dateTo:'2026-06-30',limit:10,actorId:'spoofed'}),true);
  assert.equal(sessions,1);
  assert.deepEqual(calls,[{sql:'SELECT refs_assert_bounded_wbs_bank_import_request($1,$2,$3,$4,$5::date,$6::date,$7::integer)',args:['tenant','entity','period','WBPA','2026-06-01','2026-06-30',10]}]);
});
test('kernel request assertion propagates revoked permission and absent migration without fallback',async()=>{
  for(const code of ['42501','42883','55000']){
    const denial=Object.assign(new Error('denied'),{code});
    await assert.rejects(PostgresAccountingKernel.prototype.assertBoundedWbsBankImportRequest.call({async inSession(){throw denial;}},{}),error=>error===denial);
  }
});
