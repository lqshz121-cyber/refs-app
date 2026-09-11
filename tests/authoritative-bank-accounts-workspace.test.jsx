import assert from 'node:assert/strict';
import fs from 'node:fs';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {AuthoritativeBankAccountsTable,AuthoritativeBankAccountsWorkspace,bankAccountEvidenceScopeKey,beginBankAccountScopeRead,isReconciliationScopeReadPossiblyTruncated,settleBankAccountScopeRead,summarizeReconciliationBackedAccounts} from '../src/authoritative-bank-accounts-workspace.jsx';
import {AuthoritativeBankWorkspace,AuthoritativeReconciliationWorkspace} from '../src/authoritative-bank-workspace.jsx';

const rows=[
  {reconciliation_id:'11111111-1111-4111-8111-111111111111',bank_account_ref:'BANK-2',statement_ending_date:'2026-06-30',currency:'USD',status:'IN_REVIEW',version:2},
  {reconciliation_id:'22222222-2222-4222-8222-222222222222',bank_account_ref:'BANK-1',statement_ending_date:'2026-05-31',currency:'USD',status:'RECONCILED',version:4},
  {reconciliation_id:'33333333-3333-4333-8333-333333333333',bank_account_ref:'BANK-1',statement_ending_date:'2026-07-31',currency:'USD',status:'REOPENED',version:5},
  {reconciliation_id:'44444444-4444-4444-8444-444444444444',bank_account_ref:'BANK-1',statement_ending_date:'2026-07-31',currency:'CAD',status:'DRAFT',version:1},
];
const accounts=summarizeReconciliationBackedAccounts(rows);
assert.deepEqual(accounts.map(row=>`${row.bank_account_ref}:${row.currency}`),['BANK-1:CAD','BANK-1:USD','BANK-2:USD']);
assert.equal(accounts[1].returned_scope_count,2);
assert.equal(accounts[1].latest_statement_ending_date,'2026-07-31');
assert.equal(accounts[1].latest_status,'REOPENED');

const tableMarkup=renderToStaticMarkup(<AuthoritativeBankAccountsTable accounts={accounts}/>);
for(const token of ['Accounts with retained reconciliation evidence','BANK-1','BANK-2','CAD','USD','2026-07-31','REOPENED','Transactions','Reconcile'])assert.match(tableMarkup,new RegExp(token));
assert.match(tableMarkup,/Scopes returned in this read/);
assert.doesNotMatch(tableMarkup,/Retained statements/);
assert.doesNotMatch(tableMarkup,/Current balance|Connect bank|Add account|Transfer funds|Pay now/i);

const scopeA=bankAccountEvidenceScopeKey({baseUrl:'https://accounting.example',tenantId:'tenant-a',entityId:'entity-a'});
const scopeB=bankAccountEvidenceScopeKey({baseUrl:'https://accounting.example',tenantId:'tenant-a',entityId:'entity-b'});
const initialReadState={phase:'LOADING',rows:[],error:null,lastSuccessfulReadAt:null,scopeKey:scopeA};
const firstFailure=settleBankAccountScopeRead(initialReadState,{ok:false,code:'UNAVAILABLE'},null,scopeA);
assert.equal(firstFailure.lastSuccessfulReadAt,null,'a failed first request must not be labelled an authoritative read');
const successfulRead=settleBankAccountScopeRead(firstFailure,{ok:true,rows},'2026-09-11T14:00:00.000Z',scopeA);
assert.equal(successfulRead.lastSuccessfulReadAt,'2026-09-11T14:00:00.000Z');
const laterFailure=settleBankAccountScopeRead(successfulRead,{ok:false,code:'UNAVAILABLE'},null,scopeA);
assert.equal(laterFailure.lastSuccessfulReadAt,'2026-09-11T14:00:00.000Z','a failed refresh must preserve the last successful authoritative read time');
const switchedRead=beginBankAccountScopeRead(successfulRead,scopeB);
assert.equal(switchedRead.lastSuccessfulReadAt,null,'changing company must immediately clear the prior company read time');
assert.deepEqual(switchedRead.rows,[],'changing company must immediately clear the prior company rows');
const switchedFailure=settleBankAccountScopeRead(switchedRead,{ok:false,code:'UNAVAILABLE'},null,scopeB);
assert.equal(switchedFailure.lastSuccessfulReadAt,null,'a failed first read for company B must not show company A success metadata');
assert.equal(isReconciliationScopeReadPossiblyTruncated(Array.from({length:199})),false);
assert.equal(isReconciliationScopeReadPossiblyTruncated(Array.from({length:200})),true,'a response at the API limit cannot claim a complete population');

const config={baseUrl:'https://accounting.example',tenantId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',entityId:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',periodId:'cccccccc-cccc-4ccc-8ccc-cccccccccccc'};
const initialMarkup=renderToStaticMarkup(<AuthoritativeBankAccountsWorkspace config={config} fetcher={async()=>{throw new Error('SSR must not fetch');}}/>);
assert.match(initialMarkup,/Bank Accounts/);assert.match(initialMarkup,/Loading bank account evidence/);assert.match(initialMarkup,/not a complete bank-account master or a source of current balances/i);
assert.doesNotMatch(initialMarkup,/localStorage|seed row|demo data/i);
const transactionHandoff=renderToStaticMarkup(<AuthoritativeBankWorkspace config={config} initialScope={{bankAccountRef:'BANK-1'}} fetcher={async()=>{throw new Error('SSR must not fetch');}}/>);
assert.match(transactionHandoff,/value="BANK-1"/,'Bank Accounts must prefill the exact retained account reference when opening transactions');
const reconciliationHandoff=renderToStaticMarkup(<AuthoritativeReconciliationWorkspace config={config} initialScope={{bankAccountRef:'BANK-1',statementEndingDate:'2026-07-31'}} fetcher={async()=>{throw new Error('SSR must not fetch');}}/>);
assert.match(reconciliationHandoff,/value="BANK-1"/);assert.match(reconciliationHandoff,/value="2026-07-31"/,'Bank Accounts must prefill the exact retained reconciliation cutoff');

const source=fs.readFileSync('src/authoritative-bank-accounts-workspace.jsx','utf8');
assert.match(source,/refreshAuthoritativeReconciliationScopes/);
assert.match(source,/readGeneration\.current/,'late reads must be unable to overwrite a newer company or retry result');
assert.match(source,/Scope list may be incomplete/,'a full limited response must disclose possible truncation');
assert.doesNotMatch(source,/localStorage|sessionStorage|seed\.js|repo\.js|legacy-demo-app/i,'Bank Accounts must use only the authenticated reconciliation-scope reader');
assert.match(source,/connections, credentials, account creation or editing, balance refresh, transfers, payments, and posting are not available/i);
console.log('authoritative Bank Accounts workspace: reconciliation-backed account evidence only');
