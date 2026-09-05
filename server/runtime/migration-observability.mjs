import {performance} from 'node:perf_hooks';
import {MIGRATION_MANIFEST} from './migration-manifest.mjs';

const names=new Set(MIGRATION_MANIFEST.map(({name})=>name));
const safeCodes=new Set(['MIGRATION_MANIFEST_MISMATCH','MIGRATION_CHECKSUM_MISMATCH','MIGRATION_IDENTITY_REJECTED','MIGRATION_DATABASE_REJECTED','DB_DOWN_FORBIDDEN','PG_DRIVER_UNAVAILABLE','MIGRATION_TIMEOUT_INVALID','MIGRATION_COMMAND_INVALID','MIGRATION_URL_REQUIRED']);

export function safeMigrationErrorCode(error){
  const code=error?.code;
  return typeof code==='string'&&(safeCodes.has(code)||/^[0-9A-Z]{5}$/.test(code))?code:'MIGRATION_RUN_FAILED';
}

export function emitMigrationEvent(onEvent,event){
  // Diagnostics must not turn a committed migration into an apparent rollback.
  try{onEvent?.(Object.freeze(event));}catch{}
}

export async function observeMigration(name,direction,work,{onEvent,clock=()=>performance.now()}={}){
  const migration_name=names.has(name)?name:'unknown';
  const started=clock();
  const elapsed=()=>Math.max(0,Math.round(clock()-started));
  emitMigrationEvent(onEvent,{event:'migration_started',migration_name,direction,elapsed_ms:0});
  try{
    const result=await work();
    emitMigrationEvent(onEvent,{event:result==='skipped'?'migration_skipped':'migration_completed',migration_name,direction,elapsed_ms:elapsed()});
    return result;
  }catch(error){
    emitMigrationEvent(onEvent,{event:'migration_failed',migration_name,direction,elapsed_ms:elapsed(),code:safeMigrationErrorCode(error)});
    throw error;
  }
}
