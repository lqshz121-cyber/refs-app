import {pathToFileURL} from 'node:url';
import {createPool} from './db.mjs';
import {migrateDown,migrateUp} from './migrations.mjs';
import {runtimeConfig} from './config.mjs';

export async function runMigrations(command){
  const migrationUrl=runtimeConfig().migrationDatabaseUrl;
  if(!migrationUrl)throw new Error('MIGRATION_DATABASE_URL is required for migration commands');
  const pool=await createPool({databaseUrl:migrationUrl,applicationName:'refs-migration-runner',max:2});
  try{
    if(command==='up')await migrateUp(pool);
    else if(command==='down')await migrateDown(pool);
    else if(command==='reset'){await migrateDown(pool,{all:true});await migrateUp(pool);}
    else throw new Error(`Unknown migration command: ${command}`);
  }finally{await pool.end();}
}

if(import.meta.url===pathToFileURL(process.argv[1]||'').href){
  runMigrations(process.argv[2]||'up').then(()=>console.log(`migration ${process.argv[2]||'up'} complete`)).catch(error=>{console.error(error.code||error.name,error.message);process.exitCode=1;});
}
