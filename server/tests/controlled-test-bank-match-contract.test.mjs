import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const up=fs.readFileSync(new URL('../db/migrations/190_wbs_test_bank_match_fixture_read.sql',import.meta.url),'utf8');
const down=fs.readFileSync(new URL('../db/migrations/down/190_wbs_test_bank_match_fixture_read.sql',import.meta.url),'utf8');
const repository=fs.readFileSync(new URL('../runtime/kernel-repository.mjs',import.meta.url),'utf8');

test('isolated Bank Match fixture is private, exact, legacy-only and server-selected',()=>{
  for(const token of ["refs_assert_scope(p_tenant,p_entity,'WBS.TEST.IMPORT')","refs_assert_scope(p_tenant,p_entity,'BANK.VIEW')","refs_assert_scope(p_tenant,p_entity,'AP.VIEW')","b.bank_account_ref='WBS_TEST_BANK'","d.document_type='WBS_TEST_BANK_TRANSACTION'","bd.document_kind='AP_BILL'","sd.document_type='WBS_TEST_PAYABLE'","bd.document_number LIKE 'WBS-TEST-%'","p.status='OPEN'","REVOKE ALL","GRANT EXECUTE"])assert.match(up,new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
  assert.doesNotMatch(up,/WBS_TEST_BANK_2026_0[1-6]/);assert.match(down,/DROP FUNCTION IF EXISTS refs_resolve_wbs_test_bank_match_fixture/);
  assert.match(repository,/async resolveWbsTestBankMatchFixture/);assert.match(repository,/rows\.length!==1/);
});
