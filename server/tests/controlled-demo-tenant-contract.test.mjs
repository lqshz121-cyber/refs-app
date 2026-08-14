import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const up=await readFile(new URL('../db/migrations/116_controlled_demo_tenant_isolation.sql',import.meta.url),'utf8');
const down=await readFile(new URL('../db/migrations/down/116_controlled_demo_tenant_isolation.sql',import.meta.url),'utf8');

test('controlled DEMO tenant marker is explicit, isolated, and expires without mutating accounting evidence',()=>{
  assert.match(up,/CREATE TABLE controlled_demo_tenant/);
  assert.match(up,/tenant_id uuid PRIMARY KEY REFERENCES tenant/);
  assert.match(up,/expires_at timestamptz NOT NULL/);
  assert.match(up,/absence of a row means the\s+-- tenant remains a normal, non-demo tenant/i);
  assert.match(up,/CREATE POLICY controlled_demo_tenant_scope_policy/);
  assert.match(up,/CREATE TRIGGER controlled_demo_tenant_append_only BEFORE UPDATE OR DELETE/);
  assert.match(up,/Controlled DEMO tenant code must use the DEMO_ namespace/);
  assert.match(up,/WHEN d\.expires_at<=clock_timestamp\(\) THEN 'EXPIRED'/);
  assert.doesNotMatch(up,/INSERT INTO (journal_entry|ledger_line|source_document|staging_item)/i);
});

test('controlled DEMO retirement is append-only, audited, and non-destructive',()=>{
  assert.match(up,/CREATE TABLE controlled_demo_tenant_retirement/);
  assert.match(up,/tenant_id uuid NOT NULL UNIQUE REFERENCES controlled_demo_tenant/);
  assert.match(up,/CREATE TRIGGER controlled_demo_tenant_retirement_append_only BEFORE UPDATE OR DELETE/);
  assert.match(up,/CREATE FUNCTION refs_retire_controlled_demo_tenant/);
  assert.match(up,/INSERT INTO audit_event[\s\S]*'CONTROLLED_DEMO_RETIRED'/);
  assert.match(up,/INSERT INTO outbox_event[\s\S]*'CONTROLLED_DEMO_RETIRED'/);
  assert.match(up,/REVOKE ALL ON FUNCTION refs_retire_controlled_demo_tenant/);
  assert.match(down,/Cannot remove controlled DEMO tenant markers or retirement audit evidence/);
});

test('runtime status reader is tenant-scoped and defaults ordinary tenants to production',()=>{
  assert.match(up,/CREATE FUNCTION refs_read_controlled_demo_tenant/);
  assert.match(up,/refs_current_tenant\(\) IS DISTINCT FROM p_tenant/);
  assert.match(up,/WHEN d\.tenant_id IS NULL THEN 'PRODUCTION'/);
  assert.match(up,/ELSE 'ACTIVE_DEMO'/);
  assert.match(up,/GRANT EXECUTE ON FUNCTION refs_read_controlled_demo_tenant\(uuid\) TO refs_app/);
});
