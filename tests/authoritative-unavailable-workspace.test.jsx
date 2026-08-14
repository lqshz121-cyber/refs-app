import React from 'react';
import assert from 'node:assert/strict';
import {renderToStaticMarkup} from 'react-dom/server';
import {AuthoritativeUnavailableWorkspace} from '../src/authoritative-unavailable-workspace.jsx';

const entityId='11111111-1111-4111-8111-111111111111';
const periodId='22222222-2222-4222-8222-222222222222';
const markup=renderToStaticMarkup(<AuthoritativeUnavailableWorkspace item={{label:'AutoRec',requirements:['BANK.VIEW']}} config={{entityId,periodId}}/>);
assert.match(markup,/Configured entity/);
assert.match(markup,/Configured period/);
assert.match(markup,new RegExp(`title="Entity ID: ${entityId}"`));
assert.match(markup,new RegExp(`title="Period ID: ${periodId}"`));
assert.doesNotMatch(markup,new RegExp(`>[^<]*${entityId}[^<]*<|>[^<]*${periodId}[^<]*<`));
console.log('authoritative unavailable workspace: readable scope with audit-only IDs verified');