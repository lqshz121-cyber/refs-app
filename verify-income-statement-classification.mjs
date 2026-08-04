import assert from 'node:assert/strict';
import { localIncomeStatementSection } from './src/income-statement-classification.js';

assert.equal(localIncomeStatementSection({type:'REVENUE',account_code:'421803'}), 'Rental income');
assert.equal(localIncomeStatementSection({type:'REVENUE',account_code:'480000'}), 'Other property income');
assert.equal(localIncomeStatementSection({type:'EXPENSE',account_code:'641600'}), 'Property operations');
assert.equal(localIncomeStatementSection({type:'EXPENSE',account_code:'795000'}), 'Interest and financing');
assert.equal(localIncomeStatementSection({type:'EXPENSE',account_code:'780120'}), 'Capital / completion review');
assert.equal(localIncomeStatementSection({type:'ASSET',account_code:'164200'}), 'Out of P&L scope');
console.log('income statement classification: real-estate presentation boundaries verified');
