import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {createAccountingApi} from '../api/accounting-http.mjs';
import {PostgresAccountingKernel} from '../runtime/kernel-repository.mjs';

test('bounded controlled AI source contracts are explicitly wired into routine CI scripts',async()=>{
  const [serverPackage,rootPackage]=await Promise.all([
    readFile(new URL('../package.json',import.meta.url),'utf8'),
    readFile(new URL('../../package.json',import.meta.url),'utf8')
  ]);
  assert.match(JSON.parse(serverPackage).scripts.posttest,/(?:^|\s)tests\/controlled-test-ai-source-read-contract\.test\.mjs(?:\s|$)/);
  assert.match(JSON.parse(rootPackage).scripts['test:authoritative-ai-audit'],/(?:^|\s)node tests\/authoritative-controlled-test-ai-source\.test\.js(?:\s|$)/);
});

test('migration 186 exposes only a bounded exact OPEN-period WBS TEST payable read',async()=>{
  const [up,down]=await Promise.all([
    readFile(new URL('../db/migrations/186_controlled_test_ai_source_read.sql',import.meta.url),'utf8'),
    readFile(new URL('../db/migrations/down/186_controlled_test_ai_source_read.sql',import.meta.url),'utf8')
  ]);
  for(const token of ['refs_list_controlled_test_ai_sources',"'GL.JE.VIEW'","e.source_system IN ('WBS','REFS_STAGE1')",'d.source_system=v_source_system',"source_module='payable'","document_type='WBS_TEST_PAYABLE'","status='POSTED'","p.status='OPEN'",'AND EXISTS(',"eligible_journal.status='POSTED'",'p_limit>100','LIMIT p_limit','REVOKE ALL','GRANT EXECUTE'])assert.match(up,new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
  assert.match(up,/accounting_date BETWEEN v_start AND v_end/);
  assert.doesNotMatch(up,/\b(?:INSERT INTO|UPDATE|DELETE FROM|refs_post_journal|raw_event\.payload)\b/i);
  assert.match(down,/DROP FUNCTION IF EXISTS refs_list_controlled_test_ai_sources/);
  assert.match(up,/CREATE INDEX source_link_source_document_posted_journal_lookup_idx/);
  assert.match(down,/DROP INDEX IF EXISTS source_link_source_document_posted_journal_lookup_idx/);
  assert.match(down,/DROP INDEX IF EXISTS source_document_wbs_test_payable_posted_period_idx/);
});

test('repository and HTTP expose the dedicated bounded no-store read without changing the general register',async()=>{
  const calls=[],kernel=Object.create(PostgresAccountingKernel.prototype);kernel.inSession=async work=>work({query:async(sql,args)=>{calls.push({sql,args});return {rows:[]};}});
  await kernel.listControlledTestAiSources({tenantId:'t',entityId:'e',periodId:'p',limit:100});
  assert.deepEqual(calls,[{sql:'SELECT * FROM refs_list_controlled_test_ai_sources($1,$2,$3,$4)',args:['t','e','p',100]}]);

  const tenantId=randomUUID(),entityId=randomUUID(),periodId=randomUUID(),scopes=[];
  const api=createAccountingApi({authenticate:async()=>({trusted:true,tenantId,actorId:'reader'}),kernelFactory:async()=>({listControlledTestAiSources:async scope=>{scopes.push(scope);return [];}})});
  const url=`/api/v1/entities/${entityId}/source-documents/controlled-test-ai-eligible?periodId=${periodId}&limit=100`;
  const response=await api({method:'GET',url,headers:{},body:null});
  assert.equal(response.status,200);assert.equal(response.headers['cache-control'],'no-store');assert.deepEqual(response.body,{ok:true,data:[]});
  assert.deepEqual(scopes,[{tenantId,entityId,periodId,limit:100}]);
  const defaulted=await api({method:'GET',url:url.replace('&limit=100',''),headers:{},body:null});
  assert.equal(defaulted.status,200);assert.deepEqual(scopes.at(-1),{tenantId,entityId,periodId,limit:100});
  assert.equal((await api({method:'GET',url:url.replace('limit=100','limit='),headers:{},body:null})).body.code,'INVALID_QUERY_PARAMETER');
  assert.equal((await api({method:'GET',url:`${url}&offset=1`,headers:{},body:null})).body.code,'UNEXPECTED_QUERY_PARAMETER');
  assert.equal((await api({method:'GET',url:url.replace('limit=100','limit=101'),headers:{},body:null})).body.code,'INVALID_QUERY_PARAMETER');
  assert.equal((await api({method:'GET',url,headers:{'if-match':'"0"'},body:null})).body.code,'IF_MATCH_NOT_ALLOWED');
  assert.equal((await api({method:'GET',url,headers:{},body:{}})).body.code,'READ_BODY_FORBIDDEN');
});
