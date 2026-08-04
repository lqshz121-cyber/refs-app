import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { chartAccountControlState, chartAccountDrill, chartAccountScope } from './src/chart-account-actions.js';

assert.deepEqual(chartAccountDrill({ account_code: '111000', account_name: 'Operating Cash', account_type: 'ASSET' }), { label:'View register', route:'register', context:{route:'register',accountCode:'111000'} }, 'asset account opens its local register');
assert.deepEqual(chartAccountDrill({ account_code: '220200', account_name: 'Accounts Payable', account_type: 'LIABILITY' }), { label:'Run report', route:'gl', context:{route:'gl',tab:'GL Detail',drillAccounts:['220200'],drillLabel:'220200 Accounts Payable'} }, 'non-cash liability stays in scoped GL Detail');
assert.deepEqual(chartAccountDrill({ account_code: '380104', account_name: 'Member Equity', account_type: 'EQUITY' }), { label:'Run report', route:'gl', context:{route:'gl',tab:'GL Detail',drillAccounts:['380104'],drillLabel:'380104 Member Equity'} }, 'equity stays in scoped GL Detail');
assert.deepEqual(chartAccountDrill({ account_code: '482000', account_name: 'Interest income', account_type: 'REVENUE' }), { label:'Run report', route:'gl', context:{route:'gl',tab:'GL Detail',drillAccounts:['482000'],drillLabel:'482000 Interest income'} }, 'non-asset account opens a scoped GL report');
assert.equal(chartAccountScope('111000'), 'Operating');
assert.equal(chartAccountScope('112000'), 'Escrow');
assert.equal(chartAccountControlState('120200'), 'AR control');
assert.equal(chartAccountControlState('291001'), 'AP control');
const coaUi = readFileSync(new URL('./src/module-coa.jsx', import.meta.url), 'utf8');
const registerUi = readFileSync(new URL('./src/module-register.jsx', import.meta.url), 'utf8');
assert.match(coaUi, /const context=\{\.\.\.action\.context,entityId:entity \|\| '',coaReturn:\{route:'coa',tab,qboQuery,entityId:entity \|\| ''\}\}/, 'every COA drill retains local tab/query/entity scope');
assert.match(registerUi, /Back to Chart of Accounts/, 'register exposes an explicit COA return action');
const reportsUi = readFileSync(new URL('./src/modules-more.jsx', import.meta.url), 'utf8');
assert.match(reportsUi, /coaReturn \? 'Back to Chart of Accounts'/, 'GL Detail visibly returns to the originating COA scope');
console.log('chart account actions: register and report drill targets verified');
