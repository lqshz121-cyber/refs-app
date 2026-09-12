import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {MIGRATION_MANIFEST} from '../runtime/migration-manifest.mjs';

test('reconciliation command retries are actor-bound before legacy receipt handling',async()=>{
  const up=await readFile(new URL('../db/migrations/385_reconciliation_idempotency_actor_binding.sql',import.meta.url),'utf8');
  const down=await readFile(new URL('../db/migrations/down/385_reconciliation_idempotency_actor_binding.sql',import.meta.url),'utf8');
  const manifest=MIGRATION_MANIFEST.find(item=>item.name==='385_reconciliation_idempotency_actor_binding.sql');
  assert.deepEqual(manifest,{name:'385_reconciliation_idempotency_actor_binding.sql',up:createHash('sha256').update(up.replace(/\r\n/g,'\n')).digest('hex'),down:createHash('sha256').update(down.replace(/\r\n/g,'\n')).digest('hex')});
  for(const token of ['refs_current_actor','pg_advisory_xact_lock','idempotency_receipt','receipt_actor IS DISTINCT FROM actor','Reconciliation retry belongs to another actor'])assert.match(up,new RegExp(token));
  for(const scope of ['RECONCILIATION_START:','RECONCILIATION_CLEARANCE:','RECONCILIATION_ADJUSTMENT_DRAFT:','RECONCILIATION_\'\|\|upper(p_action)'])assert.match(up,new RegExp(scope));
  for(const fn of ['refs_start_reconciliation','refs_set_reconciliation_clearance','refs_transition_reconciliation_adjustment_aware','refs_create_reconciliation_adjustment_draft']){
    assert.match(up,new RegExp(`ALTER FUNCTION ${fn}\\(`));
    assert.match(up,new RegExp(`CREATE FUNCTION ${fn}\\(`));
    assert.match(up,new RegExp(`REVOKE ALL ON FUNCTION ${fn}_385`));
    assert.match(down,new RegExp(`ALTER FUNCTION ${fn}_385`));
  }
});
