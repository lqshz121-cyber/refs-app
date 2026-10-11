import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';

// Executes the component's actual callback. Not mounted UI or live API evidence.
const source=readFileSync(new URL('../src/authoritative-bank-workspace.jsx',import.meta.url),'utf8');
const start=source.indexOf('  const start=async()=>{',source.indexOf('export function AuthoritativeAdmittedStatements'));
const end=source.indexOf('\n',start);
assert.ok(start>0&&end>start);
const callback=source.slice(start,end);

function fixture({duringCommand=()=>{},duringParent=()=>{},allowed=true,result={ok:true,data:{}}}={}){
  const events=[];
  const epoch={current:1},scope={current:'company-A'};
  const bindings={detail:{row:{id:'synthetic-only'}},scopeKey:'company-A',readEpoch:epoch,readScope:scope,
    config:{},currentActorAccess:{},canStartReconciliation:()=>allowed,reason:'controller reason',fetcher:()=>{},
    setDetail:update=>events.push(['state',typeof update==='function'?update({}):update]),
    startAuthoritativeReconciliationFromAdmittedStatement:async()=>{events.push(['command']);await duringCommand({epoch,scope});return result;},
    onStarted:async()=>{events.push(['parent']);await duringParent({epoch,scope});},
    load:async()=>events.push(['load'])};
  const run=Function(...Object.keys(bindings),callback+';return start;')(...Object.values(bindings));
  return{run,events};
}

test('signed start rejects missing authority before adapter invocation',async()=>{
  const f=fixture({allowed:false});await f.run();assert.deepEqual(f.events,[]);
});
test('signed start completes current-scope parent refresh then list refresh',async()=>{
  const f=fixture();await f.run();assert.deepEqual(f.events.map(e=>e[0]),['state','command','parent','state','load']);
  assert.equal(f.events[3][1].phase,'STARTED');
});
test('signed start preserves current-scope API denial without parent refresh',async()=>{
  const failure={ok:false,code:'SYNTHETIC_DENIAL'};
  const f=fixture({result:failure});await f.run();assert.deepEqual(f.events.map(e=>e[0]),['state','command','state']);
  assert.equal(f.events[2][1].error,failure);
});
for(const boundary of ['duringCommand','duringParent'])for(const change of ['unmount','company']){
  test(`signed start discards ${change} completion ${boundary}`,async()=>{
    const f=fixture({[boundary]:async({epoch,scope})=>{if(change==='unmount')epoch.current++;else scope.current='company-B';}});
    await f.run();assert.deepEqual(f.events.map(e=>e[0]),boundary==='duringCommand'?['state','command']:['state','command','parent']);
  });
}
