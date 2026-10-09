import test from 'node:test';import assert from 'node:assert/strict';
import {AUTHORITATIVE_WORKFLOW_ROLES,assertWorkflowRoleSafety} from '../runtime/workflow-role-grant.mjs';
import {BANK_REQUEST_SETTINGS_ROLE,BANK_REQUEST_ACCOUNTING_VIEW_ROLE} from '../runtime/bank-request-settings-role.mjs';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {MIGRATION_MANIFEST} from '../runtime/migration-manifest.mjs';

test('457 adds exactly one readonly additive pair and preserves all prior constraint pairs on rollback',()=>{
  const name='457_bank_request_settings_view.sql',read=path=>readFileSync(new URL(path,import.meta.url),'utf8');
  const entry=MIGRATION_MANIFEST.find(row=>row.name===name);assert.ok(entry);
  const up=read('../db/migrations/'+name),down=read('../db/migrations/down/'+name);
  for(const [direction,body] of [['up',up],['down',down]])assert.equal(createHash('sha256').update(body).digest('hex'),entry[direction]);
  const pairs=body=>{
    const expression=body.split('ADD CONSTRAINT runtime_human_additive_permission_authority_check CHECK(')[1]?.split(');')[0];assert.ok(expression);
    return [...expression.matchAll(/permission_code='([^']+)' AND authority_class IN\(([^)]+)\)/g)].flatMap(([,permission,classes])=>[...classes.matchAll(/'([^']+)'/g)].map(([,authority])=>`${permission}:${authority}`)).sort();
  };
  const prior=pairs(read('../db/migrations/445_workflow_authority_reachability.sql'));
  assert.deepEqual(pairs(up),[...prior,'ACCOUNTING.SETTINGS.WORKFLOW.VIEW:BANK_IMPORT_REQUEST'].sort());
  assert.deepEqual(pairs(down),prior);
  assert.match(down,/Retained combined request\/settings grants prevent rollback/);
  assert.doesNotMatch(up,/UPDATE runtime_actor_grant|GRANT EXECUTE|ACCOUNTING\.SETTINGS\.WORKFLOW\.APPROVE/);
});

test('same-user combined bundle adds only settings evidence and retains one request authority',()=>{
  const role=AUTHORITATIVE_WORKFLOW_ROLES.WBS_BANK_IMPORT_REQUESTER_SETTINGS_VIEWER;
  assert.equal(role,BANK_REQUEST_SETTINGS_ROLE);assert.ok(Object.isFrozen(role));assert.ok(Object.isFrozen(role.permissions));
  assert.deepEqual(role.permissions,['WBS.AUTOREC.VIEW','WBS.TEST.BANK.IMPORT.REQUEST','ACCOUNTING.SETTINGS.WORKFLOW.VIEW','AI.ACCOUNTING.SETTINGS.VIEW']);
  assert.equal(assertWorkflowRoleSafety(role),role);
  for(const permission of ['WBS.TEST.IMPORT','ACCOUNTING.SETTINGS.WORKFLOW.APPROVE','BANK.RECONCILIATION.START','BANK.MATCH.CREATE','GL.JE.POST'])assert.throws(()=>assertWorkflowRoleSafety({...role,permissions:[...role.permissions,permission]}),{code:'WORKFLOW_ROLE_SCOPE_DENIED'});
});
test('requester has only WBS observation read and independent human request permission',()=>{
  const role=AUTHORITATIVE_WORKFLOW_ROLES.WBS_BANK_IMPORT_REQUESTER;
  assert.equal(role.authorityClass,'BANK_IMPORT_REQUEST');assert.equal(role.principalKind,'HUMAN');
  assert.deepEqual(role.permissions,['WBS.AUTOREC.VIEW','WBS.TEST.BANK.IMPORT.REQUEST']);
  assert.equal(assertWorkflowRoleSafety(role),role);
  for(const permission of ['WBS.TEST.IMPORT','BANK.RECONCILIATION.START','BANK.MATCH.CREATE','GL.JE.POST'])assert.equal(role.permissions.includes(permission),false);
  assert.throws(()=>assertWorkflowRoleSafety({...role,authorityClass:'DRAFT'}),{code:'WORKFLOW_ROLE_SCOPE_DENIED'});
});

test('accounting-view requester preserves all existing effective reads without adding analysis or lifecycle authority',()=>{
  const role=AUTHORITATIVE_WORKFLOW_ROLES.WBS_BANK_IMPORT_REQUESTER_ACCOUNTING_VIEWER;
  assert.equal(role,BANK_REQUEST_ACCOUNTING_VIEW_ROLE);
  assert.ok(Object.isFrozen(role));assert.ok(Object.isFrozen(role.permissions));
  const existing=['AI.AMORTIZATION.VIEW','AP.VIEW','AR.VIEW','BANK.VIEW','GL.JE.VIEW','GL.REPORT.VIEW','WBS.AUTOREC.VIEW'];
  assert.deepEqual([...role.permissions].sort(),[...existing,'WBS.TEST.BANK.IMPORT.REQUEST','ACCOUNTING.SETTINGS.WORKFLOW.VIEW','AI.ACCOUNTING.SETTINGS.VIEW'].sort());
  assert.equal(assertWorkflowRoleSafety(role),role);
  for(const permission of ['AI.ANALYSIS.EXPLAIN','WBS.TEST.IMPORT','ACCOUNTING.SETTINGS.WORKFLOW.APPROVE','BANK.RECONCILIATION.START','BANK.MATCH.CREATE','GL.JE.POST'])assert.equal(role.permissions.includes(permission),false);
  for(const permission of ['WBS.TEST.IMPORT','ACCOUNTING.SETTINGS.WORKFLOW.APPROVE','BANK.RECONCILIATION.START','BANK.MATCH.CREATE','GL.JE.POST'])assert.throws(()=>assertWorkflowRoleSafety({...role,permissions:[...role.permissions,permission]}),{code:'WORKFLOW_ROLE_SCOPE_DENIED'});
  assert.equal(AUTHORITATIVE_WORKFLOW_ROLES.WBS_BANK_IMPORT_REQUESTER_SETTINGS_VIEWER,BANK_REQUEST_SETTINGS_ROLE);
  assert.equal(BANK_REQUEST_SETTINGS_ROLE.permissions.length,4);
});
