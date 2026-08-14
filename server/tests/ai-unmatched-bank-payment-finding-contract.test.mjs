import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const here=resolve(fileURLToPath(new URL('.',import.meta.url)));
const up=await readFile(resolve(here,'../db/migrations/124_ai_unmatched_bank_payment_findings.sql'),'utf8');
const down=await readFile(resolve(here,'../db/migrations/down/124_ai_unmatched_bank_payment_findings.sql'),'utf8');

test('unmatched bank-payment findings retain only negative bank evidence without bank or accounting mutation',()=>{
  assert.match(up,/CREATE TABLE ai_unmatched_bank_payment_finding/);assert.match(up,/IF bank_row\.amount>=0 OR EXISTS\(SELECT 1 FROM bank_match/);
  assert.match(up,/AI_UNMATCHED_BANK_PAYMENT_FINDING_MATERIALIZED/);assert.match(up,/INSERT INTO outbox_event/);
  for(const field of ['can_create_draft','can_review','can_approve','can_post'])assert.match(up,new RegExp(`'${field}',false`));
  assert.doesNotMatch(up,/UPDATE bank_source/i);assert.doesNotMatch(up,/UPDATE bank_match/i);assert.doesNotMatch(up,/INSERT INTO journal_entry/i);
});

test('unmatched bank evidence is immutable, current-match aware, scoped, bounded, and retained on rollback',()=>{
  assert.match(up,/CREATE TRIGGER ai_unmatched_bank_payment_finding_append_only BEFORE UPDATE OR DELETE/);assert.match(up,/MATCHED_AFTER_FINDING/);
  assert.match(up,/refs_read_ai_unmatched_bank_payment_findings/);assert.match(up,/p_limit<1 OR p_limit>100/);assert.match(up,/refs_assert_scope\(p_tenant,p_entity,'AI\.AMORTIZATION\.PROPOSE'\)/);
  assert.match(down,/Cannot remove retained AI unmatched bank payment findings/);
});
