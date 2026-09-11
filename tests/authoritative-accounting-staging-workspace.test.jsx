import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {AuthoritativeAccountingStagingWorkspace} from '../src/authoritative-accounting-staging-workspace.jsx';
const markup=renderToStaticMarkup(<AuthoritativeAccountingStagingWorkspace config={{baseUrl:'https://fixture.example',tenantId:'11111111-1111-4111-8111-111111111111',entityId:'22222222-2222-4222-8222-222222222222',periodId:'33333333-3333-4333-8333-333333333333'}}/>);
assert.match(markup,/Accounting Staging/);assert.match(markup,/Read-only register/);assert.match(markup,/Loading Accounting Staging/);assert.match(markup,/persisted staging items and immutable evidence links/);assert.doesNotMatch(markup,/Import now|Assign item|Create Draft|Approve|Post item/);
