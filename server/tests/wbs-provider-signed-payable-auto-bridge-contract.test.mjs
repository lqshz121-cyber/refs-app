import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const up=await readFile(new URL('../db/migrations/114_wbs_provider_signed_payable_auto_bridge.sql',import.meta.url),'utf8');
const down=await readFile(new URL('../db/migrations/down/114_wbs_provider_signed_payable_auto_bridge.sql',import.meta.url),'utf8');

test('114 atomically records exact later-signed equivalence without promoting operator evidence',()=>{
  for(const token of ['refs_admit_wbs_provider_signed_payables_111','wbs_operator_payable_evidence_provider_hash','upstream_mcp_row_hash','upstream_mcp_content_hash','jsonb_array_length(operator_attestation.company_codes)=1','refs_wbs_operator_signed_source_link_hash','refs_link_wbs_operator_evidence_to_signed_source','linked_operator_exception_count'])assert.match(up,new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
  assert.doesNotMatch(up,/UPDATE\s+wbs_operator_payable|INSERT INTO\s+(?:journal_entry|journal_line|posting_batch|ledger_line)\b/i);
  assert.match(down,/RENAME TO refs_admit_wbs_provider_signed_payables/);
});
