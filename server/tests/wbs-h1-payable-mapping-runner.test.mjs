import test from 'node:test';
import assert from 'node:assert/strict';
import {applyWbsH1PayableMappings,resolveWbsH1PayableMapping} from '../tools/apply-wbs-h1-payable-mappings.mjs';

const row=(overrides={})=>({tenant_id:'11111111-1111-4111-8111-111111111111',entity_id:'22222222-2222-4222-8222-222222222222',period_id:'33333333-3333-4333-8333-333333333333',journal_entry_id:'44444444-4444-4444-8444-444444444444',source_document_id:'55555555-5555-4555-8555-555555555555',attachment_id:'66666666-6666-4666-8666-666666666666',source_record_hash:'sha256:'+'a'.repeat(64),company_code:'OPPO',mapping_match_count:1,mapped_account_code:'641000',mapped_account_name:'Electric expense',mapped_supplementary:'',mapped_project_codes:'',wbs_setting_id:'42',project_code:'',cost_code:'71E701',...overrides});

test('only one effective, valid and supported WBS mapping is READY',()=>{
  assert.equal(resolveWbsH1PayableMapping(row()).status,'READY');
  assert.equal(resolveWbsH1PayableMapping(row({mapping_match_count:0})).status,'MAPPING_MISSING');
  assert.equal(resolveWbsH1PayableMapping(row({mapping_match_count:2})).status,'MAPPING_AMBIGUOUS');
  assert.equal(resolveWbsH1PayableMapping(row({mapped_account_code:''})).status,'MAPPING_INVALID');
  assert.equal(resolveWbsH1PayableMapping(row({mapped_supplementary:'Company'})).status,'MAPPING_UNSUPPORTED_MEMBER');
  assert.equal(resolveWbsH1PayableMapping(row({mapped_project_codes:'P1,P2',project_code:'P3'})).status,'MAPPING_SCOPE_MISMATCH');
});

test('runner posts READY rows and reports fail-closed mapping exceptions',async()=>{
  const progress=[],prepared=[];
  const summary=await applyWbsH1PayableMappings({rows:[row(),row({source_record_hash:'sha256:'+'b'.repeat(64),mapping_match_count:0})],prepare:async decision=>{prepared.push(decision);return decision;},complete:async decision=>({status:'WBS_H1_MAPPING_POSTED',company_code:decision.row.company_code,idempotent:false}),onProgress:value=>progress.push(value)});
  assert.equal(summary.status,'WBS_H1_PAYABLE_MAPPING_PARTIAL');assert.equal(summary.posted_count,1);assert.equal(summary.exception_count,1);assert.equal(summary.exceptions.MAPPING_MISSING,1);assert.equal(prepared.length,1);assert.deepEqual(progress.map(item=>item.status),['MAPPING_MISSING','WBS_H1_MAPPING_POSTED']);
});
