import test from 'node:test';import assert from 'node:assert/strict';
import {internalTestWorkflowActors,routeInternalTestPrincipal,InternalTestIdentityRouteError} from '../runtime/internal-test-identity-router.mjs';
const env=Object.fromEntries(['READER','MAKER','SUBMITTER','REVIEWER','APPROVER','POSTER','RECONCILIATION_STARTER','CLEARER','REOPENER'].map((role,index)=>[`REFS_INTERNAL_TEST_${role}_ACTOR_ID`,`${role.toLowerCase()}-actor-${index}`]));
const actors=internalTestWorkflowActors(env),principal={trusted:true,internalTest:true,tenantId:'11111111-1111-4111-8111-111111111111',actorId:'entry'};
const route=(method,path)=>routeInternalTestPrincipal({method,url:`https://internal.example${path}`,principal,actors});
test('internal full-test router retains distinct finite identities by workflow stage',()=>{
  assert.equal(route('GET','/api/v1/entities/22222222-2222-4222-8222-222222222222/journal-entries').actorId,actors.reader);
  assert.equal(route('POST','/api/v1/entities/22222222-2222-4222-8222-222222222222/ap/bills').actorId,actors.maker);
  assert.equal(route('POST','/api/v1/entities/22222222-2222-4222-8222-222222222222/journal-entries/33333333-3333-4333-8333-333333333333/transitions/submit').actorId,actors.submitter);
  assert.equal(route('POST','/api/v1/entities/22222222-2222-4222-8222-222222222222/journal-entries/33333333-3333-4333-8333-433333333333/transitions/review').actorId,actors.reviewer);
  assert.equal(route('POST','/api/v1/entities/22222222-2222-4222-8222-222222222222/journal-entries/33333333-3333-4333-8333-433333333333/transitions/approve').actorId,actors.approver);
  assert.equal(route('POST','/api/v1/entities/22222222-2222-4222-8222-222222222222/journal-entries/33333333-3333-4333-8333-433333333333/post').actorId,actors.poster);
  assert.equal(route('POST','/api/v1/entities/22222222-2222-4222-8222-222222222222/journal-entries/manual').actorId,actors.maker);
  assert.equal(route('POST','/api/v1/entities/22222222-2222-4222-8222-222222222222/cash-transfers').actorId,actors.maker);
  assert.equal(route('POST','/api/v1/entities/22222222-2222-4222-8222-222222222222/cash-transfers/33333333-3333-4333-8333-433333333333/transitions/submit').actorId,actors.submitter);
  assert.equal(route('POST','/api/v1/entities/22222222-2222-4222-8222-222222222222/cash-transfers/33333333-3333-4333-8333-433333333333/post').actorId,actors.poster);
  assert.notEqual(actors.maker,actors.reviewer);assert.notEqual(actors.reviewer,actors.approver);assert.notEqual(actors.approver,actors.poster);
});
test('internal full-test router rejects unadmitted writes and invalid actor configuration',()=>{
  assert.throws(()=>route('POST','/api/v1/entities/22222222-2222-4222-8222-222222222222/unknown'),error=>error instanceof InternalTestIdentityRouteError&&error.code==='INTERNAL_TEST_COMMAND_NOT_ADMITTED');
  assert.throws(()=>internalTestWorkflowActors({...env,REFS_INTERNAL_TEST_POSTER_ACTOR_ID:env.REFS_INTERNAL_TEST_APPROVER_ACTOR_ID}),error=>error instanceof InternalTestIdentityRouteError&&error.code==='INTERNAL_TEST_ACTOR_CONFIG_INVALID');
});
