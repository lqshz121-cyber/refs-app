import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';

const up=await readFile(new URL('../db/migrations/378_cash_transfer_attachment_candidates.sql',import.meta.url),'utf8');
const down=await readFile(new URL('../db/migrations/down/378_cash_transfer_attachment_candidates.sql',import.meta.url),'utf8');

test('Cash Transfer attachment candidates are scoped, minimal, and execute-only',()=>{
 const body=up.match(/CREATE FUNCTION refs_read_cash_transfer_attachment_candidates[\s\S]*?END;\$\$;/i)?.[0]??'';
 assert.match(up,/oid='attachment'::regclass AND relrowsecurity/i);
 assert.match(up,/has_table_privilege\('refs_app','attachment','SELECT'\)/i);
 assert.match(body,/STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp/i);
 for(const scope of ['CASH.TRANSFER.CREATE','GL.JE.CREATE'])assert.match(body,new RegExp("refs_assert_scope\\(p_tenant,p_entity,'"+scope.replace(/\./g,'\\.')+"'\\)"));
 for(const condition of ["a.finalization_status='VERIFIED_CLEAN'","a.scan_status='CLEAN'",'a.verified_at IS NOT NULL','a.finalized_at IS NOT NULL'])assert.ok(body.includes(condition),condition);
 for(const field of ['attachment_id','name','media_type','verified_at'])assert.match(body,new RegExp("'"+field+"'"));
 for(const forbidden of ['storage_ref','storage_version','content_hash','scan_ref','uploaded_by'])assert.doesNotMatch(body,new RegExp("'"+forbidden+"'"));
 assert.match(body,/ORDER BY a.verified_at DESC,a.attachment_id DESC[\s\S]*LIMIT 100/i);
 assert.match(up,/REVOKE ALL ON FUNCTION refs_read_cash_transfer_attachment_candidates\(uuid,uuid\) FROM PUBLIC/i);
 assert.match(up,/GRANT EXECUTE ON FUNCTION refs_read_cash_transfer_attachment_candidates\(uuid,uuid\) TO refs_app/i);
});

test('Cash Transfer attachment candidates rollback fails closed and removes the reader',()=>{
 assert.match(down,/Cannot roll back Cash Transfer attachment candidates while retained Cash Transfer evidence exists/i);
 assert.match(down,/REVOKE EXECUTE ON FUNCTION refs_read_cash_transfer_attachment_candidates\(uuid,uuid\) FROM refs_app/i);
 assert.match(down,/DROP FUNCTION refs_read_cash_transfer_attachment_candidates\(uuid,uuid\)/i);
});
