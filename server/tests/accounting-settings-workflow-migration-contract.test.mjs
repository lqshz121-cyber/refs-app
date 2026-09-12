import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { MIGRATION_MANIFEST } from '../runtime/migration-manifest.mjs';

const rawUp = await readFile(new URL('../db/migrations/374_accounting_settings_authoritative.sql', import.meta.url), 'utf8');
const rawDown = await readFile(new URL('../db/migrations/down/374_accounting_settings_authoritative.sql', import.meta.url), 'utf8');
const raw251 = await readFile(new URL('../db/migrations/251_wbs_ai_approved_entity_period_settings_read.sql', import.meta.url), 'utf8');
const normalize = value => value.replaceAll('\r\n', '\n');
const up = normalize(rawUp);
const down = normalize(rawDown);
const migration251 = normalize(raw251);

function functionBlock(source, name, { replace = false } = {}) {
  const declaration = `${replace ? 'CREATE OR REPLACE' : 'CREATE'} FUNCTION ${name}`;
  const start = source.indexOf(declaration);
  assert.notEqual(start, -1, `${declaration} must exist`);
  const bodyStart = source.indexOf('AS $$', start);
  const end = source.indexOf('$$;', bodyStart + 5);
  assert.ok(bodyStart > start && end > bodyStart, `${name} must have a complete dollar-quoted body`);
  return source.slice(start, end + 3);
}

function assertOrdered(source, ...needles) {
  let cursor = -1;
  for (const needle of needles) {
    const next = source.indexOf(needle, cursor + 1);
    assert.ok(next > cursor, `${JSON.stringify(needle)} must follow the preceding contract fragment`);
    cursor = next;
  }
}

function deepFamilyBody(source) {
  const start = source.indexOf("    IF child_key='coa' THEN");
  const end = source.indexOf('    result:=result||', start);
  assert.ok(start > 0 && end > start, 'ten-family validation body must be present');
  return source.slice(start, end);
}

function strip374RuntimeParityHardening(source) {
  let normalized = source
    .replaceAll(" OR (account->>'role'='INTERCOMPANY_CLEARING' AND account->>'account_class' NOT IN ('ASSET','LIABILITY'))", '')
    .replace(/^\s*IF[^\n]*Approved intercompany clearing report mapping violates COA class semantics[^\n]*\n/gm, '')
    .replace(/^\s*IF[^\n]*Approved vendor payment terms must be bounded JSON integers[^\n]*\n/gm, '')
    .replace(/^\s*IF[^\n]*Approved tax MONEY4 values must be JSON strings[^\n]*\n/gm, '')
    .replace(/^\s*IF[^\n]*Approved materiality MONEY4 values must be JSON strings[^\n]*\n/gm, '')
    .replace(/^\s*IF[^\n]*Approved approval MONEY4 values must be JSON strings[^\n]*\n/gm, '')
    .replace(/^\s*IF[^\n]*Approved loan materiality MONEY4 value must be a JSON string[^\n]*\n/gm, '')
    .replaceAll(
      "EXISTS(SELECT 1 FROM jsonb_array_elements(child_row.snapshot#>'{settings,non_business_dates}') d WHERE jsonb_typeof(d)<>'string' OR d#>>'{}' !~ '^\\d{4}-\\d{2}-\\d{2}$')",
      () => "EXISTS(SELECT 1 FROM jsonb_array_elements_text(child_row.snapshot#>'{settings,non_business_dates}') d WHERE d !~ '^\\d{4}-\\d{2}-\\d{2}$')"
    )
    .replace(/    IF CASE child_key[\s\S]*?Approved AI settings contain a reversed effective range[^\n]*\n/, '')
    .replace(/    IF CASE child_key[\s\S]*?Approved AI settings contain an invalid required JSON string[^\n]*\n/, '')
    .replace(/    IF CASE child_key[\s\S]*?Approved AI settings contain an empty or non-string evidence key[^\n]*\n/, '')
    .replace(/NOT \(CASE WHEN jsonb_typeof\(v->'payment_terms_days'\)[^\n]*?ELSE false END\)/g, () => "v->>'payment_terms_days' !~ '^[0-9]{1,4}$'");
  for (const [key, legacyRegex] of [
    ['ap_stale_days', "'^[0-9]+$'"],
    ['balance_dormant_days', "'^[0-9]+$'"],
    ['amount_drop_window_days', "'^[1-9][0-9]*$'"],
    ['vendor_frequency_count', "'^[1-9][0-9]*$'"],
    ['vendor_frequency_window_days', "'^[1-9][0-9]*$'"]
  ]) normalized = normalized.replace(
    new RegExp(`NOT \\(CASE WHEN jsonb_typeof\\(child_row\\.snapshot#>'\\{settings,${key}\\}'\\)[^\\n]*?ELSE false END\\)`, 'g'),
    () => `child_row.snapshot#>>'{settings,${key}}' !~ ${legacyRegex}`
  );
  return normalized;
}

function normalizePeriodHistoryPolicy(source) {
  return source
    .replace(
      "OR (NOT p_allow_retired AND child_row.snapshot#>>'{settings,period_status}'<>period_row.status::text) OR (p_allow_retired AND ((period_row.status='OPEN' AND child_row.snapshot#>>'{settings,period_status}'<>'OPEN') OR (period_row.status='SOFT_CLOSED' AND child_row.snapshot#>>'{settings,period_status}' NOT IN('OPEN','SOFT_CLOSED'))))",
      "OR child_row.snapshot#>>'{settings,period_status}'<>period_row.status::text"
    )
    .replace(
      "OR (period_row.status='OPEN' AND child_row.snapshot#>>'{settings,period_status}'<>'OPEN') OR (period_row.status='SOFT_CLOSED' AND child_row.snapshot#>>'{settings,period_status}' NOT IN('OPEN','SOFT_CLOSED'))",
      "OR child_row.snapshot#>>'{settings,period_status}'<>period_row.status::text"
    );
}

test('374 is checksummed forward migration with retained-evidence rollback protection', () => {
  const entry = MIGRATION_MANIFEST.find(item => item.name === '374_accounting_settings_authoritative.sql');
  assert.ok(entry, '374 migration must be present in the fixed migration manifest');
  assert.equal(entry.up, createHash('sha256').update(up).digest('hex'));
  assert.equal(entry.down, createHash('sha256').update(down).digest('hex'));
  assert.match(down, /Refusing to remove retained accounting settings workflow evidence/);
});

test('374 keeps legacy setting status and immutability intact while owning a closed workflow aggregate', () => {
  assert.doesNotMatch(up, /ALTER TABLE setting_snapshot.*DROP CONSTRAINT/is);
  assert.doesNotMatch(up, /CREATE OR REPLACE FUNCTION refs_protect_approved_config/);
  assert.match(up, /status IN\('DRAFT','SUBMITTED','REVIEWED','APPROVED','ACTIVE','SUPERSEDED'\)/);
  assert.match(up, /accounting_settings_one_active_entity_uq[\s\S]+WHERE status='ACTIVE'/);
  assert.match(up, /refs\.config_retire','authorized'/);
  assert.match(up, /AI_ACCOUNTING_ENTITY_PERIOD_SETTINGS_V1/);
  assert.match(up, /refs_validate_accounting_settings_activation_snapshot/);
});

test('374 locks, revalidates and fails closed for cross-scope, non-open and same-period commands', () => {
  assert.match(up, /pg_advisory_xact_lock\(hashtextextended\('ACCOUNTING_SETTINGS:'/);
  assert.match(up, /LOCK TABLE setting_snapshot IN SHARE/);
  assert.match(up, /tenant_id=p_tenant AND entity_id=p_entity[\s\S]+scope_type='ENTITY'[\s\S]+status='APPROVED'/);
  assert.match(up, /transition requires the target period to remain OPEN/);
  assert.match(up, /Same-period accounting settings replacement is forbidden/);
  assert.match(up, /replacement must target a strictly later period/);
  assert.match(up, /source evidence changed/);
});

test('374 STABLE readers never take row locks and commands atomically audit and enqueue', () => {
  for (const name of [
    'refs_validate_accounting_settings_selected_bundle',
    'refs_accounting_settings_parent_snapshot',
    'refs_accounting_settings_workflow_payload',
    'refs_read_accounting_settings_workflow_evidence',
    'refs_read_accounting_settings_workflow_options',
    'refs_read_accounting_settings_workflow_register'
  ]) {
    const body = functionBlock(up, name);
    assert.doesNotMatch(body, /FOR (?:UPDATE|SHARE)/, name);
  }
  assert.match(up, /INSERT INTO audit_event/g);
  assert.match(up, /INSERT INTO outbox_event/g);
  assert.match(up, /idempotency_receipt/);
  assert.doesNotMatch(up, /action='ACTIVATE'[\s\S]{0,200}refs_assert_scope\([^;]+AI\.ACCOUNTING\.SETTINGS\.VIEW/);
});

test('374 private activation readback is exact 251 validation plus runtime parity hardening and remains ungranted', () => {
  const legacy = functionBlock(migration251, 'refs_read_wbs_ai_approved_entity_period_settings');
  const expected = legacy
    .replace('CREATE FUNCTION refs_read_wbs_ai_approved_entity_period_settings(', 'CREATE FUNCTION refs_validate_accounting_settings_activation_snapshot(')
    .replace("  PERFORM refs_assert_scope(p_tenant,p_entity,'AI.ACCOUNTING.SETTINGS.VIEW');\n", '');
  const activation = functionBlock(up, 'refs_validate_accounting_settings_activation_snapshot')
    .replace('  child jsonb; result jsonb; child_key text; child_family text; selected_ids jsonb;', '  child jsonb; result jsonb; child_key text; child_family text;')
    .replace("  SELECT jsonb_object_agg(k,parent_row.snapshot#>>ARRAY[k,'setting_snapshot_id']) INTO selected_ids FROM unnest(child_keys) k;\n  PERFORM refs_validate_accounting_settings_selected_bundle(p_tenant,p_entity,p_period,parent_row.snapshot,selected_ids,false);\n", '');
  assert.equal(strip374RuntimeParityHardening(activation), expected);
  assert.match(expected, /LANGUAGE plpgsql SECURITY DEFINER/);
  assert.doesNotMatch(expected, /\bSTABLE\b/);
  assert.match(up, /REVOKE ALL ON FUNCTION[^;]+refs_validate_accounting_settings_activation_snapshot\(uuid,uuid,uuid\)[^;]+FROM PUBLIC,refs_app/);
  assert.doesNotMatch(up, /GRANT EXECUTE ON FUNCTION[^;]+refs_validate_accounting_settings_activation_snapshot/);
  assert.match(down, /DROP FUNCTION IF EXISTS refs_validate_accounting_settings_activation_snapshot/);
});

test('374 private selected bundle validator is exact ten-family validation across every workflow boundary', () => {
  const legacy = functionBlock(migration251, 'refs_read_wbs_ai_approved_entity_period_settings');
  const helper = functionBlock(up, 'refs_validate_accounting_settings_selected_bundle');
  const helperFamily = normalizePeriodHistoryPolicy(deepFamilyBody(helper));
  assert.equal(strip374RuntimeParityHardening(helperFamily), deepFamilyBody(legacy));
  assert.equal(helperFamily, normalizePeriodHistoryPolicy(deepFamilyBody(functionBlock(up, 'refs_read_wbs_ai_approved_entity_period_settings', { replace: true }))));
  assert.equal(helperFamily, normalizePeriodHistoryPolicy(deepFamilyBody(functionBlock(up, 'refs_validate_accounting_settings_activation_snapshot'))));
  assert.match(helper, /LANGUAGE plpgsql STABLE SECURITY DEFINER/);
  assert.doesNotMatch(helper, /FOR (?:UPDATE|SHARE)/);
  assert.match(helper, /p_ids->>child_key IS DISTINCT FROM child->>'setting_snapshot_id'/);
  assert.match(helper, /NOT p_allow_retired AND status='APPROVED'/);
  assert.match(helper, /p_allow_retired AND status IN\('APPROVED','RETIRED'\)/);
  assert.match(helper, /NOT p_allow_retired AND NOT entity_row\.active/);
  assert.match(helper, /NOT p_allow_retired AND \(period_row\.ledger_code<>'PRIMARY' OR EXISTS/);
  assert.match(helper, /NOT p_allow_retired AND \(p_parent->>'company_code'<>entity_row\.entity_code OR p_parent->>'currency'<>entity_row\.base_currency\)/);
  assert.match(helper, /p_allow_retired AND \(\(period_row\.status='OPEN'[\s\S]+period_row\.status='SOFT_CLOSED'/);

  const parent = functionBlock(up, 'refs_accounting_settings_parent_snapshot');
  const transition = functionBlock(up, 'refs_transition_accounting_settings_workflow');
  const activation = functionBlock(up, 'refs_validate_accounting_settings_activation_snapshot');
  const evidence = functionBlock(up, 'refs_read_accounting_settings_workflow_evidence');
  assert.match(parent, /refs_validate_accounting_settings_selected_bundle\(p_tenant,p_entity,p_period,result,p_ids,false\)/);
  assert.match(transition, /snapshot:=refs_accounting_settings_parent_snapshot\(p_tenant,p_entity,w\.period_id,w\.child_setting_snapshot_ids\)/);
  assert.match(activation, /refs_validate_accounting_settings_selected_bundle\(p_tenant,p_entity,p_period,parent_row\.snapshot,selected_ids,false\)/);
  assert.match(evidence, /refs_validate_accounting_settings_selected_bundle\(p_tenant,p_entity,w\.period_id,w\.canonical_parent_snapshot,w\.child_setting_snapshot_ids,true\)/);
  assert.match(up, /REVOKE ALL ON FUNCTION refs_validate_accounting_settings_selected_bundle\(uuid,uuid,uuid,jsonb,jsonb,boolean\)[\s\S]+FROM PUBLIC,refs_app/);
  assert.doesNotMatch(up, /GRANT EXECUTE ON FUNCTION[^;]+refs_validate_accounting_settings_selected_bundle/);
  assertOrdered(down,
    'DROP FUNCTION IF EXISTS refs_validate_accounting_settings_activation_snapshot',
    'DROP FUNCTION refs_accounting_settings_parent_snapshot',
    'DROP FUNCTION refs_validate_accounting_settings_selected_bundle'
  );
});

test('374 keeps clearing-account semantics and JSON scalar types aligned with the runtime validator in all three deep readers', () => {
  assert.equal((up.match(/account->>'role'='INTERCOMPANY_CLEARING' AND account->>'account_class' NOT IN \('ASSET','LIABILITY'\)/g) || []).length, 3);
  assert.equal((up.match(/Approved intercompany clearing report mapping violates COA class semantics/g) || []).length, 3);
  assert.equal((up.match(/account->>'account_class'='ASSET' AND m->>'normal_balance'<>'DEBIT'/g) || []).length, 3);
  assert.equal((up.match(/account->>'account_class'='LIABILITY' AND m->>'normal_balance'<>'CREDIT'/g) || []).length, 3);
  assert.equal((up.match(/m->>'statement'<>'BS' OR m->>'contra'<>'false'/g) || []).length, 3);
  for (const message of [
    'Approved tax MONEY4 values must be JSON strings',
    'Approved materiality MONEY4 values must be JSON strings',
    'Approved approval MONEY4 values must be JSON strings',
    'Approved loan materiality MONEY4 value must be a JSON string'
  ]) assert.equal((up.match(new RegExp(message, 'g')) || []).length, 3, message);
  assert.equal((up.match(/jsonb_typeof\(v->'payment_terms_days'\)='number'/g) || []).length, 3);
  assert.equal((up.match(/payment_terms_days'\)::numeric=trunc/g) || []).length, 3);
  assert.equal((up.match(/9007199254740991/g) || []).length, 15);
  assert.equal((up.match(/::numeric=trunc/g) || []).length, 18);
  assert.equal((up.match(/Approved AI settings contain a reversed effective range/g) || []).length, 3);
  assert.equal((up.match(/Approved AI settings contain an invalid required JSON string/g) || []).length, 3);
  assert.equal((up.match(/Approved AI settings contain an empty or non-string evidence key/g) || []).length, 3);
  assert.equal((up.match(/CROSS JOIN LATERAL unnest\(ARRAY\['aliases','contract_keys','service_keys','source_requirements'\]\)/g) || []).length, 3);
  assert.equal((up.match(/CROSS JOIN LATERAL unnest\(ARRAY\['effective_to','cost_code_ref','project_ref','property_ref','member_ref','completion_date','pis_date'\]\)/g) || []).length, 3);
  assert.equal((up.match(/CROSS JOIN LATERAL unnest\(ARRAY\['effective_to','asset_ref','project_ref','property_ref'\]\)/g) || []).length, 3);
  assert.equal((up.match(/jsonb_array_elements\(a->'dimension_requirements'\) item/g) || []).length, 3);
  assert.equal((up.match(/jsonb_array_elements\(i->'dimension_requirements'\) item/g) || []).length, 3);
  assert.equal((up.match(/required_key\(key\) WHERE jsonb_typeof/g) || []).length, 39);
  assert.equal((up.match(/jsonb_array_elements\(child_row\.snapshot#>'\{settings,non_business_dates\}'\) d WHERE jsonb_typeof\(d\)<>'string'/g) || []).length, 3);
  assert.equal((up.match(/jsonb_array_elements_text\(child_row\.snapshot#>'\{settings,non_business_dates\}'\)/g) || []).length, 0);
});

test('374 pairs every finite action authority with workflow view and restores the prior additive policy on rollback', () => {
  for (const [role, permission] of [['DRAFT', 'CREATE'], ['SUBMIT', 'SUBMIT'], ['REVIEW', 'REVIEW'], ['APPROVE', 'APPROVE'], ['POST', 'ACTIVATE']]) {
    assert.match(up, new RegExp(`ACCOUNTING\\.SETTINGS\\.WORKFLOW\\.VIEW'\\s*,\\s*'${role}'[\\s\\S]+ACCOUNTING\\.SETTINGS\\.WORKFLOW\\.${permission}'`));
  }
  assert.match(up, /refs_assert_scope\(p_tenant,p_entity,'ACCOUNTING\.SETTINGS\.WORKFLOW\.VIEW'\);[\s\S]+ACCOUNTING\.SETTINGS\.WORKFLOW\.CREATE/);
  assert.match(up, /refs_assert_scope\(p_tenant,p_entity,'ACCOUNTING\.SETTINGS\.WORKFLOW\.VIEW'\);[\s\S]+refs_transition_accounting_settings_workflow/);
  assert.match(down, /DELETE FROM runtime_human_additive_permission_authority[\s\S]+ACCOUNTING\.SETTINGS\.WORKFLOW\.VIEW/);
  assert.match(down, /CHECK\s*\(permission_code='ATTACHMENT\.CREATE'/);
  assert.doesNotMatch(down, /CHECK\s*\(permission_code='ACCOUNTING\.SETTINGS\.WORKFLOW\.VIEW'/);
});

test('374 protects both prior-parent retirement paths and serializes rollback against retained grant writes', () => {
  assert.equal((up.match(/Activator cannot retire a parent they created or approved/g) || []).length, 2);
  assert.match(up, /Accounting settings separation of duties violation'[\s\S]+ERRCODE='42501'/);
  assertOrdered(down,
    'LOCK TABLE permission_catalog IN ACCESS EXCLUSIVE MODE;',
    'LOCK TABLE accounting_settings_workflow,accounting_settings_workflow_history IN ACCESS EXCLUSIVE MODE;',
    'LOCK TABLE runtime_grant_sync_receipt,runtime_actor_grant IN ACCESS EXCLUSIVE MODE;',
    "RAISE EXCEPTION 'Refusing to remove retained accounting settings workflow evidence'"
  );
});

test('374 exposes only deterministic command hashes needed by runtime preflight', () => {
  assert.match(up, /GRANT EXECUTE ON FUNCTION refs_accounting_settings_create_hash\(uuid,uuid,uuid,jsonb,text\),refs_accounting_settings_transition_hash\(uuid,uuid,uuid,text,bigint,text\)[\s\S]+TO refs_app/);
  assert.match(down, /REVOKE ALL ON FUNCTION refs_accounting_settings_create_hash\(uuid,uuid,uuid,jsonb,text\),refs_accounting_settings_transition_hash\(uuid,uuid,uuid,text,bigint,text\)[\s\S]+FROM refs_app/);
  assert.doesNotMatch(up, /GRANT EXECUTE ON FUNCTION[^;]+refs_validate_accounting_settings_activation_snapshot/);
});

test('374 separates stale preconditions from SoD and preserves a period-end monotonic retained parent timeline', () => {
  assert.match(up, /Accounting settings revision conflict'[\s\S]+ERRCODE='40001'/);
  assert.match(up, /Accounting settings status conflict'[\s\S]+ERRCODE='40001'/);
  assert.match(up, /Accounting settings separation of duties violation'[\s\S]+ERRCODE='42501'/);
  assert.match(up, /max\(CASE WHEN s\.snapshot->>'period_end'[\s\S]+latest_parent_period_end[\s\S]+status IN\('APPROVED','RETIRED'\)/);
  assert.match(up, /max\(CASE WHEN prior\.canonical_parent_snapshot->>'period_end'[\s\S]+latest_workflow_period_end[\s\S]+status IN\('ACTIVE','SUPERSEDED'\)/);
  assert.match(up, /latest_parent_period_end>=target_start[\s\S]+latest_workflow_period_end>=target_start[\s\S]+strictly later than all retained parent history/);
});

test('374 emits an independent authoritative parent audit and outbox event after deep readback', () => {
  const readback = up.indexOf('readback:=refs_validate_accounting_settings_activation_snapshot');
  const audit = up.indexOf("'CONFIG_SNAPSHOT_APPROVED','SETTING_SNAPSHOT'");
  const outbox = up.indexOf("'SETTING_SNAPSHOT',parent_id,'CONFIG_SNAPSHOT_APPROVED'");
  assert.ok(readback > 0 && audit > readback && outbox > audit);
  assert.equal((up.match(/'CONFIG_SNAPSHOT_APPROVED'/g) || []).length, 2);
});

test('374 workflow and history rows encode only the exact lifecycle states and revisions', () => {
  assert.match(up, /FOREIGN KEY\(tenant_id,entity_id,superseded_by_workflow_id\) REFERENCES accounting_settings_workflow\(tenant_id,entity_id,accounting_settings_workflow_id\)/);
  assert.match(up, /superseded_by_workflow_id<>accounting_settings_workflow_id/);
  assert.match(up, /status='DRAFT' AND revision=0[\s\S]+status='SUBMITTED' AND revision=1[\s\S]+status='REVIEWED' AND revision=2[\s\S]+status='APPROVED' AND revision=3[\s\S]+status='ACTIVE' AND revision=4[\s\S]+status='SUPERSEDED' AND revision=5/);
  assert.match(up, /submitted_by IS NULL\)=\(submitted_at IS NULL\)[\s\S]+reviewed_by IS NULL\)=\(reviewed_at IS NULL\)[\s\S]+approved_by IS NULL\)=\(approved_at IS NULL\)[\s\S]+activated_by IS NULL\)=\(activated_at IS NULL\)/);
  assert.match(up, /submitted_by IS NULL OR submitted_by<>created_by[\s\S]+reviewed_by IS NULL OR reviewed_by<>ALL[\s\S]+approved_by IS NULL OR approved_by<>ALL[\s\S]+activated_by IS NULL OR activated_by<>ALL/);
  assert.match(up, /revision=0 AND from_status IS NULL AND to_status='DRAFT'[\s\S]+revision=1 AND from_status='DRAFT' AND to_status='SUBMITTED'[\s\S]+revision=2 AND from_status='SUBMITTED' AND to_status='REVIEWED'[\s\S]+revision=3 AND from_status='REVIEWED' AND to_status='APPROVED'[\s\S]+revision=4 AND from_status='APPROVED' AND to_status='ACTIVE'[\s\S]+revision=5 AND from_status='ACTIVE' AND to_status='SUPERSEDED'/);
  assert.match(up, /CHECK\(\(revision=0\)=\(previous_event_hash IS NULL\)\)/);
  assert.match(up, /length\(actor_id\) BETWEEN 1 AND 300[\s\S]+actor_id=btrim\(actor_id\)[\s\S]+length\(reason\) BETWEEN 8 AND 2000[\s\S]+reason=btrim\(reason\)/);
});

test('374 hashes tenant and event time with one explicit timestamp across create, transition, and supersession paths', () => {
  const hash = functionBlock(up, 'refs_accounting_settings_history_hash');
  assert.match(hash, /p_tenant uuid,p_workflow uuid,p_from text,p_to text,p_revision bigint,p_actor text,p_reason text,p_previous text,p_created_at timestamptz/);
  assert.match(hash, /'tenant_id',p_tenant/);
  assert.match(hash, /'created_at',to_char\(p_created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS\.US"Z"'\)/);

  const create = functionBlock(up, 'refs_create_accounting_settings_workflow');
  assert.match(create, /event_at:=clock_timestamp\(\);[\s\S]+created_by,created_at\)[\s\S]+actor,event_at\)[\s\S]+refs_accounting_settings_history_hash\([^;]+event_at\)[\s\S]+'created_at',event_at[\s\S]+event_hash,created_at\)[\s\S]+history_hash,event_at\)/);

  const transition = functionBlock(up, 'refs_transition_accounting_settings_workflow');
  assert.match(transition, /old_event_at:=clock_timestamp\(\);[\s\S]+superseded_at=old_event_at[\s\S]+refs_accounting_settings_history_hash\([^;]+old_event_at\)[\s\S]+'created_at',old_event_at[\s\S]+event_hash,created_at\)[\s\S]+old_history_hash,old_event_at\)/);
  assert.match(transition, /event_at:=clock_timestamp\(\);[\s\S]+submitted_at=CASE WHEN action='SUBMIT' THEN event_at[\s\S]+refs_accounting_settings_history_hash\([^;]+event_at\)[\s\S]+'created_at',event_at[\s\S]+event_hash,created_at\)[\s\S]+history_hash,event_at\)/);
});

test('374 evidence reader is VIEW-scoped, granted on up, and revoked and dropped on down', () => {
  const evidence = functionBlock(up, 'refs_read_accounting_settings_workflow_evidence');
  assert.match(evidence, /refs_assert_scope\(p_tenant,p_entity,'ACCOUNTING\.SETTINGS\.WORKFLOW\.VIEW'\)/);
  assert.match(evidence, /selected_child_snapshots/);
  assert.match(evidence, /canonical_parent_hash/);
  assert.match(up, /GRANT EXECUTE ON FUNCTION[^;]+refs_read_accounting_settings_workflow_evidence\(uuid,uuid,uuid\)[^;]+TO refs_app/);
  assertOrdered(down,
    'REVOKE ALL ON FUNCTION refs_accounting_settings_create_hash',
    'refs_read_accounting_settings_workflow_evidence(uuid,uuid,uuid)',
    'DROP FUNCTION refs_read_accounting_settings_workflow_evidence(uuid,uuid,uuid);'
  );
});

test('374 blocks ACTIVE and SUPERSEDED child retirement through the bound period', () => {
  const guard = functionBlock(up, 'refs_protect_workflow_owned_accounting_settings_parent');
  assert.match(guard, /w\.status IN\('ACTIVE','SUPERSEDED'\)/);
  assert.match(guard, /jsonb_each_text\(w\.child_setting_snapshot_ids\)[\s\S]+child\.value=OLD\.setting_snapshot_id::text/);
  assert.match(guard, /NEW\.effective_to IS NULL OR NEW\.effective_to<=p\.ends_on::timestamptz/);
  assert.match(guard, /Active accounting settings child must cover its bound period'[\s\S]+ERRCODE='42501'/);
  assert.match(guard, /w\.status='ACTIVE'[\s\S]+legacy_parent_setting_snapshot_id=OLD\.setting_snapshot_id/);
});

test('374 create takes the setting snapshot SHARE lock before every retained-history scan', () => {
  const create = functionBlock(up, 'refs_create_accounting_settings_workflow');
  const lock = create.indexOf('LOCK TABLE setting_snapshot IN SHARE MODE;');
  const samePeriod = create.indexOf("status IN('ACTIVE','SUPERSEDED')", lock);
  const retainedParents = create.indexOf("s.status IN('APPROVED','RETIRED')", lock);
  const retainedWorkflows = create.indexOf("prior.status IN('ACTIVE','SUPERSEDED')", lock);
  assert.ok(lock > 0 && samePeriod > lock && retainedParents > lock && retainedWorkflows > retainedParents);
});

test('374 public reader is history-aware and down restores the exact migration 251 reader', () => {
  const publicReader = functionBlock(up, 'refs_read_wbs_ai_approved_entity_period_settings', { replace: true });
  assert.equal((publicReader.match(/status IN\('APPROVED','RETIRED'\)/g) || []).length, 3);
  assert.match(publicReader, /effective_from<=period_row\.starts_on::timestamptz[\s\S]+effective_to>period_row\.ends_on::timestamptz/);
  assert.match(publicReader, /RETURN result\|\|jsonb_build_object\('can_create_draft',false,'can_review',false,'can_approve',false,'can_post',false\)/);

  const restored = functionBlock(down, 'refs_read_wbs_ai_approved_entity_period_settings', { replace: true })
    .replace('CREATE OR REPLACE FUNCTION', 'CREATE FUNCTION');
  const legacy = functionBlock(migration251, 'refs_read_wbs_ai_approved_entity_period_settings');
  assert.equal(restored, legacy);
  assertOrdered(down,
    'DROP TRIGGER setting_snapshot_accounting_settings_parent_guard ON setting_snapshot;',
    '-- Restore the exact migration 251 public reader.',
    'CREATE OR REPLACE FUNCTION refs_read_wbs_ai_approved_entity_period_settings('
  );
});

test('374 down drops workflow dependencies before tables and exactly restores the prior additive CHECK', () => {
  assertOrdered(down,
    'DROP FUNCTION refs_read_accounting_settings_workflow_register',
    'DROP FUNCTION refs_transition_accounting_settings_workflow',
    'DROP FUNCTION refs_create_accounting_settings_workflow',
    'DROP FUNCTION refs_read_accounting_settings_workflow_evidence',
    'DROP FUNCTION refs_accounting_settings_history_hash',
    'DROP TRIGGER accounting_settings_workflow_history_append_only',
    'DROP TRIGGER accounting_settings_workflow_protect',
    'DROP TABLE accounting_settings_workflow_gate;',
    'DROP TABLE accounting_settings_workflow_history;',
    'DROP TABLE accounting_settings_workflow;'
  );
  assert.match(down, /ALTER TABLE runtime_human_additive_permission_authority ADD CONSTRAINT runtime_human_additive_permission_authority_check\s+CHECK\(permission_code='ATTACHMENT\.CREATE' AND authority_class IN\('DRAFT','PAYMENT','RECEIPT','ADJUSTMENT'\)\);/);
});
