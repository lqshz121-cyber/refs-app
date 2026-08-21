import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PostgresAccountingKernel} from '../runtime/kernel-repository.mjs';

test('260 reads the completed H1 month through one scoped security-definer receipt',async()=>{
  const up=await readFile(new URL('../db/migrations/260_wbs_h1_completion_receipt_read.sql',import.meta.url),'utf8');
  assert.match(up,/refs_assert_scope\(p_tenant,p_entity,'WBS\.TEST\.IMPORT'\)/);
  assert.match(up,/wbs_test_import_draft_completion_scope_idx/);
  assert.match(up,/wbs_controlled_test_bank_import_completion_scope_idx/);
  assert.match(up,/h\.h1_count>0 AND q\.month_count>0 AND b\.import_count=1 AND b\.row_count>0/);
  assert.doesNotMatch(up,/journal_entry|source_document/);

  const calls=[];
  const client={query:async(sql,args)=>{
    calls.push({sql,args});
    if(sql.includes('session_user'))return {rowCount:1,rows:[{session_user:'refs_runtime',current_user:'refs_runtime',is_superuser:false}]};
    if(sql.includes('refs_bootstrap_context'))return {rowCount:1,rows:[{}]};
    return {rowCount:1,rows:[{result:{period_id:'00000000-0000-4000-8000-000000000001',starts_on:'2026-01-01',ends_on:'2026-01-31',h1_count:60,month_count:10,import_count:1,row_count:12,reconciliation_id:'00000000-0000-4000-8000-000000000002'}}]};
  }};
  const pool={connect:async()=>({...client,release(){}})};
  const kernel=new PostgresAccountingKernel(pool,{sessionProvider:async()=>({trusted:true,contextToken:'x'.repeat(32)})});
  const result=await kernel.readCompletedWbsTestMonthImport({tenantId:'tenant',entityId:'entity',companyCode:'WBPA',periodCode:'2026-01'});
  assert.equal(result.status,'WBS_TEST_MONTH_IMPORT_COMPLETE');
  assert.equal(result.payables.h1_record_count,60);
  assert.equal(result.payables.record_count,10);
  assert.equal(result.bank.record_count,12);
  const read=calls.find(call=>call.sql.includes('refs_read_wbs_h1_month_completion'));
  assert.deepEqual(read.args,['tenant','entity','WBPA','2026-01']);
  assert.doesNotMatch(read.sql,/wbs_test_import_draft|journal_entry|source_document/);
});

test('260 rollback removes only its function and indexes',async()=>{
  const down=await readFile(new URL('../db/migrations/down/260_wbs_h1_completion_receipt_read.sql',import.meta.url),'utf8');
  assert.match(down,/DROP FUNCTION refs_read_wbs_h1_month_completion/);
  assert.match(down,/DROP INDEX wbs_controlled_test_bank_import_completion_scope_idx/);
  assert.match(down,/DROP INDEX wbs_test_import_draft_completion_scope_idx/);
  assert.doesNotMatch(down,/DROP TABLE/);
});
