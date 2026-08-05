import {createHash} from 'node:crypto';
import {readdir,readFile} from 'node:fs/promises';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {databaseName,runtimeConfig} from './config.mjs';
import {KernelError,withTransaction} from './db.mjs';
import {MIGRATION_MANIFEST} from './migration-manifest.mjs';

const here=dirname(fileURLToPath(import.meta.url));
const migrationRoot=resolve(here,'..','db','migrations');
const downRoot=join(migrationRoot,'down');
const lockKey=728346219;

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

export async function migrateUp(pool){
  const client=await pool.connect();
  let locked=false;
  try{
    await client.query('SELECT pg_advisory_lock($1)',[lockKey]);
    locked=true;
    await assertMigrationConnection(client);
    await ensureMetadata(client);
    const files=await filesAt(migrationRoot);
    assertManifest(files);
    for(const name of files){
      const migration=await migrationFile(migrationRoot,name);
      assertChecksum(migration,'up');
      const applied=await client.query('SELECT checksum FROM refs_schema_migration WHERE migration_name=$1',[name]);
      if(applied.rowCount){
        if(applied.rows[0].checksum!==migration.checksum)throw new KernelError('MIGRATION_CHECKSUM_MISMATCH',`Applied migration changed: ${name}`);
        continue;
      }
      await withTransaction(pinnedClientPool(client),async tx=>{
        await tx.query(migration.sql);
        await tx.query('INSERT INTO refs_schema_migration(migration_name,checksum) VALUES($1,$2)',[name,migration.checksum]);
      });
    }
  }finally{
    try{if(locked)await client.query('SELECT pg_advisory_unlock($1)',[lockKey]);}finally{client.release();}
  }
}

export async function migrateDown(pool,{all=false}={}){
  const client=await pool.connect();
  let locked=false;
  try{
    await client.query('SELECT pg_advisory_lock($1)',[lockKey]);
    locked=true;
    await assertMigrationConnection(client,{destructive:true});
    await ensureMetadata(client);
    const applied=(await client.query('SELECT migration_name FROM refs_schema_migration ORDER BY migration_name DESC')).rows.map(row=>row.migration_name);
    const selected=all?applied:applied.slice(0,1);
    for(const name of selected){
      const down=await migrationFile(downRoot,name);
      assertChecksum(down,'down');
      await withTransaction(pinnedClientPool(client),async tx=>{
        await tx.query(down.sql);
        await tx.query('DELETE FROM refs_schema_migration WHERE migration_name=$1',[name]);
      });
    }
  }finally{
    try{if(locked)await client.query('SELECT pg_advisory_unlock($1)',[lockKey]);}finally{client.release();}
  }
}
