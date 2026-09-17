// S24 — Docker-free logical restore drill.
//
// `test-backup-restore-drill.mjs` proves a `pg_dump -Fc` / `pg_restore` round
// trip, but it needs Docker and it only asserts two facts about the restored
// database: the migration row count and one seeded tenant. That leaves the
// questions an actual recovery turns on unanswered:
//
//   - does the restored migration ledger still match the manifest byte for
//     byte, or only in cardinality?
//   - does `db:up` on the release SHA become a no-op after the restore
//     (forward fix), rather than re-running DDL?
//   - does a ledger that was restored *wrong* fail closed, or does the runner
//     happily serve a database it cannot account for?
//   - are attachment payloads inside the database at all? If they are not, a
//     database-only backup is by definition incomplete and the object store
//     has to be captured at the same timestamp.
//
// This drill answers those against any PostgreSQL 16 reachable through
// MIGRATION_DATABASE_URL — the embedded server used by the kernel gate is
// enough, no container runtime required. It mutates only `refs_schema_migration`,
// always inside a transaction it can restore from its own logical export, and
// refuses to run against a database whose name does not end in `_test`.
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {MIGRATION_MANIFEST} from './migration-manifest.mjs';
import {createPool,KernelError} from './db.mjs';
import {runtimeConfig} from './config.mjs';

const LEDGER='refs_schema_migration';

export function ledgerDigest(rows){
  const hash=createHash('sha256');
  for(const {migration_name,checksum} of [...rows].sort((a,b)=>a.migration_name<b.migration_name?-1:a.migration_name>b.migration_name?1:0)){
    hash.update(`${migration_name}\t${checksum}\n`);
  }
  return hash.digest('hex');
}

export function manifestDigest(manifest=MIGRATION_MANIFEST){
  return ledgerDigest(manifest.map(({name,up})=>({migration_name:name,checksum:up})));
}

// A logical export of the ledger: the rows a restore has to reproduce exactly.
// Kept as plain JSON rather than COPY text so the same export can be diffed,
// archived next to the dump, and re-imported by any client.
export function serializeLedger(rows){
  return JSON.stringify(rows.map(({migration_name,checksum})=>({migration_name,checksum})),null,0);
}

async function ledgerRows(client){
  return (await client.query(`SELECT migration_name,checksum FROM ${LEDGER} ORDER BY migration_name`)).rows;
}

async function restoreLedger(client,exported){
  const rows=JSON.parse(exported);
  await client.query('BEGIN');
  try{
    await client.query(`DELETE FROM ${LEDGER}`);
    for(const {migration_name,checksum} of rows){
      await client.query(`INSERT INTO ${LEDGER}(migration_name,checksum) VALUES ($1,$2)`,[migration_name,checksum]);
    }
    await client.query('COMMIT');
  }catch(error){await client.query('ROLLBACK');throw error;}
  return rows.length;
}

// Attachment bytes must never live in the database: if they did, a database
// backup would look complete while the object store drifted silently.
// Binary columns elsewhere are not a failure — 417's cursor signing key is a
// legitimate one — but they are reported, because they make the dump itself a
// secret-bearing artifact that has to be encrypted and rotated.
async function objectStoragePolicy(client){
  const binary=(await client.query(`
    SELECT c.relname AS table_name,a.attname AS column_name,format_type(a.atttypid,a.atttypmod) AS data_type
      FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace
     WHERE n.nspname='public' AND c.relkind='r' AND a.attnum>0 AND NOT a.attisdropped
       AND a.atttypid IN ('bytea'::regtype,'oid'::regtype)
     ORDER BY 1,2`)).rows;
  const documentBinary=binary.filter(({table_name})=>/attachment|document|source_document/.test(table_name));
  const largeObjects=Number((await client.query('SELECT count(*)::text AS count FROM pg_largeobject_metadata')).rows[0].count);
  const reference=(await client.query(`
    SELECT a.attname AS column_name,a.attnotnull
      FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace
     WHERE n.nspname='public' AND c.relname='attachment' AND a.attname IN ('storage_ref','storage_version') AND NOT a.attisdropped`)).rows;
  const constraints=(await client.query(`
    SELECT conname,pg_get_constraintdef(oid) AS definition
      FROM pg_constraint
     WHERE conrelid='public.attachment'::regclass AND contype IN ('c','u')`)).rows;
  return {
    documentBinaryColumns:documentBinary,
    // Advisory, not a failure: these make the dump a secret-bearing artifact.
    otherBinaryColumns:binary.filter(row=>!documentBinary.includes(row)),
    largeObjects,
    storageColumns:reference.map(({column_name,attnotnull})=>({column:column_name,notNull:attnotnull})),
    storageRefConstrained:constraints.some(({definition})=>/storage_ref\s*~/.test(definition)&&/:\/\//.test(definition)),
    storageVersionUnique:constraints.some(({definition})=>/UNIQUE/.test(definition)&&/storage_version/.test(definition)),
  };
}

export async function runLogicalRestoreDrill({env=process.env,poolFactory=createPool,runUp}={}){
  const migrationUrl=runtimeConfig(env).migrationDatabaseUrl;
  if(!migrationUrl)throw new KernelError('MIGRATION_URL_REQUIRED','MIGRATION_DATABASE_URL is required for the logical restore drill');
  const pool=await poolFactory({databaseUrl:migrationUrl,applicationName:'refs-logical-restore-drill',max:1});
  const client=await pool.connect();
  const checks=[];
  const record=(name,pass,detail)=>{checks.push({name,pass:Boolean(pass),detail});return Boolean(pass);};
  let exported=null;
  try{
    const database=(await client.query('SELECT current_database() AS name')).rows[0].name;
    if(!String(database).endsWith('_test')){
      throw new KernelError('DRILL_DATABASE_FORBIDDEN',`Logical restore drill refuses to mutate ${database}: it rewrites ${LEDGER} and is only allowed on a _test database`);
    }

    // 1. baseline — the ledger has to equal the manifest, not merely count the same.
    const baseline=await ledgerRows(client);
    const baselineDigest=ledgerDigest(baseline);
    const expectedDigest=manifestDigest();
    record('ledger_count_matches_manifest',baseline.length===MIGRATION_MANIFEST.length,{ledger:baseline.length,manifest:MIGRATION_MANIFEST.length});
    record('ledger_digest_matches_manifest',baselineDigest===expectedDigest,{ledgerDigest:baselineDigest,manifestDigest:expectedDigest});

    // 2. logical export — the artifact a restore is judged against.
    exported=serializeLedger(baseline);
    record('ledger_export_non_empty',exported.length>2,{bytes:exported.length});

    // 3. object storage policy — a database backup alone is not a full backup.
    const policy=await objectStoragePolicy(client);
    record('no_document_payload_in_database',policy.documentBinaryColumns.length===0&&policy.largeObjects===0,{documentBinaryColumns:policy.documentBinaryColumns,largeObjects:policy.largeObjects,otherBinaryColumns:policy.otherBinaryColumns});
    record('attachment_storage_metadata_present',policy.storageColumns.length===2&&policy.storageColumns.every(({notNull})=>notNull),policy.storageColumns);
    record('attachment_storage_ref_constrained',policy.storageRefConstrained&&policy.storageVersionUnique,{storageRefConstrained:policy.storageRefConstrained,storageVersionUnique:policy.storageVersionUnique});

    // 4. restore the exported ledger over itself — a restore must be byte-exact.
    const restoredCount=await restoreLedger(client,exported);
    const restoredDigest=ledgerDigest(await ledgerRows(client));
    record('restored_ledger_is_byte_exact',restoredCount===baseline.length&&restoredDigest===baselineDigest,{restoredCount,restoredDigest});

    // 5. forward fix — `db:up` after a good restore must be a complete no-op.
    if(runUp){
      const after=await runUp();
      record('post_restore_up_is_noop',after.exitCode===0&&after.completed===0&&after.skipped===MIGRATION_MANIFEST.length,after);
    }else{
      record('post_restore_up_is_noop',false,{skipped:'runUp not supplied — forward fix not exercised'});
    }

    // 6. a wrong restore must fail closed, not serve an unaccountable schema.
    const victim=baseline[baseline.length-1];
    await client.query(`UPDATE ${LEDGER} SET checksum=$2 WHERE migration_name=$1`,[victim.migration_name,'0'.repeat(64)]);
    if(runUp){
      const tampered=await runUp();
      record('tampered_ledger_fails_closed',tampered.exitCode!==0&&tampered.code==='MIGRATION_CHECKSUM_MISMATCH',{migration:victim.migration_name,...tampered});
    }else{
      record('tampered_ledger_fails_closed',false,{skipped:'runUp not supplied'});
    }

    // 7. a ledger row lost in restore must also fail closed rather than re-run DDL.
    await restoreLedger(client,exported);
    await client.query(`DELETE FROM ${LEDGER} WHERE migration_name=$1`,[victim.migration_name]);
    if(runUp){
      const missing=await runUp();
      record('missing_ledger_row_fails_closed',missing.exitCode!==0,{migration:victim.migration_name,...missing});
    }else{
      record('missing_ledger_row_fails_closed',false,{skipped:'runUp not supplied'});
    }

    // 8. the drill leaves the database exactly as it found it.
    await restoreLedger(client,exported);
    const finalDigest=ledgerDigest(await ledgerRows(client));
    record('drill_leaves_ledger_unchanged',finalDigest===baselineDigest,{finalDigest});

    return {schema:'REFS_LOGICAL_RESTORE_DRILL_V1',database,migrationCount:MIGRATION_MANIFEST.length,ledgerDigest:baselineDigest,checks,pass:checks.every(({pass})=>pass)};
  }finally{
    // Never leave a mutated ledger behind, even on an unexpected throw.
    if(exported){try{await restoreLedger(client,exported);}catch{}}
    client.release();
    await pool.end();
  }
}

if(import.meta.url===pathToFileURL(process.argv[1]||'').href){
  const {spawn}=await import('node:child_process');
  const {fileURLToPath}=await import('node:url');
  const {dirname,resolve}=await import('node:path');
  const serverRoot=resolve(dirname(fileURLToPath(import.meta.url)),'..');
  const runUp=()=>new Promise(resolvePromise=>{
    const child=spawn(process.execPath,['runtime/migrate.mjs','up'],{cwd:serverRoot,env:process.env,stdio:['ignore','pipe','pipe']});
    let out='';
    child.stdout.on('data',chunk=>{out+=chunk;});
    child.stderr.on('data',chunk=>{out+=chunk;});
    child.once('exit',code=>{
      const events=out.split('\n').filter(Boolean).map(line=>{try{return JSON.parse(line);}catch{return null;}}).filter(Boolean);
      resolvePromise({
        exitCode:code??1,
        completed:events.filter(event=>event.event==='migration_completed').length,
        skipped:events.filter(event=>event.event==='migration_skipped').length,
        code:events.find(event=>event.event==='migration_runner_failed')?.code??null,
      });
    });
  });
  runLogicalRestoreDrill({runUp}).then(result=>{
    console.log(JSON.stringify(result,null,2));
    if(!result.pass)process.exitCode=1;
  }).catch(error=>{
    console.error(JSON.stringify({event:'logical_restore_drill_failed',code:error?.code??'DRILL_FAILED',message:error?.message}));
    process.exitCode=1;
  });
}
