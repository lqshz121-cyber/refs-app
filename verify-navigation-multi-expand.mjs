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

const collapsedState = state;
state = retainActiveNavigationGroup(state,groups,'rules');
assert.equal(state,collapsedState,'navigating inside an already-open group must not rewrite other group state');

state = retainActiveNavigationGroup(state,groups,'dashboard');
assert.deepEqual(
  state,
  {'Control Center':true,'Accounting Settings':true},
  'a direct route into an explicitly collapsed group must reopen it without folding another group',
);

const beforeToggle = state;
state = toggleNavigationGroup(state,'Accounting Settings');
assert.deepEqual(state,{'Control Center':true,'Accounting Settings':false});
assert.deepEqual(beforeToggle,{'Control Center':true,'Accounting Settings':true},'group state updates must be immutable');

state = toggleNavigationGroup(state,'Accounting Settings');
assert.deepEqual(state,{'Control Center':true,'Accounting Settings':true},'the same group header must explicitly reopen the group');

console.log('Navigation multi-expand contract verified.');
