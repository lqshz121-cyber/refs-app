import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (file) => readFileSync(new URL(file, import.meta.url), 'utf8');

const readonlySurfaces = [
  ['AP/AR evidence', './src/authoritative-workspace.jsx'],
  ['Journal evidence', './src/authoritative-journal-workspace.jsx'],
  ['Reports evidence', './src/authoritative-reports-workspace.jsx'],
];

const commandBinding = /(?:createAuthoritativeBankPaymentMatch|createAuthoritativeReconciliationAdjustmentDraft|transitionAuthoritativeReconciliation|setAuthoritativeReconciliation(?:Adjustment)?Clearance|unmatchAuthoritativeBankPayment)/;
const prohibitedRuntimeFallback = /(?:localStorage|SEED_|legacy-demo-app|seed\.js|repo\.js)/;

for (const [label, file] of readonlySurfaces) {
  const source = read(file);
  assert.doesNotMatch(source, commandBinding, `${label} must not bind Bank/Reconciliation controller commands`);
  assert.doesNotMatch(source, prohibitedRuntimeFallback, `${label} must not import demonstration state or browser-local accounting state`);
  assert.match(source, /(?:BLOCKED|StateBlock)/, `${label} must fail closed when authoritative evidence is unavailable`);
}

const bank = read('./src/authoritative-bank-workspace.jsx');
assert.match(bank, /scopeMatches\s*&&\s*config\s*&&\s*<AuthoritativeBankMatchReview/, 'Bank match review must remain behind immutable scope validation');
assert.match(bank, /scopeMatches\s*&&\s*hasAuthorizedWorksheetEvidence\s*&&\s*<section className="card" aria-label="Reconciliation lifecycle command"/, 'Reconciliation controller commands must require authorized worksheet evidence');
assert.match(bank, /BLOCKED — immutable bank scope mismatch/, 'Bank scope mismatches must fail closed');
assert.match(bank, /BLOCKED — immutable reconciliation scope mismatch/, 'Reconciliation scope mismatches must fail closed');

console.log('QB authoritative read-only boundary contract passed');
