import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {fileURLToPath} from 'node:url';
import {dirname,resolve} from 'node:path';
import {MIGRATION_MANIFEST} from './migration-manifest.mjs';

const serverRoot=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const project=`refs_backup_drill_${process.pid}_${Date.now().toString(36)}`.toLowerCase();
const database='refs_backup_drill_test';
const restoredDatabase='refs_backup_restore_test';
const password='refs_migrator_test_K8r3w5T1z9Hp';

if(!/^refs_backup_drill_[a-z0-9_-]+$/.test(project))throw new Error('Unsafe backup drill compose project name');
if(!database.endsWith('_test')||!restoredDatabase.endsWith('_test'))throw new Error('Backup drill requires *-test databases');
function freePort(){return new Promise((resolvePort,reject)=>{const server=createServer();server.once('error',reject);server.listen(0,'127.0.0.1',()=>{const {port}=server.address();server.close(error=>error?reject(error):resolvePort(port));});});}
function run(command,args,env){return new Promise((resolveRun,reject)=>{const child=spawn(command,args,{cwd:serverRoot,env,stdio:'inherit'});child.once('error',reject);child.once('exit',(code,signal)=>code===0?resolveRun():reject(new Error(`${command} exited ${code??signal}`)));});}

const port=await freePort();
const composeEnv={...process.env,POSTGRES_DB:database,POSTGRES_USER:'refs_migrator',POSTGRES_PASSWORD:password,POSTGRES_PORT:String(port)};
const migrationUrl=`postgresql://refs_migrator:${password}@127.0.0.1:${port}/${database}`;
const migrationEnv={...composeEnv,REFS_PG_REQUIRED:'1',DATABASE_URL:`postgresql://refs_runtime:refs_runtime_test_N7v2p9Q4x6Lm@127.0.0.1:${port}/${database}`,MIGRATION_DATABASE_URL:migrationUrl,CONTEXT_ISSUER_DATABASE_URL:`postgresql://refs_context_issuer:refs_issuer_test_P6m4s8V2q7Jc@127.0.0.1:${port}/${database}`,GRANT_SYNC_DATABASE_URL:`postgresql://refs_grant_sync:refs_grant_sync_test_R9k5d3W8y2Fn@127.0.0.1:${port}/${database}`};
const shell=['set -eu',"pg_dump -U \"$POSTGRES_USER\" -Fc \"$POSTGRES_DB\" -f /tmp/refs-backup.dump",`createdb -U \"$POSTGRES_USER\" \"${restoredDatabase}\"`,`pg_restore -U \"$POSTGRES_USER\" --exit-on-error -d \"${restoredDatabase}\" /tmp/refs-backup.dump`,`test \"$(psql -U \"$POSTGRES_USER\" -d \"${restoredDatabase}\" -Atqc 'SELECT count(*) FROM refs_schema_migration')\" = '${MIGRATION_MANIFEST.length}'`,`test \"$(psql -U \"$POSTGRES_USER\" -d \"${restoredDatabase}\" -Atqc \"SELECT count(*) FROM tenant WHERE tenant_code='BKDRILL'\")\" = '1'`,`dropdb -U \"$POSTGRES_USER\" \"${restoredDatabase}\"`,'rm -f /tmp/refs-backup.dump'].join('; ');

console.log(`Backup restore drill project=${project} source=${database} restored=${restoredDatabase} port=${port} image=${composeEnv.POSTGRES_IMAGE||'postgres:16-alpine'}`);
try{
  await run('docker',['compose','-p',project,'-f','compose.yaml','up','-d','--wait'],composeEnv);
  await run(process.execPath,['runtime/migrate.mjs','up'],migrationEnv);
  await run('docker',['compose','-p',project,'-f','compose.yaml','exec','-T','postgres','psql','-v','ON_ERROR_STOP=1','-U','refs_migrator','-d',database,'-c',"INSERT INTO tenant(tenant_code,name) VALUES('BKDRILL','Backup Restore Drill')"],composeEnv);
  await run('docker',['compose','-p',project,'-f','compose.yaml','exec','-T','postgres','sh','-ceu',shell],composeEnv);
}finally{
  await run('docker',['compose','-p',project,'-f','compose.yaml','down','-v','--remove-orphans'],composeEnv).catch(error=>{console.error(`Backup drill cleanup failed for owned project ${project}: ${error.message}`);process.exitCode=1;});
}
