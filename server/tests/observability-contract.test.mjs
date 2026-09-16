// Every structured event the runtime emits must be in the catalog, with a level
// and an alert rule; the catalog must not name events nobody emits; DB metrics
// must be plain SELECTs against tables that exist in the migration chain.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readdir,readFile} from 'node:fs/promises';
import {EVENT_CATALOG,DB_METRICS,MISSING_EVENTS} from '../runtime/observability-contract.mjs';

async function emitted(){
  const out=new Set();
  for(const dir of ['runtime','api','outbox-consumer']){
    let names=[];try{names=await readdir(new URL(`../${dir}/`,import.meta.url));}catch{continue;}
    for(const n of names.filter(n=>n.endsWith('.mjs')&&!n.startsWith('test-')&&n!=='observability-contract.mjs')){
      const src=await readFile(new URL(`../${dir}/${n}`,import.meta.url),'utf8');
      for(const m of src.matchAll(/event:'([a-z_]+)'/g))out.add(m[1]);
    }
  }
  return out;
}

test('every emitted runtime event is catalogued with a level and an alert rule',async()=>{
  const seen=await emitted();const known=new Set(EVENT_CATALOG.map(e=>e.event));
  const uncatalogued=[...seen].filter(e=>!known.has(e)).sort();
  assert.deepEqual(uncatalogued,[],'add these to EVENT_CATALOG with level/fields/alert');
  for(const e of EVENT_CATALOG){assert.match(e.level,/^(info|warn|error)$/,e.event);assert.ok(typeof e.alert==='string'&&e.alert.length>3,e.event);assert.ok(Array.isArray(e.fields),e.event);}
});

test('the catalog does not describe events that nothing emits, and names are unique',async()=>{
  const seen=await emitted();
  const dead=EVENT_CATALOG.map(e=>e.event).filter(e=>!seen.has(e));
  assert.deepEqual(dead,[]);
  assert.equal(new Set(EVENT_CATALOG.map(e=>e.event)).size,EVENT_CATALOG.length);
});

test('catalogued fields never include amounts, names or secrets',()=>{
  const forbidden=/(^|_)(amount|balance|token|secret|password|email|description)($|_)|^name$|display_name|tenant_name|reason_text/i;
  for(const e of EVENT_CATALOG)for(const f of e.fields)assert.doesNotMatch(f,forbidden,`${e.event}.${f}`);
});

test('every DB metric is a single read-only SELECT over relations the migration chain creates',async()=>{
  const files=await readdir(new URL('../db/migrations/',import.meta.url));
  const created=new Set(['refs_schema_migration']); // created by the runner's ensureMetadata, not by a migration
  for(const f of files.filter(f=>f.endsWith('.sql'))){const s=await readFile(new URL(`../db/migrations/${f}`,import.meta.url),'utf8');for(const m of s.matchAll(/CREATE (?:TABLE|VIEW|OR REPLACE VIEW)\s+(?:IF NOT EXISTS\s+)?([a-z_][a-z0-9_]*)/gi))created.add(m[1].toLowerCase());}
  for(const m of DB_METRICS){
    assert.match(m.sql,/^SELECT /,m.metric);assert.doesNotMatch(m.sql,/\b(INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE)\b/i,m.metric);
    for(const rel of m.sql.matchAll(/\b(?:FROM|JOIN)\s+([a-z_][a-z0-9_]*)/g))assert.ok(created.has(rel[1]),`${m.metric} reads ${rel[1]} which no migration creates`);
    assert.ok(m.threshold.length>5,m.metric);
  }
});

test('the missing-events gap list is explicit about where each would be emitted',()=>{
  for(const g of MISSING_EVENTS){assert.match(g.event,/^[a-z_ \/]+$/);assert.ok(g.where&&g.why);}
  assert.ok(MISSING_EVENTS.length>=1);
});
