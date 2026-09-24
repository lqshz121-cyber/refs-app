#!/usr/bin/env node
// R04: run every gate on its own database.
//
// The problem this solves: `gate:all` chains the four gates with `&&` against ONE database, so a
// gate inherits whatever the previous gate left behind. The barrier contract in particular has
// "no evidence may exist yet" preconditions; run after gate:concurrency it can fail on another
// gate's rows rather than on anything it tests. That is a false red, and the obvious "fixes"
// (ordering gates by luck, TRUNCATE between gates, skipping the precondition) are all forbidden
// or fragile.
//
// What this does instead (Z03's strategy, applied per gate):
//   1. migrate ONE template database to the manifest head, then mark it IS_TEMPLATE;
//   2. for each gate, CREATE DATABASE ... TEMPLATE -> a fresh, fully migrated, empty copy;
//   3. run that gate's steps in order against the copy, with all four role URLs retargeted
//      (runtimeConfig in strict mode insists they address the same database);
//   4. write one JSON per gate the moment it finishes, then drop the copy.
//
// No production setting is touched, no test is skipped, and REFS_PG_REQUIRED=1 is forced so a
// gate cannot go green by skipping for lack of a database.
//
// Usage (from server/):
//   node tools/gate-runner.mjs                       # all gates in gate:all order
//   node tools/gate-runner.mjs --gate barriers,security
//   node tools/gate-runner.mjs --resume              # skip gates whose JSON already says PASSED
//   node tools/gate-runner.mjs --per-file            # additionally, one fresh database per file
//   node tools/gate-runner.mjs --out out/gates --timeout 600 --keep
//
// Exit code: 0 only when every selected gate PASSED. 1 when any gate failed. 2 on runner error.

import {spawn} from 'node:child_process';
import {readFileSync, writeFileSync, mkdirSync, existsSync} from 'node:fs';
import {dirname, join, relative} from 'node:path';
import {fileURLToPath} from 'node:url';
import pg from 'pg';
import {parseTap, classifyFailure} from './test-shard-runner.mjs';

const SERVER_ROOT=dirname(dirname(fileURLToPath(import.meta.url)));
export const SCHEMA_VERSION='REFS_GATE_RUN_V1';
export const URL_KEYS=['DATABASE_URL','MIGRATION_DATABASE_URL','CONTEXT_ISSUER_DATABASE_URL','GRANT_SYNC_DATABASE_URL'];
const GATE_ORDER_SCRIPT='gate:all';

export const ident=name=>{
  if(!/^[a-z_][a-z0-9_]{0,62}$/.test(name))throw new Error(`unsafe database identifier: ${name}`);
  return name;
};
export const withDatabase=(url,name)=>{const u=new URL(url);u.pathname=`/${name}`;return u.toString();};
export const retargetEnv=(env,name)=>{
  const out={...env};
  for(const key of URL_KEYS){if(env[key])out[key]=withDatabase(env[key],name);}
  return out;
};

// Gate definitions come from package.json so the runner can never drift from `npm run gate:*`.
export function readGates(pkg){
  const scripts=pkg.scripts||{};
  const order=(scripts[GATE_ORDER_SCRIPT]||'').split('&&').map(s=>s.trim())
    .map(s=>/^npm run (?:--silent )?gate:([a-z-]+)$/.exec(s)?.[1]).filter(Boolean);
  const names=order.length?order:Object.keys(scripts).filter(k=>/^gate:[a-z-]+$/.test(k)&&k!==GATE_ORDER_SCRIPT).map(k=>k.slice(5));
  return names.map(name=>{
    const script=scripts[`gate:${name}`];
    if(!script)throw new Error(`${GATE_ORDER_SCRIPT} references gate:${name}, which is not defined`);
    const steps=script.split('&&').map(s=>s.trim()).filter(Boolean).map(command=>{
      const file=/^node --test (\S+)$/.exec(command)?.[1]??null;
      return {command,file};
    });
    return {name,script,steps};
  });
}

function parseArgs(argv){
  const opts={gates:null,resume:false,perFile:false,keep:false,timeoutSec:600,out:join(SERVER_ROOT,'out','gates')};
  for(let i=0;i<argv.length;i+=1){
    const a=argv[i];
    if(a==='--gate')opts.gates=argv[++i].split(',').map(s=>s.trim()).filter(Boolean);
    else if(a==='--resume')opts.resume=true;
    else if(a==='--per-file')opts.perFile=true;
    else if(a==='--keep')opts.keep=true;
    else if(a==='--timeout')opts.timeoutSec=Number(argv[++i]);
    else if(a==='--out')opts.out=join(process.cwd(),argv[++i]);
    else throw new Error(`unknown argument ${a}`);
  }
  if(!(opts.timeoutSec>0))throw new Error('--timeout must be a positive number of seconds');
  return opts;
}

function runStep(command,env,timeoutSec){
  return new Promise(resolve=>{
    const startedAt=Date.now();
    const child=spawn('/bin/sh',['-c',command],{cwd:SERVER_ROOT,env});
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

const excerptOf=text=>{
  const lines=text.split('\n');
  const at=lines.findIndex(l=>/^not ok |AssertionError|Error:|error:/.test(l));
  const start=at===-1?Math.max(0,lines.length-25):Math.max(0,at-3);
  return lines.slice(start,start+30).join('\n').slice(0,4000);
};

export function stepOutcome(step,result){
  const text=`${result.stdout}\n${result.stderr}`;
  const tap=step.file?parseTap(text):null;
  const base={command:step.command,file:step.file,exitCode:result.exitCode,signal:result.signal,
    timedOut:result.timedOut,durationMs:result.durationMs,...(tap?{tap}:{})};
  const everythingSkipped=tap&&tap.tests>0&&tap.skipped===tap.tests;
  if(result.exitCode===0&&!result.timedOut){
    // A gate that skipped because it had no database has proved nothing.
    if(everythingSkipped)return {...base,status:'SKIPPED',failure:{code:'ALL_SKIPPED',actionable:true,describe:'Every test skipped; a gate may not pass by skipping.'}};
    return {...base,status:'PASSED',failure:null,...(step.file?{}:{output:text.trim().split('\n').slice(-3).join('\n')})};
  }
  return {...base,status:'FAILED',failure:classifyFailure(text,result),excerpt:excerptOf(text)};
}

async function adminQuery(baseUrl,sql){
  const c=new pg.Client({connectionString:withDatabase(baseUrl,'postgres')});
  await c.connect();
  try{return await c.query(sql);}finally{await c.end().catch(()=>{});}
}

async function buildTemplate(env,name,timeoutSec){
  const base=env.MIGRATION_DATABASE_URL;
  await adminQuery(base,`ALTER DATABASE ${ident(name)} IS_TEMPLATE false`).catch(()=>{});
  await adminQuery(base,`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
  await adminQuery(base,`CREATE DATABASE ${name}`);
  const c=new pg.Client({connectionString:withDatabase(base,name)});
  await c.connect();
  try{await c.query('CREATE EXTENSION IF NOT EXISTS pgcrypto');}finally{await c.end();}
  // Migrate through the real entry point, with all four URLs on the template, so the
  // MIGRATION_DATABASE_REJECTED and same-endpoint guards run exactly as in production.
  const started=Date.now();
  const r=await runStep('node runtime/migrate.mjs up',retargetEnv(env,name),timeoutSec);
  if(r.exitCode!==0)throw new Error(`template migration failed (exit ${r.exitCode}):\n${excerptOf(`${r.stdout}\n${r.stderr}`)}`);
  const d=new pg.Client({connectionString:withDatabase(base,name)});
  await d.connect();
  let ledger;
  try{
    ledger=(await d.query('SELECT count(*)::int AS rows, max(migration_name) AS head FROM refs_schema_migration')).rows[0];
  }finally{await d.end();}
  await adminQuery(base,`ALTER DATABASE ${name} IS_TEMPLATE true`);
  return {name,ledger,migrateMs:Date.now()-started};
}

async function withClone(env,template,label,body,{keep=false}={}){
  const base=env.MIGRATION_DATABASE_URL;
  const name=ident(`refs_gate_${label.replace(/[^a-z0-9]/g,'_')}_${Date.now().toString(36)}`.slice(0,63));
  const started=Date.now();
  await adminQuery(base,`CREATE DATABASE ${name} TEMPLATE ${ident(template)}`);
  const cloneMs=Date.now()-started;
  try{return await body({name,cloneMs,env:retargetEnv(env,name)});}
  finally{if(!keep)await adminQuery(base,`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`).catch(()=>{});}
}

export function gateStatus(steps){
  if(steps.some(s=>s.status==='FAILED'))return 'FAILED';
  if(steps.some(s=>s.status==='SKIPPED'))return 'FAILED';
  return steps.length?'PASSED':'FAILED';
}

async function runGate(gate,env,template,opts,serverVersion){
  const startedAt=new Date().toISOString();
  const steps=[];const databases=[];
  if(opts.perFile){
    for(const step of gate.steps){
      await withClone(env,template.name,`${gate.name}_${steps.length}`,async({name,cloneMs,env:e})=>{
        databases.push({name,cloneMs});
        steps.push(stepOutcome(step,await runStep(step.command,e,opts.timeoutSec)));
      },{keep:opts.keep});
      // Unlike `&&`, keep going: the remaining files are still evidence.
    }
  }else{
    await withClone(env,template.name,gate.name,async({name,cloneMs,env:e})=>{
      databases.push({name,cloneMs});
      for(const step of gate.steps){
        const o=stepOutcome(step,await runStep(step.command,e,opts.timeoutSec));
        steps.push(o);
        // Same semantics as the npm script: a gate stops at its first failing step.
        if(o.status!=='PASSED'){
          for(const rest of gate.steps.slice(steps.length))steps.push({command:rest.command,file:rest.file,status:'NOT_RUN',failure:null});
          break;
        }
      }
    },{keep:opts.keep});
  }
  const ran=steps.filter(s=>s.status!=='NOT_RUN');
  return {schema_version:SCHEMA_VERSION,gate:gate.name,script:gate.script,status:gateStatus(ran),
    isolation:opts.perFile?'DATABASE_PER_FILE':'DATABASE_PER_GATE',
    postgres:serverVersion,template:{name:template.name,ledger_rows:template.ledger.rows,ledger_head:template.ledger.head},
    databases,started_at:startedAt,finished_at:new Date().toISOString(),
    durationMs:ran.reduce((n,s)=>n+(s.durationMs||0),0),steps};
}

async function main(){
  const opts=parseArgs(process.argv.slice(2));
  const env={...process.env,REFS_PG_REQUIRED:'1'};
  for(const key of URL_KEYS)if(!env[key])throw new Error(`${key} is required`);
  const pkg=JSON.parse(readFileSync(join(SERVER_ROOT,'package.json'),'utf8'));
  let gates=readGates(pkg);
  if(opts.gates){
    const unknown=opts.gates.filter(g=>!gates.some(x=>x.name===g));
    if(unknown.length)throw new Error(`unknown gate(s): ${unknown.join(', ')}`);
    gates=gates.filter(g=>opts.gates.includes(g.name));
  }
  mkdirSync(opts.out,{recursive:true});
  const pathFor=name=>join(opts.out,`gate-${name}.json`);
  const pending=gates.filter(g=>{
    if(!opts.resume||!existsSync(pathFor(g.name)))return true;
    try{return JSON.parse(readFileSync(pathFor(g.name),'utf8')).status!=='PASSED';}catch{return true;}
  });
  const serverVersion=(await adminQuery(env.MIGRATION_DATABASE_URL,"SELECT current_setting('server_version') v")).rows[0].v;
  process.stdout.write(`R04 gate runner: ${gates.length} selected, ${pending.length} to run, PostgreSQL ${serverVersion}, out ${relative(SERVER_ROOT,opts.out)||'.'}\n`);
  if(pending.length){
    const template=await buildTemplate(env,'refs_gate_template',opts.timeoutSec);
    process.stdout.write(`template ${template.name}: ${template.ledger.rows} migrations, head ${template.ledger.head} (${(template.migrateMs/1000).toFixed(1)}s)\n`);
    try{
      for(const gate of pending){
        process.stdout.write(`gate:${gate.name} ... `);
        const result=await runGate(gate,env,template,opts,serverVersion);
        writeFileSync(pathFor(gate.name),`${JSON.stringify(result,null,2)}\n`);
        const failed=result.steps.find(s=>s.status==='FAILED'||s.status==='SKIPPED');
        process.stdout.write(`${result.status} ${(result.durationMs/1000).toFixed(1)}s${failed?` (${failed.file||failed.command}: ${failed.failure.code})`:''}\n`);
      }
    }finally{
      if(!opts.keep){
        await adminQuery(env.MIGRATION_DATABASE_URL,`ALTER DATABASE ${template.name} IS_TEMPLATE false`).catch(()=>{});
        await adminQuery(env.MIGRATION_DATABASE_URL,`DROP DATABASE IF EXISTS ${template.name} WITH (FORCE)`).catch(()=>{});
      }
    }
  }
  const results=gates.map(g=>existsSync(pathFor(g.name))?JSON.parse(readFileSync(pathFor(g.name),'utf8')):{gate:g.name,status:'NOT_RUN'});
  const summary={schema_version:SCHEMA_VERSION,generated_at:new Date().toISOString(),postgres:serverVersion,
    gates:results.map(r=>({gate:r.gate,status:r.status,durationMs:r.durationMs??null,isolation:r.isolation??null})),
    status:results.every(r=>r.status==='PASSED')?'PASSED':'FAILED'};
  writeFileSync(join(opts.out,'summary.json'),`${JSON.stringify(summary,null,2)}\n`);
  process.stdout.write(`summary: ${summary.status} -> ${relative(SERVER_ROOT,join(opts.out,'summary.json'))}\n`);
  process.exit(summary.status==='PASSED'?0:1);
}

if(import.meta.url===`file://${process.argv[1]}`){
  main().catch(error=>{process.stderr.write(`gate-runner: ${error.message}\n`);process.exit(2);});
}
