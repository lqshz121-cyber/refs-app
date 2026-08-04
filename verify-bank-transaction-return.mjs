import assert from 'node:assert/strict';
import { localBankTransactionDetailBackTarget, localBankTransactionJournalReturnContext, localBankTransactionJournalReturnScopeLabel } from './src/bank-transaction-return.js';

const receipt = localBankTransactionDetailBackTarget({receiptReturn:{route:'receipts',receiptId:'JE-101',view:'Reviewed',query:'Maple'}},{queue:'Posted',page:2});
assert.deepEqual(receipt,{route:'receipts',context:{route:'receipts',receiptId:'JE-101',view:'Reviewed',query:'Maple'},label:'Back to Receipt evidence'});
const arReceipt = localBankTransactionDetailBackTarget({arReturn:{route:'ar',tab:'Receipts',receiptView:'Bank matched',asOfDate:'2026-07-31'}},{queue:'Posted',page:2});
assert.deepEqual(arReceipt,{route:'ar',context:{route:'ar',tab:'Receipts',receiptView:'Bank matched',asOfDate:'2026-07-31'},label:'Back to customer receipts'});
const history = localBankTransactionDetailBackTarget({reconciliationReturn:{route:'bankrec',acctCode:'BA-003',historyId:9}},{queue:'Posted',page:2});
assert.deepEqual(history,{route:'bankrec',context:{route:'bankrec',acctCode:'BA-003',historyId:9},label:'Back to reconciliation history'});
const list = localBankTransactionDetailBackTarget({acctCode:'BA-001',queue:'Excluded',query:'fee',dateRange:'This month',type:'Money out'},{queue:'Excluded',page:3});
assert.equal(list.route,'banktx');
assert.deepEqual(list.context,{route:'banktx',acctCode:'BA-001',queue:'Excluded',query:'fee',dateRange:'This month',type:'Money out',page:3});
assert.deepEqual(localBankTransactionJournalReturnContext({acctCode:'BA-003',bankTxnId:'BT-42',origin:{receiptReturn:{route:'receipts',receiptId:'JE-101',view:'Reviewed',query:'Maple'}}}), {route:'banktx',acctCode:'BA-003',bankTxnId:'BT-42',receiptReturn:{route:'receipts',receiptId:'JE-101',view:'Reviewed',query:'Maple'},reconciliationReturn:null});
assert.equal(localBankTransactionJournalReturnContext({acctCode:'BA-003'}), null);
assert.match(localBankTransactionJournalReturnScopeLabel({acctCode:'BA-003',bankTxnId:'BT-42'}), /BA-003.*BT-42/);
console.log('bank transaction return: source context and list filters retained');
