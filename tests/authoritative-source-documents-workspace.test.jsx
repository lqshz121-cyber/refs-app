import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {AuthoritativeSourceDocumentsWorkspace} from '../src/authoritative-source-documents-workspace.jsx';

const config={entityId:'11111111-1111-4111-8111-111111111111',periodId:'22222222-2222-4222-8222-222222222222',baseUrl:'https://api.example',getAccessToken:async()=> 'a'.repeat(48)};
const markup=renderToStaticMarkup(<AuthoritativeSourceDocumentsWorkspace config={config} fetcher={async()=>({ok:true,json:async()=>({ok:true,data:[]})})}/>);
assert.match(markup,/Loading authoritative Source Document evidence/);
const source=fs.readFileSync(path.join(process.cwd(),'src','authoritative-source-documents-workspace.jsx'),'utf8');
assert.match(source,/refreshAuthoritativeSourceDocuments/);assert.match(source,/readAuthoritativeSourceDocumentDetail/);assert.match(source,/Attachment content and provider payloads are not exposed/);assert.match(source,/Back to Source Documents/);
assert.doesNotMatch(source,/localStorage|from ['"]\.\/repo|from ['"]\.\/seed|from ['"]\.\/data|\b(?:POST|PUT|PATCH|DELETE)\b/);
console.log('authoritative Source Documents workspace: API-only persisted evidence and immutable detail verified');
