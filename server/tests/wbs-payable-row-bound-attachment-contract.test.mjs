import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';
const up=await readFile(new URL('../db/migrations/101_wbs_payable_row_bound_attachment_intent.sql',import.meta.url),'utf8');
const down=await readFile(new URL('../db/migrations/down/101_wbs_payable_row_bound_attachment_intent.sql',import.meta.url),'utf8');
const http=await readFile(new URL('../api/accounting-http.mjs',import.meta.url),'utf8');

test('row-bound upload intent is append-only, exact-scope, idempotent and hides internal CAS from the browser',()=>{
  for(const token of ['CREATE TABLE wbs_payable_attachment_upload_intent','wbs_payable_attachment_upload_intent_append_only','WBS_PAYABLE_ATTACHMENT_RESERVE:','refs_reserve_wbs_payable_attachment_hash','ON CONFLICT DO NOTHING','refs_read_wbs_payable_attachment_uploads','refs_bind_wbs_payable_uploaded_attachment'])assert.match(up,new RegExp(token));
  for(const token of ['ATTACHMENT.CREATE','AP.VIEW','WBS.PAYABLE.REVIEW','STAGING_REVIEW_REQUIRED','BGDATA.payable','TRANSACTION_CANDIDATE','wbs_snapshot_delivery_attestation'])assert.match(up,new RegExp(token.replaceAll('.','\\.')));
  assert.match(up,/intent\.created_by=refs_current_actor\(\)/);assert.match(up,/scan\.actor_id=refs_current_actor\(\)/);assert.match(up,/wi\.created_by=refs_current_actor\(\)/);
  assert.match(up,/refs_bind_wbs_payable_attachment\(/);assert.doesNotMatch(http,/from-upload[\s\S]{0,1200}expectedProviderReceiptHash/);
  assert.match(down,/retained WBS Payable attachment upload intent evidence/);
});

test('public HTTP surface remains evidence-only and does not list entity attachments or advance accounting workflow',()=>{
  assert.match(http,/attachments'&&parts\[9\]==='uploads'/);assert.match(http,/bindings'&&parts\[10\]==='from-upload'/);
  assert.match(http,/allowOnly\(payload,\['attachmentId','reason'\]\)/);
  const handler=http.slice(http.indexOf("parts[10]==='from-upload'"),http.indexOf("}else if(parts.length===9",http.indexOf("parts[10]==='from-upload'")));
  for(const forbidden of ['reviewWbsPayable({','createWbsPayableApDraft({','transitionJournal','postJournal'])assert.doesNotMatch(handler,new RegExp(forbidden.replace(/[({]/g,'\\$&')));
});
