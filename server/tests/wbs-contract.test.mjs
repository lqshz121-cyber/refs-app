import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile, readdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {dirname, join, resolve} from 'node:path';

const here=dirname(fileURLToPath(import.meta.url));
const serverRoot=resolve(here,'..');
const sql=await readFile(join(serverRoot,'db','migrations','001_wbs_accounting_core.sql'),'utf8');
const openapi=await readFile(join(serverRoot,'api','openapi-wbs.yaml'),'utf8');
const fixtureDir=join(here,'fixtures','wbs');
const fixtureNames=(await readdir(fixtureDir)).filter(name=>name.endsWith('.json')).sort();
const fixtures=await Promise.all(fixtureNames.map(async name=>({name,data:JSON.parse(await readFile(join(fixtureDir,name),'utf8'))})));

const normalize=s=>s.replace(/\s+/g,' ').trim();
const sqlFlat=normalize(sql);
const tableNames=[
  'tenant','entity','accounting_period','raw_event','sync_cursor','import_batch',
  'source_document','source_document_line','staging_item','setting_snapshot',
  'mapping_snapshot','rule_evaluation','ai_decision','accounting_exception',
  'journal_entry','journal_line','posting_batch','ledger_line','source_link',
  'idempotency_receipt','audit_event','outbox_event','attachment','bank_source',
  'bank_match','reconciliation'
];

test('migration declares the complete accounting and WBS contract object set',()=>{
  for(const name of tableNames)assert.match(sql,new RegExp(`CREATE TABLE ${name}\\s*\\(`),`missing table ${name}`);
  assert.match(sql,/BEGIN;/);
  assert.match(sql,/COMMIT;/);
});

test('raw event keys separate immutable versions from one current projection',()=>{
  assert.match(sqlFlat,/UNIQUE \(tenant_id, source_system, source_module, source_entity_id, source_record_id, source_version\)/);
  assert.match(sqlFlat,/CREATE UNIQUE INDEX raw_event_one_current_uq ON raw_event \(tenant_id, source_system, source_module, source_entity_id, source_record_id\) WHERE is_current/);
  assert.match(sql,/event_type source_event_type NOT NULL/);
  assert.match(sql,/payload_hash text NOT NULL CHECK \(payload_hash ~ '\^sha256:/);
  assert.match(sqlFlat,/source_document ADD FOREIGN KEY \(tenant_id, raw_event_id, source_system, source_module, source_entity_id, source_record_id, source_version\) REFERENCES raw_event\(tenant_id, raw_event_id, source_system, source_module, source_entity_id, source_record_id, source_version\)/);
});

test('mapping, active bank match and idempotency invariants are database-backed',()=>{
  assert.match(sqlFlat,/UNIQUE \(tenant_id, family, scope_type, scope_key, input_key_hash, version\)/);
  assert.match(sqlFlat,/CONSTRAINT mapping_approved_equal_priority_no_overlap EXCLUDE USING gist/);
  assert.match(sql,/Resolver must return exactly one highest-priority APPROVED effective candidate; zero or tied candidates fail closed as MAPPING_MISSING\/MAPPING_AMBIGUOUS/);
  assert.match(sqlFlat,/CREATE UNIQUE INDEX bank_match_one_active_bank_line_uq ON bank_match \(tenant_id, bank_source_id\) WHERE status = 'ACTIVE'/);
  assert.match(sqlFlat,/CREATE UNIQUE INDEX bank_match_one_active_business_source_uq ON bank_match \(tenant_id, business_source_document_id\) WHERE status = 'ACTIVE' AND business_source_document_id IS NOT NULL/);
  assert.match(sqlFlat,/CREATE UNIQUE INDEX bank_match_one_active_journal_line_uq ON bank_match \(tenant_id, journal_line_id\) WHERE status = 'ACTIVE' AND journal_line_id IS NOT NULL/);
  assert.match(sqlFlat,/UNIQUE \(tenant_id, operation_scope, idempotency_key\)/);
  assert.match(sql,/request_hash text NOT NULL CHECK \(request_hash ~ '\^sha256:/);
  assert.match(sql,/repeated key with a different request_hash is rejected/);
});

test('journal line immutability checks both old and new parent on update',()=>{
  const fn=sql.match(/CREATE OR REPLACE FUNCTION protect_posted_journal_line\(\)[\s\S]*?\n\$\$;/)?.[0]||'';
  assert.match(fn,/TG_OP = 'UPDATE'[\s\S]*?OLD\.tenant_id[\s\S]*?OLD\.journal_entry_id/);
  assert.match(fn,/ORDER BY tenant_id, journal_entry_id[\s\S]*?FOR UPDATE/);
  assert.match(fn,/old_parent_status = 'POSTED'/);
  assert.match(fn,/NEW\.tenant_id[\s\S]*?NEW\.journal_entry_id/);
  assert.match(fn,/new_parent_status = 'POSTED'/);
  assert.ok(fn.indexOf("old_parent_status = 'POSTED'") < fn.indexOf("new_parent_status = 'POSTED'"),'old Posted parent must be rejected before accepting a new parent');
  assert.match(sql,/Posting transaction lock order: accounting_period FOR UPDATE; journal_entry FOR UPDATE; journal_line rows FOR UPDATE ordered by journal_line_id/);
  assert.match(sql,/Required two-connection test: A locks JE then lines and posts; B line UPDATE blocks[\s\S]*?SQLSTATE 55000/);
});

test('entity and period identity is carried by composite candidate keys and foreign keys',()=>{
  for(const key of [
    'accounting_period ADD FOREIGN KEY (tenant_id, entity_id)',
    'source_document ADD FOREIGN KEY (tenant_id, entity_id, source_system, source_entity_id)',
    'journal_entry ADD FOREIGN KEY (tenant_id, entity_id, period_id)',
    'journal_entry ADD FOREIGN KEY (tenant_id, entity_id, reversal_of_id)',
    'journal_entry ADD FOREIGN KEY (tenant_id, entity_id, reclass_of_id)',
    'journal_line ADD FOREIGN KEY (tenant_id, entity_id, period_id, journal_entry_id)',
    'posting_batch ADD FOREIGN KEY (tenant_id, entity_id, period_id)',
    'ledger_line ADD FOREIGN KEY (tenant_id, entity_id, period_id, posting_batch_id)',
    'ledger_line ADD FOREIGN KEY (tenant_id, entity_id, period_id, journal_entry_id)',
    'ledger_line ADD FOREIGN KEY (tenant_id, entity_id, period_id, journal_line_id)',
    'staging_item ADD FOREIGN KEY (tenant_id, entity_id, source_document_id)',
    'source_document_line ADD FOREIGN KEY (tenant_id, entity_id, source_document_id)',
    'bank_source ADD FOREIGN KEY (tenant_id, entity_id, source_document_id)',
    'bank_match ADD FOREIGN KEY (tenant_id, entity_id, bank_source_id)',
    'bank_match ADD FOREIGN KEY (tenant_id, entity_id, business_source_document_id)',
    'audit_event ADD FOREIGN KEY (tenant_id, entity_id)'
  ])assert.match(sqlFlat,new RegExp(key.replace(/[()]/g,'\\$&')),`missing composite scope guard: ${key}`);
  assert.match(sqlFlat,/UNIQUE \(tenant_id, entity_id, period_id, journal_entry_id\)/);
  assert.match(sqlFlat,/UNIQUE \(tenant_id, entity_id, period_id, journal_line_id\)/);
  assert.match(sqlFlat,/UNIQUE \(tenant_id, entity_id, period_id, posting_batch_id\)/);
});

test('source trace graph is entity-scoped, including raw evidence',()=>{
  const linkBlock=sql.match(/CREATE TABLE source_link \([\s\S]*?\n\);/)?.[0]||'';
  assert.match(linkBlock,/entity_id uuid NOT NULL/);
  for(const relation of [
    'source_link ADD FOREIGN KEY (tenant_id, entity_id, source_document_id)',
    'source_link ADD FOREIGN KEY (tenant_id, entity_id, source_document_line_id)',
    'source_link ADD FOREIGN KEY (tenant_id, entity_id, staging_item_id)',
    'source_link ADD FOREIGN KEY (tenant_id, entity_id, journal_entry_id)',
    'source_link ADD FOREIGN KEY (tenant_id, entity_id, journal_line_id)',
    'source_link ADD FOREIGN KEY (tenant_id, entity_id, posting_batch_id)',
    'source_link ADD FOREIGN KEY (tenant_id, entity_id, ledger_line_id)',
    'source_link ADD FOREIGN KEY (tenant_id, entity_id, bank_source_id)',
    'source_link ADD FOREIGN KEY (tenant_id, entity_id, bank_match_id)',
    'source_link ADD FOREIGN KEY (tenant_id, entity_id, reconciliation_id)'
  ])assert.match(sqlFlat,new RegExp(relation.replace(/[()]/g,'\\$&')),`trace relation not entity-scoped: ${relation}`);
  assert.match(sql,/CREATE TRIGGER source_link_entity_scope/);
  assert.match(sql,/Raw event does not belong to the source link entity/);
});

test('setting and mapping approval enforce maker-approver separation',()=>{
  for(const table of ['setting_snapshot','mapping_snapshot']){
    const block=sql.match(new RegExp(`CREATE TABLE ${table} \\([\\s\\S]*?\\n\\);`))?.[0]||'';
    assert.match(block,/created_by text NOT NULL/);
    assert.match(block,/CHECK \(approved_by IS NULL OR approved_by <> created_by\)/);
  }
});

test('posted journals, ledger lines, audit events and trace links have immutable policy',()=>{
  assert.match(sql,/CREATE TRIGGER journal_entry_posted_immutable/);
  assert.match(sql,/CREATE TRIGGER journal_line_posted_immutable/);
  assert.match(sql,/CREATE TRIGGER ledger_line_append_only/);
  assert.match(sql,/CREATE TRIGGER audit_event_append_only/);
  assert.match(sql,/CREATE TRIGGER source_link_append_only/);
  const sourceLinkBlock=sql.match(/CREATE TABLE source_link \([\s\S]*?\n\);/)?.[0]||'';
  assert.doesNotMatch(sourceLinkBlock,/description|document_no|journal_number/i);
  assert.match(sourceLinkBlock,/ledger_line_id uuid REFERENCES ledger_line/);
  assert.match(sql,/CHECK \(reviewed_by IS NULL OR reviewed_by <> created_by\)/);
  assert.match(sql,/CHECK \(approved_by IS NULL OR reviewed_by IS NULL OR approved_by <> reviewed_by\)/);
  assert.match(sql,/CHECK \(posted_by IS NULL OR approved_by IS NULL OR posted_by <> approved_by\)/);
});

test('financial amounts are decimal and trace objects use foreign keys',()=>{
  assert.match(sql,/numeric\(20,4\)/);
  assert.doesNotMatch(sql,/\b(real|double precision|money)\b/i);
  for(const target of ['raw_event','source_document','staging_item','journal_entry','journal_line','posting_batch','ledger_line','bank_source','bank_match','reconciliation','attachment']){
    assert.match(sql,new RegExp(`REFERENCES ${target}\\(`),`source graph never references ${target}`);
  }
});

test('core relationships include tenant-scoped composite foreign keys',()=>{
  for(const relation of [
    'raw_event ADD FOREIGN KEY (tenant_id, import_batch_id)',
    'source_document ADD FOREIGN KEY (tenant_id, raw_event_id, source_system, source_module, source_entity_id, source_record_id, source_version)',
    'staging_item ADD FOREIGN KEY (tenant_id, entity_id, source_document_id)',
    'journal_line ADD FOREIGN KEY (tenant_id, entity_id, period_id, journal_entry_id)',
    'ledger_line ADD FOREIGN KEY (tenant_id, entity_id, period_id, journal_line_id)',
    'bank_match ADD FOREIGN KEY (tenant_id, entity_id, bank_source_id)',
    'source_link ADD FOREIGN KEY (tenant_id, entity_id, ledger_line_id)',
    'source_link ADD FOREIGN KEY (tenant_id, attachment_id)'
  ])assert.match(sqlFlat,new RegExp(relation.replace(/[()]/g,'\\$&')));
});

test('OpenAPI exposes only REFS-side ingestion, review and trace boundaries',()=>{
  assert.match(openapi,/openapi: 3\.1\.0/);
  assert.match(openapi,/x-wbs-external-access: read-only/);
  for(const operation of ['createWbsImportBatch','getWbsImportBatch','updateWbsImportBatchStatus','getWbsSyncCursor','advanceWbsSyncCursor','listSourceDocuments','getSourceDocument','reviewStagingItem','resolveIngestionException','traceFromSourceDocument','traceFromLedgerLine'])assert.match(openapi,new RegExp(`operationId: ${operation}`));
  assert.doesNotMatch(openapi,/operationId: (create|update|delete).*Wbs(Source|Transaction|Setting|Match)/i);
  assert.match(openapi,/security:\n  - sessionCookie: \[\]\n  - serviceAccountBearer: \[\]/);
  assert.match(openapi,/x-actor-source: authenticated-service-account[\s\S]*?security:\n\s+- serviceAccountBearer: \[\]/);
  assert.match(openapi,/x-actor-source: authenticated-session[\s\S]*?security:\n\s+- sessionCookie: \[\]/);
  const requestSurface=openapi.slice(0,openapi.indexOf('    TraceGraph:'));
  assert.doesNotMatch(requestSurface,/actor_id:\s*\{/);
  assert.doesNotMatch(openapi,/x-actor-source: request-body/);
  assert.match(openapi,/x-required-permission: ACCOUNTING\.STAGING\.REVIEW/);
  assert.match(openapi,/x-entity-scope: staging item entity must be present in authenticated session claims/);
  assert.match(openapi,/x-sod: reviewer must differ from source coder and from the approver of the selected mapping snapshot/);
});

test('source, mapping and attachment policies fail closed at the contract boundary',()=>{
  assert.match(openapi,/transaction-source-allowlist: \[bankFeed, payable, cost, loan, pmCharge, closing\]/);
  assert.match(openapi,/evidence-only-modules: \[accountLink, accountReport, generalLedger, IncomeStatement\]/);
  assert.match(openapi,/tied-highest-priority-code: MAPPING_AMBIGUOUS/);
  assert.match(openapi,/required-state: VERIFIED_CLEAN/);
  assert.match(sql,/CHECK \(source_module IN \('bankFeed', 'payable', 'cost', 'loan', 'pmCharge', 'closing'\)\)/);
  assert.match(sql,/finalization_status = 'VERIFIED_CLEAN'[\s\S]*?scan_status = 'CLEAN'/);
  assert.match(sql,/CREATE TRIGGER source_link_attachment_finalized/);
  assert.match(sql,/Attachment must be VERIFIED_CLEAN before it enters the trace graph/);
});

test('all REFS writes require idempotency and version preconditions where applicable',()=>{
  const writeOperations=[...openapi.matchAll(/^\s{4}(post|patch):\n([\s\S]*?)(?=^\s{4}(?:get|post|patch|put|delete):|^\s{2}\/v1\/|^components:)/gm)];
  assert.ok(writeOperations.length>=4);
  for(const [,method,block] of writeOperations){
    assert.match(block,/IdempotencyKey/,`${method} operation lacks Idempotency-Key`);
    if(block.includes('actions/')||method==='patch')assert.match(block,/IfMatch/,`${method} state mutation lacks If-Match`);
  }
  assert.match(openapi,/name: Idempotency-Key/);
  assert.match(openapi,/name: If-Match/);
  assert.match(openapi,/ETag:/);
});

test('source responses expose the five-part canonical key and display numbers are not trace keys',()=>{
  for(const field of ['source_system','source_module','source_entity_id','source_record_id','source_version'])assert.match(openapi,new RegExp(`${field}: \\{ type: string \\}`));
  assert.match(openapi,/document_no: \{ type: \[string, 'null'\], description: Display-only; never a trace key\. \}/);
  assert.match(openapi,/immutable_id:/);
});

test('negative fixtures cover required ingestion failures with fail-closed outcomes',()=>{
  const expectedScenarios=new Set(['duplicate_raw_replay','out_of_order_tombstone','ambiguous_mapping','matchinfo_missing_fields','report_as_source_reject','attachment_hash_mismatch']);
  assert.equal(fixtures.length,expectedScenarios.size);
  for(const {name,data} of fixtures){
    assert.ok(expectedScenarios.delete(data.scenario),`unexpected or duplicate scenario in ${name}`);
    assert.equal(data.expected?.no_draft,true,`${name} must fail closed before Draft`);
    assert.match(data.expected?.code||'',/^[A-Z][A-Z0-9_]+$/);
    assert.ok((data.expected?.invariant||'').length>20);
  }
  assert.equal(expectedScenarios.size,0);
});

test('duplicate replay fixture uses an identical five-part key',()=>{
  const replay=fixtures.find(x=>x.data.scenario==='duplicate_raw_replay').data;
  const key=e=>[e.source_system,e.source_module,e.source_entity_id,e.source_record_id,e.source_version].join('|');
  assert.equal(key(replay.events[0]),key(replay.events[1]));
  assert.equal(replay.events[0].payload_hash,replay.events[1].payload_hash);
});

test('specialized fixtures retain evidence needed for deterministic quarantine',()=>{
  const ambiguous=fixtures.find(x=>x.data.scenario==='ambiguous_mapping').data;
  assert.equal(new Set(ambiguous.mapping_candidates.map(x=>x.priority)).size,1);
  assert.equal(new Set(ambiguous.mapping_candidates.map(x=>x.account_code)).size,2);
  const match=fixtures.find(x=>x.data.scenario==='matchinfo_missing_fields').data;
  for(const field of ['entity_id','bank_account_ref','amount','currency','match_status'])assert.ok(match.missing_required_fields.includes(field));
  const report=fixtures.find(x=>x.data.scenario==='report_as_source_reject').data;
  assert.equal(report.source.source_module,'accountLink');
  const attachment=fixtures.find(x=>x.data.scenario==='attachment_hash_mismatch').data;
  assert.notEqual(attachment.attachment.declared_hash,attachment.attachment.stored_hash);
});

test('contract states its non-production boundary',()=>{
  assert.match(openapi,/version: 0\.1\.0-contract/);
  assert.match(openapi,/x-contract-status: executable-specification/);
  assert.match(openapi,/Contract-only API/);
});
