import test from 'node:test';
import assert from 'node:assert/strict';
import {reportAccessFailure} from '../api/access-failure-diagnostics.mjs';
import {PostgresAccountingKernel} from '../runtime/kernel-repository.mjs';

test('database timeout diagnostics retain a closed stage and never raw database details',async()=>{
  for(const stage of ['CONTEXT_ISSUE','CONTEXT_BIND','DATABASE_OPERATION']){
    const failure=Object.assign(new Error('private query and token'),{code:'57014'});
    const kernel=new PostgresAccountingKernel({connect:async()=>({
      query:async sql=>{
        if(sql.startsWith('SELECT session_user'))return {rowCount:1,rows:[{session_user:'refs_runtime',current_user:'refs_runtime',is_superuser:false}]};
        if(sql.startsWith('SELECT refs_bootstrap_context')&&stage==='CONTEXT_BIND')throw failure;
        return {rowCount:1,rows:[]};
      },release(){}
    })},{sessionProvider:async()=>{if(stage==='CONTEXT_ISSUE')throw failure;return {trusted:true,contextToken:'x'.repeat(40)};}});
    await assert.rejects(kernel.inSession(async()=>{throw failure;}),error=>error===failure);
    const events=[];reportAccessFailure(failure,event=>events.push(event));
    assert.deepEqual(events,[{event:'accounting_database_timeout',sqlstate:'57014',stage}]);
  }
  const events=[];reportAccessFailure({code:'57014',accountingDatabaseStage:'private value'},event=>events.push(event));
  assert.equal(events[0].stage,'UNKNOWN');
});

test('access diagnostics distinguish deployment, context, and grant failures without retaining sensitive details',()=>{
  const events=[];
  for(const message of ['Context issuer identity denied','Actor has no active DB authorization grant','Runtime context denied or expired','Tenant/entity scope denied','Permission AP.VIEW denied','permission denied for table confidential_company','secret-token-and-personal-data'])reportAccessFailure({code:'42501',message,detail:'private',where:'private'},event=>events.push(event));
  assert.deepEqual(events.map(event=>event.reason),['CONTEXT_ISSUER_IDENTITY','NO_ACTIVE_GRANT','CONTEXT_BINDING','ENTITY_SCOPE','ENTITY_PERMISSION','DATABASE_OBJECT_PRIVILEGE','OTHER_DATABASE_ACCESS_DENIAL']);
  assert.doesNotMatch(JSON.stringify(events),/private|confidential_company|secret-token|AP.VIEW/);
  assert.ok(events.every(event=>Object.keys(event).length===5&&/^[a-f0-9]{64}$/.test(event.signature)));
  assert.equal(new Set(events.map(event=>event.signature)).size,events.length);
});

test('context trigger and database deployment failures remain distinct without logging stack text',()=>{
  const events=[];
  for(const message of ['Human write authority requires a finite exact-role grant','Service-only permission requires an exact SERVICE authority grant','Human permission grant authority does not match its frozen workflow class','Service authority contains a non-service permission','Writable permission is outside the closed authority matrix','Actor has mutually exclusive workflow authorities in one entity','permission denied to set role "private-role"','new row violates row-level security policy for table "private-table"'])reportAccessFailure({code:'42501',message,where:'PL/pgSQL function refs_issue_context(text,uuid,text,integer) private payload'},event=>events.push(event));
  assert.deepEqual(events.map(event=>event.reason),['HUMAN_AUTHORITY_EXPIRY','SERVICE_AUTHORITY_MISMATCH','HUMAN_AUTHORITY_MISMATCH','SERVICE_PERMISSION_MISMATCH','AUTHORITY_MATRIX','AUTHORITY_CONFLICT','DATABASE_ROLE_MEMBERSHIP','DATABASE_ROW_POLICY']);
  assert.ok(events.every(event=>event.stage==='CONTEXT_ISSUE'));
  assert.doesNotMatch(JSON.stringify(events),/private|payload|refs_issue_context/);
});

test('diagnostics neither log unrelated errors nor change the response when logging fails',()=>{
  reportAccessFailure({code:'23505',message:'private'},()=>assert.fail('unrelated error logged'));
  assert.doesNotThrow(()=>reportAccessFailure({code:'42501',message:'Tenant/entity scope denied'},()=>{throw new Error('log unavailable');}));
});
