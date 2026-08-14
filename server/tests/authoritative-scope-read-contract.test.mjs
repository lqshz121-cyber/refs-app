import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const up=await readFile(new URL('../db/migrations/130_authoritative_scope_status_text.sql',import.meta.url),'utf8');
const down=await readFile(new URL('../db/migrations/down/130_authoritative_scope_status_text.sql',import.meta.url),'utf8');

test('authoritative scope reader returns the PostgreSQL period enum through its text contract',()=>{
  assert.match(up,/CREATE OR REPLACE FUNCTION public\.refs_read_authoritative_scope/);
  assert.match(up,/p\.status::text/);
  assert.match(up,/refs_assert_scope\(p_tenant,p_entity,'GL\.REPORT\.VIEW'\)/);
  assert.doesNotMatch(up,/DROP FUNCTION/);
});

test('authoritative scope reader rollback restores the exact prior function contract',()=>{
  assert.match(down,/CREATE OR REPLACE FUNCTION public\.refs_read_authoritative_scope/);
  assert.match(down,/p\.status\s*\n/);
  assert.doesNotMatch(down,/p\.status::text/);
});
