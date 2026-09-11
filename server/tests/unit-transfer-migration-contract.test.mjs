import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {UNIT_TRANSFER_CREATE_FIELDS} from '../runtime/unit-transfer-contract.mjs';

const up=await readFile(new URL('../db/migrations/370_unit_transfer_authoritative.sql',import.meta.url),'utf8');
const down=await readFile(new URL('../db/migrations/down/370_unit_transfer_authoritative.sql',import.meta.url),'utf8');

test('Unit Transfer migration uses private one-shot gates instead of caller-settable session flags',()=>{
 assert.doesNotMatch(up,/refs[.]unit_transfer_(?:workflow|lifecycle)|set_config\s*\(/i);
 assert.match(up,/CREATE TABLE unit_transfer_internal_gate/i);
 assert.match(up,/REVOKE ALL ON unit_transfer_internal_gate FROM PUBLIC,refs_app/i);
 assert.match(up,/DELETE FROM unit_transfer_internal_gate WHERE backend_pid=pg_backend_pid\(\) AND transaction_id=txid_current\(\)/i);
 assert.match(up,/INSERT INTO unit_transfer_internal_gate VALUES\(pg_backend_pid\(\),txid_current\(\),p_tenant,p_pair,'JOURNAL'/i);
 assert.match(up,/resource_kind='PAIR'/i);assert.match(up,/resource_kind='UNIT'/i);
 assert.match(up,/g[.]operation=op_name AND\(op_name='REBASELINED' OR g[.]unit_transfer_pair_id=NEW[.]last_transfer_pair_id\)/i);
 assert.match(up,/op_name='REBASELINED' AND\(NEW[.]current_owner_entity_id<>OLD[.]current_owner_entity_id OR NEW[.]last_transfer_pair_id IS DISTINCT FROM OLD[.]last_transfer_pair_id\)/i);
 assert.match(up,/UNIT_TRANSFER_UNIT_REBASELINED/i);
 assert.match(up,/CREATE TRIGGER unit_transfer_journal_line_guard/i);
 assert.match(up,/CREATE TRIGGER unit_transfer_source_link_guard/i);
 assert.match(down,/DROP TABLE unit_transfer_internal_gate/i);
});

test('Unit Transfer ownership and authority metadata remain tenant-bound and roundtrip-safe',()=>{
 assert.match(up,/CONSTRAINT unit_transfer_unit_control_last_transfer_pair_tenant_fk\s+FOREIGN KEY\(tenant_id,last_transfer_pair_id\) REFERENCES unit_transfer_pair\(tenant_id,unit_transfer_pair_id\)/i);
 assert.match(up,/INSERT INTO runtime_human_permission_authority[\s\S]+ON CONFLICT\(permission_code\) DO UPDATE SET authority_class=EXCLUDED[.]authority_class/i);
 assert.match(down,/DROP CONSTRAINT unit_transfer_unit_control_last_transfer_pair_tenant_fk/i);
 assert.match(down,/DELETE FROM runtime_human_permission_authority WHERE permission_code IN/i);
 assert.match(down,/REAL_ESTATE[.]UNIT_TRANSFER[.]CANCEL/i);
});

test('Unit Transfer retains dual-company workflow, audit, outbox, cost, mapping and elimination controls',()=>{
 assert.match(up,/refs_assert_scope\(p_tenant,pair[.]source_entity_id,'REAL_ESTATE[.]UNIT_TRANSFER[.]'\|\|action\)/i);
 assert.match(up,/refs_assert_scope\(p_tenant,pair[.]target_entity_id,'REAL_ESTATE[.]UNIT_TRANSFER[.]'\|\|action\)/i);
 assert.match(up,/source_cost_ledger_line_ids uuid\[\] NOT NULL/i);
 assert.match(up,/refs_unit_transfer_mapping_is_current/i);
 assert.match(up,/scope_type='ENTITY' AND m[.]scope_key=p_entity::text/i);
 assert.match(up,/m[.]input_key_hash=refs_jsonb_hash\(m[.]input_keys\)/i);
 assert.match(up,/higher[.]scope_type=m[.]scope_type AND higher[.]scope_key=m[.]scope_key/i);
 assert.match(up,/tied[.]scope_type=m[.]scope_type AND tied[.]scope_key=m[.]scope_key/i);
 assert.match(up,/CREATE TABLE unit_transfer_elimination_basis/i);
 assert.match(up,/\(p[.]transfer_date,p[.]unit_transfer_pair_id\)<\(p_after_date,p_after_pair\)/i);
 assert.match(up,/LIMIT p_limit\+1/i);assert.doesNotMatch(up,/count\(\*\)>100 FROM unit_transfer_pair/i);
 assert.ok((up.match(/INSERT INTO audit_event/g)||[]).length>=6);
 assert.ok((up.match(/INSERT INTO outbox_event/g)||[]).length>=6);
 assert.match(up,/CREATE FUNCTION refs_cancel_unit_transfer_pair/i);
 assert.match(up,/pair[.]status<>'DRAFT_PAIR'/i);
 assert.match(up,/source_journal[.]revision<>p_expected_source_revision/i);
 assert.match(up,/target_journal[.]revision<>p_expected_target_revision/i);
 assert.match(up,/actor=pair[.]created_by/i);
 assert.match(up,/UNIT_TRANSFER_CANCELLED/i);
 assert.match(down,/DROP FUNCTION refs_cancel_unit_transfer_pair/i);
 assert.match(down,/Refusing to remove retained Unit Transfer evidence/i);
});

test('Unit Transfer OpenAPI exposes the exact closed command bodies',async()=>{
 const spec=JSON.parse(await readFile(new URL('../api/openapi-accounting.json',import.meta.url),'utf8'));
 const base=spec.paths['/entities/{entityId}/unit-transfers'];
 assert.ok(base?.get&&base?.post);
 assert.deepEqual([...base.post.requestBody.content['application/json'].schema.required].sort(),[...UNIT_TRANSFER_CREATE_FIELDS].sort());
 assert.equal(base.post.requestBody.content['application/json'].schema.additionalProperties,false);
 assert.deepEqual(base.post.requestBody.content['application/json'].schema.properties.sourceCarryingAccountCodes,{type:'array',minItems:1,maxItems:50,uniqueItems:true,items:{type:'string',minLength:1,maxLength:64,pattern:'^[A-Za-z0-9._-]{1,64}$'}});
 for(const field of ['sourceGainLossAccountCode','targetInventoryAccountCode'])assert.deepEqual(base.post.requestBody.content['application/json'].schema.properties[field],{type:'string',minLength:1,maxLength:64,pattern:'^[A-Za-z0-9._-]{1,64}$'});
 assert.deepEqual(base.get.parameters.slice(1).map(parameter=>parameter.name),['periodId','limit','afterDate','afterPairId']);
 const options=spec.paths['/entities/{entityId}/unit-transfers/create-options']?.get;assert.ok(options);assert.deepEqual(options.parameters.slice(1).map(parameter=>parameter.name),['periodId','targetEntityId','transferDate','targetAttachmentId']);
 const transition=spec.paths['/entities/{entityId}/unit-transfers/{pairId}/transitions']?.post;
 assert.deepEqual(transition.requestBody.content['application/json'].schema.required,['action','expectedPairRevision','expectedSourceRevision','expectedTargetRevision','reason']);
 const post=spec.paths['/entities/{entityId}/unit-transfers/{pairId}/post']?.post;
 assert.deepEqual(post.requestBody.content['application/json'].schema.required,['expectedPairRevision','expectedSourceRevision','expectedTargetRevision']);
 const cancel=spec.paths['/entities/{entityId}/unit-transfers/{pairId}/cancel']?.post;
 assert.deepEqual(cancel.requestBody.content['application/json'].schema.required,['expectedPairRevision','expectedSourceRevision','expectedTargetRevision','reason']);
});
