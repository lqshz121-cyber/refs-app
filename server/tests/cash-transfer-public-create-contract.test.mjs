import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';

const up=await readFile(new URL('../db/migrations/377_cash_transfer_public_create.sql',import.meta.url),'utf8');
const down=await readFile(new URL('../db/migrations/down/377_cash_transfer_public_create.sql',import.meta.url),'utf8');
const signature='uuid,uuid,uuid,date,text,char(3),text,text,text,text,numeric,uuid[],text,text';

test('Cash Transfer public create accepts only public DTO fields and a command key',()=>{
  assert.match(up,/CREATE FUNCTION refs_create_cash_transfer_from_public_dto\(/i);
  assert.match(up,/RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp/i);
  assert.match(up,/p_attachments uuid\[\],p_reason text,p_idempotency_key text/i);
  assert.doesNotMatch(up,/p_attachment_hash|p_attachment_snapshot_hash|attachmentSnapshotHash|attachmentHash/i);
  assert.match(up,/refs_assert_scope\(p_tenant,p_entity,'CASH[.]TRANSFER[.]CREATE'\)/i);
  assert.match(up,/refs_assert_scope\(p_tenant,p_entity,'GL[.]JE[.]CREATE'\)/i);
  assert.match(up,/refs_current_actor\(\) IS NULL OR length\(coalesce\(p_idempotency_key,''\)\) NOT BETWEEN 8 AND 200/i);
  assert.match(up,/REVOKE ALL ON FUNCTION refs_create_cash_transfer_from_public_dto\(/i);
  assert.match(up,/GRANT EXECUTE ON FUNCTION refs_create_cash_transfer_from_public_dto\(/i);
  assert.match(up,/TO refs_app/i);
});

test('Cash Transfer public create owns canonical verified-clean attachment evidence',()=>{
  assert.match(up,/SELECT ARRAY\(SELECT id FROM unnest\(COALESCE\(p_attachments,'\{\}'::uuid\[\]\)\) id ORDER BY id\) INTO attachments/i);
  assert.match(up,/cardinality\(attachments\)<>cardinality\(COALESCE\(p_attachments,'\{\}'::uuid\[\]\)\)/i);
  assert.match(up,/cardinality\(attachments\)<>cardinality\(ARRAY\(SELECT DISTINCT id FROM unnest\(COALESCE\(p_attachments,'\{\}'::uuid\[\]\)\) id\)\)/i);
  assert.match(up,/Cash Transfer attachments must be unique canonical identifiers/i);
  assert.match(up,/snapshot_hash:=refs_cash_transfer_attachment_snapshot\(p_tenant,p_entity,attachments\)/i);
  assert.match(up,/snapshot_hash IS NULL/i);
  assert.match(up,/Cash Transfer requires exact verified-clean retained attachment evidence/i);
});

test('Cash Transfer public create binds its server snapshot into canonical idempotency hashing and the aggregate command',()=>{
  assert.match(up,/request_hash:=refs_create_cash_transfer_hash\(p_tenant,p_entity,p_period,p_date,p_currency,p_from_account,p_from_bank,p_to_account,p_to_bank,p_amount,p_number,attachments,snapshot_hash,p_reason\)/i);
  assert.match(up,/RETURN refs_create_cash_transfer\(p_tenant,p_entity,p_period,p_date,p_currency,p_from_account,p_from_bank,p_to_account,p_to_bank,p_amount,p_number,attachments,snapshot_hash,p_reason,p_idempotency_key,request_hash\)/i);
  assert.doesNotMatch(up,/INSERT INTO idempotency_receipt|UPDATE idempotency_receipt/i);
  assert.doesNotMatch(up,/CREATE OR REPLACE FUNCTION refs_create_cash_transfer\(/i);
});

test('Cash Transfer public create rollback fails closed and removes the public wrapper',()=>{
  assert.match(down,/IF EXISTS\(SELECT 1 FROM cash_transfer\) OR EXISTS\(SELECT 1 FROM cash_transfer_bank_link\) OR EXISTS\(SELECT 1 FROM cash_transfer_bank_account_control\)/i);
  assert.match(down,/Cannot roll back Cash Transfer public create wrapper while retained Cash Transfer evidence exists/i);
  assert.match(down,new RegExp('REVOKE EXECUTE ON FUNCTION refs_create_cash_transfer_from_public_dto\\('+signature.replace(/[()[\]]/g,'\\$&')+'\\) FROM refs_app','i'));
  assert.match(down,new RegExp('DROP FUNCTION refs_create_cash_transfer_from_public_dto\\('+signature.replace(/[()[\]]/g,'\\$&')+'\\)','i'));
});
