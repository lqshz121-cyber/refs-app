import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const here=resolve(fileURLToPath(new URL('.',import.meta.url)));
const migration=await readFile(resolve(here,'../db/migrations/145_insurance_prepaid_amortization_read.sql'),'utf8');
const down=await readFile(resolve(here,'../db/migrations/down/145_insurance_prepaid_amortization_read.sql'),'utf8');

test('Insurance prepaid readiness is an authenticated entity-period read of the exact signed chain',()=>{
  assert.match(migration,/refs_assert_scope\(p_tenant,p_entity,'GL\.REPORT\.VIEW'\)/);
  assert.match(migration,/p\.period_id=p_period/);
  assert.match(migration,/wbs_provider_signed_payable_admission/);
  assert.match(migration,/d\.payload_hash=s\.source_payload_hash AND d\.version>=s\.source_document_version/);
  assert.match(migration,/c\.coverage_hash~'\^sha256:/);
  assert.match(migration,/mapping\.output_rules->>'prepaid_type'='INSURANCE'/);
  assert.match(migration,/j\.status='POSTED'/);
  assert.match(migration,/ll\.account_code=jl\.account_code AND ll\.debit_amount=jl\.debit_amount/);
  assert.match(migration,/'amount',to_char\(amount,'FM999999999999990\.0000'\)/);
});

test('read status never upgrades an AI proposal and exposes no posting authority',()=>{
  assert.match(migration,/'READY_FOR_INDEPENDENT_REVIEW'/);
  assert.match(migration,/'INDEPENDENTLY_REVIEWED'/);
  assert.match(migration,/'DRAFT_CREATED'/);
  assert.match(migration,/'can_independently_review'.*refs_has_permission\('PREPAID\.AMORTIZATION\.REVIEW'\)/s);
  assert.match(migration,/'can_create_draft'.*refs_has_permission\('PREPAID\.AMORTIZATION\.DRAFT'\).*refs_has_permission\('GL\.JE\.AUTO\.CREATE'\)/s);
  assert.match(migration,/'can_submit',false,'can_approve',false,'can_post',false/);
  assert.doesNotMatch(migration,/INSERT INTO (journal_entry|ledger_line|insurance_prepaid_amortization_review)/i);
  assert.doesNotMatch(migration,/UPDATE |DELETE FROM /i);
});

test('down migration removes only the GET-only reader',()=>{
  assert.match(down,/DROP FUNCTION refs_read_insurance_prepaid_amortization/);
  assert.doesNotMatch(down,/DROP TABLE|DELETE FROM/i);
});
