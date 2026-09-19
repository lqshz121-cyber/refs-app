// R14: proof that withHistoricalHead does what MIGRATION-BARRIER-TEST-DESIGN.md specified,
// so the 20 unconverted migrateDownThrough sites now have a working primitive to convert to.
import test, {before} from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import {migrateUp, migrateDown} from '../runtime/migrations.mjs';
import {MIGRATION_MANIFEST} from '../runtime/migration-manifest.mjs';
import {withHistoricalHead, historicalHeadAvailable} from './helpers/historical-head.mjs';

// 181 is the lowest target among the 20 unconverted call sites, so it is the deepest
// historical head the conversion will need and the strongest case to prove.
const DEEPEST='181_wbs_test_large_bank_batch.sql';
let unavailable=null;
before(async()=>{
  if(!historicalHeadAvailable()){unavailable='MIGRATION_DATABASE_URL not set';return;}
  try{const c=new pg.Client({connectionString:process.env.MIGRATION_DATABASE_URL});await c.connect();await c.end();}
  catch(error){unavailable=`POSTGRES NOT RUN: ${error.code||error.name}: ${error.message}`;}
});
const pgTest=(name,fn)=>test(name,async t=>{if(unavailable){t.skip(unavailable);return;}await fn(t);});
const head=async pool=>(await pool.query('SELECT migration_name FROM refs_schema_migration ORDER BY migration_name DESC LIMIT 1')).rows[0]?.migration_name??null;

pgTest('R14-1: withHistoricalHead builds the deepest needed head (181) and steps that migration down and up without crossing a barrier',async()=>{
  await withHistoricalHead(DEEPEST,async({pool})=>{
    assert.equal(await head(pool),DEEPEST,'the fresh database stops exactly at the historical head');
    assert.equal((await pool.query('SELECT count(*)::int n FROM refs_schema_migration')).rows[0].n,
      MIGRATION_MANIFEST.findIndex(m=>m.name===DEEPEST)+1,'nothing after the head is applied');
    // The whole point: the migration under test rounds down and back up, and 401 is never
    // reached because it was never applied on this database.
    await migrateDown(pool);
    assert.notEqual(await head(pool),DEEPEST,'the migration under test came off');
    await migrateUp(pool,{until:DEEPEST});
    assert.equal(await head(pool),DEEPEST,'and went back on');
  });
});

pgTest('R14-2: the temporary database is dropped and the role URLs restored even when the body throws',async()=>{
  const before={...process.env};
  let captured=null;
  await assert.rejects(withHistoricalHead(DEEPEST,async({databaseName})=>{captured=databaseName;throw new Error('deliberate');}),/deliberate/);
  for(const k of ['DATABASE_URL','MIGRATION_DATABASE_URL','CONTEXT_ISSUER_DATABASE_URL','GRANT_SYNC_DATABASE_URL'])
    assert.equal(process.env[k],before[k],`${k} must be restored after a throwing body`);
  const admin=new pg.Client({connectionString:process.env.MIGRATION_DATABASE_URL});await admin.connect();
  const left=(await admin.query('SELECT count(*)::int n FROM pg_database WHERE datname=$1',[captured])).rows[0].n;
  await admin.end();
  assert.equal(left,0,'the throwaway database must not survive a failure');
});

pgTest('R14-3: the shared gate database is untouched by a historical-head run',async()=>{
  const admin=new pg.Client({connectionString:process.env.MIGRATION_DATABASE_URL});await admin.connect();
  const headBefore=(await admin.query('SELECT migration_name FROM refs_schema_migration ORDER BY migration_name DESC LIMIT 1')).rows[0]?.migration_name??null;
  await withHistoricalHead(DEEPEST,async({pool})=>{await migrateDown(pool);});
  const headAfter=(await admin.query('SELECT migration_name FROM refs_schema_migration ORDER BY migration_name DESC LIMIT 1')).rows[0]?.migration_name??null;
  await admin.end();
  assert.equal(headAfter,headBefore,'the live chain must not move');
});

pgTest('R14-4: a malformed or non-manifest target is refused before any database is created',async()=>{
  await assert.rejects(withHistoricalHead('not-a-migration',async()=>{}),/must be a migration file name/);
  await assert.rejects(withHistoricalHead('999_no_such_migration.sql',async()=>{}),e=>e.code==='MIGRATION_UNTIL_UNKNOWN');
});
