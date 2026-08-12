import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const up=readFileSync(new URL('../db/migrations/096_wbs_payable_ap_draft.sql',import.meta.url),'utf8');
const down=readFileSync(new URL('../db/migrations/down/096_wbs_payable_ap_draft.sql',import.meta.url),'utf8');

test('reviewed WBS Payable Draft command is maker-controlled and immutable-evidence bound',()=>{
  assert.match(up,/refs_assert_scope\(p_tenant,p_entity,'AP\.BILL\.CREATE'\)/);
  assert.match(up,/actor=evidence\.reviewed_by/);
  assert.match(up,/p_expected_revision<>0/);
  assert.match(up,/evidence\.evidence_hash<>p_expected_evidence_hash/);
  assert.match(up,/evidence\.mapping_snapshot_id<>p_mapping/);
  assert.match(up,/requested_attachments IS DISTINCT FROM frozen_attachments/);
  assert.match(up,/SOURCE_ATTACHMENT/);assert.match(up,/VERIFIED_CLEAN/);assert.match(up,/scan_status='CLEAN'/);
  assert.match(up,/wbs_payable_draft_evidence_append_only/);
  assert.match(up,/CREATE_WBS_PAYABLE_AP_DRAFT:/);assert.match(up,/INSERT INTO idempotency_receipt/);assert.match(up,/FOR UPDATE/);
});

test('reviewed WBS Payable Draft atomically creates only source-linked Draft accounting state',()=>{
  assert.match(up,/VALUES\(journal_id[^;]+'AUTO','DRAFT'/s);
  assert.match(up,/journal_number:='WBS-AP-'\|\|replace\(p_review::text,'-',''\)/);
  assert.match(up,/VALUES\(business_id[^;]+'AP_BILL'[^;]+'DRAFT'/s);
  assert.match(up,/SOURCE_TO_JE/);assert.match(up,/JE_ATTACHMENT/);
  assert.match(up,/SET status='DRAFT_CREATED',version=version\+1/);
  assert.match(up,/can_submit',false/);assert.match(up,/can_review',false/);assert.match(up,/can_approve',false/);assert.match(up,/can_post',false/);
  assert.doesNotMatch(up,/INSERT INTO ledger_line/i);assert.doesNotMatch(up,/INSERT INTO posting_batch/i);assert.doesNotMatch(up,/refs_post_journal\(/i);assert.doesNotMatch(up,/refs_transition_journal\(/i);
  assert.match(down,/Cannot remove WBS Payable AP Draft lineage while Draft evidence exists/);
});
