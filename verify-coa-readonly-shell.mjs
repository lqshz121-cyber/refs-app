import { strict as assert } from 'node:assert';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('./src/module-coa.jsx', import.meta.url), 'utf8');

for (const required of [
  'Chart of Accounts',
  'Filter by name or number',
  'Register/GL drillback',
  'Account creation, editing, activation, and deactivation are unavailable.',
  'chartAccountDrill(r)',
  "coaReturn:{route:'coa',tab,qboQuery,entityId:entity || ''}",
]) assert.ok(source.includes(required), `COA readonly shell must retain ${required}`);

for (const forbidden of [
  'exportName="wbs-coa-full"',
  'exportName="chart-of-accounts"',
  'Export CSV',
  'Create account',
  'Edit account',
  'Merge account',
  'Delete account',
]) assert.ok(!source.includes(forbidden), `COA readonly shell must not expose ${forbidden}`);

console.log('coa-readonly-shell: all assertions passed');
