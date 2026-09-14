import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {MIGRATION_MANIFEST} from '../runtime/migration-manifest.mjs';
const digest=value=>createHash('sha256').update(value).digest('hex');
test('Unit Transfer transition gates journal enum state and routes each entity outbox event distinctly',async()=>{
 const name='407_unit_transfer_transition_status_outbox_fix.sql',entry=MIGRATION_MANIFEST.find(row=>row.name===name);
 const up=await readFile(new URL('../db/migrations/'+name,import.meta.url),'utf8'),down=await readFile(new URL('../db/migrations/down/'+name,import.meta.url),'utf8');
 assert.equal(entry?.up,digest(up));assert.equal(entry?.down,digest(down));
 assert.equal((up.match(/::journal_status/g)||[]).length,1);assert.match(up,/target_status journal_status/);assert.doesNotMatch(down,/::journal_status/);
 for(const actor of ['pair.source_entity_id','pair.target_entity_id'])assert.match(up,new RegExp("jsonb_build_object\\('entity_id',"+actor.replace('.','\\.')+"\\)"));
 assert.match(down,/UNIT_TRANSFER_'\|\|action,payload,refs_jsonb_hash\(payload\)/);
});
