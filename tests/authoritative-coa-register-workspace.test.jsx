import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {AuthoritativeChartOfAccountsWorkspace} from '../src/authoritative-coa-register-workspace.jsx';

const config={entityId:'11111111-1111-4111-8111-111111111111',periodId:'22222222-2222-4222-8222-222222222222',baseUrl:'https://api.example',getAccessToken:async()=> 'a'.repeat(48)};
const markup=renderToStaticMarkup(<AuthoritativeChartOfAccountsWorkspace config={config} fetcher={async()=>({ok:true,json:async()=>({ok:true,data:[]})})}/>);
assert.match(markup,/Chart of Accounts/);assert.match(markup,/Account name or number/);assert.match(markup,/Master status/);assert.match(markup,/Posted currency/);assert.match(markup,/Rows per page/);assert.match(markup,/READ ONLY/);assert.match(markup,/Loading authoritative account master/);assert.match(markup,/Accounts returned/);assert.match(markup,/POSTED ledger lines/);assert.match(markup,/Exact API snapshot/);
const source=fs.readFileSync(path.join(process.cwd(),'src','authoritative-coa-register-workspace.jsx'),'utf8');
assert.match(source,/refreshAuthoritativeChartOfAccounts/);assert.match(source,/refreshAuthoritativeAccountRegister/);assert.match(source,/Back to Chart of Accounts/);assert.match(source,/POSTED ledger evidence/);assert.match(source,/authoritative-coa-table/);assert.match(source,/authoritative-register-table/);assert.match(source,/authoritative-coa-summary/);assert.match(source,/authoritative-register-scope/);assert.match(source,/Clear filters/);assert.match(source,/Open register/);assert.match(source,/Return context:/);assert.match(source,/Search register evidence/);assert.match(source,/Showing page/);
assert.doesNotMatch(source,/localStorage|from ['"]\.\/repo|from ['"]\.\/seed|from ['"]\.\/data|\b(?:POST|PUT|PATCH|DELETE)\b|[鈥路]/);
const styles=fs.readFileSync(path.join(process.cwd(),'index.html'),'utf8');
assert.match(styles,/\.authoritative-coa-summary/);assert.match(styles,/\.authoritative-register-scope/);assert.match(styles,/\.authoritative-coa-filter/);assert.match(styles,/\.authoritative-coa-pagination/);assert.match(styles,/\.authoritative-status\.is-active/);assert.match(styles,/@media \(max-width:600px\)/);
console.log('authoritative COA/Register workspace: API-only filters, paging, exact Back context, contained tables, and responsive evidence verified');
