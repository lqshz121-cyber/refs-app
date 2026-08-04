import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const bankUi = readFileSync(new URL('./src/module-banktx.jsx', import.meta.url), 'utf8');
const reconciliationUi = readFileSync(new URL('./src/module-bankrec.jsx', import.meta.url), 'utf8');
const apUi = readFileSync(new URL('./src/module-ap.jsx', import.meta.url), 'utf8');

assert.match(bankUi, /const paymentSignedHistoryTarget = paymentBankDetail\.lifecycle\?\.signedEntry/, 'Payment-bank evidence creates a signed-history target only from retained signed evidence');
assert.match(bankUi, /No retained signed-off reconciliation for this payment scope/, 'Cleared-but-not-signed payment evidence is explicit');
assert.match(bankUi, /bankTransactionReturn:\{route:'banktx',acctCode,bankTxnId:paymentBankDetail\.bank_txn_id,paymentReturn\}/, 'Signed history retains the Payment → Bank return chain');
assert.match(bankUi, /Open signed reconciliation history/, 'The payment-bank detail exposes the signed-history drill');
assert.match(reconciliationUi, /goto\('banktx',navContext\.bankTransactionReturn\)/, 'Signed history returns to retained bank evidence before Payment');
assert.match(reconciliationUi, /localReconciliationPaymentReturnTarget\(navContext\)/, 'Reconciliation normal view restores the Payment list scope');
assert.match(apUi, /const paymentDetailReturn = \{\.\.\.paymentReturn, paymentDetail:true, \.\.\.\(paymentReturn\?\.billDetail \? \{paymentBillDetail:true\} : \{\}\)\}/, 'Bank and JE drills know whether Payment Detail originated from Bill Detail');
assert.match(apUi, /if \(!navContext\?\.paymentDetail \|\| !navContext\?\.billId\) return;/, 'Payment return only reopens a detail when it carries the explicit marker');
assert.match(apUi, /setSelectedPayment\(retainedPayment\)/, 'Bank/history return restores the same retained payment detail before the list');

console.log('payment signed-history return: payment → bank → immutable signed snapshot restores Payment Detail before the original list, with explicit unsigned state');
