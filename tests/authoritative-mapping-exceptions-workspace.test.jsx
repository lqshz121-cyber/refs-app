import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {AuthoritativeMappingExceptionsWorkspace} from '../src/authoritative-mapping-exceptions-workspace.jsx';
const markup=renderToStaticMarkup(<AuthoritativeMappingExceptionsWorkspace config={{baseUrl:'https://fixture.example',tenantId:'11111111-1111-4111-8111-111111111111',entityId:'22222222-2222-4222-8222-222222222222',periodId:'33333333-3333-4333-8333-333333333333'}}/>);
assert.match(markup,/Mapping Exceptions/);assert.match(markup,/Read-only register/);assert.match(markup,/Loading Mapping Exceptions/);assert.match(markup,/retained mapping failures and immutable evidence/);assert.doesNotMatch(markup,/Assign exception|Resolve exception|Waive exception|Create Draft|Post exception/);
