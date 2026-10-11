import test from 'node:test';
import assert from 'node:assert/strict';
import {postgresDataVolumeTarget} from '../runtime/postgres-container.mjs';
import {readFile} from 'node:fs/promises';

test('PostgreSQL 18 and later use the official versioned Docker volume root',()=>{
  assert.equal(postgresDataVolumeTarget('postgres:15-alpine'),'/var/lib/postgresql/data');
  assert.equal(postgresDataVolumeTarget('postgres:16-alpine'),'/var/lib/postgresql/data');
  assert.equal(postgresDataVolumeTarget('postgres:18-alpine'),'/var/lib/postgresql');
  assert.equal(postgresDataVolumeTarget('postgres:19.1-alpine'),'/var/lib/postgresql');
});

test('isolated access gate supports deployed PG18 and uses the shared volume mapping',async()=>{
  const source=await readFile(new URL('../../tools/analysis/postgres-release-gap-gate.mjs',import.meta.url),'utf8');
  assert.match(source,/\['postgres:15-alpine','postgres:16-alpine','postgres:18-alpine'\]\.includes\(image\)/);
  assert.match(source,/POSTGRES_DATA_VOLUME_TARGET:postgresDataVolumeTarget\(image\)/);
  assert.doesNotMatch(source,/POSTGRES_DATA_VOLUME_TARGET:'\/var\/lib\/postgresql\/data'/);
});
