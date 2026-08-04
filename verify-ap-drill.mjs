import { findBillForApDrill } from './src/ap-drill.js';

const assert = (condition, message) => { if (!condition) throw new Error(message); };
const bills = [
  {bill_id: 0, bill_no: 'BILL-0', je_number: 'JE-AP-0'},
  {bill_id: 12, bill_no: 'BILL-12', je_number: 'JE-AP-12', pay_je_number: 'JE-PAY-12'},
];

assert(findBillForApDrill(bills, {billId: 0})?.bill_no === 'BILL-0', 'bill id supports zero-valued ids');
assert(findBillForApDrill(bills, {billNo: 'BILL-12'})?.bill_id === 12, 'bill number opens local bill detail');
assert(findBillForApDrill(bills, {jeNumber: 'JE-AP-12'})?.bill_id === 12, 'AP JE opens local bill detail');
assert(findBillForApDrill(bills, {jeNumber: 'JE-PAY-12'})?.bill_id === 12, 'payment JE opens local bill detail');
assert(findBillForApDrill(bills, {jeNumber: 'JE-MISSING'}) === null, 'unknown evidence does not select a bill');
assert(findBillForApDrill(bills, null) === null, 'missing drill context is safe');
console.log('AP drill verification passed');
