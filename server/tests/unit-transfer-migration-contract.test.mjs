import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {UNIT_TRANSFER_CREATE_FIELDS} from '../runtime/unit-transfer-contract.mjs';
import {MIGRATION_MANIFEST} from '../runtime/migration-manifest.mjs';

const up=await readFile(new URL('../db/migrations/370_unit_transfer_authoritative.sql',import.meta.url),'utf8');
const down=await readFile(new URL('../db/migrations/down/370_unit_transfer_authoritative.sql',import.meta.url),'utf8');
const reversalUp=await readFile(new URL('../db/migrations/371_unit_transfer_paired_reversal.sql',import.meta.url),'utf8');
const reversalDown=await readFile(new URL('../db/migrations/down/371_unit_transfer_paired_reversal.sql',import.meta.url),'utf8');

test('Unit Transfer paired reversal migration is checksum-bound in order',()=>{
 const index=MIGRATION_MANIFEST.findIndex(entry=>entry.name==='371_unit_transfer_paired_reversal.sql');
 assert.ok(index>=0);assert.equal(MIGRATION_MANIFEST[index-1]?.name,'370_unit_transfer_authoritative.sql');
 const entry=MIGRATION_MANIFEST[index];assert.equal(entry.up,createHash('sha256').update(reversalUp).digest('hex'));assert.equal(entry.down,createHash('sha256').update(reversalDown).digest('hex'));
});

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
 const reversalBase='/entities/{entityId}/unit-transfers/{pairId}/reversals',reversalCreate=spec.paths[reversalBase]?.post;
 assert.deepEqual(reversalCreate.requestBody.content['application/json'].schema.required,['expectedPairRevision','expectedSourceRevision','expectedTargetRevision','reversalDate','sourceJournalNumber','targetJournalNumber','reason']);assert.equal(reversalCreate.requestBody.content['application/json'].schema.additionalProperties,false);
 assert.equal(reversalCreate.responses['201'].content['application/json'].schema.$ref,'#/components/schemas/UnitTransferReversalDraftEnvelope');
 for(const suffix of ['transitions','cancel','post']){const operation=spec.paths[`${reversalBase}/{reversalPairId}/${suffix}`]?.post;assert.ok(operation);assert.equal(operation.requestBody.content['application/json'].schema.additionalProperties,false);}
 assert.equal(spec.components.schemas.UnitTransferReversalPostReceipt.additionalProperties,false);assert.ok(spec.components.schemas.UnitTransferReversalPostReceipt.required.includes('elimination_reversal_basis_id'));assert.ok(spec.components.schemas.UnitTransferReversalPostReceipt.required.includes('evidence_hash'));
});

test('Unit Transfer paired reversal is a separate, dual-company, fail-closed accounting command',()=>{
 assert.match(reversalUp,/CREATE TABLE unit_transfer_reversal_pair/i);
 assert.match(reversalUp,/status IN\('DRAFT_PAIR','PENDING_REVIEW_PAIR','PENDING_APPROVAL_PAIR','APPROVED_PAIR','POSTED_PAIR','CANCELLED_PAIR'\)/i);
 assert.match(reversalUp,/CREATE POLICY unit_transfer_reversal_pair_scope[\s\S]+refs_entity_allowed\(source_entity_id\)[\s\S]+refs_entity_allowed\(target_entity_id\)/i);
 assert.match(reversalUp,/REAL_ESTATE[.]UNIT_TRANSFER[.]REVERSE/i);
 assert.match(reversalUp,/refs_assert_scope\(p_tenant,original_pair[.]source_entity_id,'REAL_ESTATE[.]UNIT_TRANSFER[.]REVERSE'\)/i);
 assert.match(reversalUp,/refs_assert_scope\(p_tenant,original_pair[.]target_entity_id,'REAL_ESTATE[.]UNIT_TRANSFER[.]REVERSE'\)/i);
 assert.match(reversalUp,/refs_assert_scope\(p_tenant,original_pair[.]source_entity_id,'GL[.]JE[.]REVERSE'\)/i);
 assert.match(reversalUp,/refs_assert_scope\(p_tenant,original_pair[.]target_entity_id,'GL[.]JE[.]REVERSE'\)/i);
 assert.match(reversalUp,/actor=original_pair[.]created_by/i);
 assert.match(reversalUp,/VALUES\(p_tenant,'UNIT_TRANSFER_REVERSAL_CREATE:'\|\|p_entity/i);
});

test('Unit Transfer reversal Drafts are exact inverses without prematurely occupying reversal_of_id',()=>{
 assert.match(reversalUp,/CREATE FUNCTION refs_create_unit_transfer_reversal_pair_hash\(/i);
 assert.match(reversalUp,/CREATE FUNCTION refs_create_unit_transfer_reversal_pair\(/i);
 assert.match(reversalUp,/journal_type,status[\s\S]+VALUES[\s\S]+'REVERSAL','DRAFT'/i);
 assert.match(reversalUp,/journal_type,status,journal_date,currency,description,created_by,reversal_of_id\)[\s\S]+actor,NULL/i);
 assert.match(reversalUp,/SELECT gen_random_uuid\(\),p_tenant,original_pair[.]source_entity_id[\s\S]+original_line[.]credit_amount,original_line[.]debit_amount/i);
 assert.match(reversalUp,/SELECT gen_random_uuid\(\),p_tenant,original_pair[.]target_entity_id[\s\S]+original_line[.]credit_amount,original_line[.]debit_amount/i);
 assert.match(reversalUp,/refs_unit_transfer_journal_snapshot\(p_tenant,original_pair[.]source_entity_id,source_reversal_journal\)/i);
 assert.match(reversalUp,/refs_unit_transfer_journal_snapshot\(p_tenant,original_pair[.]target_entity_id,target_reversal_journal\)/i);
});

test('Unit Transfer paired reversal locks and CAS-protects every retained aggregate',()=>{
 for(const name of ['unit_transfer_pair','unit_transfer_reversal_pair','unit_transfer_unit_control','journal_entry'])assert.match(reversalUp,new RegExp(`FROM ${name}[\\s\\S]+FOR UPDATE`,'i'));
 assert.match(reversalUp,/original_pair[.]revision<>p_expected_pair_revision/i);
 assert.match(reversalUp,/source_original_journal[.]revision<>p_expected_source_revision/i);
 assert.match(reversalUp,/target_original_journal[.]revision<>p_expected_target_revision/i);
 assert.match(reversalUp,/source_reversal_journal[.]revision<>p_expected_source_reversal_revision/i);
 assert.match(reversalUp,/target_reversal_journal[.]revision<>p_expected_target_reversal_revision/i);
 assert.match(reversalUp,/unit_control[.]version<>reversal_pair[.]expected_unit_version/i);
 assert.match(reversalUp,/unit_control[.]last_transfer_pair_id IS DISTINCT FROM original_pair[.]unit_transfer_pair_id/i);
 assert.match(reversalUp,/pg_advisory_xact_lock/i);
});

test('Unit Transfer reversal permits only the latest ownership event and fails closed on cost or IC settlement uncertainty',()=>{
 assert.match(reversalUp,/original_pair[.]status<>'POSTED_PAIR'/i);
 assert.match(reversalUp,/unit_control[.]last_transfer_pair_id IS DISTINCT FROM original_pair[.]unit_transfer_pair_id/i);
 assert.match(reversalUp,/later[.]status<>'CANCELLED_PAIR' AND later[.]created_at>original_pair[.]created_at/i);
 assert.doesNotMatch(reversalUp,/later[.]created_at>original_pair[.]created_at OR later[.]status='POSTED_PAIR'/i);
 assert.match(reversalUp,/actor IN\(p_pair[.]created_by,source_original_journal[.]created_by,source_original_journal[.]reviewed_by,source_original_journal[.]approved_by,source_original_journal[.]posted_by,target_original_journal[.]created_by,target_original_journal[.]reviewed_by,target_original_journal[.]approved_by,target_original_journal[.]posted_by\)/i);
 assert.match(reversalUp,/CREATE TABLE unit_transfer_ic_open_item/i);
 assert.match(reversalUp,/status IN\('OPEN','SETTLED'\)/i);
 assert.match(reversalUp,/source_ic[.]remaining_amount<>original_pair[.]transfer_price[\s\S]+target_ic[.]remaining_amount<>original_pair[.]transfer_price/i);
 assert.match(reversalUp,/status<>'OPEN'/i);
 assert.match(reversalUp,/refs_unit_transfer_cost_snapshot/i);
 assert.match(reversalUp,/Target Unit Transfer cost moved after Post/i);
 assert.match(reversalUp,/Source Unit Transfer cost is not zero after Post/i);
});

test('Unit Transfer reversal binds both originals only inside one-shot gates and posts atomically',()=>{
 assert.match(reversalUp,/resource_kind IN\('JOURNAL','PAIR','UNIT','HEADER','IC_OPEN_ITEM'\)/i);
 assert.match(reversalUp,/resource_kind='HEADER'/i);
 assert.match(reversalUp,/SET reversal_of_id=original_pair[.]source_journal_entry_id/i);
 assert.match(reversalUp,/SET reversal_of_id=original_pair[.]target_journal_entry_id/i);
 assert.match(reversalUp,/refs_post_unit_transfer_reversal_journal\(p_tenant,original_pair[.]source_entity_id/i);
 assert.match(reversalUp,/refs_post_unit_transfer_reversal_journal\(p_tenant,original_pair[.]target_entity_id/i);
 assert.match(reversalUp,/current_owner_entity_id=original_pair[.]source_entity_id[\s\S]+current_asset_account_codes=original_pair[.]source_carrying_account_codes[\s\S]+lifecycle_stage=original_pair[.]source_lifecycle_stage[\s\S]+version=version\+1/i);
 assert.match(reversalUp,/CREATE TABLE unit_transfer_elimination_reversal_basis/i);
 assert.match(reversalUp,/UNIT_TRANSFER_REVERSAL_POSTED/i);
 assert.match(reversalUp,/RETURNING elimination_reversal_basis_id,evidence_hash INTO elimination_reversal_id,elimination_reversal_hash/i);
 assert.match(reversalUp,/'elimination_reversal_basis_id',elimination_reversal_id,'evidence_hash',elimination_reversal_hash/i);
 assert.ok((reversalUp.match(/INSERT INTO audit_event/g)||[]).length>=4);
 assert.ok((reversalUp.match(/INSERT INTO outbox_event/g)||[]).length>=4);
});

test('Unit Transfer paired Post creates guarded reciprocal IC open items without unsafe history backfill',()=>{
 const writerStart=reversalUp.indexOf('CREATE OR REPLACE FUNCTION refs_post_unit_transfer_pair(p_tenant uuid,p_entity uuid,p_pair uuid');
 const writer=reversalUp.slice(writerStart,reversalUp.indexOf('CREATE FUNCTION refs_unit_transfer_reversal_target_cost_snapshot',writerStart));
 assert.ok(writer.length>1000);
 assert.match(reversalUp,/CREATE FUNCTION refs_post_unit_transfer_pair_370\(p_tenant uuid,p_entity uuid,p_pair uuid/i);
 assert.match(writer,/CREATE OR REPLACE FUNCTION refs_post_unit_transfer_pair\(p_tenant uuid,p_entity uuid,p_pair uuid/i);
 assert.doesNotMatch(reversalUp,/pg_get_functiondef|EXECUTE patched/i);
 assert.match(reversalUp,/CREATE TRIGGER unit_transfer_paired_reversal_journal_guard/i);
 assert.match(writer,/INSERT INTO unit_transfer_ic_open_item[\s\S]+'DUE_FROM'[\s\S]+FROM ledger_line ll JOIN journal_line jl[\s\S]+source_result->>'posting_batch_id'/i);
 assert.match(writer,/INSERT INTO unit_transfer_ic_open_item[\s\S]+'DUE_TO'[\s\S]+FROM ledger_line ll JOIN journal_line jl[\s\S]+target_result->>'posting_batch_id'/i);
 assert.match(reversalUp,/CREATE TRIGGER unit_transfer_ic_open_item_protect/i);
 assert.match(reversalUp,/status='SETTLED',remaining_amount=0,version=version\+1/i);
 assert.match(reversalUp,/refs_unit_transfer_ic_has_later_activity/i);
 assert.match(reversalUp,/may represent settlement/i);
 assert.doesNotMatch(writer,/INSERT INTO unit_transfer_ic_open_item[\s\S]+FROM unit_transfer_pair[\s\S]+status='POSTED_PAIR'/i);
 assert.match(reversalUp,/IF idem[.]status='SUCCEEDED' THEN RETURN idem[.]response_body\|\|jsonb_build_object\('idempotent',true\)/i);
 assert.match(reversalDown,/refs_post_unit_transfer_pair_370/i);
});

test('Unit Transfer reversal attempts retain ordered history while allowing one active retry after cancel',()=>{
 assert.match(reversalUp,/CREATE UNIQUE INDEX unit_transfer_reversal_one_live_original_uq[\s\S]+WHERE status<>'CANCELLED_PAIR'/i);
 assert.match(reversalUp,/CREATE UNIQUE INDEX unit_transfer_reversal_one_open_unit_uq[\s\S]+WHERE status NOT IN\('POSTED_PAIR','CANCELLED_PAIR'\)/i);
 assert.match(reversalUp,/'reversal_history',COALESCE\(\(SELECT jsonb_agg\(refs_read_unit_transfer_reversal_pair[\s\S]+ORDER BY r[.]created_at,r[.]unit_transfer_reversal_pair_id\)[\s\S]+\),'\[\]'::jsonb\)/i);
 assert.match(reversalUp,/'active_reversal',\(SELECT refs_read_unit_transfer_reversal_pair[\s\S]+r[.]status NOT IN\('POSTED_PAIR','CANCELLED_PAIR'\)[\s\S]+LIMIT 1\)/i);
 assert.match(reversalUp,/EXISTS\(SELECT 1 FROM unit_transfer_reversal_pair r[\s\S]+r[.]status<>'CANCELLED_PAIR'\)/i);
 assert.doesNotMatch(reversalUp,/'elimination_reversal_basis_id',elimination_reversal_basis_id,'original_elimination_basis_id',original_elimination_basis_id,'signed_elimination_amount'/i);
});

test('Unit Transfer reversal down migration refuses retained evidence and restores 370 guards',()=>{
 assert.match(reversalDown,/Refusing to remove retained Unit Transfer reversal evidence/i);
 // up/371 never shadow-copies the journal transition guard (no _370 copy is
 // created anywhere in the chain), so the down body must not try to restore one:
 // that reference made down/371 die with 42883 on first contact. What up/371
 // does add is the paired-reversal journal guard, and the down must remove it.
 assert.doesNotMatch(reversalDown,/refs_guard_unit_transfer_journal_transition_370/i);
 assert.match(reversalDown,/DROP TRIGGER IF EXISTS unit_transfer_paired_reversal_journal_guard ON journal_entry/i);
 assert.match(reversalDown,/DROP FUNCTION refs_guard_unit_transfer_paired_reversal_journal_transition\(\)/i);
 assert.match(reversalDown,/pg_get_functiondef\('refs_protect_unit_transfer_unit_370\(\)'::regprocedure\)/i);
 assert.match(reversalDown,/DROP TABLE unit_transfer_elimination_reversal_basis/i);
 assert.match(reversalDown,/DROP TABLE unit_transfer_reversal_pair/i);
 assert.match(reversalDown,/DROP TABLE unit_transfer_ic_open_item/i);
});
