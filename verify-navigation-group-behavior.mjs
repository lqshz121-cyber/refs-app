import assert from 'node:assert/strict';
import { localNavigationGroupBehavior, localVisibleNavigationItems } from './src/navigation-group-behavior.js';

assert.deepEqual(localNavigationGroupBehavior([['je','Journal Entries']]),{kind:'DIRECT',route:'je',label:'Journal Entries'});
assert.deepEqual(localNavigationGroupBehavior([['gl','General Ledger'],['coa','Chart of Accounts']]),{kind:'EXPANDABLE',route:null,label:null});
assert.deepEqual(localVisibleNavigationItems([['je','Journal Entries'],['je','Create Journal Entry'],['gl','General Ledger']]),[['je','Journal Entries'],['gl','General Ledger']]);
assert.deepEqual(localNavigationGroupBehavior([['je','Journal Entries'],['je','Create Journal Entry']]),{kind:'DIRECT',route:'je',label:'Journal Entries'});
console.log('navigation group behavior: every one-destination parent routes directly without a duplicate child');
