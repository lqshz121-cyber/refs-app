import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {createAccountingApi} from '../api/accounting-http.mjs';
import {PostgresAccountingKernel} from '../runtime/kernel-repository.mjs';

test('source-document SQL exposes entity-scoped immutable evidence only',async()=>{
  const up=await readFile(new URL('../db/migrations/084_source_document_read.sql',import.meta.url),'utf8');
  const down=await readFile(new URL('../db/migrations/down/084_source_document_read.sql',import.meta.url),'utf8');
  for(const token of ['refs_list_source_documents','refs_get_source_document_detail',"'GL.JE.VIEW'",'refs_assert_scope','source_document_line','source_link',"j.status='POSTED'",'payload_hash','REVOKE ALL','GRANT EXECUTE'])assert.match(up,new RegExp(token));
  assert.doesNotMatch(up,/\b(?:INSERT INTO|UPDATE|DELETE FROM|refs_post_journal|refs_create_|attachment_storage|storage_ref|raw_event\.payload)\b/i);
  assert.match(down,/DROP FUNCTION IF EXISTS refs_get_source_document_detail/);assert.match(down,/DROP FUNCTION IF EXISTS refs_list_source_documents/);
});

test('repository and HTTP expose exact no-store source-document GET contracts',async()=>{
  const calls=[],kernel=Object.create(PostgresAccountingKernel.prototype);kernel.inSession=async work=>work({query:async(sql,args)=>{calls.push({sql,args});return {rows:[]};}});
  await kernel.listSourceDocuments({tenantId:'t',entityId:'e'});await kernel.getSourceDocumentDetail({tenantId:'t',entityId:'e',sourceDocumentId:'d'});
  assert.deepEqual(calls,[{sql:'SELECT * FROM refs_list_source_documents($1,$2)',args:['t','e']},{sql:'SELECT * FROM refs_get_source_document_detail($1,$2,$3)',args:['t','e','d']}]);
  const tenantId=randomUUID(),entityId=randomUUID(),sourceDocumentId=randomUUID(),scopes=[];
  const api=createAccountingApi({authenticate:async()=>({trusted:true,tenantId,actorId:'reader'}),kernelFactory:async()=>({listSourceDocuments:async scope=>{scopes.push(['list',scope]);return [];},getSourceDocumentDetail:async scope=>{scopes.push(['detail',scope]);return [];}})});
  const list=`/api/v1/entities/${entityId}/source-documents`,detail=`${list}/${sourceDocumentId}`;
  for(const url of [list,detail]){const response=await api({method:'GET',url,headers:{},body:null});assert.equal(response.status,200);assert.equal(response.headers['cache-control'],'no-store');}
  assert.deepEqual(scopes,[['list',{tenantId,entityId}],['detail',{tenantId,entityId,sourceDocumentId}]]);
  assert.equal((await api({method:'GET',url:`${detail}?extra=1`,headers:{},body:null})).body.code,'UNEXPECTED_QUERY_PARAMETER');
  assert.equal((await api({method:'GET',url:`${list}/not-a-uuid`,headers:{},body:null})).body.code,'INVALID_PATH_PARAMETER');
  assert.equal((await api({method:'GET',url:list,headers:{'idempotency-key':'not-allowed'},body:null})).body.code,'IDEMPOTENCY_KEY_NOT_ALLOWED');
  assert.equal((await api({method:'GET',url:detail,headers:{},body:{}})).body.code,'READ_BODY_FORBIDDEN');
});
