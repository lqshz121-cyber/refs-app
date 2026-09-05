import {pathToFileURL} from 'node:url';
import {createPool,KernelError} from './db.mjs';
import {migrateDown,migrateUp} from './migrations.mjs';
import {runtimeConfig} from './config.mjs';
import {emitMigrationEvent,safeMigrationErrorCode} from './migration-observability.mjs';

export function migrationStatementTimeout(env=process.env){
  const raw=env.REFS_PG_MIGRATION_STATEMENT_TIMEOUT_MS;
  const value=raw===undefined?600000:Number(raw);
  if(!Number.isSafeInteger(value)||value<100||value>600000||!/^\d+$/.test(String(raw??value))){
    throw new KernelError('MIGRATION_TIMEOUT_INVALID','Migration statement timeout must be an integer from 100 to 600000 milliseconds');
  }
  return value;
}

export async function runMigrations(command,{env=process.env,poolFactory=createPool,up=migrateUp,down=migrateDown,onEvent=event=>console.log(JSON.stringify(event))}={}){
  if(!['up','down','reset'].includes(command))throw new KernelError('MIGRATION_COMMAND_INVALID','Unsupported migration command');
  const statementTimeoutMs=migrationStatementTimeout(env);
  const migrationUrl=runtimeConfig(env).migrationDatabaseUrl;
  if(!migrationUrl)throw new KernelError('MIGRATION_URL_REQUIRED','MIGRATION_DATABASE_URL is required for migration commands');
  const pool=await poolFactory({databaseUrl:migrationUrl,applicationName:'refs-migration-runner',max:2,statementTimeoutMs});
  emitMigrationEvent(onEvent,{event:'migration_runner_started',command,statement_timeout_ms:statementTimeoutMs});
  try{
    if(command==='up')await up(pool,{onEvent});
    else if(command==='down')await down(pool,{onEvent});
    else{await down(pool,{all:true,onEvent});await up(pool,{onEvent});}
  }finally{await pool.end();}
}

if(import.meta.url===pathToFileURL(process.argv[1]||'').href){
  runMigrations(process.argv[2]||'up').then(()=>console.log(JSON.stringify({event:'migration_runner_completed'}))).catch(error=>{console.error(JSON.stringify({event:'migration_runner_failed',code:safeMigrationErrorCode(error)}));process.exitCode=1;});
}
