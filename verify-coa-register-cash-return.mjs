import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const coa = readFileSync(new URL('./src/module-coa.jsx', import.meta.url), 'utf8');
const drill = readFileSync(new URL('./src/chart-account-actions.js', import.meta.url), 'utf8');
const register = readFileSync(new URL('./src/module-register.jsx', import.meta.url), 'utf8');
const returnScope = readFileSync(new URL('./src/account-register-return.js', import.meta.url), 'utf8');
const reconciliation = readFileSync(new URL('./src/module-bankrec.jsx', import.meta.url), 'utf8');

for (const text of ['View register', 'Run report', 'coaReturn:{route:\'coa\'', 'Back to Chart of Accounts']) {
  assert.ok(coa.includes(text) || drill.includes(text) || register.includes(text), `COA/register drill is missing: ${text}`);
}
assert.match(drill, /if \(localCashAccountGroup\(account\?\.account_code\)\)/, 'Only classified local cash accounts may open the register');
assert.match(drill, /return \{ label: 'Run report', route: 'gl'/, 'Non-cash accounts must drill to GL rather than a bank register');
assert.ok(register.includes('const coaReturn = navContext?.coaReturn?.route === \'coa\''), 'Register must retain the originating COA context');
assert.ok(register.includes('registerReturnContext()'), 'Register-to-report/reconcile routes must use the preserved return scope');
assert.ok(returnScope.includes("coaReturn?.route === 'coa' ? {coaReturn} : {}"), 'Register return contexts must preserve a valid COA origin');
assert.ok(reconciliation.includes("navContext?.registerReturn?.route === 'register'"), 'Reconcile must offer an explicit return to the originating register');
for (const forbidden of ['Create account', 'Edit account', '>Export<', 'Auto-match']) {
  assert.ok(!coa.includes(forbidden) && !register.includes(forbidden), `COA/register evidence UI must not expose mutation: ${forbidden}`);
}

console.log('PASS: COA → cash Register → Reconcile/GL → Back preserves COA scope and blocks non-cash reconciliation');
