import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {MIGRATION_MANIFEST} from '../runtime/migration-manifest.mjs';

const up=await readFile(new URL('../db/migrations/287_ai_admitted_source_review_lifecycle.sql',import.meta.url),'utf8');
const down=await readFile(new URL('../db/migrations/down/287_ai_admitted_source_review_lifecycle.sql',import.meta.url),'utf8');

test('migration 287 retains admitted-source review evidence and projects only current findings',()=>{
  for(const token of ['CREATE TABLE ai_admitted_source_review_finding','CREATE TABLE ai_admitted_source_review_lifecycle','CREATE VIEW ai_admitted_source_review_current_finding','refs_jsonb_hash(finding)',"'ADMITTED_SOURCE_UNBOOKED'","'BLOCKED_SOURCE_INCOMPLETE'","'SUPERSEDED_BY_NEW_EVIDENCE'",'source_payload_hash','source_line_hash','evidence_hash'])assert.match(up,new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
  assert.match(up,/finding->'action_flags'=jsonb_build_object\('can_create_draft',false,'can_review',false,'can_approve',false,'can_post',false\)/);
  assert.match(up,/finding->'suggested_journal'='null'::jsonb/);
  assert.doesNotMatch(up,/DECLARE[^$]*\bevidence_hash text\b/);
  assert.match(up,/\bv_evidence_hash text\b/);
  assert.doesNotMatch(up,/DECLARE[^$]*\bfinding_hash text\b/);
  assert.match(up,/\bv_finding_hash text\b/);
  assert.doesNotMatch(up,/ELSE finding_hash END/);
});

test('retention is event-driven by authoritative source and booking evidence, never by a GET scan',()=>{
  for(const token of ['ai_admitted_source_review_after_retained','ai_admitted_source_review_after_document','ai_admitted_source_review_after_business_document','ai_admitted_source_review_after_source_link','refs_refresh_ai_admitted_source_review'])assert.match(up,new RegExp(token));
  for(const forbidden of [/INSERT\s+INTO\s+journal_entry/i,/INSERT\s+INTO\s+journal_line/i,/INSERT\s+INTO\s+ledger_line/i,/UPDATE\s+journal_entry/i,/UPDATE\s+ledger_line/i])assert.doesNotMatch(up,forbidden);
});

test('current retained findings join the human accountability queue with no accounting authority',()=>{
  assert.match(up,/ADMITTED_SOURCE_REVIEW/);
  assert.match(up,/FROM ai_admitted_source_review_current_finding/);
  assert.match(up,/NOT EXISTS\(SELECT 1 FROM ai_finding_action/);
  assert.match(up,/AI_ADMITTED_SOURCE_REVIEW_FINDING_RETAINED/);
  assert.ok(MIGRATION_MANIFEST.some(item=>item.name==='287_ai_admitted_source_review_lifecycle.sql'));
});

test('rollback restores the prior queue functions and refuses to erase retained evidence',()=>{
  assert.match(down,/Cannot roll back retained admitted-source review evidence/);
  assert.match(down,/SELECT function_definition FROM ai_admitted_source_review_function_backup/);
  assert.match(down,/DROP CONSTRAINT ai_finding_action_finding_kind_check/);
  assert.doesNotMatch(down,/ADD CONSTRAINT[^;]+ADMITTED_SOURCE_REVIEW/s);
  assert.match(down,/DROP FUNCTION refs_refresh_ai_admitted_source_review/);
});
