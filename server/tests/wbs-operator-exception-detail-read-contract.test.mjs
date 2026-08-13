import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

test('retained WBS exception detail is closed, scoped, and only links to separately signed evidence',async()=>{
  const up=await readFile(new URL('../db/migrations/108_wbs_operator_exception_detail_read.sql',import.meta.url),'utf8');
  const down=await readFile(new URL('../db/migrations/down/108_wbs_operator_exception_detail_read.sql',import.meta.url),'utf8');
  const repo=await readFile(new URL('../runtime/kernel-repository.mjs',import.meta.url),'utf8');
  for(const token of ["refs_assert_scope(p_tenant,p_entity,'WBS.PAYABLE.OPERATOR_ATTEST')",'wbs_operator_payable_attestation_id=p_attestation','wbs_snapshot_delivery_attestation',"imp.environment='PRODUCTION'","snapshot_receipt.source_module='BGDATA.payable'","'EXCEPTION_REVIEW_REQUIRED'::text,false,false,false,false",'ELIGIBLE_FOR_SIGNED_REVIEW','Accounting data steward','WBS provider administrator'])assert.match(up,new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
  assert.doesNotMatch(up,/INSERT INTO|UPDATE |DELETE FROM|journal_entry|ledger_line|refs_review_wbs|refs_create/);
  assert.match(down,/DROP FUNCTION refs_read_wbs_operator_payable_exception_rows/);
  assert.match(repo,/async listWbsOperatorPayableExceptionRows/);
});
