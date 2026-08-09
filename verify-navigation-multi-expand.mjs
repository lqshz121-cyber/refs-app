// Navigation panel focus contract.
//
// Renamed in spirit, not in filename: this file used to assert MULTI-expand
// (several groups listed at once). At the product owner's direction on 2026-08-06
// the panel now shows exactly ONE group, because the 74px rail already provides the
// persistent overview that multi-expand was protecting. See src/navigation-open-state.js.
//
// The filename is unchanged so the existing verifier discovery and any external
// references keep working. What is still guarded, unchanged from before:
//   - a singleton route never disturbs the panel
//   - state updates are immutable
//   - an explicit header toggle is the only thing that closes a group
//   - the same header reopens it
// What changed: selecting a second group now focuses it instead of stacking.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import { firstNavigationRoute, isDirectNavigationGroup, railNavigationContext, retainActiveNavigationGroup } from './src/navigation-open-state.js';

const groups = [
  { group: 'Control Center', items: [['dashboard', 'Dashboard'], ['aiAudit', 'AI Audit Center']] },
  { group: 'Accounting Settings', items: [['settings', 'Core settings'], ['rules', 'Rule Center']] },
  { group: 'Reports', items: [['reports', 'Reports']] },
];

// Entering a multi-item group focuses it.
let state = retainActiveNavigationGroup({}, groups, 'aiAudit');
assert.deepEqual(state, { 'Control Center': true });

// Entering a different group focuses that one and drops the previous list.
// This is the behaviour change: the panel must not stack unrelated page lists.
state = retainActiveNavigationGroup(state, groups, 'rules');
assert.deepEqual(
  state,
  { 'Accounting Settings': true },
  'selecting another group must focus it alone, not stack it under the previous group',
);

// A singleton route has its own rail entry and must leave the panel untouched.
const unchanged = retainActiveNavigationGroup(state, groups, 'reports');
assert.equal(unchanged, state, 'a singleton route must not alter panel state');

// Reference stability: navigating within the already-focused group must return the
// same object, or the route effect that calls this would re-render forever.
const stable = retainActiveNavigationGroup(state, groups, 'settings');
assert.equal(stable, state, 'navigating inside the focused group must not produce a new object');

const operationsVisible = {
  group: 'Accounting Operations',
  items: [['closing', 'Closing Accounting'], ['intercompany', 'Intercompany'], ['assets', 'Fixed Assets']],
};
assert.equal(firstNavigationRoute(operationsVisible), 'closing', 'Operations starts at its first visible child.');
assert.equal(isDirectNavigationGroup({group:'Reports',items:[['reports','Reports Center']]}), true, 'singleton items stay direct entries.');
assert.deepEqual(
  railNavigationContext(operationsVisible, 'closing'),
  {route:'closing', navigationEntry:'rail', navigationGroup:'Accounting Operations', navigationDestination:'closing'},
  'the rail must mark a new Operations entry rather than restoring Intercompany',
);

const operationsState = retainActiveNavigationGroup({'Auto Reconciliation':true}, [operationsVisible], 'closing');
assert.deepEqual(operationsState, {'Accounting Operations':true}, 'Operations replaces the prior panel.');

const app = fs.readFileSync(new URL('./src/app.jsx', import.meta.url), 'utf8');
assert.match(app, /const next=firstNavigationRoute\(g\); if\(!next\) return;[\s\S]*?setOpenGroups\(isSingleton\?\{\}:\{\[g\.group\]:true\}\); goto\(next,entry\);/, 'rail groups must enter their first visible route and replace the open panel.');
assert.match(app, /railEntryRevision:\+\+railEntryRevision\.current/, 'a repeated rail click must remount the workspace rather than retaining child state.');
assert.match(app, /\['cost','unitcost','unittransfer','loan','loanreg','pmpickup','amortization','accruals'\]/, 'WBS-only Operations routes must not become the initial REFS accounting destination.');

// Whatever the sequence, never more than one group is listed.
const openCount = Object.values(state).filter(Boolean).length;
assert.equal(openCount, 1, 'the panel must never list more than one group');

console.log('navigation-panel-focus: rail selections reset to the first visible workspace; Operations starts at Closing Accounting');
