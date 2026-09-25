// R13: the backup/restore drill restores into a new _test database and proves it is the same system.
import test,{before} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import pg from 'pg';
import {runtimeConfig} from '../runtime/config.mjs';
import {migrateUp} from '../runtime/migrations.mjs';
import {runDrill,fingerprint,compareFingerprints} from '../runtime/backup-restore-drill.mjs';

const config=runtimeConfig();
let unavailable=null;
before(async()=>{
  try{const p=new pg.Pool({connectionString:config.migrationDatabaseUrl,max:1});try{await p.query('SELECT 1');await migrateUp(p,{});
    const server=Number((await p.query("SELECT current_setting('server_version_num')::int/10000 m")).rows[0].m);
    const client=Number(/(\d+)\.\d+/.exec(execFileSync('pg_dump',['--version'],{encoding:'utf8'}))?.[1]);
    if(client<server)unavailable=`pg_dump ${client} cannot dump a PostgreSQL ${server} server`;
  }finally{await p.end();}}
  catch(error){unavailable=`POSTGRES OR pg_dump NOT AVAILABLE: ${error.code||error.name}: ${error.message}`;if(config.requirePostgres&&!/pg_dump|ENOENT/.test(unavailable))throw error;}
});
const pgTest=(name,fn)=>test(name,async t=>{if(unavailable){t.skip(unavailable);return;}await fn(t);});

pgTest('R13-1: a restored copy carries the same ledger, functions, triggers, policies, grants, constraints and rows, and needs no migration',async()=>{
  const admin=new pg.Client({connectionString:config.migrationDatabaseUrl});await admin.connect();
  try{await admin.query("INSERT INTO tenant(tenant_id,tenant_code,name) VALUES(gen_random_uuid(),'R13DRILL','drill row')");}finally{await admin.end();}
  const result=await runDrill();
  assert.deepEqual(result.differences,[]);
  assert.deepEqual(result.migrations_applied_on_restore,[]);
  assert.equal(result.ok,true);
  assert.ok(result.total_rows>=1&&result.table_count>200);
  assert.equal(result.ledger.head,(await import('../runtime/migration-manifest.mjs')).MIGRATION_MANIFEST.at(-1).name);
});

pgTest('R13-2: the comparison notices a single changed row and a dropped trigger',async()=>{
  const base=await fingerprint(config.migrationDatabaseUrl);
  const rowChanged=structuredClone(base);rowChanged.data.tenant={...rowChanged.data.tenant,sha256:'0'.repeat(64)};
  assert.deepEqual(compareFingerprints(base,rowChanged).map(d=>d.kind),['data.tenant']);
  const triggerDropped=structuredClone(base);triggerDropped.structure.triggers={rows:base.structure.triggers.rows-1,sha256:'1'.repeat(64)};
  assert.deepEqual(compareFingerprints(base,triggerDropped).map(d=>d.kind),['structure.triggers']);
});
