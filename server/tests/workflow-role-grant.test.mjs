import test from 'node:test';
import assert from 'node:assert/strict';
import {AUTHORITATIVE_WORKFLOW_ROLES,authoritativeWorkflowRoleGrantConfig,grantAuthenticatedWorkflowRole} from '../runtime/workflow-role-grant.mjs';

const base={NODE_ENV:'production',REFS_DEPLOYMENT_ENV:'staging',REFS_WORKFLOW_ROLE_CONFIRM:'AUTHORITATIVE_WORKFLOW_ROLE_ONLY',REFS_STAGE1_TENANT_ID:'11111111-1111-4111-8111-111111111111',REFS_STAGE1_ENTITY_ID:'22222222-2222-4222-8222-222222222222',REFS_WORKFLOW_ROLE:'WBS_PAYABLE_MAKER',REFS_WORKFLOW_GRANT_EXPECTED_VERSION:'2',REFS_WORKFLOW_GRANT_IDEMPOTENCY_KEY:'workflow-maker-0001',REFS_AUTHENTICATED_ACCESS_TOKEN:'opaque',OIDC_ISSUER:'https://issuer.example',OIDC_AUDIENCE:'refs',OIDC_JWKS_URI:'https://issuer.example/jwks'};

test('workflow roles are complete mutually exclusive grant sets with no provider/import permission',()=>{
  const config=authoritativeWorkflowRoleGrantConfig(base);
  assert.deepEqual(config.permissions,AUTHORITATIVE_WORKFLOW_ROLES.WBS_PAYABLE_MAKER);
  for(const permissions of Object.values(AUTHORITATIVE_WORKFLOW_ROLES)){
    assert.equal(new Set(permissions).size,permissions.length);
    assert.equal(permissions.some(permission=>/WBS\.SNAPSHOT\.IMPORT|WBS\.BANK\.ADMIT/.test(permission)),false);
  }
  assert.deepEqual(AUTHORITATIVE_WORKFLOW_ROLES.WBS_OPERATOR_ATTESTER,['WBS.AUTOREC.VIEW','WBS.PAYABLE.OPERATOR_ATTEST']);
  assert.equal(AUTHORITATIVE_WORKFLOW_ROLES.WBS_OPERATOR_ATTESTER.some(permission=>/^(AP\.|AR\.|BANK\.|GL\.)/.test(permission)),false);
  assert.equal(AUTHORITATIVE_WORKFLOW_ROLES.WBS_OPERATOR_ATTESTER.some(permission=>/REVIEW|CREATE|SUBMIT|APPROVE|POST|IMPORT|ADMIT/.test(permission)),false);
  assert.equal(AUTHORITATIVE_WORKFLOW_ROLES.WBS_PAYABLE_MAKER.includes('GL.JE.REVIEW'),false);
  assert.equal(AUTHORITATIVE_WORKFLOW_ROLES.WBS_PAYABLE_REVIEWER.includes('AP.BILL.CREATE'),false);
  assert.equal(AUTHORITATIVE_WORKFLOW_ROLES.JE_REVIEWER.includes('GL.JE.APPROVE'),false);
  assert.equal(AUTHORITATIVE_WORKFLOW_ROLES.JE_APPROVER.includes('GL.JE.POST'),false);
  assert.equal(AUTHORITATIVE_WORKFLOW_ROLES.BANK_MATCH_MAKER.includes('BANK.MATCH.UNMATCH'),false);
  assert.equal(AUTHORITATIVE_WORKFLOW_ROLES.BANK_MATCH_REVIEWER.includes('BANK.MATCH.CREATE'),false);
});

test('workflow role config fails closed outside staging and for unknown or malformed values',()=>{
  for(const environment of [{...base,REFS_DEPLOYMENT_ENV:'production'},{...base,REFS_WORKFLOW_ROLE:'CONTROLLER'},{...base,REFS_WORKFLOW_GRANT_EXPECTED_VERSION:'x'},{...base,REFS_STAGE1_ENTITY_ID:'not-uuid'}]){
    assert.throws(()=>authoritativeWorkflowRoleGrantConfig(environment),error=>/WORKFLOW_ROLE_(ENV_DENIED|CONFIG_INVALID)/.test(error.code));
  }
});

test('authenticated role grant derives actor from verified token and sends only the frozen bundle',async()=>{
  const config=authoritativeWorkflowRoleGrantConfig(base),calls=[];
  const pool={connect:async()=>({query:async(sql,args)=>{
    calls.push({sql,args});
    if(sql==='BEGIN ISOLATION LEVEL SERIALIZABLE')return {};
    if(sql.includes('session_user')&&sql.includes('current_user'))return {rowCount:1,rows:[{session_user:'refs_grant_sync',current_user:'refs_grant_sync'}]};
    if(sql.startsWith('SELECT refs_grant_request_hash'))return {rowCount:1,rows:[{request_hash:'sha256:request'}]};
    if(sql.startsWith('SELECT refs_reconcile_actor_grants'))return {rowCount:1,rows:[{result:{permissions:[...config.permissions].reverse(),version:3,idempotent:false}}]};
    return {rowCount:0,rows:[]};
  },release(){}})};
  const result=await grantAuthenticatedWorkflowRole(pool,config,{authenticator:{authenticate:async()=>({tenantId:config.tenantId,actorId:'auth0|maker'})}});
  assert.equal(result.role,'WBS_PAYABLE_MAKER');
  const reconcile=calls.find(call=>call.sql.startsWith('SELECT refs_reconcile_actor_grants'));
  assert.equal(reconcile.args[1],'auth0|maker');
  assert.deepEqual(reconcile.args[3],config.permissions);
});

test('role wrapper rejects altered permissions and tenant swaps before grant sync',async()=>{
  const config=authoritativeWorkflowRoleGrantConfig(base);
  await assert.rejects(grantAuthenticatedWorkflowRole({}, {...config,permissions:[...config.permissions,'GL.JE.POST']}),error=>error.code==='WORKFLOW_ROLE_SCOPE_DENIED');
  await assert.rejects(grantAuthenticatedWorkflowRole({},config,{authenticator:{authenticate:async()=>({tenantId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',actorId:'auth0|maker'})}}),error=>error.code==='WORKFLOW_ROLE_TENANT_DENIED');
});
