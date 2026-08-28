import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const read=path=>readFile(new URL(path,import.meta.url),'utf8');
test('migration 281 retains a scoped append-only decision queue without workflow escalation',async()=>{
  const [up,down,repository,roles]=await Promise.all([read('../db/migrations/281_ai_accounting_decision_queue_read.sql'),read('../db/migrations/down/281_ai_accounting_decision_queue_read.sql'),read('../runtime/kernel-repository.mjs'),read('../runtime/workflow-role-grant.mjs')]);
  for(const token of ['refs_assert_scope(p_tenant,p_entity,\'GL.JE.VIEW\')','decision_hash<>refs_jsonb_hash(d.packet)','population_complete','can_accept_or_reject','can_create_draft',"'can_submit',false","'can_review',false","'can_approve',false","'can_post',false",'REVOKE ALL ON FUNCTION refs_read_ai_accounting_decision_queue'])assert.match(up,new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
  assert.doesNotMatch(up,/INSERT INTO journal_entry|UPDATE journal_entry|refs_submit|refs_review|refs_approve|refs_post/);
  assert.match(down,/DROP FUNCTION(?: IF EXISTS)? refs_read_ai_accounting_decision_queue/);
  assert.match(repository,/readAiAccountingDecisionQueue/);
  assert.match(roles,/AI_ACCOUNTING_DECISION_MAKER:role\('DRAFT',\[\.\.\.READ,'GL\.JE\.CREATE'\]\)/);
});
