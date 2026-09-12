import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {readFileSync} from 'node:fs';
import {AuthoritativeCashTransferWorkspace} from '../src/authoritative-cash-transfer-workspace.jsx';

test('Cash Transfer workspace renders an authoritative register boundary',()=>{
 const markup=renderToStaticMarkup(<AuthoritativeCashTransferWorkspace config={{baseUrl:'https://fixture.example',tenantId:'11111111-1111-4111-8111-111111111111',entityId:'22222222-2222-4222-8222-222222222222',periodId:'33333333-3333-4333-8333-333333333333'}} fetcher={async()=>({ok:false,status:503,json:async()=>({ok:false})})}/>);
 assert.match(markup,/Cash Transfer/);
});

test('Cash Transfer workspace delegates authority and evidence to the server',()=>{
 const source=readFileSync('src/authoritative-cash-transfer-workspace.jsx','utf8');
 for(const name of ['refreshAuthoritativeCashTransfers','readAuthoritativeCashTransferCreateOptions','readAuthoritativeCashTransferAttachmentCandidates','readAuthoritativeCashTransfer','createAuthoritativeCashTransfer','transitionAuthoritativeCashTransfer','cancelAuthoritativeCashTransfer','postAuthoritativeCashTransfer','readAuthoritativeCashTransferBankAccountControls','createAuthoritativeCashTransferBankAccountControl','approveAuthoritativeCashTransferBankAccountControl','retireAuthoritativeCashTransferBankAccountControl','linkAuthoritativeCashTransferBankLeg'])assert.match(source,new RegExp(name));
 assert.match(source,/flags\.can_submit/);
 assert.match(source,/flags\.can_reconcile/);
 assert.match(source,/if\(showControls\)void loadControls\(\)/, 'control configuration must not load on the Cash Transfer first screen');
 assert.doesNotMatch(source,/useEffect\(\(\)=>\{void load\(\);void loadControls\(\);\}/, 'a configuration authorization failure must not contaminate the main register');
 assert.match(source,/Retry approved bank-account controls/);
 assert.match(source,/row\.bank_member_ref!==source\?\.bank_member_ref/);
 assert.match(source,/row\.cash_account_code!==source\?\.cash_account_code/);
 assert.match(source,/Your current role can still use Cash Transfer where the server authorizes it/);
 assert.doesNotMatch(source,/attachmentSnapshotHash|attachment_snapshot_hash/);
 assert.doesNotMatch(source,/ledger_projection|journal_lines\s*:/);
 assert.match(source,/transfer:detail/);
 assert.match(source,/readAuthoritativeCashTransferBankLegCandidates/);
 assert.match(source,/cashTransferId:detail\.cash_transfer_id,leg,limit:25,after,fetcher/);
 assert.match(source,/void loadBankCandidates\('SOURCE'\);void loadBankCandidates\('DESTINATION'\)/);
 assert.match(source,/Load more \$\{pretty\(leg\)\} candidates/);
 assert.doesNotMatch(source,/refreshAuthoritativeBankTransactions/);
 assert.doesNotMatch(source,/<label key=\{leg\}>/, 'bank-leg fields must not nest labels');
 assert.match(source,/Known bank-source ID \(fallback\)/);
 assert.match(source,/command:\{leg,bankSourceId\}/);
 assert.match(source,/Verified-clean attachment candidates/);
 assert.match(source,/Retry verified attachments/);
 assert.match(source,/attachmentState\.rows\.map/);
 assert.match(source,/attachmentIds:\[\.\.\.selectedAttachmentIds\]\.sort\(\)/);
 assert.doesNotMatch(source,/Verified-clean attachment IDs|textarea value=\{attachments\}/);
});
