import test from 'node:test';import assert from 'node:assert/strict';
import {PostgresContextIssuer} from '../runtime/context-issuer.mjs';

function simulatedPool(failures,{phase='ISSUE'}={}){
  const state={attempts:0,released:0,rollbacks:0,hashes:[],functions:[]};
  const pool={connect:async()=>{
    const attempt=++state.attempts;
    return {release:()=>{state.released++;},query:async(sql,args)=>{
      const issue=sql.includes('refs_issue_context')||sql.includes('refs_issue_read_context');
      if(issue){state.hashes.push(args[2]);state.functions.push(sql.includes('refs_issue_read_context')?'READ':'WRITE');}
      if(sql==='ROLLBACK')state.rollbacks++;
      if(failures[attempt-1]&&((phase==='ISSUE'&&issue)||(phase==='COMMIT'&&sql==='COMMIT'))){throw Object.assign(new Error('controlled database conflict'),{code:failures[attempt-1]});}
      return issue?{rowCount:1,rows:[{expires_at:'2026-09-08T10:00:00Z'}]}:{rowCount:0,rows:[]};
    }};
  }};
  return {pool,state};
}

test('context issuance retries statement and commit conflicts with one principal and token identity',async()=>{
  for(const [readOnly,code,phase] of [[false,'40001','COMMIT'],[true,'40P01','ISSUE']]){
    const {pool,state}=simulatedPool([code],{phase});let principals=0;
    const issuer=new PostgresContextIssuer(pool,{principalProvider:async()=>{principals++;return {trusted:true,actorId:'fixture-actor'};}});
    const result=await issuer.issue({tenantId:'fixture-tenant',readOnly});
    assert.equal(result.trusted,true);assert.equal(result.expiresAt,'2026-09-08T10:00:00Z');
    assert.equal(principals,1);assert.equal(state.attempts,2);assert.equal(state.released,2);assert.equal(state.rollbacks,1);
    assert.equal(new Set(state.hashes).size,1);assert.equal(state.functions.every(value=>value===(readOnly?'READ':'WRITE')),true);
  }
});

test('context issuance stops at the existing bounded serialization retry limit',async()=>{
  const {pool,state}=simulatedPool(['40001','40001','40001','40001']);
  const issuer=new PostgresContextIssuer(pool,{principalProvider:async()=>({trusted:true,actorId:'fixture-actor'})});
  await assert.rejects(issuer.issue({tenantId:'fixture-tenant'}),error=>error.code==='40001');
  assert.equal(state.attempts,4);assert.equal(state.released,4);assert.equal(state.rollbacks,4);assert.equal(new Set(state.hashes).size,1);
});

test('context issuance does not retry authorization denials or accept an untrusted principal',async()=>{
  const {pool,state}=simulatedPool(['42501']);
  const issuer=new PostgresContextIssuer(pool,{principalProvider:async()=>({trusted:true,actorId:'fixture-actor'})});
  await assert.rejects(issuer.issue({tenantId:'fixture-tenant'}),error=>error.code==='42501');assert.equal(state.attempts,1);
  const denied=new PostgresContextIssuer(pool,{principalProvider:async()=>({trusted:false,actorId:'fixture-actor'})});
  await assert.rejects(denied.issue({tenantId:'fixture-tenant'}),error=>error.code==='AUTHENTICATED_PRINCIPAL_REQUIRED');assert.equal(state.attempts,1);
});
