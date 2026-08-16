import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const up=await readFile(new URL('../db/migrations/157_wbs_property_rent_pickup.sql',import.meta.url),'utf8');
const down=await readFile(new URL('../db/migrations/down/157_wbs_property_rent_pickup.sql',import.meta.url),'utf8');
const repository=await readFile(new URL('../runtime/kernel-repository.mjs',import.meta.url),'utf8');

test('signed Property Rent review resolves configuration server-side and produces only a normal AR Draft',()=>{
 for(const pattern of [/WBS\.PROPERTY\.RENT\.REVIEW/,/WBS\.PROPERTY\.RENT\.DRAFT/,/admission and review require different actors/,/exactly one server-resolved approved setting/,/exactly one highest-priority server-resolved mapping/,/receivable_account_code/,/revenue_account_code/,/to_char\(source\.gross_amount,'FM9999999999999990\.0000'\)/,/refs_auto_staging_ready/,/refs_create_auto_journal\(/,/'AR_INVOICE'/,/wbs_property_rent_review_evidence_append_only/,/wbs_property_rent_draft_evidence_append_only/])assert.match(up,pattern);
 assert.doesNotMatch(up,/refs_post_journal\(/);
 assert.doesNotMatch(up,/p_mapping|p_setting/);
 assert.match(down,/Cannot remove retained WBS Property Rent review or Draft evidence/);
 assert.match(repository,/async reviewWbsPropertyRent/);assert.match(repository,/async createWbsPropertyRentDraft/);
});
