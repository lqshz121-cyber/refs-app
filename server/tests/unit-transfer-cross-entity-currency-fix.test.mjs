import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {MIGRATION_MANIFEST} from '../runtime/migration-manifest.mjs';
const digest=value=>createHash('sha256').update(value).digest('hex');
test('Unit Transfer cross-entity cost guard uses source evidence currency without PLpgSQL ambiguity',async()=>{
 const name='405_unit_transfer_cross_entity_currency_fix.sql',entry=MIGRATION_MANIFEST.find(row=>row.name===name);
 const up=await readFile(new URL('../db/migrations/'+name,import.meta.url),'utf8'),down=await readFile(new URL('../db/migrations/down/'+name,import.meta.url),'utf8');
 assert.equal(entry?.up,digest(up));assert.equal(entry?.down,digest(down));
 assert.match(up,/CREATE OR REPLACE FUNCTION refs_create_unit_transfer/);
 assert.match(up,/l[.]currency=source_document[.]currency/);assert.doesNotMatch(up,/l[.]currency=currency/);
 assert.match(down,/l[.]currency=currency/);assert.match(up,/GRANT EXECUTE ON FUNCTION refs_create_unit_transfer/);
});