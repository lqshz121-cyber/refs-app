import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {createAccountingApi} from '../api/accounting-http.mjs';
import {PostgresAccountingKernel} from '../runtime/kernel-repository.mjs';

test('COA and register SQL are entity-scoped, POSTED-only, fixed-decimal reads with no mutations',async()=>{
  const up=await readFile(new URL('../db/migrations/083_chart_of_accounts_register_read.sql',import.meta.url),'utf8');
  const down=await readFile(new URL('../db/migrations/down/083_chart_of_accounts_register_read.sql',import.meta.url),'utf8');
  for(const token of ['refs_list_chart_of_accounts',"'GL.REPORT.VIEW'",'refs_list_account_register',"'GL.JE.VIEW'",'refs_assert_scope',"j.status='POSTED'",'numeric\\(20,4\\)','PARTITION BY s.currency','source_document_ids','REVOKE ALL','GRANT EXECUTE'])assert.match(up,new RegExp(token));
  assert.doesNotMatch(up,/\b(?:INSERT INTO|UPDATE|DELETE FROM|refs_post_journal|refs_create_|refs_transition_)\b/i);
  assert.match(down,/DROP FUNCTION IF EXISTS refs_list_account_register/);assert.match(down,/DROP FUNCTION IF EXISTS refs_list_chart_of_accounts/);
});

test('repository and HTTP expose exact authenticated no-store COA and register GET contracts',async()=>{
  const calls=[],kernel=Object.create(PostgresAccountingKernel.prototype);kernel.inSession=async work=>work({query:async(sql,args)=>{calls.push({sql,args});return {rows:[]};}});
  await kernel.listChartOfAccounts({tenantId:'t',entityId:'e',periodId:'p'});await kernel.listAccountRegister({tenantId:'t',entityId:'e',periodId:'p',accountCode:'111000'});
  assert.deepEqual(calls,[{sql:'SELECT * FROM refs_list_chart_of_accounts($1,$2,$3)',args:['t','e','p']},{sql:'SELECT * FROM refs_list_account_register($1,$2,$3,$4)',args:['t','e','p','111000']}]);
  const tenantId=randomUUID(),entityId=randomUUID(),periodId=randomUUID(),scopes=[];
  const api=createAccountingApi({authenticate:async()=>({trusted:true,tenantId,actorId:'reader'}),kernelFactory:async()=>({listChartOfAccounts:async scope=>{scopes.push(['coa',scope]);return [];},listAccountRegister:async scope=>{scopes.push(['register',scope]);return [];}})});
  const coa=`/api/v1/entities/${entityId}/general-ledger/chart-of-accounts?periodId=${periodId}`;
  const register=`/api/v1/entities/${entityId}/general-ledger/account-register?periodId=${periodId}&accountCode=111000`;
  for(const url of [coa,register]){const response=await api({method:'GET',url,headers:{},body:null});assert.equal(response.status,200);assert.equal(response.headers['cache-control'],'no-store');}
  assert.deepEqual(scopes,[['coa',{tenantId,entityId,periodId}],['register',{tenantId,entityId,periodId,accountCode:'111000'}]]);
  assert.equal((await api({method:'GET',url:`${register}&extra=1`,headers:{},body:null})).body.code,'UNEXPECTED_QUERY_PARAMETER');
  assert.equal((await api({method:'GET',url:register.replace('111000','invalid account'),headers:{},body:null})).body.code,'INVALID_QUERY_PARAMETER');
  assert.equal((await api({method:'GET',url:coa,headers:{'idempotency-key':'not-allowed'},body:null})).body.code,'IDEMPOTENCY_KEY_NOT_ALLOWED');
  assert.equal((await api({method:'GET',url:register,headers:{},body:{}})).body.code,'READ_BODY_FORBIDDEN');
});
