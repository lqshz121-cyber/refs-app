import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {MIGRATION_MANIFEST} from '../runtime/migration-manifest.mjs';

const name='382_fixed_asset_acquisition_source_version_zero.sql';
const read=direction=>readFile(new URL(`../db/migrations/${direction==='down'?'down/':''}${name}`,import.meta.url),'utf8');
const digest=value=>createHash('sha256').update(value.replace(/\r\n/g,'\n')).digest('hex');

test('382 preserves the source-document version zero baseline through acquisition and depreciation',async()=>{
 const [up,down]=await Promise.all([read('up'),read('down')]);
 assert.match(up,/CHECK \(source_document_version >= 0\)/);
 assert.match(up,/p_source_version IS NULL OR p_source_version<0/);
 assert.match(up,/source\.version<>p_source_version/);
 assert.match(down,/source_document_version = 0/);
 assert.match(down,/Retained version-zero acquisition bindings require non-negative source version support/);
 assert.match(down,/CHECK \(source_document_version > 0\)/);
 assert.match(down,/p_source_version IS NULL OR p_source_version<1/);
});

test('382 migration files match the normalized manifest hashes',async()=>{
 const entry=MIGRATION_MANIFEST.find(row=>row.name===name);assert.ok(entry);
 for(const direction of ['up','down'])assert.equal(digest(await read(direction)),entry[direction]);
});
