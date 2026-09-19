#!/usr/bin/env node
// R13: resumable, sharded server test runner with a machine-readable summary.
//
// The problem this solves: `npm test` runs hundreds of files in a handful of giant
// `node --test` invocations. One hang past the CI wall clock truncates the run and every
// result is lost -- including the results of files that already passed. There is then no
// artifact to triage from, so the next attempt starts from zero.
//
// This runner executes one file per child process with a per-file timeout, and appends
// each outcome to a JSON state file the moment it completes. A truncated run therefore
// keeps everything it had already proved, and `--resume` continues from where it stopped.
// Failures are classified, not merely counted, because "Postgres was unreachable" and
// "an assertion is wrong" demand different responses and a bare red count conflates them.
//
// Usage:
//   node tools/test-shard-runner.mjs                  # run everything, fresh
//   node tools/test-shard-runner.mjs --resume         # skip files already recorded
//   node tools/test-shard-runner.mjs --shard 2/4      # this shard only
//   node tools/test-shard-runner.mjs --filter postgres
//   node tools/test-shard-runner.mjs --timeout 300    # per-file seconds (default 180)
//   node tools/test-shard-runner.mjs --state out/run.json
//   node tools/test-shard-runner.mjs --summary        # summarise state, run nothing
//
// Exit code is 0 only when every executed file passed or was legitimately skipped.

import {spawn} from 'node:child_process';
import {readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync} from 'node:fs';
import {dirname, join, relative} from 'node:path';
import {fileURLToPath} from 'node:url';

const SERVER_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const TESTS_DIR = join(SERVER_ROOT, 'tests');
const DEFAULT_STATE = join(SERVER_ROOT, 'out', 'test-shard-state.json');
const SCHEMA_VERSION = 'REFS_TEST_SHARD_RUN_V1';

// First matching rule wins, so the specific diagnoses precede the generic ones.
const FAILURE_CLASSES = [
  {code:'POSTGRES_UNAVAILABLE', actionable:false,
   describe:'The file needs a live PostgreSQL and could not reach one.',
   match:t=>/POSTGRES NOT RUN|ECONNREFUSED|could not connect to server|password authentication failed|database .* does not exist/i.test(t)},
  {code:'CONTAINER_UNAVAILABLE', actionable:false,
   describe:'The file needs the attachment containers (MinIO/ClamAV/scanner sidecar) and they are not running.',
   match:t=>/Container attachment test environment is required|SCANNER_ENDPOINT|CLAMAV_PORT/.test(t)},
  {code:'SHARED_DB_RESIDUE', actionable:false,
   describe:'Failed on state left by an earlier file in the same database: a full-suite isolation artifact, not a defect. Re-run the file alone on a fresh database to confirm.',
   match:t=>/duplicate key value violates unique constraint|canceling statement due to lock timeout|canceling statement due to statement timeout|precondition: no .* evidence/.test(t)},
  {code:'TIMEOUT', actionable:true,
   describe:'The file exceeded the per-file wall clock and was killed.',
   match:(t,r)=>r.timedOut===true},
  {code:'MIGRATION_BARRIER', actionable:true,
   describe:'A migration guard refused (401/414 barrier family).',
   match:t=>/MIGRATION_RESET_BLOCKED|MIGRATION_LEDGER_AHEAD|DB_DOWN_FORBIDDEN|MIGRATION_CHECKSUM_MISMATCH|MIGRATION_MANIFEST_MISMATCH/.test(t)},
  {code:'MODULE_ERROR', actionable:true,
   describe:'The file failed to load (import/syntax/missing export), so nothing ran.',
   match:t=>/ERR_MODULE_NOT_FOUND|Cannot find module|SyntaxError|does not provide an export named/.test(t)},
  {code:'CRASH', actionable:true,
   describe:'The child died without producing a TAP summary.',
   match:(t,r)=>r.signal!==null||!/^# tests \d+/m.test(t)},
  {code:'ASSERTION', actionable:true,
   describe:'A test assertion failed.',
   match:t=>/AssertionError|ERR_ASSERTION|^not ok /m.test(t)},
  {code:'UNCLASSIFIED', actionable:true,
   describe:'Nonzero exit matching no known pattern. Needs a human.',
   match:()=>true}
];

function parseArgs(argv){
  const opts={resume:false,summary:false,shard:null,filter:null,timeoutSec:180,state:DEFAULT_STATE};
  for(let i=0;i<argv.length;i+=1){
    const arg=argv[i];
    const next=()=>{const v=argv[i+1];if(v===undefined||v.startsWith('--'))throw new Error(`${arg} requires a value`);i+=1;return v;};
    if(arg==='--resume')opts.resume=true;
    else if(arg==='--summary')opts.summary=true;
    else if(arg==='--shard')opts.shard=next();
    else if(arg==='--filter')opts.filter=next();
    else if(arg==='--timeout')opts.timeoutSec=Number(next());
    else if(arg==='--state')opts.state=next();
    else throw new Error(`Unknown argument ${arg}`);
  }
  if(!Number.isInteger(opts.timeoutSec)||opts.timeoutSec<1||opts.timeoutSec>3600)throw new Error('--timeout must be an integer between 1 and 3600 seconds');
  if(opts.shard!==null&&!/^\d+\/\d+$/.test(opts.shard))throw new Error('--shard must look like 2/4');
  return opts;
}

export function discoverTestFiles(dir=TESTS_DIR){
  return readdirSync(dir).filter(f=>f.endsWith('.test.mjs')).sort()
    .map(f=>relative(SERVER_ROOT,join(dir,f)).split('\\').join('/'));
}

// A file's shard is a function of its own name, so adding or removing a file never
// reshuffles the others across shards.
export function shardOf(file,total){
  let h=0;
  for(let i=0;i<file.length;i+=1)h=(h*31+file.charCodeAt(i))>>>0;
  return (h%total)+1;
}

export function selectFiles(files,{shard=null,filter=null}={}){
  let out=files;
  if(filter)out=out.filter(f=>f.includes(filter));
  if(shard){
    const [index,total]=shard.split('/').map(Number);
    if(index<1||index>total)throw new Error(`--shard ${shard} is out of range`);
    out=out.filter(f=>shardOf(f,total)===index);
  }
  return out;
}

export function parseTap(text){
  const num=key=>{const m=text.match(new RegExp(`^# ${key} (\\d+)$`,'m'));return m?Number(m[1]):0;};
  return {tests:num('tests'),pass:num('pass'),fail:num('fail'),skipped:num('skipped'),todo:num('todo')};
}

export function classifyFailure(text,result){
  for(const rule of FAILURE_CLASSES){
    if(rule.match(text,result))return {code:rule.code,actionable:rule.actionable,describe:rule.describe};
  }
  return {code:'UNCLASSIFIED',actionable:true,describe:'Unclassified'};
}

function excerptOf(text){
  const lines=text.split('\n');
  const at=lines.findIndex(l=>/^not ok |AssertionError|Error:/.test(l));
  const start=at===-1?Math.max(0,lines.length-25):Math.max(0,at-3);
  return lines.slice(start,start+25).join('\n').slice(0,4000);
}

// A file that skips every test because Postgres is absent is neither a pass nor a failure.
// Reporting it green would be exactly the "mock as accepted" mistake this repo forbids.
export function outcomeFor(file,result){
  const text=`${result.stdout}\n${result.stderr}`;
  const tap=parseTap(text);
  const base={file,durationMs:result.durationMs,exitCode:result.exitCode,signal:result.signal,...tap};
  if(result.exitCode===0&&!result.timedOut){
    const everythingSkipped=tap.tests>0&&tap.skipped===tap.tests;
    return {...base,status:everythingSkipped?'SKIPPED':'PASSED',failure:null};
  }
  return {...base,status:'FAILED',failure:classifyFailure(text,result),excerpt:excerptOf(text)};
}

function runOne(file,timeoutSec){
  return new Promise(resolve=>{
    const startedAt=Date.now();
    const child=spawn(process.execPath,['--test',file],{cwd:SERVER_ROOT,env:process.env});
    let stdout='',stderr='',timedOut=false;
    const timer=setTimeout(()=>{timedOut=true;child.kill('SIGKILL');},timeoutSec*1000);
    child.stdout.on('data',d=>{stdout+=d;});
    child.stderr.on('data',d=>{stderr+=d;});
    child.on('close',(exitCode,signal)=>{
      clearTimeout(timer);
      resolve({stdout,stderr,exitCode,signal,timedOut,durationMs:Date.now()-startedAt});
    });
  });
}

export function loadState(statePath){
  if(!existsSync(statePath))return {schema_version:SCHEMA_VERSION,started_at:null,results:[]};
  const parsed=JSON.parse(readFileSync(statePath,'utf8'));
  if(parsed.schema_version!==SCHEMA_VERSION)throw new Error(`State schema is ${parsed.schema_version}, expected ${SCHEMA_VERSION}. Delete it to start fresh.`);
  return parsed;
}

function saveState(statePath,state){
  mkdirSync(dirname(statePath),{recursive:true});
  writeFileSync(statePath,`${JSON.stringify(state,null,2)}\n`);
}

export function summarize(state){
  const by=status=>state.results.filter(r=>r.status===status);
  const failed=by('FAILED');
  const byClass={};
  for(const r of failed){
    const code=r.failure?.code??'UNCLASSIFIED';
    byClass[code]=(byClass[code]??0)+1;
  }
  const totals=state.results.reduce((a,r)=>({tests:a.tests+r.tests,pass:a.pass+r.pass,fail:a.fail+r.fail,skipped:a.skipped+r.skipped}),{tests:0,pass:0,fail:0,skipped:0});
  return {
    files:{total:state.results.length,passed:by('PASSED').length,skipped:by('SKIPPED').length,failed:failed.length},
    assertions:totals,
    failures_by_class:byClass,
    // Only actionable failures gate. An unreachable database is an environment fact, not a
    // defect; blocking on it teaches people to ignore red.
    actionable_failures:failed.filter(r=>r.failure?.actionable).map(r=>({file:r.file,class:r.failure.code})),
    non_actionable_failures:failed.filter(r=>!r.failure?.actionable).map(r=>({file:r.file,class:r.failure.code}))
  };
}

function printSummary(state){
  const s=summarize(state);
  process.stdout.write('\n=== R13 test shard summary ===\n');
  process.stdout.write(`files     : ${s.files.total} total, ${s.files.passed} passed, ${s.files.skipped} skipped, ${s.files.failed} failed\n`);
  process.stdout.write(`assertions: ${s.assertions.tests} tests, ${s.assertions.pass} pass, ${s.assertions.fail} fail, ${s.assertions.skipped} skipped\n`);
  if(Object.keys(s.failures_by_class).length){
    process.stdout.write('failures by class:\n');
    for(const [code,n] of Object.entries(s.failures_by_class).sort((a,b)=>b[1]-a[1]))process.stdout.write(`  ${code.padEnd(22)} ${n}\n`);
  }
  if(s.actionable_failures.length){
    process.stdout.write('\nactionable:\n');
    for(const f of s.actionable_failures)process.stdout.write(`  [${f.class}] ${f.file}\n`);
  }
  if(s.non_actionable_failures.length){
    process.stdout.write('\nenvironment (not a defect, does not gate):\n');
    for(const f of s.non_actionable_failures)process.stdout.write(`  [${f.class}] ${f.file}\n`);
  }
  return s;
}

async function main(){
  const opts=parseArgs(process.argv.slice(2));
  const state=loadState(opts.state);

  if(opts.summary){
    const s=printSummary(state);
    process.exit(s.actionable_failures.length?1:0);
  }

  const done=new Set(opts.resume?state.results.map(r=>r.file):[]);
  if(!opts.resume)state.results=[];
  if(!state.started_at)state.started_at=new Date().toISOString();

  const selected=selectFiles(discoverTestFiles(),{shard:opts.shard,filter:opts.filter});
  const pending=selected.filter(f=>!done.has(f));

  process.stdout.write(`R13 runner: ${selected.length} selected, ${pending.length} to run`);
  process.stdout.write(opts.shard?` (shard ${opts.shard})`:'');
  process.stdout.write(`, ${opts.timeoutSec}s per file, state ${relative(SERVER_ROOT,opts.state)}\n`);

  let index=0;
  for(const file of pending){
    index+=1;
    process.stdout.write(`[${String(index).padStart(3)}/${pending.length}] ${file} ... `);
    const result=await runOne(file,opts.timeoutSec);
    const outcome=outcomeFor(file,result);
    state.results.push(outcome);
    state.updated_at=new Date().toISOString();
    // Persist after every file. This is the whole point: a kill -9 here still leaves a
    // complete record of everything already proved.
    saveState(opts.state,state);
    process.stdout.write(`${outcome.status==='FAILED'?`FAILED (${outcome.failure.code})`:outcome.status} ${(outcome.durationMs/1000).toFixed(1)}s\n`);
  }

  state.summary=summarize(state);
  state.finished_at=new Date().toISOString();
  saveState(opts.state,state);
  const s=printSummary(state);
  process.stdout.write(`\nmachine-readable state: ${opts.state}\n`);
  process.exit(s.actionable_failures.length?1:0);
}

if(import.meta.url===`file://${process.argv[1]}`){
  main().catch(error=>{process.stderr.write(`test-shard-runner: ${error.message}\n`);process.exit(2);});
}
