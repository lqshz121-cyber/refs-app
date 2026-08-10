import React from 'react';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {renderToStaticMarkup} from 'react-dom/server';
import {AuthoritativeBankDetail,AuthoritativeBankTable,AuthoritativeBankWorkspace,AuthoritativeReconciliationDetail,AuthoritativeReconciliationSummary,AuthoritativeReconciliationWorkspace} from '../src/authoritative-bank-workspace.jsx';

const config={entityId:'11111111-1111-4111-8111-111111111111'};
const bankRow={bank_source_id:'11111111-1111-4111-8111-111111111111',bank_account_ref:'BANK-1',external_bank_line_id:'BANK-LINE-1',transaction_date:'2026-07-15',currency:'USD',amount:'-125.2500',version:3,source_ref:'SOURCE-1',document_type:'BANK_TRANSACTION',match_status:null,journal_entry_id:null};
const reconciliationRow={reconciliation_id:'11111111-1111-4111-8111-111111111111',bank_account_ref:'BANK-1',statement_ending_date:'2026-07-31',statement_ending_balance:'1000.0000',difference:'0.0000',status:'RECONCILED',version:4,bank_transaction_count:6,active_match_count:5,unmatched_transaction_count:1,statement_activity_amount:'250.0000'};

const bankInitial=renderToStaticMarkup(<AuthoritativeBankWorkspace config={config} fetcher={async()=>{throw new Error('SSR must not fetch');}}/>);
assert.match(bankInitial,/Bank transaction evidence/);assert.match(bankInitial,/Bank account/);assert.match(bankInitial,/From/);assert.match(bankInitial,/Through/);assert.match(bankInitial,/Choose one bank account/);assert.doesNotMatch(bankInitial,/localStorage|seed row/i);

const reconciliationInitial=renderToStaticMarkup(<AuthoritativeReconciliationWorkspace config={config} fetcher={async()=>{throw new Error('SSR must not fetch');}}/>);
assert.match(reconciliationInitial,/Reconciliation evidence/);assert.match(reconciliationInitial,/Statement ending date/);assert.match(reconciliationInitial,/One authoritative statement cutoff/);

const bankTable=renderToStaticMarkup(<AuthoritativeBankTable rows={[bankRow]}/>);
assert.match(bankTable,/BANK-LINE-1/);assert.match(bankTable,/SOURCE-1/);assert.match(bankTable,/Unmatched/);assert.match(bankTable,/READ ONLY/);assert.match(bankTable,/Open detail/);assert.doesNotMatch(bankTable,/>\s*(Match|Clear|Post|Delete|Create)\s*</);
const emptyBank=renderToStaticMarkup(<AuthoritativeBankTable rows={[]}/>);assert.match(emptyBank,/No bank transactions were returned/);assert.match(emptyBank,/not evidence of zero cash activity/);assert.doesNotMatch(emptyBank,/<table/);

const bankDetail=renderToStaticMarkup(<AuthoritativeBankDetail row={bankRow} scope={{entityId:config.entityId,bankAccountRef:'BANK-1',from:'2026-07-01',through:'2026-07-31'}} onBack={()=>{}}/>);
assert.match(bankDetail,/Back to bank transactions/);assert.match(bankDetail,/Bank transaction detail/);assert.match(bankDetail,/-\$125\.25/);assert.match(bankDetail,/2026-07-01/);assert.match(bankDetail,/2026-07-31/);
assert.match(bankDetail,/full-bleed qbo-transaction-report/);

const reconciliation=renderToStaticMarkup(<AuthoritativeReconciliationSummary row={reconciliationRow}/>);
assert.match(reconciliation,/RECONCILED/);assert.match(reconciliation,/\$1,000\.00/);assert.match(reconciliation,/Unmatched/);assert.match(reconciliation,/READ ONLY/);assert.match(reconciliation,/Open statement detail/);
const emptyReconciliation=renderToStaticMarkup(<AuthoritativeReconciliationSummary row={null}/>);assert.match(emptyReconciliation,/No reconciliation statement was returned/);assert.match(emptyReconciliation,/not evidence of zero statement activity/);assert.doesNotMatch(emptyReconciliation,/Open statement detail/);

const reconciliationDetail=renderToStaticMarkup(<AuthoritativeReconciliationDetail row={reconciliationRow} scope={{entityId:config.entityId,bankAccountRef:'BANK-1',statementEndingDate:'2026-07-31'}} onBack={()=>{}}/>);
assert.match(reconciliationDetail,/Back to reconciliation evidence/);assert.match(reconciliationDetail,/Statement ending 2026-07-31/);assert.match(reconciliationDetail,/\$1,000\.00/);assert.match(reconciliationDetail,/11111111-1111-4111-8111-111111111111/);
assert.match(reconciliationDetail,/full-bleed qbo-transaction-report/);assert.match(reconciliationDetail,/Reconciled by/);
assert.match(reconciliationDetail,/Load reconciliation worksheet/);assert.match(reconciliationDetail,/CONTROLLER REVIEW/);

const source=readFileSync('src/authoritative-bank-workspace.jsx','utf8');
// Phase 2a: the four states are rendered only by the shared StateBlock, which
// is what carries role="status" / aria-busy. Assert both halves of that contract.
assert.match(source,/phase==='LOADING'.*<StateBlock tone="loading"/s,'authoritative reads must expose a loading state through StateBlock');
assert.match(readFileSync('src/ui.jsx','utf8'),/role=\{tone==='error' \? 'alert' : 'status'\}[\s\S]*aria-busy=\{tone==='loading' \? 'true' : undefined\}/,'StateBlock must announce loading as a busy status region');
assert.match(source,/phase==='ERROR'.*<ReadError/s,'authoritative reads must expose an API error with retry');
assert.match(source,/phase==='READY'.*AuthoritativeBankTable/s,'Bank results must render only after an API success');
assert.match(source,/phase==='READY'.*AuthoritativeReconciliationSummary/s,'Reconciliation results must render only after an API success');
assert.match(source,/if\(selected\).*AuthoritativeBankDetail/s,'Bank detail must replace the list and retain an explicit Back path');
assert.match(source,/if\(selected\).*AuthoritativeReconciliationDetail/s,'Reconciliation detail must replace the summary and retain an explicit Back path');
assert.match(source,/authoritative-bank-\$\{row\.bank_source_id\}/,'Bank detail must retain a stable opener for focus restoration');
assert.match(source,/authoritative-reconciliation-\$\{row\.reconciliation_id\}/,'Reconciliation detail must retain a stable opener for focus restoration');
assert.match(source,/restoreAuthoritativeReturnContext\(environment,config,context\)/,'Bank and reconciliation Back must restore scope, scroll position and focus');
assert.match(source,/bankAccountRef:scope\.bankAccountRef/,'Bank Back must retain the exact account scope');
assert.match(source,/statementEndingDate:scope\.statementEndingDate/,'Reconciliation Back must retain the exact cutoff scope');
assert.doesNotMatch(source,/localStorage|SEED_|bankRecord|bankSignoff/,'authoritative Bank/Reconcile UI must not depend on demo state or legacy mutation helpers');
assert.match(source,/refreshAuthoritativeBankMatchCandidates/,'Bank Match must start from server-validated candidate evidence, not a caller-supplied occurrence ID');
assert.match(source,/candidates\.length!==1/,'zero or multiple candidate sets must block the Match command');
assert.match(source,/createAuthoritativeBankPaymentMatch/,'an exact candidate must execute through the authoritative command client');
assert.match(source,/unmatchAuthoritativeBankPayment/,'an active match must use the authoritative Unmatch command client');
assert.match(source,/refreshAuthoritativeReconciliationWorksheet/,'Reconciliation must load server-owned worksheet evidence before a clearance command');
assert.match(source,/setAuthoritativeReconciliationClearance/,'Clear and Unclear must use the authoritative command client');
assert.match(source,/startAuthoritativeReconciliation/,'A missing scoped statement may be started only through the authoritative lifecycle command client');
assert.match(source,/transitionAuthoritativeReconciliation/,'Review, sign-off, and reopen must use the authoritative lifecycle command client');
assert.match(source,/item\.match_status==='ACTIVE'/,'Only a server-returned active Match may expose Clear');
assert.match(source,/row:item/,'Clearance command must receive the selected server worksheet row, not the reconciliation summary');
assert.match(source,/const reasonReady=reason\.trim\(\)\.length>=8/,'Clearance commands must require a non-blank controller reason before they can be clicked');
assert.match(source,/disabled=\{commandInFlight\|\|!reasonReady\}/,'Clearance and lifecycle buttons must remain disabled until the controller reason is valid');
assert.match(source,/Start DRAFT reconciliation/,'Starting a reconciliation must remain visibly Draft-only');

console.log('authoritative-bank-workspace: scoped full-page read-only SSR contract passed');
