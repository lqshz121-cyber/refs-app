import assert from 'node:assert/strict';
import { retainActiveNavigationGroup, toggleNavigationGroup } from './src/navigation-open-state.js';

const groups = [
  {group:'Control Center',items:[['dashboard','Dashboard'],['aiAudit','AI Audit Center']]},
  {group:'Accounting Settings',items:[['settings','Core settings'],['rules','Rule Center']]},
  {group:'Reports',items:[['reports','Reports']]},
];

let state = retainActiveNavigationGroup({},groups,'aiAudit');
assert.deepEqual(state,{'Control Center':true});

state = retainActiveNavigationGroup(state,groups,'rules');
assert.deepEqual(state,{'Control Center':true,'Accounting Settings':true},'opening a second route must retain the first expanded group');

const unchanged = retainActiveNavigationGroup(state,groups,'reports');
assert.equal(unchanged,state,'singleton navigation must not alter expanded multi-group state');

state = toggleNavigationGroup(state,'Control Center');
assert.deepEqual(state,{'Control Center':false,'Accounting Settings':true},'only an explicit group-header toggle may collapse that group');

console.log('Navigation multi-expand contract verified.');
