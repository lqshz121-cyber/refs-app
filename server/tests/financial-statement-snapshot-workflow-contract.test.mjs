import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {MIGRATION_MANIFEST} from '../runtime/migration-manifest.mjs';

const up=await readFile(new URL('../db/migrations/288_financial_statement_snapshot_workflow.sql',import.meta.url),'utf8');
const down=await readFile(new URL('../db/migrations/down/288_financial_statement_snapshot_workflow.sql',import.meta.url),'utf8');

test('migration 288 adds canonically validated recoverable proposal queue and detail readers',()=>{
  for(const token of ['refs_read_financial_statement_snapshot_proposal_queue','refs_read_financial_statement_snapshot_proposal','refs_assert_financial_statement_snapshot_proposal','FINANCIAL_STATEMENT_SNAPSHOT_PROPOSAL_QUEUE_V1','FINANCIAL_STATEMENT_SNAPSHOT_PROPOSAL_V1','population_complete','row_hash<>refs_jsonb_hash'])assert.match(up,new RegExp(token));
  assert.match(up,/prepared_by<>refs_current_actor\(\).*GL\.REPORT\.SNAPSHOT\.APPROVE/s);
  assert.match(up,/p_limit NOT BETWEEN 1 AND 100/);
  assert.ok(MIGRATION_MANIFEST.some(item=>item.name==='288_financial_statement_snapshot_workflow.sql'));
});

test('prepare and approve atomically retain exact audit and outbox evidence without ledger mutation',()=>{
  for(const event of ['FINANCIAL_STATEMENT_SNAPSHOT_PROPOSED','FINANCIAL_STATEMENT_SNAPSHOT_APPROVED']){
    assert.match(up,new RegExp(`audit_event[^;]+${event}`,'s'));
    assert.match(up,new RegExp(`outbox_event[^;]+${event}`,'s'));
  }
  assert.match(up,/preparer cannot approve their own proposal/i);
  assert.match(up,/refs_assert_financial_statement_snapshot_proposal\(p_tenant,p_entity,p_proposal\)/);
  assert.match(up,/actor_type,permission_used,request_id,correlation_id,idempotency_key/);
  assert.match(up,/'USER','GL\.REPORT\.SNAPSHOT\.PREPARE'/);
  assert.match(up,/'USER','GL\.REPORT\.SNAPSHOT\.APPROVE'/);
  for(const forbidden of [/INSERT\s+INTO\s+journal_entry/i,/INSERT\s+INTO\s+journal_line/i,/INSERT\s+INTO\s+ledger_line/i,/UPDATE\s+journal_entry/i,/UPDATE\s+ledger_line/i])assert.doesNotMatch(up,forbidden);
});

test('rollback restores historical commands and refuses to erase retained workflow evidence',()=>{
  assert.match(down,/Cannot roll back retained financial statement snapshot workflow evidence/);
  assert.match(down,/financial_statement_snapshot_workflow_function_backup/);
  assert.match(down,/DROP FUNCTION refs_read_financial_statement_snapshot_proposal_queue/);
  assert.match(down,/DROP FUNCTION refs_read_financial_statement_snapshot_proposal/);
});
