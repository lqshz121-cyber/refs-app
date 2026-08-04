import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const apUi = readFileSync(new URL('./src/module-ap.jsx', import.meta.url), 'utf8');
assert.match(apUi, /tab:'GL Detail',entityId:bill\?\.entity_id,drillLabel:payment\.paymentJournal\.je_number,paymentReturn:paymentDetailReturn/, 'Payment detail retains its exact payment origin when opening GL');
assert.match(apUi, /tab:'Trial Balance',entityId:bill\?\.entity_id,drillLabel:payment\.paymentJournal\.je_number,paymentReturn:paymentDetailReturn/, 'Payment detail retains its exact payment origin when opening Trial Balance');
assert.match(apUi, /Open GL Detail.*Open Trial Balance/, 'Payment detail exposes both report drills only with a retained POSTED payment JE');
console.log('payment detail report return: GL/TB retain the originating payment scope');
