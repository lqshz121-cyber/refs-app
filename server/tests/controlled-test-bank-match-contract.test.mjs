import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const up=fs.readFileSync(new URL('../db/migrations/190_wbs_test_bank_match_fixture_read.sql',import.meta.url),'utf8');
const down=fs.readFileSync(new URL('../db/migrations/down/190_wbs_test_bank_match_fixture_read.sql',import.meta.url),'utf8');
const periodUp=fs.readFileSync(new URL('../db/migrations/191_wbs_test_bank_match_period_scope.sql',import.meta.url),'utf8');
const periodDown=fs.readFileSync(new URL('../db/migrations/down/191_wbs_test_bank_match_period_scope.sql',import.meta.url),'utf8');
const stage1Up=fs.readFileSync(new URL('../db/migrations/192_wbs_test_bank_match_stage1_source.sql',import.meta.url),'utf8');
const stage1Down=fs.readFileSync(new URL('../db/migrations/down/192_wbs_test_bank_match_stage1_source.sql',import.meta.url),'utf8');
const configUp=fs.readFileSync(new URL('../db/migrations/193_wbs_test_bank_match_config_workflow.sql',import.meta.url),'utf8');
const configDown=fs.readFileSync(new URL('../db/migrations/down/193_wbs_test_bank_match_config_workflow.sql',import.meta.url),'utf8');
const repository=fs.readFileSync(new URL('../runtime/kernel-repository.mjs',import.meta.url),'utf8');

test('isolated Bank Match fixture is private, exact, legacy-only and server-selected',()=>{
  for(const token of ["refs_assert_scope(p_tenant,p_entity,'WBS.TEST.IMPORT')","refs_assert_scope(p_tenant,p_entity,'BANK.VIEW')","refs_assert_scope(p_tenant,p_entity,'AP.VIEW')","b.bank_account_ref='WBS_TEST_BANK'","d.document_type='WBS_TEST_BANK_TRANSACTION'","bd.document_kind='AP_BILL'","sd.document_type='WBS_TEST_PAYABLE'","bd.document_number LIKE 'WBS-TEST-%'","p.status='OPEN'","REVOKE ALL","GRANT EXECUTE"])assert.match(up,new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
  assert.doesNotMatch(up,/WBS_TEST_BANK_2026_0[1-6]/);assert.match(down,/DROP FUNCTION IF EXISTS refs_resolve_wbs_test_bank_match_fixture/);
  for(const token of ['refs_bind_wbs_test_bank_match_payment_source',"refs_assert_scope(p_tenant,p_entity,'AP.PAYMENT.CREATE')","document_type='WBS_TEST_PAYABLE'","occurrence.occurrence_kind<>'AP_PAYMENT'","journal.journal_type<>'AUTO'","family='BANK'","refs_rule_evaluation_hash","'WBS_TEST_BANK_MATCH_PAYMENT'","'CONTROLLED_TEST_BANK_PAYMENT_SOURCE_BOUND'"])assert.match(up,new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
  assert.match(down,/DROP FUNCTION IF EXISTS refs_bind_wbs_test_bank_match_payment_source/);
  assert.match(repository,/async resolveWbsTestBankMatchFixture/);assert.match(repository,/rows\.length!==1/);assert.match(repository,/async bindWbsTestBankMatchPaymentSource/);
});

test('193 provisions the isolated TEST_ONLY BANK evidence through distinct maker and reviewer actors only',()=>{
  for(const token of ['refs_propose_wbs_test_bank_match_config','refs_approve_wbs_test_bank_match_config',"refs_assert_scope(p_tenant,p_entity,'WBS.TEST.IMPORT')","refs_assert_scope(p_tenant,p_entity,'AP.PAYMENT.CREATE')","refs_assert_scope(p_tenant,p_entity,'GL.JE.REVIEW')","refs_assert_scope(p_tenant,p_entity,'BANK.RECONCILIATION.REVIEW')","created_by=actor","WBS_TEST_BANK_MATCH_SETTING_V1","WBS_TEST_BANK_MATCH_MAPPING_INPUT_V1","status='APPROVED'","GRANT EXECUTE"])
    assert.match(configUp,new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
  assert.doesNotMatch(configUp,/p_(created|approved)_by|set_config\([^)]*actor/i);
  assert.match(configDown,/Cannot remove migration 193 while controlled test Bank Match configuration evidence exists/);
  assert.match(repository,/async proposeWbsTestBankMatchConfig/);assert.match(repository,/async approveWbsTestBankMatchConfig/);
});

test('192 admits only the legacy controlled Stage1 Payable identity while preserving the 191 period boundary',()=>{
  assert.match(stage1Up,/sd\.source_system IN \('WBS','REFS_STAGE1'\) AND sd\.source_module='payable'/);
  assert.match(stage1Up,/\n\s+AND source_system IN \('WBS','REFS_STAGE1'\) AND source_module='payable'/);
  for(const token of [
    'CREATE OR REPLACE FUNCTION refs_resolve_wbs_test_bank_match_fixture',
    'CREATE OR REPLACE FUNCTION refs_bind_wbs_test_bank_match_payment_source',
    'bd.accounting_date BETWEEN p.starts_on AND p.ends_on',
    'sd.accounting_date=bd.accounting_date',
    "document_type='WBS_TEST_PAYABLE' AND status='POSTED'",
    "bd.document_number LIKE 'WBS-TEST-%'",
  ])assert.match(stage1Up,new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
  assert.doesNotMatch(stage1Up,/source_system IN \('WBS','REFS_STAGE1',[^)]/);
  assert.match(stage1Down,/sd\.source_system='WBS' AND sd\.source_module='payable'/);
  assert.match(stage1Down,/\n\s+AND source_system='WBS' AND source_module='payable'/);
  assert.doesNotMatch(stage1Down,/REFS_STAGE1/);
});

test('191 binds the controlled Bank Match Payable to the Bank transaction OPEN period and restores 190 exactly',()=>{
  for(const token of [
    'CREATE OR REPLACE FUNCTION refs_resolve_wbs_test_bank_match_fixture',
    'bd.accounting_date BETWEEN p.starts_on AND p.ends_on',
    'sd.accounting_date=bd.accounting_date',
    "sd.source_system='WBS' AND sd.source_module='payable'",
    "sd.document_type='WBS_TEST_PAYABLE' AND sd.status='POSTED'",
    'REVOKE ALL ON FUNCTION refs_resolve_wbs_test_bank_match_fixture',
    'GRANT EXECUTE ON FUNCTION refs_resolve_wbs_test_bank_match_fixture',
  ])assert.match(periodUp,new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
  const resolver=/CREATE(?: OR REPLACE)? FUNCTION refs_resolve_wbs_test_bank_match_fixture[\s\S]*?GRANT EXECUTE ON FUNCTION refs_resolve_wbs_test_bank_match_fixture\(uuid,uuid\) TO refs_app;/;
  const normalize=value=>value.match(resolver)?.[0].replace('CREATE OR REPLACE FUNCTION','CREATE FUNCTION');
  assert.equal(normalize(periodDown),normalize(up),'191 down must restore the exact applied 190 resolver contract');
  assert.doesNotMatch(periodDown,/bd\.accounting_date BETWEEN p\.starts_on AND p\.ends_on/);
});
