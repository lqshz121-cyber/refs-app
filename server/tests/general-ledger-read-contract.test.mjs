import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {createAccountingApi} from '../api/accounting-http.mjs';
import {PostgresAccountingKernel} from '../runtime/kernel-repository.mjs';

test('General Ledger migration is entity-scoped, POSTED-only, fixed-decimal and non-mutating',async()=>{
  const up=await readFile(new URL('../db/migrations/085_general_ledger_read.sql',import.meta.url),'utf8');
  const down=await readFile(new URL('../db/migrations/down/085_general_ledger_read.sql',import.meta.url),'utf8');
  for(const token of ['refs_list_general_ledger',"'GL.JE.VIEW'",'refs_assert_scope',"j.status='POSTED'",'numeric\\(20,4\\)','journal_entry_id','journal_line_id','ledger_line_id','source_document_ids','p_limit','p_offset','REVOKE ALL','GRANT EXECUTE'])assert.match(up,new RegExp(token));
  assert.doesNotMatch(up,/\b(?:INSERT INTO|UPDATE|DELETE FROM|refs_post_journal|refs_create_|refs_transition_)\b/i);assert.match(down,/DROP FUNCTION IF EXISTS refs_list_general_ledger/);
});
test('General Ledger period scope fix qualifies output-variable names before execution',async()=>{
  const up=await readFile(new URL('../db/migrations/088_general_ledger_period_scope_fix.sql',import.meta.url),'utf8');
  const down=await readFile(new URL('../db/migrations/down/088_general_ledger_period_scope_fix.sql',import.meta.url),'utf8');
  assert.match(up,/SELECT ap\.period_id,ap\.period_code,ap\.starts_on,ap\.ends_on INTO selected_period/);
  assert.match(up,/FROM public\.accounting_period ap/);
  assert.match(up,/WHERE ap\.tenant_id=p_tenant AND ap\.entity_id=p_entity AND ap\.period_id=p_period/);
  assert.doesNotMatch(up,/SELECT period_id,period_code,starts_on,ends_on INTO selected_period/);
  assert.match(down,/CREATE OR REPLACE FUNCTION refs_list_general_ledger/);
  assert.doesNotMatch(up,/\b(?:INSERT INTO|UPDATE|DELETE FROM|refs_post_journal|refs_create_|refs_transition_)\b/i);
});
test('repository and HTTP bind tenant, entity, period, query and page to no-store General Ledger GET',async()=>{
  const calls=[],kernel=Object.create(PostgresAccountingKernel.prototype);kernel.inSession=async work=>work({query:async(sql,args)=>{calls.push({sql,args});return {rows:[]};}});
  await kernel.listGeneralLedger({tenantId:'t',entityId:'e',periodId:'p',accountCode:null,query:'JE-100',limit:50,offset:100});
  assert.deepEqual(calls,[{sql:'SELECT * FROM refs_list_general_ledger($1,$2,$3,$4,$5,$6,$7)',args:['t','e','p',null,'JE-100',50,100]}]);
  const tenantId=randomUUID(),entityId=randomUUID(),periodId=randomUUID(),scopes=[];
  const api=createAccountingApi({authenticate:async()=>({trusted:true,tenantId,actorId:'reader'}),kernelFactory:async()=>({listGeneralLedger:async scope=>(scopes.push(scope),[])})});
  const url=`/api/v1/entities/${entityId}/general-ledger/entries?periodId=${periodId}&accountCode=610000&query=JE-100&limit=25&offset=25`;
  const response=await api({method:'GET',url,headers:{},body:null});assert.equal(response.status,200);assert.equal(response.headers['cache-control'],'no-store');
  assert.deepEqual(scopes,[{tenantId,entityId,periodId,accountCode:'610000',query:'JE-100',limit:25,offset:25}]);
  for(const [bad,code] of [[`${url}&unexpected=1`,'UNEXPECTED_QUERY_PARAMETER'],[url.replace('offset=25','offset=-1'),'INVALID_QUERY_PARAMETER'],[url.replace('query=JE-100','query=%20'),'INVALID_QUERY_PARAMETER']])assert.equal((await api({method:'GET',url:bad,headers:{},body:null})).body.code,code);
  assert.equal((await api({method:'GET',url,headers:{'idempotency-key':'not-allowed'},body:null})).body.code,'IDEMPOTENCY_KEY_NOT_ALLOWED');
});
