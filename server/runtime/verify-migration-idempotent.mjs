// R05: prove that `db:up` on an already migrated database changes nothing.
//
// Run AFTER `npm run db:up`. It runs the real migration entry point a second time and requires:
//   - every manifest migration reports `migration_skipped` (none `migration_completed`);
//   - the ledger row count and head are unchanged and the head is the manifest head;
//   - no `migration_failed` / `migration_ledger_ahead` event.
// Anything else exits 1 with a JSON explanation. This is the CI-side check behind the release
// rule "a redeploy of the same build must be a no-op on the database".
import {runMigrations} from './migrate.mjs';
import {MIGRATION_MANIFEST} from './migration-manifest.mjs';
import {runtimeConfig} from './config.mjs';
import {createPool} from './db.mjs';

export async function verifyMigrationIdempotent({env=process.env,run=runMigrations}={}){
  const url=runtimeConfig(env).migrationDatabaseUrl;
  const pool=await createPool({databaseUrl:url,applicationName:'refs-verify-idempotent',max:1});
  const ledger=async()=>(await pool.query('SELECT count(*)::int AS rows, max(migration_name) AS head FROM refs_schema_migration')).rows[0];
  try{
    const before=await ledger();
    const events=[];
    await run('up',{env,onEvent:e=>events.push(e)});
    const after=await ledger();
    const completed=events.filter(e=>e.event==='migration_completed').map(e=>e.migration_name);
    const skipped=events.filter(e=>e.event==='migration_skipped').length;
    const bad=events.filter(e=>['migration_failed','migration_ledger_ahead'].includes(e.event));
    const manifestHead=MIGRATION_MANIFEST[MIGRATION_MANIFEST.length-1].name;
    const problems=[];
    if(completed.length)problems.push(`second db:up applied ${completed.length} migration(s): ${completed.join(', ')}`);
    if(skipped!==MIGRATION_MANIFEST.length)problems.push(`expected ${MIGRATION_MANIFEST.length} skipped, saw ${skipped}`);
    if(bad.length)problems.push(`failure events: ${bad.map(e=>e.event).join(', ')}`);
    if(before.rows!==after.rows||before.head!==after.head)problems.push(`ledger moved: ${before.rows}/${before.head} -> ${after.rows}/${after.head}`);
    if(after.head!==manifestHead)problems.push(`ledger head ${after.head} is not the manifest head ${manifestHead}`);
    if(after.rows!==MIGRATION_MANIFEST.length)problems.push(`ledger has ${after.rows} rows, manifest has ${MIGRATION_MANIFEST.length}`);
    return {ok:problems.length===0,problems,ledger:after,manifest:{count:MIGRATION_MANIFEST.length,head:manifestHead},skipped,completed:completed.length};
  }finally{await pool.end();}
}

if(import.meta.url===`file://${process.argv[1]}`){
  verifyMigrationIdempotent().then(result=>{
    console.log(JSON.stringify({event:'migration_idempotency_verified',...result}));
    process.exit(result.ok?0:1);
  }).catch(error=>{console.error(JSON.stringify({event:'migration_idempotency_error',message:error.message,code:error.code||null}));process.exit(2);});
}
