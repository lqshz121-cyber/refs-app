import test from 'node:test';
import assert from 'node:assert/strict';
import {postgresDataVolumeTarget} from '../runtime/postgres-container.mjs';

test('PostgreSQL 18 and later use the official versioned Docker volume root',()=>{
  assert.equal(postgresDataVolumeTarget('postgres:15-alpine'),'/var/lib/postgresql/data');
  assert.equal(postgresDataVolumeTarget('postgres:16-alpine'),'/var/lib/postgresql/data');
  assert.equal(postgresDataVolumeTarget('postgres:18-alpine'),'/var/lib/postgresql');
  assert.equal(postgresDataVolumeTarget('postgres:19.1-alpine'),'/var/lib/postgresql');
});
