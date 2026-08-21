import assert from 'node:assert/strict';
import fs from 'node:fs';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {AuthoritativeCapitalizationPanel} from '../src/authoritative-capitalization-panel.jsx';
const config={entityId:'11111111-1111-4111-8111-111111111111',periodId:'33333333-3333-4333-8333-333333333333',baseUrl:'https://accounting.example',getAccessToken:async()=> 'a'.repeat(48)};
const markup=renderToStaticMarkup(<AuthoritativeCapitalizationPanel config={config} fetcher={async()=>{throw new Error('SSR must not fetch');}}/>);for(const token of ['Invoice capitalization review','PROPOSAL ONLY'])assert.match(markup,new RegExp(token,'i'));
const source=fs.readFileSync('src/authoritative-capitalization-panel.jsx','utf8');for(const token of ['refreshAuthoritativeAiInvoiceCapitalizationEvidence','policy-bound capitalization proposal','No Draft, review, approval, or posting authority'])assert.match(source,new RegExp(token,'i'));assert.doesNotMatch(source,/localStorage|seed\.js|legacy-demo-app/i);assert.doesNotMatch(source,/[^\x00-\x7F]/);console.log('authoritative capitalization panel: authenticated evidence only');
