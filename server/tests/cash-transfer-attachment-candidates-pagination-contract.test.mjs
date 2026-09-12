import assert from 'node:assert/strict';
import test from 'node:test';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {MIGRATION_MANIFEST} from '../runtime/migration-manifest.mjs';

const name='380_cash_transfer_attachment_candidates_pagination.sql';
const up=await readFile(new URL('../db/migrations/'+name,import.meta.url),'utf8');
const down=await readFile(new URL('../db/migrations/down/'+name,import.meta.url),'utf8');
const digest=value=>createHash('sha256').update(value).digest('hex');

test('Cash Transfer attachment candidates use a bounded scoped keyset page',()=>{
 const entry=MIGRATION_MANIFEST.find(item=>item.name===name);assert.equal(entry?.up,digest(up));assert.equal(entry?.down,digest(down));
 assert.match(up,/p_limit integer DEFAULT 100,p_before_verified_at timestamptz DEFAULT NULL,p_before_attachment_id uuid DEFAULT NULL/i);
 assert.match(up,/p_limit NOT BETWEEN 1 AND 100/);assert.match(up,/p_before_verified_at IS NULL\)<>\(p_before_attachment_id IS NULL\)/);
 assert.match(up,/refs_assert_scope\(p_tenant,p_entity,'CASH\.TRANSFER\.CREATE'\)/);assert.match(up,/refs_assert_scope\(p_tenant,p_entity,'GL\.JE\.CREATE'\)/);
 assert.match(up,/a\.tenant_id=p_tenant AND a\.entity_id=p_entity/);assert.match(up,/\(a\.verified_at,a\.attachment_id\)<\(p_before_verified_at,p_before_attachment_id\)/);assert.match(up,/LIMIT p_limit\+1/);
 for(const field of ['attachment_id','name','media_type','verified_at','limit','has_more','next_cursor'])assert.match(up,new RegExp("'"+field+"'"));
 for(const forbidden of ['storage_ref','storage_version','content_hash','scan_ref','uploaded_by'])assert.doesNotMatch(up,new RegExp("'"+forbidden+"'"));
 assert.match(up,/REVOKE ALL ON FUNCTION refs_read_cash_transfer_attachment_candidates\(uuid,uuid,integer,timestamptz,uuid\) FROM PUBLIC/);assert.match(up,/GRANT EXECUTE ON FUNCTION refs_read_cash_transfer_attachment_candidates\(uuid,uuid,integer,timestamptz,uuid\) TO refs_app/);
});

test('Cash Transfer attachment pagination rollback fails closed and restores only the prior reader',()=>{
 assert.match(down,/Cannot roll back Cash Transfer attachment candidate pagination while retained Cash Transfer evidence exists/i);assert.match(down,/DROP FUNCTION refs_read_cash_transfer_attachment_candidates\(uuid,uuid,integer,timestamptz,uuid\)/);assert.match(down,/CREATE FUNCTION refs_read_cash_transfer_attachment_candidates\(p_tenant uuid,p_entity uuid\)/);assert.match(down,/REVOKE ALL ON FUNCTION refs_read_cash_transfer_attachment_candidates\(uuid,uuid\) FROM PUBLIC/);assert.match(down,/GRANT EXECUTE ON FUNCTION refs_read_cash_transfer_attachment_candidates\(uuid,uuid\) TO refs_app/);
});