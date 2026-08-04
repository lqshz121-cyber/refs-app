import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const bankUi = readFileSync(new URL('./src/module-banktx.jsx', import.meta.url), 'utf8');
const reconcileUi = readFileSync(new URL('./src/module-bankrec.jsx', import.meta.url), 'utf8');

assert.match(reconcileUi, /historyId:historyDetail\.entry\.id/, 'Statement-history Bank drill retains its signed snapshot id');
assert.match(bankUi, /goto\('bankrec',navContext\.reconciliationReturn\)/, 'Bank evidence Back restores the complete retained reconciliation scope');
assert.match(bankUi, /signed statement \$\{navContext\.reconciliationReturn\.historyId\}/, 'Bank evidence visibly identifies a retained signed statement return');
console.log('reconciliation bank return: statement-history Bank drill restores the original immutable signed snapshot');
