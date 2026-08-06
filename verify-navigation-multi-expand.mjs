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
import { retainActiveNavigationGroup, toggleNavigationGroup } from './src/navigation-open-state.js';

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

// An explicit header toggle on the focused group closes the panel.
const beforeCollapse = state;
state = toggleNavigationGroup(state, 'Accounting Settings');
assert.deepEqual(state, {}, 're-selecting the focused group must close the panel');
assert.deepEqual(
  beforeCollapse,
  { 'Accounting Settings': true },
  'group state updates must be immutable',
);

// The same header reopens it.
state = toggleNavigationGroup(state, 'Accounting Settings');
assert.deepEqual(state, { 'Accounting Settings': true }, 'the same header must reopen the group');

// Toggling a different header moves focus rather than adding a second list.
state = toggleNavigationGroup(state, 'Control Center');
assert.deepEqual(
  state,
  { 'Control Center': true },
  'toggling another header must move focus, leaving exactly one group listed',
);

// A direct route into an explicitly closed panel reopens the owning group.
state = toggleNavigationGroup(state, 'Control Center');
assert.deepEqual(state, {});
state = retainActiveNavigationGroup(state, groups, 'dashboard');
assert.deepEqual(
  state,
  { 'Control Center': true },
  'a direct route into a closed panel must reopen its owning group',
);

// Whatever the sequence, never more than one group is listed.
const openCount = Object.values(state).filter(Boolean).length;
assert.equal(openCount, 1, 'the panel must never list more than one group');

console.log('navigation-panel-focus: one group listed at a time, singleton-safe, immutable, reference-stable');
