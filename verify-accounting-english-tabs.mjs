import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./src/module-coa.jsx', import.meta.url), 'utf8');
for (const required of [
  "const WBS_TAB = 'WBS chart of accounts (766)'",
  "const LOCAL_TAB = 'Local posting accounts'",
  '<h2 className="page-h">Chart of Accounts</h2>',
  '<Tabs tabs={[WBS_TAB, LOCAL_TAB]} active={tab} onChange={setTab}/>',
  'tab===WBS_TAB',
  'tab!==WBS_TAB',
  'Register/GL drills are functional',
]) assert.ok(source.includes(required), `missing Accounting English-shell contract: ${required}`);
assert.ok(!source.includes('<h2 className="page-h">科目'), 'COA page heading must be English-only');
assert.doesNotMatch(source, /[\p{Script=Han}]/u, 'COA source must not retain CJK visible labels or legacy aliases');
assert.ok(source.includes('Creating accounts is excluded from the retained-evidence workflow'), 'COA writes must remain unavailable');
assert.ok(!source.includes('actions.addAccount'), 'COA write action must not remain reachable');
console.log('PASS: Accounting COA English tab, read-only boundary, and retained-drill contract are present.');
