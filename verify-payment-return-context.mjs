import assert from 'node:assert/strict';
import { localPaymentReturnScopeLabel, localPaymentReportDrillContext, localPaymentBankEvidenceReturnContext, localPaymentBankEvidenceReturnScopeLabel } from './src/payment-return-context.js';

assert.equal(localPaymentReturnScopeLabel({route:'ap',tab:'Payments',billId:42,paymentDate:'This month'}), 'Retained payment scope · bill 42 · date This month · Payments');
assert.equal(localPaymentReturnScopeLabel({paymentReturn:{billId:7,paymentDate:'All dates'}}), 'Retained payment scope · bill 7 · date All dates · Payments');
assert.deepEqual(localPaymentReportDrillContext({tab:'Trial Balance',entityId:15,drillLabel:'JE-PAY-42',paymentReturn:{route:'ap',tab:'Payments',billId:42,paymentDate:'This month'}}), {route:'gl',tab:'Trial Balance',entityId:'15',drillLabel:'JE-PAY-42',paymentReturn:{route:'ap',tab:'Payments',billId:42,paymentDate:'This month'}});
assert.deepEqual(localPaymentBankEvidenceReturnContext({acctCode:'BA-003',bankTxnId:'BT-42',paymentReturn:{route:'ap',tab:'Payments',billId:42,paymentDate:'This month'}}), {route:'banktx',acctCode:'BA-003',bankTxnId:'BT-42',paymentReturn:{route:'ap',tab:'Payments',billId:42,paymentDate:'This month'}});
assert.equal(localPaymentBankEvidenceReturnContext({acctCode:'BA-003',bankTxnId:'BT-42'}), null);
assert.match(localPaymentBankEvidenceReturnScopeLabel({acctCode:'BA-003',bankTxnId:'BT-42'}), /BA-003.*BT-42/);
console.log('payment return context: bill and payment-date scope remain visible');
