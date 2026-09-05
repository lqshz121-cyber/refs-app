import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {migrationStatementTimeout,runMigrations} from '../runtime/migrate.mjs';
import {runtimeConfig} from '../runtime/config.mjs';
import {migrateUp,migrateDown} from '../runtime/migrations.mjs';
import {MIGRATION_MANIFEST} from '../runtime/migration-manifest.mjs';
import {observeMigration,safeMigrationErrorCode} from '../runtime/migration-observability.mjs';

test('migration deadline is bounded and independent of the ordinary runtime deadline',()=>{
  assert.equal(migrationStatementTimeout({}),600000);
  assert.equal(migrationStatementTimeout({REFS_PG_STATEMENT_TIMEOUT_MS:'30000'}),600000);
  for(const value of ['100','46000','600000'])assert.equal(migrationStatementTimeout({REFS_PG_MIGRATION_STATEMENT_TIMEOUT_MS:value}),Number(value));
  for(const value of ['','0','99','600001','Infinity','1e5',' 100','100.1','token-secret'])assert.throws(()=>migrationStatementTimeout({REFS_PG_MIGRATION_STATEMENT_TIMEOUT_MS:value}),{code:'MIGRATION_TIMEOUT_INVALID'});
  assert.equal(runtimeConfig({}).statementTimeoutMs,10000);
  assert.equal(runtimeConfig({REFS_PG_STATEMENT_TIMEOUT_MS:'30000',REFS_PG_MIGRATION_STATEMENT_TIMEOUT_MS:'invalid'}).statementTimeoutMs,30000);
});

test('runner only passes its dedicated pool deadline, closes the pool and preserves reset order',async()=>{
  const calls=[],events=[];
  const pool={end:async()=>calls.push('end')};
  await runMigrations('reset',{env:{REFS_PG_STATEMENT_TIMEOUT_MS:'30000'},poolFactory:async options=>{assert.equal(options.statementTimeoutMs,600000);assert.equal(options.applicationName,'refs-migration-runner');assert.equal(options.max,2);return pool;},down:async(p,options)=>{assert.equal(p,pool);assert.equal(options.all,true);calls.push('down');},up:async p=>{assert.equal(p,pool);calls.push('up');},onEvent:event=>events.push(event)});
  assert.deepEqual(calls,['down','up','end']);
  assert.deepEqual(events,[{event:'migration_runner_started',command:'reset',statement_timeout_ms:600000}]);
  let created=false;
  await assert.rejects(runMigrations('up',{env:{REFS_PG_MIGRATION_STATEMENT_TIMEOUT_MS:'0'},poolFactory:()=>{created=true;}}),{code:'MIGRATION_TIMEOUT_INVALID'});
  await assert.rejects(runMigrations('secret-command',{poolFactory:()=>{created=true;}}),{code:'MIGRATION_COMMAND_INVALID'});
  assert.equal(created,false);
  let closed=false,upCalled=false;
  const failed=Object.assign(Error('sensitive SQL error'),{code:'57014'});
  await assert.rejects(runMigrations('reset',{env:{},poolFactory:async()=>({end:async()=>{closed=true;}}),down:async()=>{throw failed;},up:async()=>{upCalled=true;},onEvent:()=>{}}),error=>error===failed);
  assert.equal(closed,true);assert.equal(upCalled,false);
});

function migrationPool({failure=false,mismatch=false}={}){
  const queries=[],last=MIGRATION_MANIFEST.at(-1),pending=MIGRATION_MANIFEST.slice(-2);
  const config=runtimeConfig(),url=new URL(config.migrationDatabaseUrl);
  const client={async query(sql,args){
    queries.push({sql,args});
    if(sql.startsWith("SELECT current_setting('statement_timeout')"))return {rows:[{statement_timeout:'10min',lock_timeout:'5s'}]};
    if(sql.startsWith('SELECT current_database()'))return {rows:[{database_name:decodeURIComponent(url.pathname.slice(1)),current_user:decodeURIComponent(url.username),session_user:decodeURIComponent(url.username)}]};
    if(sql.startsWith('SELECT checksum')){
      if(pending.some(item=>item.name===args[0]))return {rows:[],rowCount:0};
      return {rows:[{checksum:mismatch?'0'.repeat(64):MIGRATION_MANIFEST.find(item=>item.name===args[0]).up}],rowCount:1};
    }
    if(sql.startsWith('SELECT migration_name'))return {rows:[{migration_name:last.name}]};
    if(failure&&sql.length>1000)throw Object.assign(new Error('SQL private_person password=very-sensitive source values'),{code:'57014',detail:'private-detail',query:sql});
    return {rows:[],rowCount:0};
  },release(){queries.push({sql:'RELEASE'});}};
  return {queries,pending,last,async connect(){return client;}};
}

test('up emits completion only after SQL and metadata COMMIT, skips checksum-verified history in fixed order',async()=>{
  const pool=migrationPool(),events=[];
  await migrateUp(pool,{onEvent:event=>events.push({...event,last_query:pool.queries.at(-1).sql})});
  const completed=events.filter(event=>event.event==='migration_completed');
  assert.deepEqual(completed.map(event=>event.migration_name),pool.pending.map(item=>item.name));
  assert.ok(completed.every(event=>event.last_query==='COMMIT'&&event.elapsed_ms>=0&&event.direction==='up'));
  assert.equal(events.filter(event=>event.event==='migration_skipped').length,MIGRATION_MANIFEST.length-2);
  assert.deepEqual(pool.queries.filter(({sql})=>sql.startsWith('INSERT INTO refs_schema_migration')).map(({args})=>args[0]),pool.pending.map(item=>item.name));
  assert.equal(pool.queries.at(-1).sql,'RELEASE');
});

test('failed migration rolls back with no metadata/COMMIT or next migration; safe name/code/elapsed only',async()=>{
  const pool=migrationPool({failure:true}),events=[];
  await assert.rejects(migrateUp(pool,{onEvent:event=>events.push(event)}),{code:'57014'});
  const failed=events.at(-1);
  assert.deepEqual(Object.keys(failed).sort(),['code','direction','elapsed_ms','event','migration_name']);
  assert.equal(failed.code,'57014');assert.equal(failed.migration_name,pool.pending[0].name);
  assert.equal(failed.event,'migration_failed');assert.ok(failed.elapsed_ms>=0);
  assert.ok(pool.queries.some(({sql})=>sql==='ROLLBACK'));
  assert.ok(!pool.queries.some(({sql})=>sql==='COMMIT'||sql.startsWith('INSERT INTO refs_schema_migration')));
  assert.ok(!events.some(event=>event.migration_name===pool.pending[1].name));
  assert.doesNotMatch(JSON.stringify(events),/private_person|password|very-sensitive|private-detail/);
  assert.equal(pool.queries.at(-1).sql,'RELEASE');
});

test('down retains atomic SQL/metadata removal and reports completion after COMMIT',async()=>{
  const pool=migrationPool(),events=[];
  await migrateDown(pool,{onEvent:event=>events.push({...event,last_query:pool.queries.at(-1).sql})});
  assert.equal(events.at(-1).direction,'down');assert.equal(events.at(-1).migration_name,pool.last.name);
  assert.equal(events.at(-1).last_query,'COMMIT');
  assert.ok(pool.queries.some(({sql})=>sql.startsWith('DELETE FROM refs_schema_migration')));
});

test('checksum mismatch remains fail closed; log failures and arbitrary metadata cannot reveal secrets',async()=>{
  const pool=migrationPool({mismatch:true}),events=[];
  await assert.rejects(migrateUp(pool,{onEvent:event=>events.push(event)}),{code:'MIGRATION_CHECKSUM_MISMATCH'});
  assert.equal(events.at(-1).code,'MIGRATION_CHECKSUM_MISMATCH');
  assert.ok(!pool.queries.some(({sql})=>sql==='BEGIN'));
  const logs=[];let now=100;
  await observeMigration(MIGRATION_MANIFEST[0].name,'up',async()=>{}, {clock:()=>{now+=25;return now;},onEvent:event=>logs.push(event)});
  assert.equal(logs.at(-1).elapsed_ms,25);
  await observeMigration(MIGRATION_MANIFEST[0].name,'up',async()=>{}, {onEvent:()=>{throw Error('logger unavailable');}});
  assert.equal(safeMigrationErrorCode({code:'Bearer sensitive'}),'MIGRATION_RUN_FAILED');
  const bad=[];
  await assert.rejects(observeMigration('password=secret','up',async()=>{throw Error('private');},{onEvent:event=>bad.push(event)}));
  assert.equal(bad.at(-1).migration_name,'unknown');assert.doesNotMatch(JSON.stringify(bad),/password|private|secret/);
});

test('CLI invalid configuration emits only safe code and no raw values before DB import/connection',()=>{
  const result=spawnSync(process.execPath,['runtime/migrate.mjs','up'],{cwd:new URL('..',import.meta.url),encoding:'utf8',env:{...process.env,REFS_PG_MIGRATION_STATEMENT_TIMEOUT_MS:'Bearer private-value'}});
  assert.equal(result.status,1);
  assert.deepEqual(JSON.parse(result.stderr.trim()),{event:'migration_runner_failed',code:'MIGRATION_TIMEOUT_INVALID'});
  assert.equal(result.stdout,'');assert.doesNotMatch(result.stderr,/private-value|Bearer|postgresql|SELECT/);
});

test('both accounting Blueprints freeze the migration-only limit and retain db:up predeploy',async()=>{
  for(const file of ['render.yaml','render.integrations.yaml']){
    const text=await readFile(new URL(`../../${file}`,import.meta.url),'utf8');
    assert.match(text,/preDeployCommand: npm run db:up/);
    assert.match(text,/key: REFS_PG_MIGRATION_STATEMENT_TIMEOUT_MS\s+value: "600000"/);
    assert.doesNotMatch(text,/REFS_PG_STATEMENT_TIMEOUT_MS=600000/);
  }
});
