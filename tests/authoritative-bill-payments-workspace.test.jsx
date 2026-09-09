import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {AuthoritativeBillPaymentsWorkspace} from '../src/authoritative-bill-payments-workspace.jsx';
const markup=renderToStaticMarkup(<AuthoritativeBillPaymentsWorkspace config={{baseUrl:'https://fixture.example',tenantId:'11111111-1111-4111-8111-111111111111',entityId:'22222222-2222-4222-8222-222222222222',periodId:'33333333-3333-4333-8333-333333333333'}}/>);
assert.match(markup,/Bill Payments/);assert.match(markup,/Read-only register/);assert.match(markup,/Loading Bill Payments/);
assert.match(markup,/Reading retained payment, Bill, Journal, ledger, bank-match, and audit references/);
assert.doesNotMatch(markup,/Pay now|Start using Bill Pay|ACH|Approve payment|Void payment|Release payment/);
