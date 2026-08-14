import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const here=dirname(fileURLToPath(import.meta.url));
const up=await readFile(resolve(here,'../db/migrations/118_ai_wbs_payable_draft_proposal.sql'),'utf8');
const down=await readFile(resolve(here,'../db/migrations/down/118_ai_wbs_payable_draft_proposal.sql'),'utf8');
const repository=await readFile(resolve(here,'../runtime/kernel-repository.mjs'),'utf8');

test('AI payable proposal is immutable, mapping-bound, and cannot exercise accounting authority',()=>{
  assert.match(up,/CREATE TABLE ai_wbs_payable_draft_proposal/);
  assert.match(up,/CREATE TABLE ai_wbs_payable_draft_proposal_review/);
  assert.match(up,/proposal_lines jsonb NOT NULL CHECK\(jsonb_typeof\(proposal_lines\)='array'/);
  assert.match(up,/CREATE TRIGGER ai_wbs_payable_draft_proposal_append_only BEFORE UPDATE OR DELETE/);
  assert.match(up,/CREATE TRIGGER ai_wbs_payable_draft_proposal_review_append_only BEFORE UPDATE OR DELETE/);
  assert.match(up,/PERFORM refs_assert_scope\(p_tenant,p_entity,'AI\.PROPOSAL\.CREATE'\)/);
  assert.match(up,/source\.status<>'READY_FOR_DRAFT' OR staging\.status<>'READY_FOR_DRAFT'/);
  assert.match(up,/evaluation\.mapping_snapshot_id<>evidence\.mapping_snapshot_id/);
  assert.match(up,/can_create_draft',false,'can_submit',false,'can_review',false,'can_approve',false,'can_post',false/);
  assert.doesNotMatch(up,/INSERT INTO journal_entry/);
  assert.doesNotMatch(up,/UPDATE staging_item SET/);
  assert.doesNotMatch(up,/refs_create_wbs_payable_ap_draft\(/);
});

test('only a distinct AP maker can accept or reject a proposal, with idempotency and audit evidence',()=>{
  assert.match(up,/PERFORM refs_assert_scope\(p_tenant,p_entity,'AP\.BILL\.CREATE'\)/);
  assert.match(up,/actor=evidence\.reviewed_by/);
  assert.match(up,/decision IN \('ACCEPTED','REJECTED'\)/);
  assert.match(up,/REVIEW_AI_WBS_PAYABLE_DRAFT_PROPOSAL/);
  assert.match(up,/AI_WBS_PAYABLE_DRAFT_PROPOSAL_REVIEWED/);
  assert.match(up,/INSERT INTO audit_event/);
  assert.match(up,/INSERT INTO outbox_event/);
});

test('repository keeps proposal and human decision separate from the standard Draft command',()=>{
  assert.match(repository,/async proposeAiWbsPayableDraft/);
  assert.match(repository,/async reviewAiWbsPayableDraftProposal/);
  assert.match(repository,/refs_propose_ai_wbs_payable_draft/);
  assert.match(repository,/refs_review_ai_wbs_payable_draft_proposal/);
  const proposalSlice=repository.slice(repository.indexOf('async proposeAiWbsPayableDraft'),repository.indexOf('async reviewAiWbsPayableDraftProposal'));
  assert.doesNotMatch(proposalSlice,/createWbsPayableApDraft/);
});

test('down migration refuses to erase any persisted AI recommendation or human decision',()=>{
  assert.match(down,/Cannot remove persisted AI WBS payable proposal evidence/);
  assert.match(down,/IF EXISTS\(SELECT 1 FROM ai_wbs_payable_draft_proposal\)/);
});
