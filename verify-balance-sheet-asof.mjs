import assert from 'node:assert/strict';
import { postedJournalEntriesAsOf } from './src/balance-sheet-asof.js';

const journals = [
  { je_number:'JE-01', posting_status:'POSTED', entity_id:2, period_code:'2026-01' },
  { je_number:'JE-06', posting_status:'POSTED', entity_id:2, period_code:'2026-06' },
  { je_number:'JE-07', posting_status:'POSTED', entity_id:2, period_code:'2026-07' },
  { je_number:'JE-DRAFT', posting_status:'DRAFT', entity_id:2, period_code:'2026-01' },
  { je_number:'JE-OTHER', posting_status:'POSTED', entity_id:4, period_code:'2026-01' },
];
assert.deepEqual(postedJournalEntriesAsOf(journals, {entityId:2, toPeriod:'2026-06'}).map(j=>j.je_number), ['JE-01','JE-06']);
assert.deepEqual(postedJournalEntriesAsOf(journals, {entityId:2, toPeriod:'2026-07'}).map(j=>j.je_number), ['JE-01','JE-06','JE-07']);
console.log('balance sheet as-of: posted entity evidence accumulates through the selected cutoff');
