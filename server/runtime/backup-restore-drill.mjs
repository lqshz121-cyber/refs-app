// R13: backup / restore drill.
//
// Dumps a source database with pg_dump (custom format, read-only on the source), restores it into a
// NEW database whose name ends in _test, and proves the restore is the same accounting system:
//   - the migration ledger hash (the value verify-staging-release-pack reads) is identical;
//   - every public function, trigger, RLS policy and table/column grant is identical;
//   - every public table has the same row count and the same content hash;
//   - migrateUp on the restored copy has nothing to apply (no drift, no ledger-ahead).
// The source is never written. The target must not exist beforehand and is dropped at the end unless
// --keep is given, so the drill cannot overwrite a live database.
//
//   node runtime/backup-restore-drill.mjs [--keep] [--out drill.json]
// Uses MIGRATION_DATABASE_URL as the source. pg_dump / pg_restore must be on PATH at the source's major.
import {execFileSync} from 'node:child_process';
import {mkdtempSync,rmSync,writeFileSync,statSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import pg from 'pg';
import {LEDGER_HASH_SQL} from './verify-staging-release-pack.mjs';
import {LIVE_CATALOG_SQL} from './export-function-catalog.mjs';

const withDatabase=(url,name)=>{const u=new URL(url);u.pathname=`/${name}`;return u.toString();};
const dbName=url=>decodeURIComponent(new URL(url).pathname.slice(1));
const q=(ident)=>`"${ident.replace(/"/g,'""')}"`;

const STRUCTURE_SQL={
  functions:LIVE_CATALOG_SQL,
  triggers:`SELECT c.relname,t.tgname,pg_get_triggerdef(t.oid) def FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
    JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND NOT t.tgisinternal ORDER BY 1,2`,
  policies:`SELECT tablename,policyname,permissive,roles::text,cmd,qual,with_check FROM pg_policies WHERE schemaname='public' ORDER BY 1,2`,
  table_grants:`SELECT table_name,grantee,privilege_type FROM information_schema.role_table_grants WHERE table_schema='public' ORDER BY 1,2,3`,
  function_grants:`SELECT p.oid::regprocedure::text sig,coalesce(p.proacl::text,'') acl FROM pg_proc p WHERE p.pronamespace='public'::regnamespace ORDER BY 1`,
  rls:`SELECT relname,relrowsecurity,relforcerowsecurity FROM pg_class WHERE relnamespace='public'::regnamespace AND relkind='r' ORDER BY 1`,
  // pg_restore re-parses CHECK expressions and PostgreSQL re-deparses nested ANDs with fewer
  // parentheses (((a AND b) AND c) comes back as (a AND b AND c)); compare without parentheses, plus
  // the validated flag and the constraint type, which are what a restore could actually lose.
  constraints:`SELECT conrelid::regclass::text rel,conname,contype,convalidated,regexp_replace(pg_get_constraintdef(oid),'[()]','','g') def FROM pg_constraint WHERE connamespace='public'::regnamespace ORDER BY 1,2`,
};

async function hashRows(client,sql){
  const r=(await client.query(`SELECT count(*)::int n,encode(sha256(convert_to(coalesce(string_agg(x::text,E'\\n' ORDER BY x::text),''),'UTF8')),'hex') h FROM (${sql}) x`)).rows[0];
  return {rows:r.n,sha256:r.h};
}

export async function fingerprint(url){
  const client=new pg.Client({connectionString:url});await client.connect();
  try{
    await client.query("SET statement_timeout='0'");
    const ledger=(await client.query(LEDGER_HASH_SQL)).rows[0];
    const structure={};for(const [k,sql] of Object.entries(STRUCTURE_SQL))structure[k]=await hashRows(client,sql);
    const tables=(await client.query("SELECT relname FROM pg_class WHERE relnamespace='public'::regnamespace AND relkind IN ('r','p') ORDER BY 1")).rows.map(r=>r.relname);
    const data={};
    for(const t of tables)data[t]=await hashRows(client,`SELECT * FROM public.${q(t)}`);
    return {database:dbName(url),server_version:(await client.query('SHOW server_version')).rows[0].server_version,ledger,structure,table_count:tables.length,
      total_rows:Object.values(data).reduce((s,v)=>s+v.rows,0),data};
  }finally{await client.end();}
}

export function compareFingerprints(a,b){
  const diffs=[];
  if(JSON.stringify(a.ledger)!==JSON.stringify(b.ledger))diffs.push({kind:'ledger',source:a.ledger,restored:b.ledger});
  for(const k of Object.keys(a.structure))if(JSON.stringify(a.structure[k])!==JSON.stringify(b.structure[k]))diffs.push({kind:`structure.${k}`,source:a.structure[k],restored:b.structure[k]});
  for(const t of new Set([...Object.keys(a.data),...Object.keys(b.data)]))if(JSON.stringify(a.data[t])!==JSON.stringify(b.data[t]))diffs.push({kind:`data.${t}`,source:a.data[t]??null,restored:b.data[t]??null});
  return diffs;
}

export async function runDrill({env=process.env,keep=false}={}){
  const source=env.MIGRATION_DATABASE_URL;
  if(!source)throw new Error('MIGRATION_DATABASE_URL (the source) is required');
  const target=`${dbName(source).slice(0,40)}_restore_${Date.now().toString(36)}_test`;
  if(!/^[a-z_][a-z0-9_]{0,62}$/.test(target))throw new Error(`unsafe restore database name ${target}`);
  const admin=new pg.Client({connectionString:withDatabase(source,'postgres')});await admin.connect();
  const dir=mkdtempSync(join(tmpdir(),'refs-drill-'));const file=join(dir,'source.dump');
  const timings={};let created=false;
  try{
    if((await admin.query('SELECT 1 FROM pg_database WHERE datname=$1',[target])).rowCount)throw new Error(`restore target ${target} already exists; refusing`);
    let t=Date.now();const before=await fingerprint(source);timings.fingerprint_source_ms=Date.now()-t;
    t=Date.now();execFileSync('pg_dump',['--format=custom','--no-password','--file',file,source],{stdio:['ignore','ignore','pipe']});timings.dump_ms=Date.now()-t;
    const dumpBytes=statSync(file).size;
    await admin.query(`CREATE DATABASE ${q(target)}`);created=true;
    t=Date.now();execFileSync('pg_restore',['--exit-on-error','--no-password','--dbname',withDatabase(source,target),file],{stdio:['ignore','ignore','pipe']});timings.restore_ms=Date.now()-t;
    t=Date.now();const after=await fingerprint(withDatabase(source,target));timings.fingerprint_restore_ms=Date.now()-t;
    const diffs=compareFingerprints(before,after);
    // Nothing left to apply: the restored ledger is the source ledger and the files agree with it.
    const {migrateUp}=await import('./migrations.mjs');
    const saved={...env};const keys=['DATABASE_URL','MIGRATION_DATABASE_URL','CONTEXT_ISSUER_DATABASE_URL','GRANT_SYNC_DATABASE_URL'];
    const events=[];
    for(const k of keys)if(env[k])env[k]=withDatabase(env[k],target);
    const pool=new pg.Pool({connectionString:withDatabase(source,target),max:1});pool.on('error',()=>{});
    try{await migrateUp(pool,{onEvent:e=>events.push(e)});}finally{await pool.end();for(const k of keys){if(saved[k]===undefined)delete env[k];else env[k]=saved[k];}}
    const applied=events.filter(e=>e.event==='migration_completed').map(e=>e.migration_name);
    return {schema_version:'REFS_BACKUP_RESTORE_DRILL_V1',ok:diffs.length===0&&applied.length===0,source:before.database,restored:target,server_version:before.server_version,
      dump_bytes:dumpBytes,timings,ledger:before.ledger,table_count:before.table_count,total_rows:before.total_rows,structure:before.structure,
      differences:diffs,migrations_applied_on_restore:applied,kept:keep};
  }finally{
    rmSync(dir,{recursive:true,force:true});
    if(created&&!keep)await admin.query(`DROP DATABASE IF EXISTS ${q(target)} WITH (FORCE)`).catch(()=>{});
    await admin.end().catch(()=>{});
  }
}

if(import.meta.url===pathToFileURL(process.argv[1]||'').href){
  const args=process.argv.slice(2);const outIndex=args.indexOf('--out');
  runDrill({keep:args.includes('--keep')}).then(result=>{
    const text=JSON.stringify(result,null,2);
    if(outIndex>=0)writeFileSync(args[outIndex+1],text+'\n');
    console.log(JSON.stringify({event:'backup_restore_drill',ok:result.ok,source:result.source,tables:result.table_count,rows:result.total_rows,differences:result.differences.length,timings:result.timings}));
    process.exit(result.ok?0:1);
  }).catch(error=>{console.error(JSON.stringify({event:'backup_restore_drill_failed',message:error.message}));process.exit(2);});
}
