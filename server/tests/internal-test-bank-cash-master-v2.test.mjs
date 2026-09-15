import assert from 'node:assert/strict';
import test from 'node:test';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {MIGRATION_MANIFEST} from '../runtime/migration-manifest.mjs';

const name='420_internal_test_bank_cash_master_v2.sql';
const digest=text=>createHash('sha256').update(text.replace(/\r\n/g,'\n')).digest('hex');
test('internal-test v2 cash-master bootstrap is manifest-bound and retains only explicit test masters',async()=>{
  const [up,down]=await Promise.all([readFile(new URL(`../db/migrations/${name}`,import.meta.url),'utf8'),readFile(new URL(`../db/migrations/down/${name}`,import.meta.url),'utf8')]);
  const entry=MIGRATION_MANIFEST.find(row=>row.name===name);
  assert.ok(entry);assert.equal(entry.up,digest(up));assert.equal(entry.down,digest(down));
  for(const token of ['INTERNAL_TEST_BANK_DESTINATION','111991','INTERNAL_TEST_ONLY_V2','2026-01-01','2026-09-14','CASH.TRANSFER.CONFIGURE','INTERNAL_TEST_BANK_CASH_MASTER_V2_READY','pg_advisory_xact_lock'])assert.match(up,new RegExp(token.replaceAll('.','\\.')));
  assert.doesNotMatch(up,/\b(?:raw_event|source_document|wbs_)\b/i);
  assert.match(down,/without deleting retained test masters/);
});