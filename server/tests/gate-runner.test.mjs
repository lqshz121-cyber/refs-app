// R04: the per-gate database runner's pure parts -- no database needed.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {readGates, retargetEnv, stepOutcome, gateStatus, ident, URL_KEYS} from '../tools/gate-runner.mjs';

const pkg=JSON.parse(readFileSync(new URL('../package.json',import.meta.url),'utf8'));

test('GR-1: gates are read from package.json in gate:all order, so the runner cannot drift from npm run gate:*',()=>{
  const gates=readGates(pkg);
  const order=pkg.scripts['gate:all'].split('&&').map(s=>s.trim().replace(/^npm run (--silent )?gate:/,''));
  assert.deepEqual(gates.map(g=>g.name),order);
  for(const g of gates){
    assert.equal(g.steps.map(s=>s.command).join(' && '),pkg.scripts[`gate:${g.name}`],`gate:${g.name} steps must reproduce the script exactly`);
    assert.ok(g.steps.length>0);
  }
  assert.ok(gates.find(g=>g.name==='barriers').steps.every(s=>s.file),'barrier steps are all test files');
});

test('GR-2: an undefined gate referenced by gate:all is an error, not a silent omission',()=>{
  assert.throws(()=>readGates({scripts:{'gate:all':'npm run gate:a && npm run gate:missing','gate:a':'node --test x.mjs'}}),/gate:missing/);
});

test('GR-3: all four role URLs are retargeted together (strict runtimeConfig requires one endpoint)',()=>{
  const env=Object.fromEntries(URL_KEYS.map((k,i)=>[k,`postgresql://u${i}@h:5432/base`]));
  const out=retargetEnv({...env,OTHER:'x'},'refs_gate_x');
  for(const k of URL_KEYS)assert.equal(new URL(out[k]).pathname,'/refs_gate_x');
  for(const k of URL_KEYS)assert.equal(new URL(out[k]).username,new URL(env[k]).username,'credentials are preserved');
  assert.equal(out.OTHER,'x');
  assert.equal(new URL(env.DATABASE_URL).pathname,'/base','the input env is not mutated');
});

test('GR-4: a gate cannot pass by skipping',()=>{
  const step={command:'node --test a.mjs',file:'a.mjs'};
  const skipped=stepOutcome(step,{stdout:'# tests 3\n# pass 0\n# fail 0\n# skipped 3\n',stderr:'',exitCode:0,signal:null,timedOut:false,durationMs:1});
  assert.equal(skipped.status,'SKIPPED');
  assert.equal(gateStatus([skipped]),'FAILED');
  const passed=stepOutcome(step,{stdout:'# tests 3\n# pass 3\n# fail 0\n# skipped 0\n',stderr:'',exitCode:0,signal:null,timedOut:false,durationMs:1});
  assert.equal(passed.status,'PASSED');
  assert.equal(gateStatus([passed]),'PASSED');
  assert.equal(gateStatus([]),'FAILED','an empty gate proves nothing');
});

test('GR-5: failures are classified with the R13 taxonomy and keep an excerpt',()=>{
  const o=stepOutcome({command:'node --test b.mjs',file:'b.mjs'},{stdout:'not ok 1 - x\n  error: connect ECONNREFUSED 127.0.0.1:1\n# tests 1\n# fail 1\n',stderr:'',exitCode:1,signal:null,timedOut:false,durationMs:1});
  assert.equal(o.status,'FAILED');
  assert.equal(o.failure.code,'POSTGRES_UNAVAILABLE');
  assert.match(o.excerpt,/ECONNREFUSED/);
  const t=stepOutcome({command:'node --test c.mjs',file:'c.mjs'},{stdout:'',stderr:'',exitCode:null,signal:'SIGKILL',timedOut:true,durationMs:1});
  assert.equal(t.failure.code,'TIMEOUT');
});

test('GR-6: database identifiers are validated before they reach SQL',()=>{
  assert.equal(ident('refs_gate_barriers_abc'),'refs_gate_barriers_abc');
  for(const bad of ['x;DROP DATABASE y','Refs','a-b','',`a${'b'.repeat(63)}`])assert.throws(()=>ident(bad));
});
