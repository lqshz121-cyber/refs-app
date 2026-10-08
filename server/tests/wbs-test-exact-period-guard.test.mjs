import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {PostgresAccountingKernel} from '../runtime/kernel-repository.mjs';
import {MIGRATION_MANIFEST} from '../runtime/migration-manifest.mjs';

for(const method of ['retainWbsTestPayableSource','createWbsControlledTestBankScope']){
  test(`${method} fails before hash or persistence when database period guard rejects`,async()=>{
    const calls=[],error=Object.assign(new Error('outside exact period'),{code:'22023'});
    const context={inSession:async work=>work({query:async(...args)=>{calls.push(args);throw error;}})};
    const row={accounting_date:'2026-05-31'};
    await assert.rejects(PostgresAccountingKernel.prototype[method].call(context,{tenantId:'tenant',entityId:'entity',periodId:'period',row,observation:{rows:[row]}}),actual=>actual===error);
    assert.equal(calls.length,1);
    assert.equal(calls[0][0],'SELECT refs_assert_wbs_test_exact_period($1,$2,$3,$4::jsonb)');
    assert.deepEqual(calls[0][1],['tenant','entity','period',JSON.stringify([row])]);
  });
}
for(const blockedTransaction of [2,3]){
  test(`Bank transaction ${blockedTransaction} rejects closed period before chunk/finalize persistence`,async()=>{
    let transaction=0;const calls=[],error=Object.assign(new Error('closed period'),{code:'55000'});
    const context={inSession:async work=>{const current=++transaction;return work({query:async(sql,args)=>{
      calls.push({transaction:current,sql,args});
      if(sql.includes('refs_assert_wbs_test_exact_period')){if(current===blockedTransaction)throw error;return {rows:[]};}
      if(sql.includes('scope_hash'))return {rowCount:1,rows:[{request_hash:'hash'}]};
      if(sql.includes('refs_begin_wbs_test_bank_staged_import'))return {rowCount:1,rows:[{result:{status:'WBS_TEST_BANK_IMPORT_PARTIAL',stage_id:'stage',chunk_count:1,next_chunk_index:0}}]};
      if(sql.includes('refs_append_wbs_test_bank_staged_chunk'))return {rowCount:1,rows:[{result:{}}]};
      throw Error('Unexpected query after period rejection');
    }});}};
    const rows=[{accounting_date:'2026-06-01'}];
    await assert.rejects(PostgresAccountingKernel.prototype.createWbsControlledTestBankScope.call(context,{tenantId:'tenant',entityId:'entity',periodId:'period',companyCode:'WBPA',observation:{rows},bankAccountRef:'WBS_TEST_BANK',idempotencyKey:'closed-period'}),actual=>actual===error);
    const blocked=calls.filter(c=>c.transaction===blockedTransaction);
    assert.equal(blocked.length,1);assert.match(blocked[0].sql,/refs_assert_wbs_test_exact_period/);
    assert.deepEqual(blocked[0].args,['tenant','entity','period',JSON.stringify(rows)]);
    assert.equal(calls.some(c=>c.sql.includes('refs_finalize_wbs_test_bank_import_receipt')),false);
  });
}

test('forward guard and down checksums match manifest and do not alter historical retention',async()=>{
  const entry=MIGRATION_MANIFEST.find(row=>row.name==='452_wbs_test_exact_period_guard.sql');
  assert.ok(entry);
  for(const direction of ['up','down']){
    const content=await readFile(new URL(`../db/migrations/${direction==='down'?'down/':''}${entry.name}`,import.meta.url));
    assert.equal(createHash('sha256').update(content).digest('hex'),entry[direction]);
  }
  const sql=await readFile(new URL(`../db/migrations/${entry.name}`,import.meta.url),'utf8');
  assert.match(sql,/refs_assert_scope\(p_tenant,p_entity,'WBS.TEST.IMPORT'\)/);
  assert.match(sql,/ledger_code='PRIMARY' AND status='OPEN' FOR SHARE/);
  assert.match(sql,/source_date<selected_period.starts_on OR source_date>selected_period.ends_on/);
  assert.match(sql,/REVOKE ALL ON FUNCTION .* FROM PUBLIC/);
  assert.doesNotMatch(sql,/INSERT INTO|UPDATE accounting_period|CREATE OR REPLACE/);
});
