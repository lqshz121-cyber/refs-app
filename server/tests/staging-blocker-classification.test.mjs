// Z02: the classifier must separate the seven blocking conditions that all look like
// "the staging E2E did not work", and it must do so without credentials, without writes, and
// without leaking anything.
import test from 'node:test';
import assert from 'node:assert/strict';
import {classifyStagingBlocker, x04Disposition, BLOCKER_CLASSES, STAGING_BLOCKER_SCHEMA}
  from '../runtime/staging-blocker-classifier.mjs';

const SHA='a'.repeat(40);

test('Z02-1: each condition resolves to exactly one class, and to the action that clears it',()=>{
  const cases=[
    ['dependency switched on with no config',
      {missingConfigKeys:['S3_ENDPOINT','SCANNER_ENDPOINT']},'EXTERNAL_DEPENDENCY_UNCONFIGURED'],
    ['api not answering',
      {reachable:false},'API_UNREACHABLE'],
    ['edge 5xx',
      {reachable:true,httpStatus:503},'API_UNREACHABLE'],
    ['one service on the wrong build',
      {reachable:true,httpStatus:200,expectedSha:SHA,observedShas:{api:SHA,'internal-api':SHA,web:'b'.repeat(40),'internal-web':SHA}},'RELEASE_MISMATCH'],
    ['authenticated but no grant on the entity',
      {reachable:true,httpStatus:403,permissionDenied:{entityGranted:false}},'ROLE_MISSING'],
    ['granted on the entity but not for the verb',
      {reachable:true,httpStatus:403,permissionDenied:{entityGranted:true,permission:'GL.JE.POST'}},'STATEMENT_SCOPE_MISSING'],
    ['wbs leg switched off',
      {reachable:true,httpStatus:200,modes:{wbsLivePilotMode:'DISABLED'}},'WBS_DISABLED'],
    ['works, and the answer is empty',
      {reachable:true,httpStatus:200,resultCount:0},'EMPTY_DATA']
  ];
  for(const [label,observation,expected] of cases){
    const r=classifyStagingBlocker(observation);
    assert.equal(r.class,expected,label);
    assert.equal(r.schema_version,STAGING_BLOCKER_SCHEMA);
    assert.ok(r.action&&r.action.length>10,`${label}: every class must say how to clear it`);
  }
});

test('Z02-2: ROLE_MISSING and STATEMENT_SCOPE_MISSING are kept apart, because the fix differs',()=>{
  // Both are 403. One needs a grant on the entity, the other needs the grant widened to a verb.
  // Collapsing them sends the operator to the wrong person.
  const entity=classifyStagingBlocker({reachable:true,httpStatus:403,permissionDenied:{entityGranted:false}});
  const verb=classifyStagingBlocker({reachable:true,httpStatus:403,permissionDenied:{entityGranted:true,permission:'AP.BILL.WRITE_OFF.CREATE'}});
  assert.notEqual(entity.class,verb.class);
  assert.match(verb.diagnostics.join(' '),/AP\.BILL\.WRITE_OFF\.CREATE/,'the permission name is the actionable detail');
  // A bare 403 with no scope detail degrades to the broader class rather than guessing the narrower one.
  assert.equal(classifyStagingBlocker({reachable:true,httpStatus:403}).class,'ROLE_MISSING');
});

test('Z02-3: fail closed — anything unrecognised is blocking, never an implicit pass',()=>{
  for(const observation of [{},{reachable:true},{reachable:true,httpStatus:200},{reachable:true,httpStatus:418}]){
    const r=classifyStagingBlocker(observation);
    assert.equal(r.class,'UNCLASSIFIED',JSON.stringify(observation));
    assert.equal(r.blocking,true,'an unrecognised condition must block');
  }
  // A 200 with rows is not a blocker class at all -- it is simply not this classifier's business,
  // and it must not be silently reported as healthy either.
  assert.equal(classifyStagingBlocker({reachable:true,httpStatus:200,resultCount:5}).class,'UNCLASSIFIED');
});

test('Z02-4: config problems are diagnosed before anything else, because a process that will not boot answers nothing',()=>{
  // Even with drift and a 403 also present, the missing keys are the thing to fix first.
  const r=classifyStagingBlocker({
    missingConfigKeys:['OIDC_ISSUER'],reachable:false,httpStatus:403,
    expectedSha:SHA,observedShas:{api:'c'.repeat(40)}
  });
  assert.equal(r.class,'EXTERNAL_DEPENDENCY_UNCONFIGURED');
  // And release drift outranks authorisation, because a 403 from the wrong build proves nothing.
  const drift=classifyStagingBlocker({
    reachable:true,httpStatus:403,permissionDenied:{entityGranted:false},
    expectedSha:SHA,observedShas:{api:'d'.repeat(40)}
  });
  assert.equal(drift.class,'RELEASE_MISMATCH');
});

test('Z02-5: diagnostics carry names and codes, never secrets',()=>{
  const r=classifyStagingBlocker({missingConfigKeys:['S3_SECRET_ACCESS_KEY','WBS_CF_ACCESS_CLIENT_SECRET']});
  const text=JSON.stringify(r);
  // The KEY NAMES are the actionable output; no value may ever appear.
  assert.match(text,/S3_SECRET_ACCESS_KEY/,'the operator needs to know which key to set');
  for(const forbidden of ['sk_live','Bearer ','password=','-----BEGIN'])
    assert.ok(!text.includes(forbidden),`diagnostics must not contain ${forbidden}`);
  // Release drift reports which SERVICE drifted, not which SHA it is on.
  const drift=classifyStagingBlocker({reachable:true,httpStatus:200,expectedSha:SHA,observedShas:{web:'e'.repeat(40)}});
  assert.match(drift.diagnostics.join(' '),/release_drift_services=web/);
  assert.ok(!drift.diagnostics.join(' ').includes('e'.repeat(40)),'do not echo observed SHAs into diagnostics');
});

test('Z02-6: each class maps to a stop-or-continue disposition against the X04 nine-step script',()=>{
  const expectations=[
    ['EXTERNAL_DEPENDENCY_UNCONFIGURED',1,true],
    ['RELEASE_MISMATCH',2,true],
    ['API_UNREACHABLE',3,true],
    ['ROLE_MISSING',5,true],
    ['STATEMENT_SCOPE_MISSING',5,true],
    ['EMPTY_DATA',6,false],
    ['WBS_DISABLED',7,false]
  ];
  for(const [name,step,blocking] of expectations){
    const cls=BLOCKER_CLASSES[name];
    assert.equal(cls.x04_step,step,`${name} must name the X04 step it is detected at`);
    assert.equal(cls.blocking,blocking,`${name} blocking flag`);
    const d=x04Disposition({...cls,class:name});
    assert.equal(d.stop_at_step,blocking?step:null);
    assert.equal(d.continue_allowed,!blocking);
  }
  // The two non-fatal classes are recorded distinctly: an empty result is a pass, a disabled leg is not.
  assert.equal(x04Disposition({...BLOCKER_CLASSES.EMPTY_DATA,class:'EMPTY_DATA'}).record_as,'PASS_EMPTY');
  assert.equal(x04Disposition({...BLOCKER_CLASSES.WBS_DISABLED,class:'WBS_DISABLED'}).record_as,'BLOCKED_NON_FATAL');
});

test('Z02-7: classification is pure — no network, no database, no writes',()=>{
  // The module must be usable in a preflight with no credentials at all. If it ever grew an I/O
  // dependency this would start throwing rather than silently reaching out.
  const before=JSON.stringify(process.env);
  const r=classifyStagingBlocker({reachable:true,httpStatus:200,resultCount:0});
  assert.equal(r.class,'EMPTY_DATA');
  assert.equal(JSON.stringify(process.env),before,'classification must not mutate the environment');
});
