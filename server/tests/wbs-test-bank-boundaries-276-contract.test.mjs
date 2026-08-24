import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {WBS_TEST_IMPORT_GRANT_BUNDLES} from '../runtime/wbs-test-import-service.mjs';

const read=path=>fs.readFileSync(new URL(path,import.meta.url),'utf8');

test('276 makes import receipt, reconciliation start, Post, Clear, and Reopen distinct boundaries',()=>{
  assert.deepEqual(WBS_TEST_IMPORT_GRANT_BUNDLES.importer,['WBS.TEST.IMPORT']);
  assert.deepEqual(WBS_TEST_IMPORT_GRANT_BUNDLES.reconciliationStarter,['BANK.RECONCILIATION.START']);
  assert.deepEqual(WBS_TEST_IMPORT_GRANT_BUNDLES.paymentMaker,['AP.PAYMENT.CREATE']);
  assert.deepEqual(WBS_TEST_IMPORT_GRANT_BUNDLES.poster,['GL.JE.POST']);
  assert.deepEqual(WBS_TEST_IMPORT_GRANT_BUNDLES.clearer,['BANK.RECONCILIATION.CLEAR']);
  assert.deepEqual(WBS_TEST_IMPORT_GRANT_BUNDLES.reopener,['BANK.RECONCILIATION.REOPEN']);
  const identities=['importer','reconciliationStarter','maker','paymentMaker','matchMaker','submitter','reviewer','approver','poster','clearer','reopener'];
  assert.equal(identities.length,11);assert.equal(new Set(identities).size,11);
  const sql=read('../db/migrations/276_wbs_test_bank_sod_boundaries.sql');
  for(const token of ['wbs_test_bank_import_receipt','receipt_hash','SERVICE_ACCOUNT','WBS.TEST.IMPORT','refs_start_wbs_test_bank_reconciliation','BANK.RECONCILIATION.START','refs_wbs_test_bank_adjustment_post_batch','GL.JE.POST','refs_wbs_test_bank_adjustment_clear_batch','BANK.RECONCILIATION.CLEAR','Legacy WBS TEST Bank import/start boundary is disabled','Legacy WBS TEST Bank POST/CLEAR boundary is disabled','REVOKE ALL ON FUNCTION refs_finalize_wbs_test_bank_staged_import'])assert.match(sql,new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
  assert.doesNotMatch(sql,/refs_wbs_test_bank_adjustment_post_batch[\s\S]{0,1000}refs_assert_scope\([^;]+BANK\.RECONCILIATION\.CLEAR/);
  const service=read('../runtime/wbs-test-import-service.mjs');
  const importBank=service.slice(service.indexOf('async importBankTransactions'),service.indexOf('async importRange'));
  assert.doesNotMatch(importBank,/startWbsTestBankReconciliation|reconciliation_id/);
  const workflow=read('../runtime/controlled-test-bank-workflow-service.mjs');
  assert.match(workflow,/kernels\.poster\.postWbsTestBankAdjustmentBatch/);
  assert.match(workflow,/kernels\.clearer\.clearWbsTestBankAdjustmentBatch/);
  assert.match(workflow,/kernels\.reopener\.transitionReconciliation/);
  assert.doesNotMatch(workflow,/postClearWbsTestBankAdjustmentBatch/);
});

test('276 down restores every replaced historical function from retained definitions',()=>{
  const down=read('../db/migrations/down/276_wbs_test_bank_sod_boundaries.sql');
  assert.match(down,/wbs_test_bank_legacy_function_backup/);assert.match(down,/EXECUTE fn\.function_definition/);
  assert.doesNotMatch(down,/requires restoring|0A000/);
});
