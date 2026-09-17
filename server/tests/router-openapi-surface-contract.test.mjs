// Every route the HTTP router dispatches must be documented by an OpenAPI operation.
//
// router-kernel-surface-contract.test.mjs closes the router -> kernel direction (a route whose
// kernel method does not exist is a permanent 503) and the OpenAPI -> router direction by literal
// segment. The direction that stayed open is router -> OpenAPI: a dispatch clause that no
// OpenAPI path documents. That is how GET .../wbs/provider-signed/final1/orphans survived - it
// was dispatched, undocumented, unimplemented and therefore a permanent 503 (retired in S08/N02) -
// and how POST .../access/self-service-read-grant/activate stayed live but absent from the
// contract until R02 documented it.
//
// This test reads the router source, expands each dispatch condition into disjunctive normal form
// (so `parts.length===5||parts.length===7&&parts[6]==='review'` is checked as two routes), maps
// every alternative onto the OpenAPI path space (parts[0..1] are the fixed `api/v1` prefix, so
// OpenAPI segment j is parts[j+2]) and requires a documented operation for each. The only
// exemptions are clauses whose body is an explicit 404 ROUTE_NOT_FOUND guard: those exist to
// refuse undefined sub-paths and must not be documented.

import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const ROUTER=new URL('../api/accounting-http.mjs',import.meta.url);
const SPEC=new URL('../api/openapi-accounting.json',import.meta.url);

// Split a condition on top-level `&&` / `||`, honouring parentheses, brackets and quotes.
function splitTop(expr,operator){
  const parts=[];let depth=0,quote=null,start=0;
  for(let i=0;i<expr.length;i+=1){
    const ch=expr[i];
    if(quote){if(ch===quote&&expr[i-1]!=='\\')quote=null;continue;}
    if(ch==="'"||ch==='"'||ch==='`'){quote=ch;continue;}
    if(ch==='('||ch==='['||ch==='{')depth+=1;
    else if(ch===')'||ch===']'||ch==='}')depth-=1;
    else if(depth===0&&expr.startsWith(operator,i)){parts.push(expr.slice(start,i));i+=operator.length-1;start=i+1;}
  }
  parts.push(expr.slice(start));
  return parts.map(part=>part.trim()).filter(part=>part.length>0);
}
function unwrap(expr){
  let value=expr.trim();
  while(value.startsWith('(')){
    let depth=0,quote=null,closed=-1;
    for(let i=0;i<value.length;i+=1){
      const ch=value[i];
      if(quote){if(ch===quote&&value[i-1]!=='\\')quote=null;continue;}
      if(ch==="'"||ch==='"'||ch==='`'){quote=ch;continue;}
      if(ch==='(')depth+=1;else if(ch===')'){depth-=1;if(depth===0){closed=i;break;}}
    }
    if(closed!==value.length-1)break;
    value=value.slice(1,-1).trim();
  }
  return value;
}
// Disjunctive normal form: a list of alternatives, each a list of atomic conditions.
function toDnf(expr){
  const value=unwrap(expr);
  const ors=splitTop(value,'||');
  if(ors.length>1)return ors.flatMap(part=>toDnf(part));
  const ands=splitTop(value,'&&');
  if(ands.length>1)return ands.map(part=>toDnf(part)).reduce((left,right)=>left.flatMap(a=>right.map(b=>[...a,...b])),[[]]);
  return [[value]];
}
function conditionOf(line){
  const start=line.match(/^\s*(?:\}\s*else\s+if|else\s+if|if)\(/);
  if(!start)return null;
  let depth=0,quote=null;
  for(let i=start[0].length-1;i<line.length;i+=1){
    const ch=line[i];
    if(quote){if(ch===quote&&line[i-1]!=='\\')quote=null;continue;}
    if(ch==="'"||ch==='"'||ch==='`'){quote=ch;continue;}
    if(ch==='(')depth+=1;
    else if(ch===')'){depth-=1;if(depth===0)return line.slice(start[0].length,i);}
  }
  return null;
}
function routesOf(atoms){
  const lengths=new Set(),lits=new Map();
  for(const atom of atoms){
    const single=atom.match(/^parts\.length===(\d+)$/);
    if(single){lengths.add(Number(single[1]));continue;}
    const many=atom.match(/^\[((?:\d+,?)+)\]\.includes\(parts\.length\)$/);
    if(many){for(const value of many[1].split(','))lengths.add(Number(value));continue;}
    const literal=atom.match(/^parts\[(\d+)\]==='([^']*)'$/);
    if(literal){const set=lits.get(Number(literal[1]))??new Set();set.add(literal[2]);lits.set(Number(literal[1]),set);continue;}
    const oneOf=atom.match(/^\[((?:'[^']*',?)+)\]\.includes\(parts\[(\d+)\]\)$/);
    if(oneOf){const set=lits.get(Number(oneOf[2]))??new Set();for(const value of oneOf[1].matchAll(/'([^']*)'/g))set.add(value[1]);lits.set(Number(oneOf[2]),set);}
  }
  return {lengths:[...lengths],lits};
}
function methodOf(atoms){
  for(const atom of atoms){const match=atom.match(/^method==='([A-Z]+)'$/);if(match)return match[1];}
  return null;
}
async function readSurfaces(){
  const src=await readFile(ROUTER,'utf8');
  const spec=JSON.parse(await readFile(SPEC,'utf8'));
  const lines=src.split('\n');
  const postGate=lines.findIndex(line=>line.includes("if(method!=='POST')throw new AccountingApiError(405"));
  assert.ok(postGate>0,'the POST-only gate moved - this extraction depends on it');
  const nested=[];
  lines.forEach((line,index)=>{const match=line.match(/^\s*if\(method==='([A-Z]+)'\)\{\s*$/);if(match)nested.push({index,method:match[1]});});
  const clauses=[];
  lines.forEach((line,index)=>{
    const condition=conditionOf(line);
    if(condition==null)return;
    if(!/parts\.length/.test(condition))return;
    const next=(lines[index+1]??'').trim();
    // An unconditional 404 body is a guard clause; `if(method!=='GET')throw ... 404` instead pins the method.
    const guard=/^throw new AccountingApiError\(404,'ROUTE_NOT_FOUND'/.test(next);
    const nextMethod=next.match(/^if\(method!=='([A-Z]+)'\)throw new AccountingApiError\(404/);
    for(const atoms of toDnf(condition)){
      const {lengths,lits}=routesOf(atoms);
      if(lengths.length===0)continue;
      let methods=[];
      const declared=methodOf(atoms);
      if(declared!=null)methods=[declared];
      else if(nextMethod)methods=[nextMethod[1]];
      else{
        // A clause that branches on the method inside its own body serves every method it branches on.
        const inner=nested.filter(entry=>entry.index>index&&entry.index-index<40).map(entry=>entry.method);
        if(inner.length>0)methods=[...new Set(inner)];
        else if(index>postGate)methods=['POST'];
      }
      for(const method of methods.length>0?methods:[null])clauses.push({line:index+1,method,lengths,lits,guard,condition:condition.slice(0,160)});
    }
  });
  const operations=[];
  for(const [path,item] of Object.entries(spec.paths??{})){
    const segments=['api','v1',...path.split('/').filter(Boolean)];
    for(const [method,operation] of Object.entries(item??{})){
      if(!/^(get|post|put|patch|delete)$/.test(method))continue;
      operations.push({path,method:method.toUpperCase(),segments,operationId:operation.operationId});
    }
  }
  return {clauses,operations};
}
function matches(clause,operation){
  if(clause.method!=null&&clause.method!==operation.method)return false;
  if(!clause.lengths.includes(operation.segments.length))return false;
  for(const [index,values] of clause.lits){
    const segment=operation.segments[index];
    if(segment==null)return false;
    if(/^\{.*\}$/.test(segment))continue; // the contract parameterizes a segment the router pins
    if(![...values].includes(segment))return false;
  }
  return true;
}

test('the router and contract surfaces are both extracted - the census has not silently gone empty',async()=>{
  const {clauses,operations}=await readSurfaces();
  assert.ok(clauses.length>300,`only ${clauses.length} router dispatch alternatives extracted - the condition parser drifted`);
  assert.ok(operations.length>300,`only ${operations.length} OpenAPI operations read - the contract or this reader drifted`);
  assert.ok(clauses.some(clause=>clause.guard),'no explicit 404 ROUTE_NOT_FOUND guard clause found - the guard detector drifted');
  assert.ok(clauses.every(clause=>clause.method!=null),'every dispatch alternative must resolve to an HTTP method');
});

test('every route the router dispatches is documented by an OpenAPI operation',async()=>{
  const {clauses,operations}=await readSurfaces();
  const undocumented=clauses
    .filter(clause=>!clause.guard)
    .filter(clause=>!operations.some(operation=>matches(clause,operation)))
    .map(clause=>`accounting-http.mjs:${clause.line} ${clause.method} ${clause.condition}`);
  assert.deepEqual(undocumented,[],
    `the router dispatches routes that no OpenAPI operation documents - document them or remove them:\n  ${undocumented.join('\n  ')}`);
});

test('explicit 404 ROUTE_NOT_FOUND guards stay undocumented',async()=>{
  const {clauses,operations}=await readSurfaces();
  const documentedGuards=clauses
    .filter(clause=>clause.guard)
    .filter(clause=>operations.some(operation=>matches(clause,operation)))
    .map(clause=>`accounting-http.mjs:${clause.line} ${clause.condition}`);
  assert.deepEqual(documentedGuards,[],
    `a clause that only throws 404 ROUTE_NOT_FOUND is documented as a real operation:\n  ${documentedGuards.join('\n  ')}`);
});

test('the Final-1 provider-signed family is documented in both directions',async()=>{
  const {clauses,operations}=await readSurfaces();
  const final1Clauses=clauses.filter(clause=>[...clause.lits.values()].some(values=>values.has('final1')));
  assert.ok(final1Clauses.length>=2,`only ${final1Clauses.length} Final-1 dispatch alternatives found - extraction drifted`);
  const undocumented=final1Clauses.filter(clause=>!operations.some(operation=>matches(clause,operation)))
    .map(clause=>`accounting-http.mjs:${clause.line} ${clause.condition}`);
  assert.deepEqual(undocumented,[],'a Final-1 route is dispatched without a contract entry');
  const final1Operations=operations.filter(operation=>operation.segments.includes('final1'));
  assert.ok(final1Operations.length>=6,`only ${final1Operations.length} Final-1 operations documented - contract drifted`);
  const unserved=final1Operations.filter(operation=>!clauses.some(clause=>matches(clause,operation)))
    .map(operation=>`${operation.method} ${operation.path}`);
  assert.deepEqual(unserved,[],'a Final-1 path is documented but no dispatch clause serves it');
  assert.equal(final1Operations.some(operation=>operation.segments.includes('orphans')),false,
    'the retired Final-1 orphan lifecycle path must not be reintroduced into the contract without a kernel method');
});

test('the Stage 1 self-service read activation route is documented',async()=>{
  const {operations}=await readSurfaces();
  const operation=operations.find(entry=>entry.path==='/entities/{entityId}/access/self-service-read-grant/activate'&&entry.method==='POST');
  assert.ok(operation,'the live Stage 1 read activation route must stay documented');
  assert.equal(operation.operationId,'activateStage1SelfServiceReadAccess');
});
