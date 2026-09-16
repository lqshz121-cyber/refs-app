import {createHash} from 'node:crypto';
import {readdir,readFile} from 'node:fs/promises';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {databaseName,runtimeConfig} from './config.mjs';
import {KernelError,withTransaction} from './db.mjs';
import {MIGRATION_MANIFEST} from './migration-manifest.mjs';
import {emitMigrationEvent,observeMigration} from './migration-observability.mjs';

const here=dirname(fileURLToPath(import.meta.url));
const migrationRoot=resolve(here,'..','db','migrations');
const downRoot=join(migrationRoot,'down');
const lockKey=728346219;

async function acquireMigrationLock(client){
  const prior=(await client.query("SELECT current_setting('statement_timeout') AS statement_timeout,current_setting('lock_timeout') AS lock_timeout")).rows[0];
  let locked=false;
  try{
    // Pool-level statement/lock timeouts protect ordinary SQL, but a runner
    // waiting behind another full down/up pass must not abort mid-reset.
    await client.query("SELECT set_config('statement_timeout','0',false),set_config('lock_timeout','0',false)");
    await client.query('SELECT pg_advisory_lock($1)',[lockKey]);
    locked=true;
  }finally{
    await client.query("SELECT set_config('statement_timeout',$1,false),set_config('lock_timeout',$2,false)",[prior.statement_timeout,prior.lock_timeout]);
  }
  return locked;
}

// A down migration is an irreversibility barrier when a DO block raises
// unconditionally - a RAISE EXCEPTION that sits at IF/CASE depth zero, so it
// fires on an empty database too. 401_native_settlement_bank_account_control
// is the canonical case: it protects migration 305 as retained historical
// evidence. Forty-odd down files carry such a barrier by design.
//
// Only DO blocks are inspected. A down body that restores an old function
// definition legitimately contains RAISE statements inside that function, and
// those are not refusals. String literals and comments are stripped first so a
// message text cannot open or close a block, and DDL "IF [NOT] EXISTS" is not
// a PL/pgSQL IF.
export function downMigrationRefusesUnconditionally(sql){
  const blocks=[...String(sql).matchAll(/\bDO\s+(\$[A-Za-z_]*\$)([\s\S]*?)\1/g)];
  for(const [,,rawBody] of blocks){
    const body=rawBody
      .replace(/--[^\n]*/g,' ')
      .replace(/\/\*[\s\S]*?\*\//g,' ')
      .replace(/'(?:[^']|'')*'/g,"''")
      .replace(/\b(?:DROP|CREATE|ALTER)\b[^;]*?\bIF\s+(?:NOT\s+)?EXISTS\b/gi,m=>m.replace(/\bIF\b/i,'__'));
    let depth=0;
    for(const token of body.matchAll(/\bEND\s+IF\b|\bEND\s+CASE\b|\bELSIF\b|\bIF\b|\bCASE\b|\bRAISE\s+EXCEPTION\b/gi)){
      const t=token[0].toUpperCase().replace(/\s+/g,' ');
      if(t==='END IF'||t==='END CASE')depth=Math.max(0,depth-1);
      else if(t==='IF'||t==='CASE')depth+=1;
      else if(t==='RAISE EXCEPTION'&&depth===0)return true;
    }
  }
  return false;
}

function bodyWithoutOuterTransaction(sql){
  return sql.replace(/^\s*BEGIN;\s*/i,'').replace(/\s*COMMIT;\s*$/i,'').trim();
}

async function filesAt(root){
  return (await readdir(root,{withFileTypes:true}))
    .filter(entry=>entry.isFile()&&/^\d+_.+\.sql$/.test(entry.name))
    .map(entry=>entry.name).sort();
}

async function migrationFile(root,name){
  const raw=await readFile(join(root,name),'utf8');
  const sql=raw.replace(/\r\n/g,'\n');
  return {name,sql:bodyWithoutOuterTransaction(sql),checksum:createHash('sha256').update(sql).digest('hex')};
}

function assertManifest(files){
  const expected=MIGRATION_MANIFEST.map(item=>item.name);
  if(JSON.stringify(files)!==JSON.stringify(expected))throw new KernelError('MIGRATION_MANIFEST_MISMATCH','Migration files do not match the fixed manifest',{files,expected});
}

function assertChecksum(migration,direction){
  const manifest=MIGRATION_MANIFEST.find(item=>item.name===migration.name);
  if(!manifest||manifest[direction]!==migration.checksum)throw new KernelError('MIGRATION_CHECKSUM_MISMATCH',`${direction} checksum mismatch: ${migration.name}`);
}

async function ensureMetadata(pool){
  await pool.query(`CREATE TABLE IF NOT EXISTS refs_schema_migration (
    migration_name text PRIMARY KEY,
    checksum char(64) NOT NULL,
    applied_at timestamptz NOT NULL DEFAULT now()
  )`);
}

async function assertMigrationConnection(client,{destructive=false}={}){
  const config=runtimeConfig();
  const expectedUser=decodeURIComponent(new URL(config.migrationDatabaseUrl).username);
  const expectedDatabase=databaseName(config.migrationDatabaseUrl);
  const identity=(await client.query('SELECT current_database() AS database_name, current_user AS current_user, session_user AS session_user')).rows[0];
  const forbidden=new Set(['refs_runtime','refs_context_issuer','refs_app']);
  if(!identity||identity.current_user!==expectedUser||identity.session_user!==expectedUser||forbidden.has(identity.current_user)){
    throw new KernelError('MIGRATION_IDENTITY_REJECTED','Migrations require the configured, isolated migrator login',{expectedUser,currentUser:identity?.current_user,sessionUser:identity?.session_user});
  }
  if(identity.database_name!==expectedDatabase){
    throw new KernelError('MIGRATION_DATABASE_REJECTED','Connected database does not match MIGRATION_DATABASE_URL',{expectedDatabase,currentDatabase:identity.database_name});
  }
  if(destructive&&!config.allowDown&&!String(identity.database_name||'').endsWith('_test')){
    throw new KernelError('DB_DOWN_FORBIDDEN',`Refusing destructive migration against ${identity.database_name||'unknown database'}`);
  }
  return identity;
}

const pinnedClientPool=client=>({connect:async()=>({query:(...args)=>client.query(...args),release:()=>{}})});

export async function migrateUp(pool,observation={}){
  const client=await pool.connect();
  let locked=false;
  try{
    locked=await acquireMigrationLock(client);
    await assertMigrationConnection(client);
    await ensureMetadata(client);
    const files=await filesAt(migrationRoot);
    assertManifest(files);
    // A release that is older than the database must not start. Render's
    // "rollback to previous deploy" re-runs this command with the previous
    // code; without this check every known file is 'skipped' and the ledger
    // rows written by the newer release are silently ignored, so old code
    // serves a newer schema. Refuse up front and name the recovery path.
    const known=new Set(files);
    const ahead=(await client.query('SELECT migration_name,checksum FROM refs_schema_migration ORDER BY migration_name')).rows.filter(row=>!known.has(row.migration_name));
    if(ahead.length){
      const details={schema_head:ahead[ahead.length-1].migration_name,release_head:files[files.length-1],unknown_migrations:ahead.map(row=>row.migration_name),
        recovery:'The database has been migrated by a newer release than this build. Application rollback is forward-only: redeploy a build that contains these migrations, or restore the approved pre-migration backup (including refs_schema_migration) before starting older code.'};
      emitMigrationEvent(observation.onEvent,{event:'migration_ledger_ahead',...details});
      throw new KernelError('MIGRATION_LEDGER_AHEAD',`Database holds ${ahead.length} migration(s) unknown to this release`,details);
    }
    for(const name of files){
      await observeMigration(name,'up',async()=>{
        const migration=await migrationFile(migrationRoot,name);
        assertChecksum(migration,'up');
        const applied=await client.query('SELECT checksum FROM refs_schema_migration WHERE migration_name=$1',[name]);
        if(applied.rowCount){
          if(applied.rows[0].checksum!==migration.checksum)throw new KernelError('MIGRATION_CHECKSUM_MISMATCH',`Applied migration changed: ${name}`);
          return 'skipped';
        }
        await withTransaction(pinnedClientPool(client),async tx=>{
          await tx.query(migration.sql);
          await tx.query('INSERT INTO refs_schema_migration(migration_name,checksum) VALUES($1,$2)',[name,migration.checksum]);
        });
      },observation);
    }
  }finally{
    try{if(locked)await client.query('SELECT pg_advisory_unlock($1)',[lockKey]);}finally{client.release();}
  }
}

export async function migrateDown(pool,{all=false,...observation}={}){
  const client=await pool.connect();
  let locked=false;
  try{
    locked=await acquireMigrationLock(client);
    await assertMigrationConnection(client,{destructive:true});
    await ensureMetadata(client);
    const applied=(await client.query('SELECT migration_name FROM refs_schema_migration ORDER BY migration_name DESC')).rows.map(row=>row.migration_name);
    if(all){
      // Fail before the first down runs, not twenty downs in. A reset that
      // reaches an irreversibility barrier mid-way leaves the schema partly
      // torn down; refusing up front leaves it exactly as it was and names the
      // barrier and the recovery path instead of surfacing a bare P0001.
      for(const name of applied){
        const down=await migrationFile(downRoot,name);
        assertChecksum(down,'down');
        if(downMigrationRefusesUnconditionally(down.sql)){
          const details={schema_head:applied[0],applied_count:applied.length,first_irreversible_migration:name,
            recovery:'Reset is only for test databases that have not crossed an irreversible migration. Recover a database that has crossed one by restoring an approved backup and applying forward fixes with db:up; do not roll back.'};
          emitMigrationEvent(observation.onEvent,{event:'migration_reset_blocked',...details});
          throw new KernelError('MIGRATION_RESET_BLOCKED',`Reset cannot pass irreversible migration ${name}`,details);
        }
      }
    }
    const selected=all?applied:applied.slice(0,1);
    for(const name of selected){
      await observeMigration(name,'down',async()=>{
        const down=await migrationFile(downRoot,name);
        assertChecksum(down,'down');
        await withTransaction(pinnedClientPool(client),async tx=>{
          await tx.query(down.sql);
          await tx.query('DELETE FROM refs_schema_migration WHERE migration_name=$1',[name]);
        });
      },observation);
    }
  }finally{
    try{if(locked)await client.query('SELECT pg_advisory_unlock($1)',[lockKey]);}finally{client.release();}
  }
}
