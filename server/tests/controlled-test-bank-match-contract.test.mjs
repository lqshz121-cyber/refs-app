import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const up=fs.readFileSync(new URL('../db/migrations/190_wbs_test_bank_match_fixture_read.sql',import.meta.url),'utf8');
const down=fs.readFileSync(new URL('../db/migrations/down/190_wbs_test_bank_match_fixture_read.sql',import.meta.url),'utf8');
const periodUp=fs.readFileSync(new URL('../db/migrations/191_wbs_test_bank_match_period_scope.sql',import.meta.url),'utf8');
const periodDown=fs.readFileSync(new URL('../db/migrations/down/191_wbs_test_bank_match_period_scope.sql',import.meta.url),'utf8');
const repository=fs.readFileSync(new URL('../runtime/kernel-repository.mjs',import.meta.url),'utf8');

test('isolated Bank Match fixture is private, exact, legacy-only and server-selected',()=>{
  for(const token of ["refs_assert_scope(p_tenant,p_entity,'WBS.TEST.IMPORT')","refs_assert_scope(p_tenant,p_entity,'BANK.VIEW')","refs_assert_scope(p_tenant,p_entity,'AP.VIEW')","b.bank_account_ref='WBS_TEST_BANK'","d.document_type='WBS_TEST_BANK_TRANSACTION'","bd.document_kind='AP_BILL'","sd.document_type='WBS_TEST_PAYABLE'","bd.document_number LIKE 'WBS-TEST-%'","p.status='OPEN'","REVOKE ALL","GRANT EXECUTE"])assert.match(up,new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
  assert.doesNotMatch(up,/WBS_TEST_BANK_2026_0[1-6]/);assert.match(down,/DROP FUNCTION IF EXISTS refs_resolve_wbs_test_bank_match_fixture/);
  for(const token of ['refs_bind_wbs_test_bank_match_payment_source',"refs_assert_scope(p_tenant,p_entity,'AP.PAYMENT.CREATE')","document_type='WBS_TEST_PAYABLE'","occurrence.occurrence_kind<>'AP_PAYMENT'","journal.journal_type<>'AUTO'","family='BANK'","refs_rule_evaluation_hash","'WBS_TEST_BANK_MATCH_PAYMENT'","'CONTROLLED_TEST_BANK_PAYMENT_SOURCE_BOUND'"])assert.match(up,new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
  assert.match(down,/DROP FUNCTION IF EXISTS refs_bind_wbs_test_bank_match_payment_source/);
  assert.match(repository,/async resolveWbsTestBankMatchFixture/);assert.match(repository,/rows\.length!==1/);assert.match(repository,/async bindWbsTestBankMatchPaymentSource/);
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
