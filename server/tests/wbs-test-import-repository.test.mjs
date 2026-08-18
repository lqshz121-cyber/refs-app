import test from 'node:test';
import assert from 'node:assert/strict';
import {PostgresAccountingKernel} from '../runtime/kernel-repository.mjs';

test('repository hashes and executes one atomic WBS test Payable Draft command',async()=>{
  const calls=[];
  const client={query:async(sql,args)=>{
    calls.push({sql,args});
    if(sql.includes('session_user'))return {rowCount:1,rows:[{session_user:'refs_runtime',current_user:'refs_runtime',is_superuser:false}]};
    if(sql.includes('refs_bootstrap_context'))return {rowCount:1,rows:[{}]};
    if(sql.includes('_hash('))return {rowCount:1,rows:[{request_hash:`sha256:${'a'.repeat(64)}`}]};
    return {rowCount:1,rows:[{result:{status:'DRAFT',test_only:true}}]};
  }};
  const pool={connect:async()=>({...client,release(){}})};
  const kernel=new PostgresAccountingKernel(pool,{sessionProvider:async()=>({trusted:true,contextToken:'x'.repeat(32)})});
  const observation={schema_version:'WBS_LIVE_PILOT_OBSERVATION_V1'},row={source_record_hash:`sha256:${'b'.repeat(64)}`};
  const result=await kernel.createWbsTestPayableDraft({tenantId:'tenant',entityId:'entity',periodId:'period',observation,row,rowIndex:0,idempotencyKey:'wbs-test-0001'});
  assert.deepEqual(result,{status:'DRAFT',test_only:true});
  const hashCall=calls.find(call=>call.sql.includes('refs_create_wbs_test_payable_draft_hash'));
  const commandCall=calls.find(call=>call.sql.includes('refs_create_wbs_test_payable_draft('));
  assert.deepEqual(hashCall.args,['tenant','entity','period',JSON.stringify(observation),JSON.stringify(row),0]);
  assert.deepEqual(commandCall.args,[...hashCall.args,'wbs-test-0001',`sha256:${'a'.repeat(64)}`]);
});

test('repository hashes and executes the exact post-workflow WBS test source finalizer',async()=>{
  const calls=[];
  const client={query:async(sql,args)=>{
    calls.push({sql,args});
    if(sql.includes('session_user'))return {rowCount:1,rows:[{session_user:'refs_runtime',current_user:'refs_runtime',is_superuser:false}]};
    if(sql.includes('refs_bootstrap_context'))return {rowCount:1,rows:[{}]};
    if(sql.includes('_hash('))return {rowCount:1,rows:[{request_hash:`sha256:${'c'.repeat(64)}`}]};
    return {rowCount:1,rows:[{result:{status:'POSTED',test_only:true,idempotent:false}}]};
  }};
  const pool={connect:async()=>({...client,release(){}})};
  const kernel=new PostgresAccountingKernel(pool,{sessionProvider:async()=>({trusted:true,contextToken:'x'.repeat(32)})});
  const payload=['tenant','entity','source','business','journal'];
  const result=await kernel.finalizeWbsTestImportSource({tenantId:payload[0],entityId:payload[1],sourceDocumentId:payload[2],businessDocumentId:payload[3],journalEntryId:payload[4],idempotencyKey:'wbs-test-finalize-0001'});
  assert.deepEqual(result,{status:'POSTED',test_only:true,idempotent:false});
  const hashCall=calls.find(call=>call.sql.includes('refs_finalize_wbs_test_import_source_hash'));
  const commandCall=calls.find(call=>call.sql.includes('refs_finalize_wbs_test_import_source('));
  assert.deepEqual(hashCall.args,payload);
  assert.deepEqual(commandCall.args,[...payload,'wbs-test-finalize-0001',`sha256:${'c'.repeat(64)}`]);
});
