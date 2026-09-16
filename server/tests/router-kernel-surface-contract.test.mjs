// Every kernel method the HTTP router dispatches to must exist on the kernel.
//
// accounting-http.mjs guards each dispatch with
//   if(typeof kernel.<name>!=='function') throw new AccountingApiError(503, ...)
// which is the right fail-closed shape at runtime, but it also means a route
// whose kernel method was never implemented is a permanent, silent 503 that no
// unit test with a stubbed kernel will ever notice. This test reads the router
// source, collects every `kernel.<name>` it references, and checks each against
// PostgresAccountingKernel.prototype - the real kernel, not a stub.
//
// Known gap, recorded rather than hidden: GET .../wbs/provider-signed/final1/orphans
// (accounting-http.mjs ~:822) calls readWbsProviderFinal1OrphanLifecycle, which no
// kernel implements and no OpenAPI path documents. Removing the route or adding
// the method must update KNOWN_UNIMPLEMENTED so the list never grows silently.

import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PostgresAccountingKernel} from '../runtime/kernel-repository.mjs';

const KNOWN_UNIMPLEMENTED=Object.freeze(['readWbsProviderFinal1OrphanLifecycle']);

test('every kernel method referenced by the HTTP router exists on PostgresAccountingKernel, except the recorded known gaps',async()=>{
  const src=await readFile(new URL('../api/accounting-http.mjs',import.meta.url),'utf8');
  const referenced=[...new Set([...src.matchAll(/\bkernel\.([a-zA-Z_][a-zA-Z0-9_]*)\s*(?:\(|!==|===)/g)].map(m=>m[1]))].sort();
  assert.ok(referenced.length>200,`router references only ${referenced.length} kernel methods - extraction regex drifted`);
  const missing=referenced.filter(name=>typeof PostgresAccountingKernel.prototype[name]!=='function').sort();
  assert.deepEqual(missing,[...KNOWN_UNIMPLEMENTED].sort(),
    `router dispatches to kernel methods that do not exist (each is a permanent 503):\n  ${missing.join('\n  ')}`);
});

test('the known-gap list does not name a method that has since been implemented',()=>{
  for(const name of KNOWN_UNIMPLEMENTED)assert.notEqual(typeof PostgresAccountingKernel.prototype[name],'function',`${name} is implemented now - remove it from KNOWN_UNIMPLEMENTED`);
});

test('every OpenAPI operation has a unique operationId and every path is served by a dispatch clause on its literal segments',async()=>{
  const spec=JSON.parse(await readFile(new URL('../api/openapi-accounting.json',import.meta.url),'utf8'));
  const src=await readFile(new URL('../api/accounting-http.mjs',import.meta.url),'utf8');
  const literals=new Set([...src.matchAll(/parts\[\d+\]==='([^']+)'/g)].map(m=>m[1]).concat([...src.matchAll(/\['([^\]]+)'\]\.includes\(parts\[\d+\]\)/g)].flatMap(m=>m[1].split("','"))));
  const ids=[];const unserved=[];
  for(const [path,item] of Object.entries(spec.paths||{})){
    for(const [method,op] of Object.entries(item||{})){if(!/^(get|post|put|patch|delete)$/.test(method))continue;ids.push(op.operationId);}
    // Every literal (non-parameter) segment of the path must appear as a dispatch literal somewhere in the router.
    for(const seg of path.split('/').filter(Boolean)){if(/^\{.*\}$/.test(seg)||['api','v1','entities'].includes(seg))continue;if(!literals.has(seg))unserved.push(`${path} (segment "${seg}")`);}
  }
  assert.equal(new Set(ids).size,ids.length,'operationIds must be unique');
  assert.ok(ids.every(id=>typeof id==='string'&&id.length>0),'every operation needs an operationId');
  assert.deepEqual(unserved,[],'OpenAPI documents a path with a literal segment the router never dispatches on');
});
