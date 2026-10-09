// Local verification only. Separate owned container; no staging/production URLs.
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {fileURLToPath} from 'node:url';
import {resolve,dirname} from 'node:path';
import {verifyFreshPostgresTap,formatFreshPostgresVerification} from '../../server/runtime/postgres-fresh-tap.mjs';
import {runtimeConfig} from '../../server/runtime/config.mjs';
import {createPool} from '../../server/runtime/db.mjs';
import {waitForPostgresReadiness} from '../../server/runtime/postgres-readiness.mjs';
const root=process.argv[3] ? resolve(process.argv[3]) : resolve(dirname(fileURLToPath(import.meta.url)),'../../server');
const profile=process.env.REFS_LOCAL_GAP_PROFILE||'release-gap';
if(!['release-gap','settings-workflow','bounded-bank-binding','bounded-bank-target','settings-read-role','bank-request','bank-request-combined','bank-request-accounting-view'].includes(profile))throw Error('Unknown local PostgreSQL verification profile');
const files=profile==='settings-workflow'?['accounting-settings-workflow-postgres.test.mjs']:profile.startsWith('bank-request')?['bounded-bank-request-postgres.test.mjs']:profile==='settings-read-role'?['settings-mapping-read-role-postgres.test.mjs']:profile==='bounded-bank-target'?['bounded-bank-pilot-target-postgres.test.mjs']:profile==='bounded-bank-binding'?['bounded-bank-pilot-binding-postgres.test.mjs']:['ap-ar-write-off-postgres.test.mjs','control-reconciliation-posted-only-postgres.test.mjs','historical-head-helper-postgres.test.mjs','statement-timeout-production-safety-postgres.test.mjs'];
const expectedCounts=profile==='settings-workflow'?[34]:profile.startsWith('bank-request')||profile==='settings-read-role'||profile.startsWith('bounded-bank-')?[1]:[6,5,4,5];
const image=process.argv[2];
if(!['postgres:15-alpine','postgres:16-alpine'].includes(image)||![3,4].includes(process.argv.length))throw Error('Usage: node tools/analysis/postgres-release-gap-gate.mjs postgres:15-alpine|postgres:16-alpine [local-server-directory]');
const project=`refs_kernel_gate_gap_${process.pid}_${Date.now().toString(36)}`;
const port=await new Promise((done,fail)=>{const server=createServer();server.once('error',fail);server.listen(0,'127.0.0.1',()=>{const p=server.address().port;server.close(e=>e?fail(e):done(p));});});
const database='refs_release_gap_test';
// Empty input deliberately selects only the existing local fixture defaults.
// Never obtain credentials from process.env or an external database URL.
const local=runtimeConfig({}),migrationFixture=new URL(local.migrationDatabaseUrl);
const env={...process.env,POSTGRES_IMAGE:image,POSTGRES_PORT:String(port),POSTGRES_DB:database,POSTGRES_USER:migrationFixture.username,POSTGRES_PASSWORD:decodeURIComponent(migrationFixture.password),POSTGRES_DATA_VOLUME_TARGET:'/var/lib/postgresql/data',REFS_PG_REQUIRED:'1'};
env.REFS_LOCAL_BANK_REQUEST_ROLE=profile==='bank-request-accounting-view'?'accounting-view':profile==='bank-request-combined'?'combined':'standalone';
for(const [name,key] of [['DATABASE_URL','databaseUrl'],['MIGRATION_DATABASE_URL','migrationDatabaseUrl'],['CONTEXT_ISSUER_DATABASE_URL','contextIssuerDatabaseUrl'],['GRANT_SYNC_DATABASE_URL','grantSyncDatabaseUrl']]){const fixture=new URL(local[key]);fixture.hostname='127.0.0.1';fixture.port=String(port);fixture.pathname=`/${database}`;env[name]=fixture.href;}
const run=(command,args,capture=false)=>new Promise((done,fail)=>{const child=spawn(command,args,{cwd:root,env,shell:process.platform==='win32'&&command==='docker',stdio:capture?['ignore','pipe','pipe']:'inherit'});let output='';if(capture)for(const stream of [child.stdout,child.stderr])stream.on('data',chunk=>{output+=chunk;process.stdout.write(chunk);});child.once('error',fail);child.once('exit',(code,signal)=>code===0?done(output):fail(Error(`${command} exited ${code??signal}`)));});
const compose=['compose','-p',project,'-f','compose.yaml'];
console.log(JSON.stringify({project,image,database,root,files}));
try{await run('docker',[...compose,'up','-d','--wait']);
const readiness=await waitForPostgresReadiness({probe:async()=>{const pool=await createPool({databaseUrl:env.MIGRATION_DATABASE_URL,applicationName:'refs-gap-readiness',max:1});try{await pool.query('SELECT 1');}finally{await pool.end();}}});
console.log(`Gap gate connection ready attempts=${readiness.attempts} elapsed_ms=${readiness.elapsedMs}`);
for(const [index,file] of files.entries()){console.log(`Gap gate test_file=${file}`);const tap=await run(process.execPath,['--test',`tests/${file}`],true);const verified=verifyFreshPostgresTap(tap);if(verified.tap.tests!==expectedCounts[index])throw Error(`Expected ${expectedCounts[index]} cases for ${file}, got ${verified.tap.tests}`);console.log(formatFreshPostgresVerification(verified));}}
finally{await run('docker',[...compose,'down','-v','--remove-orphans']);}
