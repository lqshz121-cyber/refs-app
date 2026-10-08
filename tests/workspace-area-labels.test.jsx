import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {AuthoritativeAccountingStagingWorkspace} from '../src/authoritative-accounting-staging-workspace.jsx';
import {AuthoritativeBillPaymentsWorkspace} from '../src/authoritative-bill-payments-workspace.jsx';
import {AuthoritativeFixedAssetsWorkspace} from '../src/authoritative-fixed-assets-workspace.jsx';
import {AuthoritativeLoanRegisterWorkspace} from '../src/authoritative-loan-register-workspace.jsx';
import {AuthoritativeMappingExceptionsWorkspace} from '../src/authoritative-mapping-exceptions-workspace.jsx';
import {AuthoritativeRecurringTransactionsWorkspace} from '../src/authoritative-recurring-transactions-workspace.jsx';
import {AuthoritativeRulesWorkspace} from '../src/authoritative-rules-workspace.jsx';
const config={baseUrl:'https://fixture.example',tenantId:'11111111-1111-4111-8111-111111111111',entityId:'22222222-2222-4222-8222-222222222222',periodId:'33333333-3333-4333-8333-333333333333'};
const cases=[['accounting-staging','Accounting Staging',AuthoritativeAccountingStagingWorkspace],['bill-payments','Bill Payments',AuthoritativeBillPaymentsWorkspace],['fixed-assets','Fixed assets',AuthoritativeFixedAssetsWorkspace],['loan-register','Loans',AuthoritativeLoanRegisterWorkspace],['mapping-exceptions','Mapping Exceptions',AuthoritativeMappingExceptionsWorkspace],['recurring-transactions','Recurring transactions',AuthoritativeRecurringTransactionsWorkspace],['rules','Rules',AuthoritativeRulesWorkspace]];
for(const [file,label,Component] of cases){
  const html=renderToStaticMarkup(<Component config={config}/>);
  assert.ok(html.includes(`aria-label="${label} workspace"`),`${file} renders its named region`);
  assert.doesNotMatch(html,/aria-label="(?:undefined|null|\s*) workspace"/);
  const source=readFileSync(`src/authoritative-${file}-workspace.jsx`,'utf8');
  for(const opening of source.matchAll(/<AuthoritativeWorkspaceView\b[^>]*>/g))assert.match(opening[0],/\barea=/,`${file}: detail and error branches also need a region name`);
}
const payments=renderToStaticMarkup(<AuthoritativeBillPaymentsWorkspace config={config} workspaceTitle="Vendor payment history"/>);
assert.match(payments,/aria-label="Vendor payment history workspace"/);
const error=renderToStaticMarkup(<AuthoritativeFixedAssetsWorkspace config={{}} accessState={{status:'ERROR',message:'Access unavailable'}}/>);
assert.match(error,/aria-label="Fixed assets workspace"/);
assert.match(error,/Could not load company access/);
console.log('workspace area labels: seven rendered loading regions, dynamic title, access-error region and all detail/error callsites verified');
