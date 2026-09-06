import test from 'node:test';
import assert from 'node:assert/strict';
import {reportAccessFailure} from '../api/access-failure-diagnostics.mjs';

test('access diagnostics distinguish deployment, context, and grant failures without retaining sensitive details',()=>{
  const events=[];
  for(const message of ['Context issuer identity denied','Actor has no active DB authorization grant','Runtime context denied or expired','Tenant/entity scope denied','Permission AP.VIEW denied','permission denied for table confidential_company','secret-token-and-personal-data'])reportAccessFailure({code:'42501',message,detail:'private',where:'private'},event=>events.push(event));
  assert.deepEqual(events.map(event=>event.reason),['CONTEXT_ISSUER_IDENTITY','NO_ACTIVE_GRANT','CONTEXT_BINDING','ENTITY_SCOPE','ENTITY_PERMISSION','DATABASE_OBJECT_PRIVILEGE','OTHER_DATABASE_ACCESS_DENIAL']);
  assert.doesNotMatch(JSON.stringify(events),/private|confidential_company|secret-token|AP.VIEW/);
  assert.ok(events.every(event=>Object.keys(event).length===3));
});

test('diagnostics neither log unrelated errors nor change the response when logging fails',()=>{
  reportAccessFailure({code:'23505',message:'private'},()=>assert.fail('unrelated error logged'));
  assert.doesNotThrow(()=>reportAccessFailure({code:'42501',message:'Tenant/entity scope denied'},()=>{throw new Error('log unavailable');}));
});
