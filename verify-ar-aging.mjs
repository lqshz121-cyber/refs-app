import assert from 'node:assert/strict';
import { localArAgingBucket, localArAgingRows } from './src/ar-aging.js';

assert.equal(localArAgingBucket({ due_date: '2026-07-31' }, '2026-07-31'), 'Current');
assert.equal(localArAgingBucket({ due_date: '2026-07-01' }, '2026-07-31'), '1-30');
assert.equal(localArAgingBucket({ due_date: '2026-06-01' }, '2026-07-31'), '31-60');
assert.equal(localArAgingBucket({ due_date: '2026-05-02' }, '2026-07-31'), '61-90');
assert.equal(localArAgingBucket({ due_date: '2026-05-01' }, '2026-07-31'), '90+');
const rows = localArAgingRows([{ inv_id: 1, due_date: '2026-07-15', status: 'OPEN' }, { inv_id: 2, due_date: '2026-06-01', status: 'PAID' }], '2026-07-31');
assert.deepEqual(rows.map(row => [row.inv_id, row.aging_bucket]), [[1, '1-30']], 'only open retained local invoices age');
console.log('AR aging: as-of buckets and open-receivable boundary verified');
