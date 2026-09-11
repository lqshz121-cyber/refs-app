import assert from 'node:assert/strict';
import fs from 'node:fs';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {AuthoritativeMasterDataWorkspace} from '../src/authoritative-master-data-workspace.jsx';

const config={baseUrl:'https://accounting.example',tenantId:'11111111-1111-4111-8111-111111111111',entityId:'22222222-2222-4222-8222-222222222222',periodId:'33333333-3333-4333-8333-333333333333'};
const vendorMarkup=renderToStaticMarkup(<AuthoritativeMasterDataWorkspace config={config} fetcher={async()=>{throw new Error('SSR must not fetch');}}/>);
for(const token of ['Master Data','SERVER AUTHORIZED','Vendors','Customers','Chart of accounts','New vendor','Review changes','Loading vendors'])assert.match(vendorMarkup,new RegExp(token,'i'));
const customerMarkup=renderToStaticMarkup(<AuthoritativeMasterDataWorkspace config={config} initialView="CUSTOMERS" fetcher={async()=>{throw new Error('SSR must not fetch');}}/>);
assert.match(customerMarkup,/New customer/);assert.match(customerMarkup,/Loading customers/);assert.doesNotMatch(customerMarkup,/New vendor/);
const accountsMarkup=renderToStaticMarkup(<AuthoritativeMasterDataWorkspace config={config} initialView="ACCOUNTS" fetcher={async()=>{throw new Error('SSR must not fetch');}}/>);
assert.match(accountsMarkup,/Chart of Accounts|Chart of accounts/);assert.doesNotMatch(accountsMarkup,/New vendor|New customer/);
const source=fs.readFileSync('src/authoritative-master-data-workspace.jsx','utf8');
for(const token of ['CounterpartyRegisterWorkspace','AuthoritativeChartOfAccountsWorkspace','kind="VENDOR"','kind="CUSTOMER"'])assert.ok(source.includes(token),`missing ${token}`);
assert.doesNotMatch(source,/localStorage|sessionStorage|seed\.js|repo\.js|legacy-demo-app/i,'Master Data must compose existing authoritative workspaces without browser accounting state');
console.log('authoritative Master Data workspace: server-backed vendor, customer, and account masters');
