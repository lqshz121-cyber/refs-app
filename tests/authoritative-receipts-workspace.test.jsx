import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {AuthoritativeReceiptsWorkspace} from '../src/authoritative-receipts-workspace.jsx';
const markup=renderToStaticMarkup(<AuthoritativeReceiptsWorkspace config={{baseUrl:'https://fixture.example',tenantId:'11111111-1111-4111-8111-111111111111',entityId:'22222222-2222-4222-8222-222222222222',periodId:'33333333-3333-4333-8333-333333333333'}}/>);
assert.match(markup,/Receipts/);assert.match(markup,/Read-only queue/);assert.match(markup,/Loading Receipts/);assert.match(markup,/immutable receipt and attachment evidence/);assert.doesNotMatch(markup,/Upload receipt|Run OCR|Review receipt|Add to books|Promote payment/);
