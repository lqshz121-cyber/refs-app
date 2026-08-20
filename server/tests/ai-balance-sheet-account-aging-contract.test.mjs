import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
const read=path=>readFile(new URL(path,import.meta.url),'utf8');
test('balance-sheet aging source is Posted-ledger, period, lineage, and policy bound',async()=>{const up=await read('../db/migrations/238_ai_balance_sheet_account_aging_review.sql');for(const token of ['refs_assert_ai_analysis_scope','AI_BALANCE_SHEET_AGING_POLICY','AI_BALANCE_SHEET_DORMANT_NONZERO_BALANCE_V1',"j.status='POSTED'",'j.journal_date<=p.ends_on',"l.account_code~'^[123]'",'source_document_ids','REVOKE ALL','GRANT EXECUTE'])assert.ok(up.includes(token),`missing ${token}`);assert.doesNotMatch(up,/INSERT\s+INTO\s+journal_entry|UPDATE\s+journal_entry|INSERT\s+INTO\s+ledger_line/i);});
test('rollback removes only the two balance-sheet aging readers',async()=>{const down=await read('../db/migrations/down/238_ai_balance_sheet_account_aging_review.sql');assert.match(down,/DROP FUNCTION refs_read_ai_balance_sheet_account_aging_source/);assert.match(down,/DROP FUNCTION refs_read_ai_balance_sheet_aging_policy/);assert.doesNotMatch(down,/DROP TABLE|DELETE FROM|TRUNCATE/i);});
