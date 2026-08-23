import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

test('270 separates the controlled placeholder vendor from the real WBS vendor and requires four lines',async()=>{
  const up=await readFile(new URL('../db/migrations/270_wbs_h1_payable_reclass_vendor_identity.sql',import.meta.url),'utf8');
  const down=await readFile(new URL('../db/migrations/down/270_wbs_h1_payable_reclass_vendor_identity.sql',import.meta.url),'utf8');
  for(const token of [
    "l.party_ref=''WBS_TEST_VENDOR''",
    "member_ref=''WBS_TEST_VENDOR''",
    "credit_member IS DISTINCT FROM source_row.vendor_no",
    "member_type=''VENDOR'' AND active",
    "required_member_type=''VENDOR''",
    'jsonb_array_length(draft_lines)<>4',
    'baseline_vendor_member_ref',
    'target_vendor_member_ref',
    'WBS_TEST_IMPORT_LINE_V1',
    'UNSIGNED_TEST_ONLY',
    'Refusing to discard retained WBS H1 Payable vendor reclassification identity evidence'
  ]) assert.match(up+'\n'+down,new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
  for(const forbidden of ['refs_transition_journal','refs_post_journal','INSERT INTO ledger_line'])assert.doesNotMatch(up,new RegExp(forbidden));
});
