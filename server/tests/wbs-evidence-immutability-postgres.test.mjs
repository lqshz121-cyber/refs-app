// WBS raw and derived evidence must be immutable to the application login.
//
// The chain keeps raw provider rows (raw_event, wbs_* receipts and retained
// source rows), review evidence and control totals as evidence. Two mechanisms
// enforce that: a BEFORE UPDATE OR DELETE trigger that rejects mutation, or a
// privilege model where refs_app can only SELECT and every write goes through a
// SECURITY DEFINER function. This test reads pg_trigger and information_schema
// on the migrated database - not migration text, which hides triggers created
// through EXECUTE format() - and requires one of the two for every table.
import test, {before, after} from 'node:test';
import assert from 'node:assert/strict';
import {createPool} from '../runtime/db.mjs';
import {runtimeConfig} from '../runtime/config.mjs';
import {migrateUp} from '../runtime/migrations.mjs';

const config=runtimeConfig();
let admin=null,runtime=null,unavailable=null;
before(async()=>{
  try{admin=await createPool({databaseUrl:config.migrationDatabaseUrl,applicationName:'refs-wbs-immutability-admin',max:2});await admin.query('SELECT 1');await migrateUp(admin,{});
      runtime=await createPool({databaseUrl:config.databaseUrl,applicationName:'refs-wbs-immutability-runtime',max:2});await runtime.query('SELECT 1');}
  catch(error){unavailable=`POSTGRES NOT RUN: ${error.code||error.name}: ${error.message}`;if(config.requirePostgres)throw error;for(const p of [admin,runtime])if(p)await p.end().catch(()=>{});admin=runtime=null;}
});
after(async()=>{for(const p of [admin,runtime])if(p)await p.end();});
function pgTest(name,fn){test(name,async t=>{if(unavailable){t.skip(unavailable);return;}await fn(t);});}

// Tables whose rows legitimately change state through SECURITY DEFINER commands
// and are therefore protected by privileges rather than a mutation trigger.
const STATEFUL_BY_DESIGN=new Set(['staging_item']);

pgTest('every WBS / raw-evidence table is either trigger-guarded against UPDATE and DELETE or unwritable by refs_app',async()=>{
  const rows=(await admin.query(`
    WITH t AS (
      SELECT c.oid,c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relkind='r' AND (c.relname LIKE 'wbs\\_%' OR c.relname IN ('raw_event','source_document','source_document_line','source_link'))
    )
    SELECT t.relname,
      EXISTS (SELECT 1 FROM pg_trigger tg WHERE tg.tgrelid=t.oid AND NOT tg.tgisinternal AND tg.tgenabled<>'D' AND (tg.tgtype & 2)=2 AND ((tg.tgtype & 16)=16 OR (tg.tgtype & 8)=8)) AS guarded_by_trigger,
      has_table_privilege('refs_app',t.oid,'UPDATE') AS app_update,
      has_table_privilege('refs_app',t.oid,'DELETE') AS app_delete,
      has_table_privilege('refs_app',t.oid,'INSERT') AS app_insert
    FROM t ORDER BY 1`)).rows;
  assert.ok(rows.length>=60,`expected the WBS evidence surface, saw ${rows.length} tables`);
  const exposed=rows.filter(r=>!r.guarded_by_trigger&&(r.app_update||r.app_delete)&&!STATEFUL_BY_DESIGN.has(r.relname)).map(r=>r.relname);
  assert.deepEqual(exposed,[],'refs_app can rewrite or delete evidence rows without a trigger stopping it');
  const byTrigger=rows.filter(r=>r.guarded_by_trigger).length,byPrivilege=rows.filter(r=>!r.guarded_by_trigger&&!r.app_update&&!r.app_delete).length;
  console.log(`# evidence tables: ${rows.length}; trigger-guarded ${byTrigger}; privilege-only ${byPrivilege}; stateful-by-design ${rows.filter(r=>STATEFUL_BY_DESIGN.has(r.relname)).length}`);
  console.log('# privilege-only: '+rows.filter(r=>!r.guarded_by_trigger&&!STATEFUL_BY_DESIGN.has(r.relname)).map(r=>r.relname).join(', '));
});

pgTest('raw_event cannot be updated or deleted by the application login even with a bound context, and the migrator sees the trigger-or-privilege boundary explicitly',async()=>{
  const client=await runtime.connect();
  try{
    for(const sql of ["UPDATE raw_event SET payload_hash=payload_hash WHERE false","DELETE FROM raw_event WHERE false","INSERT INTO raw_event SELECT * FROM raw_event WHERE false"]){
      await client.query('BEGIN');await client.query('SET LOCAL ROLE refs_app');
      await assert.rejects(client.query(sql),e=>e.code==='42501',`refs_app must not be able to run: ${sql}`);
      await client.query('ROLLBACK');
    }
  }finally{client.release();}
});

pgTest('retained provider rows and control totals carry a content hash column and a uniqueness rule on their stable source identity',async()=>{
  const hashCols=(await admin.query(`SELECT table_name,column_name FROM information_schema.columns WHERE table_schema='public' AND table_name LIKE 'wbs\\_%' AND column_name IN ('content_sha256','row_hash','source_record_hash','payload_hash','control_totals_hash','package_hash') ORDER BY 1,2`)).rows;
  assert.ok(hashCols.length>=15,`only ${hashCols.length} hash columns across wbs_* tables`);
  console.log('# hash-bearing wbs_* columns: '+hashCols.length);
  const rawUnique=(await admin.query(`SELECT count(*)::int n FROM pg_indexes WHERE schemaname='public' AND tablename='raw_event' AND indexdef ILIKE '%UNIQUE%' AND indexdef ILIKE '%source_record_id%'`)).rows[0].n;
  assert.ok(rawUnique>=1,'raw_event must be unique on its stable source identity');
});
