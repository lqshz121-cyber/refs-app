import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';
const foundation=await readFile(new URL('../db/migrations/136_wbs_autorec_accounting_event.sql',import.meta.url),'utf8');
const draft=await readFile(new URL('../db/migrations/137_wbs_autorec_g11_draft.sql',import.meta.url),'utf8');
const incurred=await readFile(new URL('../db/migrations/138_wbs_autorec_g11_incurred.sql',import.meta.url),'utf8');
const repo=await readFile(new URL('../runtime/kernel-repository.mjs',import.meta.url),'utf8');

test('AutoRec accounting events and journal bindings are immutable exact-scope foundations',()=>{
  for(const pattern of [/CREATE TABLE accounting_event/i,/event_type IN \('PAYABLE_INCUR','AUTOC'\)/i,/source_document_id uuid NOT NULL, staging_item_id uuid NOT NULL/i,/bank_account_ref=btrim\(bank_account_ref\).*length\(bank_account_ref\) BETWEEN 1 AND 128/is,/clearing_member_ref=btrim\(clearing_member_ref\).*length\(clearing_member_ref\) BETWEEN 1 AND 160/is,/UNIQUE\(tenant_id,entity_id,wbs_autorec_match_review_id,event_type\)/i,/CREATE TABLE journal_accounting_event/i,/UNIQUE\(tenant_id,entity_id,journal_entry_id\)/i,/accounting_event_append_only/i,/journal_accounting_event_append_only/i,/ENABLE ROW LEVEL SECURITY/i])assert.match(foundation,pattern);
});
test('dedicated producers derive fixed G11 drafts without caller accounting fields and finalization binds canonical raw evidence',()=>{
  assert.match(foundation,/refs_create_wbs_autorec_payable_incur_draft/);assert.match(foundation,/refs_create_wbs_autorec_autoc_draft/);
  assert.match(draft,/REVOKE ALL ON FUNCTION refs_create_wbs_autorec_event_draft_private[\s\S]*FROM PUBLIC/i);
  assert.match(draft,/family='WBS_AUTOREC_G11'[\s\S]*snapshot_hash=refs_jsonb_hash/i);
  const publicSignatures=[...foundation.matchAll(/CREATE (?:OR REPLACE )?FUNCTION refs_create_wbs_autorec_(?:payable_incur|autoc)_draft\(([^)]*)\)/gi)].map(match=>match[1]);assert.equal(publicSignatures.length,2);
  for(const signature of publicSignatures)for(const forbidden of ['event_type','journal','amount','account','member','lines'])assert.doesNotMatch(signature,new RegExp(forbidden,'i'));
  for(const pattern of [/mapping snapshot is missing or not canonical/i,/exact Source-to-JE lineage is incomplete/i,/line_snapshot/i,/mapping_snapshot_hash'[\s\S]*'lines',line_snapshot/i,/CREATE TABLE wbs_autorec_g11_completion_line/i,/INCUR','RELEASED','INCURRED/i])assert.match(incurred,pattern);
  assert.match(repo,/createWbsAutoRecPayableIncurDraft/);assert.match(repo,/createWbsAutoRecAutocDraft/);assert.match(repo,/WBS_AUTOREC_EVENT_DRAFT_FUNCTION_DENIED/);
});
