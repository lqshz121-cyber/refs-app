import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {AuthoritativeLoanRegisterWorkspace} from '../src/authoritative-loan-register-workspace.jsx';
const markup=renderToStaticMarkup(<AuthoritativeLoanRegisterWorkspace config={{baseUrl:'https://fixture.example',tenantId:'11111111-1111-4111-8111-111111111111',entityId:'22222222-2222-4222-8222-222222222222',periodId:'33333333-3333-4333-8333-333333333333'}}/>);
assert.match(markup,/Loan Register/);assert.match(markup,/Read-only register/);assert.match(markup,/Loading Loan Register/);assert.match(markup,/loan source, lender, and immutable lineage references/);assert.doesNotMatch(markup,/Create loan|Record draw|Record repayment|Post loan/);
