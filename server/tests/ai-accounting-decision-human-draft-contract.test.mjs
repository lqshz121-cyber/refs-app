import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const up=new URL('../db/migrations/254_ai_accounting_decision_human_draft.sql',import.meta.url);
const down=new URL('../db/migrations/down/254_ai_accounting_decision_human_draft.sql',import.meta.url);

test('254 retains immutable decision, human outcome, Draft evidence, audit and outbox atomically',async()=>{
  const sql=await readFile(up,'utf8');
  for(const token of ['ai_accounting_decision','ai_accounting_human_decision','ai_accounting_decision_draft_evidence','refs_retain_ai_accounting_decision','refs_human_decide_ai_accounting','refs_create_ai_accounting_decision_draft','AI_ACCOUNTING_ENGINE','AI.ANALYSIS.EXPLAIN','GL.JE.CREATE','refs_create_manual_journal','idempotency_receipt','FOR SHARE','audit_event','outbox_event','reject_mutation','READY_FOR_HUMAN_REVIEW','ACCEPTED','REJECTED'])assert.match(sql,new RegExp(token.replaceAll('.','\\.')));
  assert.doesNotMatch(sql,/refs_transition_journal|refs_post_journal|GL\.JE\.(SUBMIT|REVIEW|APPROVE|POST)/);
  assert.match(sql,/Only a ready decision may be accepted/);
  assert.match(sql,/AI producer cannot create an accounting Draft/);
});

test('254 down refuses deletion when retained decisions exist',async()=>{
  const sql=await readFile(down,'utf8');
  assert.match(sql,/Cannot remove retained AI accounting decisions/);
  assert.match(sql,/DROP FUNCTION IF EXISTS refs_create_ai_accounting_decision_draft/);
});
