import assert from 'node:assert/strict';
import { localAccountRegisterEntries, localAccountRegisterOpeningBalance, localCashRegisterScope, localRegisterAccountOptions, localRegisterBankEvidence, localRegisterEndingBalance, localRegisterScope } from './src/account-register-evidence.js';

const journals = [
  {je_number:'JE-2',je_date:'2026-07-02',period_code:'2026-07',entity_id:2,posting_status:'POSTED',lines:[{account_code:'111000',debit_amount:20,credit_amount:0}]},
  {je_number:'JE-1',je_date:'2026-07-01',period_code:'2026-07',entity_id:2,posting_status:'POSTED',lines:[{account_code:'111000',debit_amount:50,credit_amount:0}]},
  {je_number:'JE-DRAFT',je_date:'2026-07-03',period_code:'2026-07',entity_id:2,posting_status:'DRAFT',lines:[{account_code:'111000',debit_amount:500,credit_amount:0}]},
  {je_number:'JE-OTHER',je_date:'2026-07-03',period_code:'2026-07',entity_id:4,posting_status:'POSTED',lines:[{account_code:'111000',debit_amount:500,credit_amount:0}]},
];
const entries = localAccountRegisterEntries(journals, {entityId:2,accountCode:'111000',throughPeriod:'2026-07'});
assert.deepEqual(entries.map(entry => [entry.ref,entry.runningBalance]), [['JE-1',50],['JE-2',70]], 'only same-entity posted entries enter a deterministic running balance');
assert.equal(localRegisterEndingBalance(entries), 70);
const openingJournals = [...journals,{je_number:'JE-OPEN',je_date:'2026-06-30',period_code:'2026-06',entity_id:2,posting_status:'POSTED',lines:[{account_code:'111000',debit_amount:30,credit_amount:0}]}];
assert.equal(localAccountRegisterOpeningBalance(openingJournals,{entityId:2,accountCode:'111000',fromPeriod:'2026-07'}),30);
assert.deepEqual(localAccountRegisterEntries(openingJournals,{entityId:2,accountCode:'111000',fromPeriod:'2026-07',throughPeriod:'2026-07'}).map(entry=>[entry.ref,entry.runningBalance]),[['JE-1',80],['JE-2',100]],'opening balance plus in-period posted movement drives the running balance');
assert.equal(localRegisterScope('111000'), 'Operating');
assert.equal(localRegisterScope('112000'), 'Escrow');
assert.equal(localRegisterScope('120100'), 'Non-cash account');
assert.deepEqual(localRegisterAccountOptions([{account_code:'111000',account_type:'ASSET'},{account_code:'112000',account_type:'ASSET'},{account_code:'220200',account_type:'LIABILITY'},{account_code:'421803',account_type:'INCOME'}]).map(row=>row.account_code), ['111000','112000'], 'only retained local cash scopes can use the register surface');
assert.deepEqual(localRegisterBankEvidence({je_number:'JE-1'}, {BA1:{txns:[{external_id:'LOCAL-1',matched_je:'JE-1',match_status:'MATCHED'}]}}), {state:'LOCAL_MATCHED',label:'BA1 / LOCAL-1'});
assert.equal(localRegisterBankEvidence({je_number:'JE-1'}, {BA1:{txns:[{matched_je:'JE-1',match_status:'UNMATCHED'}]}}).state, 'LOCAL_UNMATCHED');
const masters = [{bank_account_code:'BA1',entity_id:2,gl_account_code:'111000',cash_scope:'Operating'}];
assert.equal(localCashRegisterScope({entityId:2,accountCode:'111000',bankAccountMaster:masters}).state, 'LOCAL_CASH_REGISTER');
assert.equal(localCashRegisterScope({entityId:null,accountCode:'111000',bankAccountMaster:masters}).state, 'ENTITY_REQUIRED');
assert.equal(localRegisterBankEvidence({je_number:'JE-1'}, {BA1:{txns:[{matched_je:'JE-1',match_status:'MATCHED'}]}}, {bankAccountMaster:masters,entityId:4,cashAccountCode:'111000'}).state, 'OUT_OF_SCOPE_BANK_EVIDENCE');
console.log('account register evidence: posted-only running balance, scope separation, and bank evidence are verified');
