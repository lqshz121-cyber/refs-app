import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {dirname,resolve} from 'node:path';

const serverRoot=resolve(dirname(fileURLToPath(import.meta.url)),'..');

export const FIXTURES=Object.freeze([
  Object.freeze({id:'controlled-ap-close',pattern:'controlled DEMO tenant runs one AP Bill through HTTP Draft, four-role Post, GL, TB and AP aging without affecting another tenant'}),
  Object.freeze({id:'ar-rent-pickup-close',pattern:'isolated property rent pickup carries invoice and bank receipt evidence through AR, JE, GL, trial balance, and reports'}),
  Object.freeze({id:'signed-wbs-payable-post',pattern:'provider-signed Payable admission atomically reaches Review Draft four-role Post and same-JE reports'}),
  Object.freeze({id:'signed-bank-same-source-close',pattern:'provider-signed Bank source survives exact Match Unmatch adjustment Post reconciliation and same-source reports'}),
  Object.freeze({id:'bank-reconcile-close',pattern:'Stage 2 test-data chain traces one reconciled bank payment through its posted JE, GL, TB and report rows'}),
  Object.freeze({id:'wbs-autorec-event-foundation',pattern:'independent AutoRec review and immutable accounting-event foundation enforce exact evidence and fail-closed Draft producers'}),
  Object.freeze({id:'ai-exception-lineage',pattern:'operator exception row links append-only to the later exact signed Payable source without becoming Review authority'}),
  Object.freeze({id:'real-estate-reports',pattern:'cash flow statement classifies|CWIP rollforward admits|construction-loan rollforward admits|prepaid rollforward admits|intercompany reconciliation requires|budget versus actual reads|consolidation reads only'})
]);

export function selectFixtures(args=[]){
  if(args.length===0)return FIXTURES;
  if(args.length!==2||args[0]!=='--fixture'||!args[1])throw new Error('Usage: node runtime/run-postgres-fixture-suite.mjs [--fixture <id>]');
  const fixture=FIXTURES.find(value=>value.id===args[1]);
  if(!fixture)throw new Error(`Unknown PostgreSQL fixture: ${args[1]}`);
  return [fixture];
}

export function readTapSummary(output){
  const summary={};
  for(const key of ['tests','pass','fail','skipped']){
    const match=output.match(new RegExp(`^# ${key} (\\d+)$`,'m'));
    if(!match)return null;
    summary[key]=Number(match[1]);
  }
  return summary;
}

export function fixtureResult({id,exitCode,output,durationMs,signal=null,error=null}){
  const tap=readTapSummary(output);
  const verified=tap!==null&&tap.tests>0&&tap.pass>0&&tap.fail===0&&tap.skipped===0;
  return Object.freeze({
    id,
    exitCode:verified&&exitCode===0?0:1,
    durationMs,
    signal,
    error:error??(verified&&exitCode===0?null:'Fixture must execute at least one passing, non-skipped PostgreSQL test.'),
    tap
  });
}

function runFixture(fixture,env){
  return new Promise(resolveRun=>{
    const startedAt=Date.now();
    const child=spawn(process.execPath,['runtime/test-postgres-fresh.mjs','--pattern',fixture.pattern],{cwd:serverRoot,env,stdio:['ignore','pipe','pipe']});
    let output='';
    child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');
    child.stdout.on('data',chunk=>{output+=chunk;process.stdout.write(chunk);});
    child.stderr.on('data',chunk=>{output+=chunk;process.stderr.write(chunk);});
    child.once('error',error=>resolveRun(fixtureResult({id:fixture.id,exitCode:1,output,durationMs:Date.now()-startedAt,error:error.message})));
    child.once('exit',(code,signal)=>resolveRun(fixtureResult({id:fixture.id,exitCode:code??1,output,durationMs:Date.now()-startedAt,signal:signal??null})));
  });
}

export async function runFixtureSuite({fixtures=FIXTURES,env=process.env}={}){
  const results=[];
  for(const fixture of fixtures)results.push(await runFixture(fixture,env));
  return {schema:'REFS_POSTGRES_FIXTURE_SUITE_V1',image:env.POSTGRES_IMAGE||'postgres:16-alpine',fixtures:results,pass:results.every(result=>result.exitCode===0)};
}

if(process.argv[1]===fileURLToPath(import.meta.url)){
  const summary=await runFixtureSuite({fixtures:selectFixtures(process.argv.slice(2))});
  console.log(JSON.stringify(summary));
  if(!summary.pass)process.exitCode=1;
}
