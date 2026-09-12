import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {alignedIntercompanyCounterpartyScopes,authorizedIntercompanyEliminationScopes,intercompanyEliminationScopeKey} from '../src/intercompany-elimination-ui-model.js';

const scope=(entity,period,patch={})=>({entity_id:entity,period_id:period,entity_code:`E${entity[0]}`,entity_name:`Entity ${entity[0]}`,period_code:'2026-09',period_start:'2026-09-01',period_end:'2026-09-30',base_currency:'USD',...patch});
const a=scope('11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),b=scope('22222222-2222-4222-8222-222222222222','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'),wrongDate=scope('33333333-3333-4333-8333-333333333333','cccccccc-cccc-4ccc-8ccc-cccccccccccc',{period_end:'2026-10-31'}),wrongCurrency=scope('44444444-4444-4444-8444-444444444444','dddddddd-dddd-4ddd-8ddd-dddddddddddd',{base_currency:'CAD'});

test('member selectors accept only complete unique authorized catalog scopes',()=>{
 const invalid={...a,period_start:'2026-02-31'},rows=authorizedIntercompanyEliminationScopes([a,{...a},b,invalid,{entity_id:'manual',period_id:'manual'}]);
 assert.deepEqual(rows,[a,b]);assert.equal(intercompanyEliminationScopeKey(a),`${a.entity_id}:${a.period_id}`);
});

test('counterparty choices require another company with the same dates and currency',()=>{
 assert.deepEqual(alignedIntercompanyCounterpartyScopes([a,b,wrongDate,wrongCurrency],a),[b]);
 assert.deepEqual(alignedIntercompanyCounterpartyScopes([a],a),[]);assert.deepEqual(alignedIntercompanyCounterpartyScopes([a],null),[]);
});

test('reports UI starts with an empty reason, renders actions only from server flags and refreshes consolidation after Post',async()=>{
 const [workspace,app,client]=await Promise.all([readFile(new URL('../src/authoritative-reports-workspace.jsx',import.meta.url),'utf8'),readFile(new URL('../src/authoritative-app.jsx',import.meta.url),'utf8'),readFile(new URL('../src/accounting-api.js',import.meta.url),'utf8')]);
 assert.match(workspace,/useState\(''\).*eliminationReason|eliminationReason.*useState\(''\)/s);assert.doesNotMatch(workspace,/setEliminationReason\(['"](?:Approved|Reviewed|Submit|Cancel)/);
 for(const flag of ['can_create_draft','can_submit','can_review','can_approve','can_cancel','can_post'])assert.match(workspace,new RegExp(`action_flags\\.${flag}`));
 assert.match(workspace,/if\(action==='POST'\)await loadConsolidation\(\)/);assert.match(workspace,/authorizedIntercompanyEliminationScopes\(scopes\)/);assert.match(app,/route === 'intercompany'.*scopes=\{scopeCatalog\}/);assert.match(app,/route === 'consolidation'.*scopes=\{scopeCatalog\}/);
 const keyFunction=client.slice(client.indexOf('export async function intercompanyEliminationCommandIdempotencyKey'),client.indexOf('export async function refreshAuthoritativeIntercompanyEliminations'));assert.doesNotMatch(keyFunction,/Date\.now|Math\.random/);
});
