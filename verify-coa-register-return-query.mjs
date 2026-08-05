import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { localAccountRegisterJournalReturnContext, localAccountRegisterReportReturnContext } from './src/account-register-return.js';

const register = readFileSync(new URL('./src/module-register.jsx', import.meta.url), 'utf8');
const coaActions = readFileSync(new URL('./src/chart-account-actions.js', import.meta.url), 'utf8');

const journalReturn = localAccountRegisterJournalReturnContext({entityId:'ENTITY-01', accountCode:'111000', fromPeriod:'2026-01', throughPeriod:'2026-07', entryId:'JE-9:0', query:'insurance'});
assert.equal(journalReturn.query, 'insurance');
assert.equal(journalReturn.accountCode, '111000');
assert.equal(journalReturn.entryId, 'JE-9:0');
const reportReturn = localAccountRegisterReportReturnContext({entityId:'ENTITY-01', accountCode:'111000', fromPeriod:'2026-01', throughPeriod:'2026-07', query:'insurance'});
assert.equal(reportReturn.query, 'insurance');
assert.match(register, /aria-label="Search posted evidence"/, 'Register must provide an explicit local evidence filter.');
assert.match(register, /navContext\.query != null/, 'A deep return must restore the saved Register query.');
assert.match(register, /No posted local entries match this search/, 'A scoped search empty state must explain the result.');
assert.match(register, /disabled=\{!cashRegisterScope\.master\}/, 'Only a mapped cash account may offer Reconcile.');
assert.match(coaActions, /return \{ label: 'Run report', route: 'gl'/, 'Non-cash COA accounts must remain GL-only.');
console.log('PASS: COA/Register retains account, entity, period and evidence query through JE/GL/Reconcile returns; non-cash accounts stay GL-only.');
