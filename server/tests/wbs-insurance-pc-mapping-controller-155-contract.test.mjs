import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,readFileSync} from 'node:fs';
import {join} from 'node:path';

const root=join(import.meta.dirname,'..');
const upPath=join(root,'db','migrations','155_wbs_insurance_pc_mapping_controller_workflow.sql');
const downPath=join(root,'db','migrations','down','155_wbs_insurance_pc_mapping_controller_workflow.sql');
const read=path=>readFileSync(path,'utf8');
const requireFile=(path,label)=>{assert.equal(existsSync(path),true,`${label} is required after compat 153 is frozen`);return read(path);};
const contains=(source,value)=>assert.equal(source.includes(value),true,`missing required contract token: ${value}`);

test('155 extends the compat decision table and does not create a parallel approval authority',()=>{
  const sql=requireFile(upPath,'migration 155');
  assert.match(sql,/INSERT INTO\s+wbs_insurance_pc_company_mapping_decision/i);
  assert.doesNotMatch(sql,/CREATE TABLE\s+wbs_insurance_pc_mapping_decision\s*\(/i);
  assert.match(sql,/wbs_company_catalog_controller_decision_id/);
  assert.match(sql,/company_mapping_hash/);
  assert.match(sql,/effective_from/);
  assert.match(sql,/effective_to/);
  assert.match(sql,/match_count/);
});

test('proposal input is a two-phase exact artifact observation or controlled-live evidence, never an admitted package or caller aggregate',()=>{
  const sql=requireFile(upPath,'migration 155');
  assert.match(sql,/wbs_insurance_pc_mapping_pre_admission_observation/);
  assert.match(sql,/PRE_ADMISSION_OBSERVATION/);
  assert.match(sql,/NOT_ADMITTED/);
  assert.match(sql,/Ed25519/);
  assert.match(sql,/storage_version/);
  assert.match(sql,/content_hash/);
  assert.match(sql,/scan_disposition/);
  assert.match(sql,/object_lock_mode/);
  assert.match(sql,/observation_hash/);
  assert.match(sql,/canonical_set_hash/);
  assert.match(sql,/source_evidence_hash/);
  assert.match(sql,/captured_at/);
  assert.match(sql,/YYYY-MM-DD["']?T["']?HH24:MI:SS\.MS["']?Z/);
  assert.doesNotMatch(sql,/\(p_captured_at\)::timestamptz/i);
  assert.doesNotMatch(sql,/p_pc_codes\s+jsonb/i);
  assert.doesNotMatch(sql,/p_company_code\s+text/i);
  assert.doesNotMatch(sql,/PRE_ADMISSION_OBSERVATION[^;]*status\s*=\s*'ADMITTED'/i);
});

test('approval locks the exact active WBS WBPA USD entity and catalog range',()=>{
  const sql=requireFile(upPath,'migration 155');
  assert.match(sql,/FROM\s+entity/i);
  assert.match(sql,/NOT ent\.active/i);
  assert.match(sql,/ent\.source_system<>'WBS'/i);
  assert.match(sql,/source_entity_id/);
  assert.match(sql,/ent\.source_entity_id<>'WBPA'/i);
  assert.match(sql,/ent\.base_currency<>'USD'/i);
  assert.match(sql,/wbs_company_catalog_controller_decision/i);
  assert.match(sql,/catalog\.effective_from>p_effective_from/);
  assert.match(sql,/catalog\.effective_to<p_effective_to/);
  assert.match(sql,/FIRST_PACKAGE_WBPA/);
  assert.match(sql,/scope_pc_code_count/);
});

test('proposal and approval enforce scope SoD CAS actor-bound replay and atomic evidence',()=>{
  const sql=requireFile(upPath,'migration 155');
  for(const permission of ['WBS.INSURANCE.PC_MAPPING.VIEW','WBS.INSURANCE.PC_MAPPING.PROPOSE','WBS.INSURANCE.PC_MAPPING.APPROVE'])assert.match(sql,new RegExp(permission.replaceAll('.','\\.')));
  assert.match(sql,/refs_assert_scope/);
  assert.match(sql,/idempotency_receipt/);
  assert.match(sql,/actor_id\s+IS DISTINCT FROM/i);
  assert.match(sql,/ERRCODE\s*=\s*'23505'/i);
  assert.match(sql,/ERRCODE\s*=\s*'42501'/i);
  assert.match(sql,/expected_revision/);
  assert.match(sql,/ERRCODE\s*=\s*'40001'/i);
  assert.match(sql,/audit_event/);
  assert.match(sql,/outbox_event/);
  assert.match(sql,/ENABLE ROW LEVEL SECURITY/);
  assert.match(sql,/REVOKE ALL/);
  assert.match(sql,/GRANT SELECT/);
  const replay=sql.indexOf("idem.status='SUCCEEDED'");
  const actor=sql.indexOf('actor_id IS DISTINCT FROM');
  assert.ok(actor>=0&&replay>actor,'actor binding must run before successful replay');
});

test('query DTO binds observation proposal and final decision hashes without raw provider rows',()=>{
  const sql=requireFile(upPath,'migration 155');
  assert.match(sql,/refs_read_wbs_insurance_pc_mapping_proposal/);
  assert.match(sql,/refs_read_wbs_insurance_pc_mapping_trace/);
  for(const hash of ['observation_hash','proposal_hash','decision_hash','company_mapping_hash'])assert.match(sql,new RegExp(hash));
  assert.match(sql,/match_count/);
  assert.doesNotMatch(sql,/['"]raw_row['"]/);
  assert.doesNotMatch(sql,/['"]snapshot_token['"]/);
});

test('down migration is evidence guarded and deactivates new permissions',()=>{
  const sql=requireFile(downPath,'migration 155 down');
  assert.match(sql,/ERRCODE\s*=\s*'55000'/i);
  assert.match(sql,/active\s*=\s*false/i);
  assert.match(sql,/DROP FUNCTION/i);
});

test('repository HTTP and OpenAPI expose real proposal approve view and trace operations',()=>{
  const repository=read(join(root,'runtime','kernel-repository.mjs'));
  const http=read(join(root,'api','accounting-http.mjs'));
  const openapi=read(join(root,'api','openapi-accounting.json'));
  for(const method of ['createWbsInsurancePcMappingProposal','approveWbsInsurancePcMappingProposal','getWbsInsurancePcMappingProposal','getWbsInsurancePcMappingTrace'])contains(repository,`async ${method}(`);
  for(const segment of ['pc-mapping-proposals','pc-company-mappings'])contains(http,segment);
  for(const operation of ['createWbsInsurancePcMappingProposal','approveWbsInsurancePcMappingProposal','getWbsInsurancePcMappingProposal','getWbsInsurancePcMappingTrace'])contains(openapi,`"operationId":"${operation}"`);
  assert.match(http,/cache-control['"]?\s*:\s*['"]no-store/i);
});
