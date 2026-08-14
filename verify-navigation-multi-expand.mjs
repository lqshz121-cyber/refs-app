// Authoritative navigation disclosure contract.
//
// Finance teams commonly keep several work areas open while moving from a
// bank exception to its journal and report. A child-page selection must not
// collapse another group: only its own visible group heading can do that.

import assert from 'node:assert/strict';
import fs from 'node:fs';

const shell = fs.readFileSync(new URL('./src/authoritative-navigation-shell.jsx', import.meta.url), 'utf8');
const app = fs.readFileSync(new URL('./src/authoritative-app.jsx', import.meta.url), 'utf8');

const toggle = (groups, label) => groups.includes(label)
  ? groups.filter(value => value !== label)
  : [...groups, label];

let groups = ['Source & Staging'];
groups = toggle(groups, 'Auto Reconciliation');
assert.deepEqual(groups, ['Source & Staging', 'Auto Reconciliation'], 'two finance work areas may remain open together');
groups = toggle(groups, 'Source & Staging');
assert.deepEqual(groups, ['Auto Reconciliation'], 'a heading collapses only its own group');

assert.match(app, /const \[expandedNavigationGroups, setExpandedNavigationGroups\]/,
  'authoritative navigation keeps a collection of open groups');
assert.match(app, /current\.includes\(groupLabel\) \? current : \[\.\.\.current, groupLabel\]/,
  'routing to a child page preserves any already-open groups');
assert.match(app, /current\.includes\(group\.label\)\s*\? current\.filter\(label => label !== group\.label\)\s*:\s*\[\.\.\.current, group\.label\]/,
  'only a group-heading action changes its disclosure state');
assert.match(shell, /const expanded = new Set\(expandedGroups \|\| \[\]\)/,
  'the shell renders every retained disclosure state');
assert.match(shell, /navigation\.map\(\(group, index\) => \{/,
  'the panel keeps all groups available instead of replacing the active group list');
assert.match(shell, /aria-expanded=\{isExpanded\}/,
  'each disclosure heading exposes its state to assistive technology');
assert.match(shell, /<Icon name=\{isExpanded \? 'chevronDown' : 'chevronRight'\}/,
  'disclosure controls use an icon rather than a letter or status word');
assert.doesNotMatch(shell, /API_UNAVAILABLE|authoritative-nav-status|Unavailable/,
  'the navigation row stays reserved for its complete workspace name');

console.log('authoritative-navigation: multiple groups remain open; only the group heading changes its own disclosure state');
