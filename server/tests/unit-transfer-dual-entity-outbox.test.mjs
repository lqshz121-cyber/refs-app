import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {MIGRATION_MANIFEST} from '../runtime/migration-manifest.mjs';
const digest=value=>createHash('sha256').update(value).digest('hex');
test('Unit Transfer emits entity-distinct outbox payloads for every dual-entity lifecycle event',async()=>{
 const name='406_unit_transfer_dual_entity_outbox.sql',entry=MIGRATION_MANIFEST.find(row=>row.name===name);
 const up=await readFile(new URL('../db/migrations/'+name,import.meta.url),'utf8'),down=await readFile(new URL('../db/migrations/down/'+name,import.meta.url),'utf8');
 assert.equal(entry?.up,digest(up));assert.equal(entry?.down,digest(down));
 for(const actor of ['p_source_entity','p_target_entity','pair.source_entity_id','pair.target_entity_id'])assert.match(up,new RegExp("jsonb_build_object\\('entity_id',"+actor.replace('.','\\.')+"\\)"));
 assert.doesNotMatch(up,/UNIT_TRANSFER_(?:DRAFT_PAIR_CREATED|POSTED)',payload,refs_jsonb_hash\(payload\)/);
 assert.match(down,/UNIT_TRANSFER_DRAFT_PAIR_CREATED',payload,refs_jsonb_hash\(payload\)/);assert.match(down,/UNIT_TRANSFER_POSTED',payload,refs_jsonb_hash\(payload\)/);
});