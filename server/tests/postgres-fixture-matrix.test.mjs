import test from 'node:test';
import assert from 'node:assert/strict';
import {POSTGRES_FIXTURE_IMAGES,selectImages} from '../runtime/run-postgres-fixture-matrix.mjs';

test('PostgreSQL fixture matrix fixes the supported release versions and rejects partial or unknown selectors',()=>{
  assert.deepEqual(POSTGRES_FIXTURE_IMAGES,['postgres:15-alpine','postgres:16-alpine','postgres:18-alpine']);
  assert.deepEqual(selectImages(),POSTGRES_FIXTURE_IMAGES);
  assert.deepEqual(selectImages(['--image','postgres:16-alpine']),['postgres:16-alpine']);
  assert.throws(()=>selectImages(['--image']),/Usage/);
  assert.throws(()=>selectImages(['--image','postgres:17-alpine']),/Usage/);
});
