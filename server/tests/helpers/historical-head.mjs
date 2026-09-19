// S18 / R14: build a historical schema head on a throwaway _test database so a test can
// exercise one migration's down/up without walking the live chain backwards through a
// barrier.
//
// Why this exists: postgres-kernel.test.mjs has 20 `migrateDownThrough(adminPool,'<NNN>')`
// call sites with targets 181..333. Stepping the shared gate database down from the
// release head to any of those crosses down/401, whose RAISE is unconditional, plus
// several conditional barriers (55006). Those sites therefore fail before reaching the
// migration they mean to test. MIGRATION-BARRIER-TEST-DESIGN.md decided not to weaken the
// barriers and not to add migrateDown({force}); the sanctioned route is this helper.
// The runner primitive `migrateUp(pool,{until})` was implemented and proven by
// tests/migration-historical-head-postgres.test.mjs; this file is the missing wrapper the
// design doc specified but that had no implementation and zero call sites.
//
// Guarantees:
//   - the shared gate database is never touched;
//   - the temporary database is always dropped, even when the body throws;
//   - the four role URLs are restored, even when the body throws, because runtimeConfig
//     insists all four target the same database;
//   - no barrier is crossed, because the head is built forwards and only the migration
//     under test is stepped down.
import pg from 'pg';
import {migrateUp} from '../../runtime/migrations.mjs';

const URL_KEYS=['DATABASE_URL','MIGRATION_DATABASE_URL','CONTEXT_ISSUER_DATABASE_URL','GRANT_SYNC_DATABASE_URL'];

export function historicalHeadAvailable(env=process.env){
  return Boolean(env.MIGRATION_DATABASE_URL);
}

// withHistoricalHead(until, body) -> body({pool, url, databaseName})
export async function withHistoricalHead(until,body,{env=process.env}={}){
  const baseUrl=env.MIGRATION_DATABASE_URL;
  if(!baseUrl)throw new Error('withHistoricalHead requires MIGRATION_DATABASE_URL');
  if(typeof until!=='string'||!/^\d{3}_[a-z0-9_]+\.sql$/.test(until))throw new Error(`withHistoricalHead: until must be a migration file name, got ${until}`);

  const saved=Object.fromEntries(URL_KEYS.map(k=>[k,env[k]]));
  const databaseName=`refs_hist_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,8)}_test`;
  const admin=new pg.Client({connectionString:baseUrl});
  let pool=null;
  await admin.connect();
  try{
    await admin.query(`CREATE DATABASE ${databaseName}`);
    const target=new URL(baseUrl);target.pathname=`/${databaseName}`;
    const url=target.toString();
    // runtimeConfig refuses a mixed-database URL set, so all four move together.
    for(const key of URL_KEYS){
      if(!saved[key])continue;
      const u=new URL(saved[key]);u.pathname=`/${databaseName}`;env[key]=u.toString();
    }
    pool=new pg.Pool({connectionString:url,max:2});
    await migrateUp(pool,{until});
    return await body({pool,url,databaseName});
  }finally{
    if(pool)await pool.end().catch(()=>{});
    for(const key of URL_KEYS){
      if(saved[key]===undefined)delete env[key];
      else env[key]=saved[key];
    }
    await admin.query(`DROP DATABASE IF EXISTS ${databaseName} WITH (FORCE)`).catch(()=>{});
    await admin.end().catch(()=>{});
  }
}
