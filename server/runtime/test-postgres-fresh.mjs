import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {fileURLToPath} from 'node:url';
import {dirname,resolve} from 'node:path';
import {postgresDataVolumeTarget} from './postgres-container.mjs';
import {createPool} from './db.mjs';
import {waitForPostgresReadiness} from './postgres-readiness.mjs';

const serverRoot=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const project=`refs_kernel_gate_${process.pid}_${Date.now().toString(36)}`.toLowerCase();
const database='refs_kernel_gate_test';
const passwords={
  migrator:'refs_migrator_test_K8r3w5T1z9Hp',
  runtime:'refs_runtime_test_N7v2p9Q4x6Lm',
  issuer:'refs_issuer_test_P6m4s8V2q7Jc',
  grantSync:'refs_grant_sync_test_R9k5d3W8y2Fn'
};

if(!/^refs_kernel_gate_[a-z0-9_-]+$/.test(project))throw new Error('Unsafe compose project name');
if(!database.endsWith('_test'))throw new Error('Fresh PostgreSQL gate requires a *_test database');

function freePort(){
  return new Promise((resolvePort,reject)=>{
    const server=createServer();
    server.once('error',reject);
    server.listen(0,'127.0.0.1',()=>{
      const {port}=server.address();
      server.close(error=>error?reject(error):resolvePort(port));
    });
  });
}

function run(command,args,env){
  return new Promise((resolveRun,reject)=>{
    const child=spawn(command,args,{cwd:serverRoot,env,stdio:'inherit',shell:process.platform==='win32'&&command==='docker'});
    child.once('error',reject);
    child.once('exit',(code,signal)=>code===0?resolveRun():reject(new Error(`${command} exited ${code??signal}`)));
  });
}

async function probePostgres(databaseUrl){
  const pool=await createPool({databaseUrl,applicationName:'refs-fresh-gate-readiness',max:1});
  try{await pool.query('SELECT 1');}
  finally{await pool.end();}
}

const port=await freePort();
const composeEnv={...process.env,
  POSTGRES_DB:database,
  POSTGRES_USER:'refs_migrator',
  POSTGRES_PASSWORD:passwords.migrator,
  POSTGRES_PORT:String(port)
};
composeEnv.POSTGRES_DATA_VOLUME_TARGET=postgresDataVolumeTarget(composeEnv.POSTGRES_IMAGE||'postgres:16-alpine');
const testEnv={...composeEnv,
  REFS_PG_REQUIRED:'1',
  DATABASE_URL:`postgresql://refs_runtime:${passwords.runtime}@127.0.0.1:${port}/${database}`,
  MIGRATION_DATABASE_URL:`postgresql://refs_migrator:${passwords.migrator}@127.0.0.1:${port}/${database}`,
  CONTEXT_ISSUER_DATABASE_URL:`postgresql://refs_context_issuer:${passwords.issuer}@127.0.0.1:${port}/${database}`,
  GRANT_SYNC_DATABASE_URL:`postgresql://refs_grant_sync:${passwords.grantSync}@127.0.0.1:${port}/${database}`
};
const postgresTestArgs=['--test'];
if(process.env.PG_TEST_NAME_PATTERN)postgresTestArgs.push('--test-name-pattern',process.env.PG_TEST_NAME_PATTERN);
postgresTestArgs.push('tests/postgres-kernel.test.mjs');

console.log(`Fresh PostgreSQL gate project=${project} database=${database} port=${port} image=${composeEnv.POSTGRES_IMAGE||'postgres:16-alpine'}`);
try{
  await run('docker',['compose','-p',project,'-f','compose.yaml','up','-d','--wait'],composeEnv);
  const readiness=await waitForPostgresReadiness({probe:()=>probePostgres(testEnv.MIGRATION_DATABASE_URL)});
  console.log(`Fresh PostgreSQL gate ready after ${readiness.attempts} probe(s) in ${readiness.elapsedMs}ms`);
  await run(process.execPath,postgresTestArgs,testEnv);
}finally{
  await run('docker',['compose','-p',project,'-f','compose.yaml','down','-v','--remove-orphans'],composeEnv).catch(error=>{
    console.error(`Fresh gate cleanup failed for owned project ${project}: ${error.message}`);
    process.exitCode=1;
  });
}
