import assert from 'node:assert/strict';
import { localReceiptJournalReturnContext, localReceiptReturnScopeLabel } from './src/receipt-return-context.js';

assert.deepEqual(localReceiptJournalReturnContext({receiptId:'JE-101',view:'Reviewed',query:'Maple'}), {route:'receipts',receiptId:'JE-101',view:'Reviewed',query:'Maple'});
assert.deepEqual(localReceiptJournalReturnContext({receiptId:'JE-102',view:'invalid'}), {route:'receipts',receiptId:'JE-102',view:'For review',query:''});
assert.equal(localReceiptJournalReturnContext({receiptId:''}), null);
assert.match(localReceiptReturnScopeLabel({receiptId:'JE-101',view:'Reviewed'}), /JE-101.*Reviewed/);
console.log('receipt return context: JE drill preserves the exact local receipt scope');
