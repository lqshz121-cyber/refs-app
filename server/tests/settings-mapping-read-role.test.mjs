import test from 'node:test';
import assert from 'node:assert/strict';
import {SETTINGS_MAPPING_READ_ROLE} from '../runtime/settings-mapping-read-role.mjs';
import {AUTHORITATIVE_WORKFLOW_ROLES,assertWorkflowRoleSafety} from '../runtime/workflow-role-grant.mjs';

test('settings/mapping candidate is an immutable exact human READ bundle',()=>{
  assert.deepEqual(SETTINGS_MAPPING_READ_ROLE,{authorityClass:'READ',principalKind:'HUMAN',permissions:['ACCOUNTING.SETTINGS.WORKFLOW.VIEW','AI.ACCOUNTING.SETTINGS.VIEW']});
  assert.equal(Object.isFrozen(SETTINGS_MAPPING_READ_ROLE),true);
  assert.equal(Object.isFrozen(SETTINGS_MAPPING_READ_ROLE.permissions),true);
  assert.equal(assertWorkflowRoleSafety(SETTINGS_MAPPING_READ_ROLE),SETTINGS_MAPPING_READ_ROLE);
  assert.equal(AUTHORITATIVE_WORKFLOW_ROLES.ACCOUNTING_SETTINGS_MAPPING_VIEWER,SETTINGS_MAPPING_READ_ROLE);
});

test('candidate neither expands existing viewer nor imports service or accounting-write authority',()=>{
  assert.equal(AUTHORITATIVE_WORKFLOW_ROLES.ACCOUNTING_SETTINGS_WORKFLOW_VIEWER.permissions.includes('AI.ACCOUNTING.SETTINGS.VIEW'),false);
  for(const permission of SETTINGS_MAPPING_READ_ROLE.permissions)assert.match(permission,/\.VIEW$/);
  assert.throws(()=>assertWorkflowRoleSafety({...SETTINGS_MAPPING_READ_ROLE,permissions:[...SETTINGS_MAPPING_READ_ROLE.permissions,'WBS.TEST.IMPORT']}),{code:'WORKFLOW_ROLE_SCOPE_DENIED'});
  assert.throws(()=>assertWorkflowRoleSafety({...SETTINGS_MAPPING_READ_ROLE,permissions:[...SETTINGS_MAPPING_READ_ROLE.permissions,'ACCOUNTING.SETTINGS.WORKFLOW.APPROVE']}),{code:'WORKFLOW_ROLE_SCOPE_DENIED'});
});
