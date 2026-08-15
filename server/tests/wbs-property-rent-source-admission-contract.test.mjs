import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const up=await readFile(new URL('../db/migrations/142_wbs_property_rent_source_admission.sql',import.meta.url),'utf8');
const down=await readFile(new URL('../db/migrations/down/142_wbs_property_rent_source_admission.sql',import.meta.url),'utf8');
const repository=await readFile(new URL('../runtime/kernel-repository.mjs',import.meta.url),'utf8');

test('Property Rent foundation admits only signed transaction candidates and remains fail closed before an AR producer exists',()=>{
  for(const pattern of [
    /WBS\.PROPERTY\.REVIEW/,
    /environment='PRODUCTION'/,
    /wbs_snapshot_delivery_attestation/,
    /ingestion_kind='TRANSACTION_CANDIDATE'/,
    /source_type' IS DISTINCT FROM 'PROPERTY_RENT_CHARGE'/,
    /admission' IS DISTINCT FROM 'TRANSACTION_CANDIDATE'/,
    /transaction_kind' IS DISTINCT FROM 'RENT_CHARGE'/,
    /CONTROL_EVIDENCE and non-rent rows cannot be admitted/,
    /'WBS_PROPERTY_RENT_CHARGE'/,
    /amount,'NONE','Admitted Property Rent source amount/,
    /'PENDING_REVIEW'/,
    /PROPERTY_RENT_PRODUCER_UNAVAILABLE/,
    /'transaction_admitted',true/,
    /'can_create_draft',false/,
    /'can_approve',false/,
    /'can_post',false/,
    /wbs_property_rent_source_admission_append_only/,
    /ENABLE ROW LEVEL SECURITY/,
    /INSERT INTO audit_event/,
    /INSERT INTO outbox_event/
  ])assert.match(up,pattern);
  assert.doesNotMatch(up,/INSERT INTO (business_document|journal_entry|journal_line|ledger_line|posting_batch)/i);
  assert.doesNotMatch(up,/amount,'(?:DEBIT|CREDIT)','Admitted Property Rent/i);
  assert.match(down,/Cannot remove retained WBS Property Rent source admissions/);
  assert.match(repository,/async admitWbsPropertyRentSource/);
  assert.match(repository,/refs_admit_wbs_property_rent_source\(/);
});
