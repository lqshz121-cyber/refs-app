import assert from'node:assert/strict';
import test from'node:test';
import{createHash}from'node:crypto';
import{readFile}from'node:fs/promises';
import{MIGRATION_MANIFEST}from'../runtime/migration-manifest.mjs';

const up=await readFile(new URL('../db/migrations/373_intercompany_elimination_authoritative.sql',import.meta.url),'utf8');
const down=await readFile(new URL('../db/migrations/down/373_intercompany_elimination_authoritative.sql',import.meta.url),'utf8');
const spec=JSON.parse(await readFile(new URL('../api/openapi-accounting.json',import.meta.url),'utf8'));

test('373 is a checksummed forward-only authoritative elimination migration with retained-evidence down protection',()=>{
 const entry=MIGRATION_MANIFEST.at(-1);assert.equal(entry.name,'373_intercompany_elimination_authoritative.sql');
 assert.equal(entry.up,createHash('sha256').update(up).digest('hex'));assert.equal(entry.down,createHash('sha256').update(down).digest('hex'));
 assert.match(down,/Refusing to remove retained intercompany elimination evidence/i);
 assert.match(down,/elimination_ref LIKE 'INTERCOMPANY_ELIMINATION_BATCH:%'/i);
});

test('373 keeps member ledgers authoritative and derives only a normal-sign matched consolidation elimination',()=>{
 assert.doesNotMatch(up,/CREATE (?:OR REPLACE )?FUNCTION refs_get_intercompany_reconciliation/i);
 assert.doesNotMatch(up,/INSERT INTO (?:journal_entry|journal_line|posting_batch|ledger_line)/i);
 assert.match(up,/matched:=LEAST\(abs\(rec[.]current_closing_balance\),abs\(rec[.]counterparty_closing_balance\)\)/i);
 assert.match(up,/source_classification='DUE_FROM'[\s\S]+source_closing_balance>0[\s\S]+counterparty_classification='DUE_TO'[\s\S]+counterparty_closing_balance<0/i);
 assert.match(up,/source_classification='DUE_TO'[\s\S]+source_closing_balance<0[\s\S]+counterparty_classification='DUE_FROM'[\s\S]+counterparty_closing_balance>0/i);
 assert.match(up,/raw_mismatch=source_closing_balance\+counterparty_closing_balance/i);
 assert.match(up,/source_normal_sign'[\s\S]+'DEBIT_POSITIVE'[\s\S]+'CREDIT_NEGATIVE'/i);
 assert.match(up,/presentation_side<>'DEBIT'[\s\S]+presentation_side<>'CREDIT'/i);
 assert.match(up,/report_period[.]ledger_code<>'PRIMARY' OR src_period[.]ledger_code<>'PRIMARY' OR cp_period[.]ledger_code<>'PRIMARY'/i);
 assert.match(up,/reporting_period_version'[\s\S]+source_period_version'[\s\S]+counterparty_period_version'/i);
});

test('373 owns one balanced two-line projection and prevents duplicate or partial authoritative evidence',()=>{
 assert.match(up,/CREATE TABLE intercompany_elimination_line/i);
 assert.match(up,/line_no smallint NOT NULL CHECK\(line_no IN\(1,2\)\)/i);
 assert.match(up,/entry_side='DEBIT'[\s\S]+debit_amount>0[\s\S]+credit_amount=0/i);
 assert.match(up,/entry_side='CREDIT'[\s\S]+credit_amount>0[\s\S]+debit_amount=0/i);
 assert.match(up,/balance[.]line_count<>2 OR balance[.]debits<>balance[.]credits OR balance[.]debits<>b[.]matched_amount/i);
 assert.match(up,/CREATE UNIQUE INDEX intercompany_elimination_one_active_source_uq[\s\S]+canonical_source_scope_hash[\s\S]+WHERE status<>'CANCELLED'/i);
 assert.match(up,/pg_advisory_xact_lock\(hashtextextended\(.*canonical_source_scope_hash/i);
 assert.match(up,/INTERCOMPANY_ELIMINATION_BATCH:'\|\|p_batch::text\|\|':LINE:'/i);
 assert.match(up,/Authoritative intercompany elimination evidence requires one approved batch Post/i);
});

test('373 locks periods in deterministic order and revalidates the complete source before atomic projection',()=>{
 assert.match(up,/ORDER BY p[.]entity_id,p[.]period_id FOR UPDATE/g);
 assert.equal((up.match(/LOCK TABLE mapping_snapshot,consolidation_snapshot,consolidation_member,consolidation_account_map IN SHARE MODE/g)||[]).length,3);
 assert.equal((up.match(/pg_advisory_xact_lock\(hashtextextended\('INTERCOMPANY_ELIMINATION_SNAPSHOT:'/g)||[]).length,3,'create, transition, and Post serialize the whole snapshot before absence/source checks');
 assert.doesNotMatch(up,/LOCK TABLE[^;]*consolidation_elimination_evidence IN SHARE MODE/i,'Post must not upgrade SHARE to RowExclusive on elimination evidence');
 assert.match(up,/source evidence changed before Post/i);
 assert.match(up,/source evidence changed before workflow transition/i);
 assert.match(up,/source_journal_entry_ids'[\s\S]+source_journal_line_ids'[\s\S]+source_ledger_line_ids'[\s\S]+source_document_ids'/i);
 assert.match(up,/counterparty_journal_entry_ids'[\s\S]+counterparty_journal_line_ids'[\s\S]+counterparty_ledger_line_ids'[\s\S]+counterparty_source_document_ids'/i);
 assert.match(up,/period_cutoff'[\s\S]+consolidation_version'[\s\S]+consolidation_snapshot_hash'[\s\S]+consolidation_receipt_hash'/i);
 assert.match(up,/consolidation_member_population_hash'[\s\S]+consolidation_account_map_population_hash'/i);
 assert.match(up,/ALTER FUNCTION refs_get_consolidation\(uuid,uuid,uuid,text\) RENAME TO refs_get_consolidation_082/i);
 assert.match(up,/BLOCKED_STALE_INTERCOMPANY_ELIMINATION_SOURCE/i);
 assert.match(up,/x[.]report_status='APPROVED_CONSOLIDATION_SNAPSHOT_AND_POSTED_LEDGER_EXACT' AND EXISTS/i);
 assert.match(up,/rec[.]ledger_line_ids IS DISTINCT FROM b[.]source_ledger_line_ids/i);
 assert.match(up,/rec[.]counterparty_ledger_line_ids IS DISTINCT FROM b[.]counterparty_ledger_line_ids/i);
 assert.match(up,/NEW_CONSOLIDATION_SNAPSHOT_REQUIRED/i);
 assert.match(down,/ALTER FUNCTION refs_get_consolidation_082\(uuid,uuid,uuid,text\) RENAME TO refs_get_consolidation/i);
});

test('373 closes permissions, lifecycle SoD, idempotency, audit and outbox',()=>{
 const cancelBody=up.slice(up.indexOf('CREATE FUNCTION refs_cancel_intercompany_elimination'),up.indexOf('CREATE FUNCTION refs_post_intercompany_elimination'));
 for(const action of['VIEW','CREATE','SUBMIT','REVIEW','APPROVE','CANCEL','POST'])assert.match(up,new RegExp(`GROUP[.]INTERCOMPANY_ELIMINATION[.]${action}`));
 for(const authority of['READ','DRAFT','SUBMIT','REVIEW','APPROVE','POST'])assert.match(up,new RegExp(`'${authority}'`));
 assert.match(up,/actor IS DISTINCT FROM b[.]created_by[\s\S]+actor IS DISTINCT FROM b[.]reviewed_by[\s\S]+actor IS DISTINCT FROM b[.]approved_by/i);
 assert.match(up,/status='PENDING_REVIEW' AND submitted_by IS NOT NULL AND reviewed_by IS NULL AND approved_by IS NULL/i);
 assert.match(up,/status='REVIEWED' AND submitted_by IS NOT NULL AND reviewed_by IS NOT NULL AND approved_by IS NULL/i);
 assert.match(up,/status IN\('APPROVED','POSTED'\) AND submitted_by IS NOT NULL AND reviewed_by IS NOT NULL AND approved_by IS NOT NULL/i);
 assert.match(up,/posted_by<>created_by AND posted_by<>reviewed_by AND posted_by<>approved_by/i);
 assert.match(up,/idempotency_receipt/i);assert.match(up,/INSERT INTO audit_event/i);assert.match(up,/INSERT INTO outbox_event/i);
 assert.match(up,/status IN\('DRAFT','PENDING_REVIEW','REVIEWED','APPROVED','POSTED','CANCELLED'\)/i);
 assert.equal((up.match(/p_expected_revision IS NULL OR p_expected_revision<0/g)||[]).length,3,'transition, cancel, and Post must reject null revisions before CAS');
 assert.match(up,/'can_submit',b[.]status='DRAFT' AND source_current/i);assert.match(up,/'can_review',b[.]status='PENDING_REVIEW' AND source_current/i);assert.match(up,/'can_approve',b[.]status='REVIEWED' AND source_current/i);
 assert.match(up,/action IS NULL OR action NOT IN\('SUBMIT','REVIEW','APPROVE'\)/i);
 assert.match(up,/CREATE FUNCTION refs_intercompany_elimination_batch_payload/i);assert.match(up,/refs_intercompany_elimination_batch_payload\(uuid,uuid,uuid\)[\s\S]+FROM PUBLIC,refs_app/i);
 assert.doesNotMatch(up,/GRANT EXECUTE ON FUNCTION(?:(?!TO refs_app)[\s\S])*refs_intercompany_elimination_batch_payload/i,'the internal payload builder must never be callable by refs_app');
 assert.equal((up.match(/result:=refs_intercompany_elimination_batch_payload/g)||[]).length,4,'all commands must build their receipt without requiring batch VIEW');
 assert.match(up,/CREATE FUNCTION refs_read_intercompany_elimination_batch[\s\S]+GROUP[.]INTERCOMPANY_ELIMINATION[.]VIEW[\s\S]+b[.]source_entity_id,'GL[.]REPORT[.]VIEW'[\s\S]+b[.]counterparty_entity_id,'GL[.]REPORT[.]VIEW'/i);
 assert.match(cancelBody,/SELECT \* INTO b FROM intercompany_elimination_batch[\s\S]+b[.]source_entity_id,'GL[.]REPORT[.]VIEW'[\s\S]+b[.]counterparty_entity_id,'GL[.]REPORT[.]VIEW'/i);
 assert.ok(cancelBody.indexOf("b.counterparty_entity_id,'GL.REPORT.VIEW'")<cancelBody.indexOf("idem.status='SUCCEEDED'"),'Cancel replay and mutation must both retain the two member read scopes');
});

test('intercompany elimination HTTP surface is closed in OpenAPI',()=>{
 const root='/entities/{entityId}/intercompany-eliminations';
 assert.equal(spec.paths[root].get.operationId,'readIntercompanyEliminationRegister');assert.equal(spec.paths[root].post.operationId,'createIntercompanyElimination');
 assert.equal(spec.paths[`${root}/create-options`].get.operationId,'readIntercompanyEliminationCreateOptions');assert.equal(spec.paths[`${root}/{batchId}`].get.operationId,'readIntercompanyEliminationBatch');
 for(const [suffix,id] of [['transitions','transitionIntercompanyElimination'],['cancel','cancelIntercompanyElimination'],['post','postIntercompanyElimination']])assert.equal(spec.paths[`${root}/{batchId}/${suffix}`].post.operationId,id);
 for(const name of ['IntercompanyEliminationSource','IntercompanyEliminationCreateOptions','IntercompanyEliminationBatch','IntercompanyEliminationCommandBatch','IntercompanyEliminationRegister']){const schema=spec.components.schemas[name];assert.equal(schema.type,'object');assert.equal(schema.additionalProperties,false);assert.ok(schema.required.length>5);assert.deepEqual([...schema.required].sort(),Object.keys(schema.properties).sort());}
 assert.deepEqual(spec.components.schemas.IntercompanyEliminationCreateOptions.required,['schema_version','reporting_entity_id','reporting_period_id','group_ref','source_entity_id','source_period_id','counterparty_entity_id','counterparty_period_id','consolidation_snapshot_id','currency','options','action_flags']);
});
