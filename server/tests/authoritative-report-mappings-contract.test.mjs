import test from 'node:test';
import assert from 'node:assert/strict';
import {projectAuthoritativeReportMappings} from '../runtime/authoritative-report-mappings.mjs';
import {approvedSettingsFixture,tenantId,entityId,periodId} from './wbs-ai-approved-settings-reader.test.mjs';

test('projects the complete approved account-to-report mapping population with immutable evidence',()=>{
  const result=projectAuthoritativeReportMappings(approvedSettingsFixture(),{tenantId,entityId,periodId});
  assert.equal(result.schema_version,'AUTHORITATIVE_REPORT_MAPPING_CATALOG_V1');
  assert.deepEqual(result.population,{total_count:24,read_count:24,population_complete:true,population_hash:result.population.population_hash});
  assert.match(result.population.population_hash,/^sha256:[0-9a-f]{64}$/);
  assert.equal(result.approval.approval_status,'APPROVED');
  assert.equal(result.mappings.length,24);
  assert.ok(result.mappings.every(row=>row.status==='ACTIVE_FOR_PERIOD'&&/^sha256:[0-9a-f]{64}$/.test(row.mapping_hash)));
  assert.equal(new Set(result.mappings.map(row=>`${row.account_code}:${row.account_role}`)).size,24);
  assert.deepEqual(result.action_flags,{can_create_draft:false,can_review:false,can_approve:false,can_post:false});
  assert.equal(Object.isFrozen(result),true);assert.equal(Object.isFrozen(result.mappings),true);assert.equal(Object.isFrozen(result.mappings[0]),true);
});

test('fails closed on scope, account binding, action, or credential drift',()=>{
  for(const [value,scope] of [
    [{...approvedSettingsFixture(),entity_id:'99999999-9999-4999-8999-999999999999'},{tenantId,entityId,periodId}],
    [{...approvedSettingsFixture(),can_post:true},{tenantId,entityId,periodId}],
    [(()=>{const value=approvedSettingsFixture();value.report_mapping.settings.account_mappings[0].account_code='MISSING';return value;})(),{tenantId,entityId,periodId}],
    [(()=>{const value=approvedSettingsFixture();value.report_mapping.approved_by='Bearer unsafe-token';return value;})(),{tenantId,entityId,periodId}]
  ])assert.throws(()=>projectAuthoritativeReportMappings(value,scope),error=>error.code==='WBS_AI_APPROVED_SETTINGS_INVALID');
});
