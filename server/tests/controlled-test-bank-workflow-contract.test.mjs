import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {WBS_TEST_IMPORT_GRANT_BUNDLES} from '../runtime/wbs-test-import-service.mjs';

test('controlled Bank runner keeps exact distinct-role permission bundles and closed TEST_ONLY OpenAPI',()=>{
  assert.deepEqual(WBS_TEST_IMPORT_GRANT_BUNDLES.importer,['WBS.TEST.IMPORT','BANK.RECONCILIATION.START','BANK.VIEW','BANK.MATCH.CREATE']);
  assert.deepEqual(WBS_TEST_IMPORT_GRANT_BUNDLES.maker,['WBS.TEST.IMPORT','AP.BILL.CREATE','BANK.RECONCILIATION.ADJUSTMENT_DRAFT','GL.JE.CREATE']);
  assert.deepEqual(WBS_TEST_IMPORT_GRANT_BUNDLES.reviewer,['GL.JE.REVIEW','BANK.RECONCILIATION.REVIEW']);
  assert.deepEqual(WBS_TEST_IMPORT_GRANT_BUNDLES.approver,['GL.JE.APPROVE','BANK.RECONCILIATION.SIGN_OFF']);
  assert.deepEqual(WBS_TEST_IMPORT_GRANT_BUNDLES.poster,['GL.JE.POST','BANK.RECONCILIATION.CLEAR','BANK.RECONCILIATION.REOPEN']);
  const api=JSON.parse(fs.readFileSync(new URL('../api/openapi-accounting.json',import.meta.url),'utf8'));
  const operation=api.paths['/entities/{entityId}/wbs/test-import/bank-workflow/run'].post;
  assert.equal(operation.operationId,'runWbsControlledTestBankWorkflow');const requests=operation.requestBody.content['application/json'].schema.oneOf;assert.equal(requests.length,2);assert.deepEqual(requests[0].required,['periodId','reconciliationId','reason']);assert.deepEqual(requests[1].required,['scopes','reason']);assert.equal(requests[1].properties.scopes.maxItems,6);
  const result=api.components.schemas.ControlledTestBankWorkflowResult;assert.equal(result.additionalProperties,false);assert.equal(result.properties.test_only.const,true);assert.equal(result.properties.provenance_mode.const,'CONTROLLED_TEST_UNSIGNED');assert.equal(result.properties.status.const,'CONTROLLED_TEST_BANK_WORKFLOW_REOPENED');
  assert.equal(api.components.schemas.ControlledTestBankRangeWorkflowResult.properties.scope_count.maximum,6);
  const up=fs.readFileSync(new URL('../db/migrations/180_controlled_test_bank_adjustment_evidence_read.sql',import.meta.url),'utf8'),down=fs.readFileSync(new URL('../db/migrations/down/180_controlled_test_bank_adjustment_evidence_read.sql',import.meta.url),'utf8');
  for(const token of ['pg_get_functiondef','adjustment.bank_delta','source.bank_source_id=adjustment.bank_source_id','BANK.RECONCILIATION.ADJUSTMENT_DRAFT','VERIFIED_CLEAN','scan_status=\'CLEAN\'','SECURITY DEFINER','REVOKE ALL'])assert.match(up,new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
  assert.match(down,/DROP FUNCTION refs_list_reconciliation_adjustment_evidence/);assert.match(down,/final_book_balance<>rec\.statement_ending_balance/);
});
