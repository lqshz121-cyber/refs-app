import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {MIGRATION_MANIFEST} from '../runtime/migration-manifest.mjs';

const name='383_high_volume_read_indexes.sql';
const read=direction=>readFile(new URL(`../db/migrations/${direction==='down'?'down/':''}${name}`,import.meta.url),'utf8');
const migration=name=>readFile(new URL(`../db/migrations/${name}`,import.meta.url),'utf8');
const digest=value=>createHash('sha256').update(value.replace(/\r\n/g,'\n')).digest('hex');

test('383 indexes each bounded high-volume read by its scoped ordering tuple',async()=>{
 const [up,down]=await Promise.all([read('up'),read('down')]);
 assert.match(up,/bank_source\(tenant_id,entity_id,bank_account_ref,transaction_date DESC,external_bank_line_id DESC,bank_source_id DESC\)/);
 assert.match(up,/bank_match\(tenant_id,entity_id,bank_source_id,matched_at DESC,bank_match_id DESC\)/);
 assert.match(up,/ledger_line\(tenant_id,entity_id,journal_entry_id,posted_at,ledger_line_id\)/);
 assert.match(up,/financial_statement_snapshot_proposal\(tenant_id,entity_id,period_id,prepared_at DESC,financial_statement_snapshot_proposal_id DESC\)/);
 assert.match(up,/wbs_h1_payable_mapping_source_stage\(tenant_id,entity_id,company_code,period_code,accounting_date,source_record_hash\)/);
 for(const index of ['bank_source_read_scope_keyset_idx','bank_match_reader_latest_idx','ledger_line_gl_snapshot_join_idx','financial_statement_snapshot_proposal_queue_idx','wbs_h1_payable_mapping_source_stage_page_idx'])assert.match(down,new RegExp(`DROP INDEX ${index}`));
});

test('high-volume readers retain bounded pages and deterministic cursor or snapshot semantics',async()=>{
 const [gl,bank,cash,wbs,reports]=await Promise.all([
  migration('300_authoritative_paged_read_snapshots.sql'),migration('109_bank_transaction_offset_pagination.sql'),
  migration('376_cash_transfer_read_surfaces.sql'),migration('268_wbs_h1_payable_accounting_proposal_read.sql'),
  migration('288_financial_statement_snapshot_workflow.sql')
 ]);
 assert.match(gl,/p_limit NOT BETWEEN 1 AND 200 OR p_offset<0/);assert.match(gl,/LIMIT 100001/);assert.match(gl,/snapshot exceeds the safe population bound/);
 assert.match(bank,/p_limit<1 OR p_limit>200/);assert.match(bank,/p_offset<0 OR p_offset>10000/);assert.match(bank,/ORDER BY b\.transaction_date DESC,b\.external_bank_line_id DESC,b\.bank_source_id DESC LIMIT p_limit OFFSET p_offset/);
 assert.match(cash,/p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100/);assert.match(cash,/\(t\.transfer_date,t\.cash_transfer_id\)<\(p_after_date,p_after_transfer\)/);assert.match(cash,/LIMIT p_limit\+1/);
 assert.match(wbs,/p_limit NOT BETWEEN 1 AND 200 OR p_offset<0/);assert.match(wbs,/ORDER BY accounting_date,source_record_hash LIMIT p_limit OFFSET p_offset/);
 assert.match(reports,/p_limit NOT BETWEEN 1 AND 100 OR p_offset<0/);assert.match(reports,/ORDER BY p\.prepared_at DESC,p\.financial_statement_snapshot_proposal_id DESC/);
});

test('383 files match normalized manifest hashes',async()=>{
 const entry=MIGRATION_MANIFEST.find(row=>row.name===name);assert.ok(entry);
 for(const direction of ['up','down'])assert.equal(digest(await read(direction)),entry[direction]);
});
