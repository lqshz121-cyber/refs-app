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
assert.match(reconciliationInitial,/Reconciliation evidence/);assert.match(reconciliationInitial,/Statement ending date/);assert.match(reconciliationInitial,/No reconciliation mutation is available/);

const bankTable=renderToStaticMarkup(<AuthoritativeBankTable rows={[bankRow]}/>);
assert.match(bankTable,/BANK-LINE-1/);assert.match(bankTable,/SOURCE-1/);assert.match(bankTable,/Unmatched/);assert.match(bankTable,/READ ONLY/);assert.match(bankTable,/Open detail/);assert.doesNotMatch(bankTable,/>\s*(Match|Clear|Post|Delete|Create)\s*</);
assert.match(renderToStaticMarkup(<AuthoritativeBankTable rows={[]}/>),/No bank transactions were returned/);

const bankDetail=renderToStaticMarkup(<AuthoritativeBankDetail row={bankRow} scope={{entityId:config.entityId,bankAccountRef:'BANK-1',from:'2026-07-01',through:'2026-07-31'}} onBack={()=>{}}/>);
assert.match(bankDetail,/Back to bank transactions/);assert.match(bankDetail,/Bank transaction detail/);assert.match(bankDetail,/-\$125\.25/);assert.match(bankDetail,/2026-07-01/);assert.match(bankDetail,/2026-07-31/);

const reconciliation=renderToStaticMarkup(<AuthoritativeReconciliationSummary row={reconciliationRow}/>);
assert.match(reconciliation,/RECONCILED/);assert.match(reconciliation,/\$1,000\.00/);assert.match(reconciliation,/Unmatched/);assert.match(reconciliation,/READ ONLY/);assert.match(reconciliation,/Open statement detail/);assert.doesNotMatch(reconciliation,/>\s*(Match|Clear|Reopen|Sign off|Post)\s*</);
assert.match(renderToStaticMarkup(<AuthoritativeReconciliationSummary row={null}/>),/No reconciliation statement was returned/);

const reconciliationDetail=renderToStaticMarkup(<AuthoritativeReconciliationDetail row={reconciliationRow} scope={{entityId:config.entityId,bankAccountRef:'BANK-1',statementEndingDate:'2026-07-31'}} onBack={()=>{}}/>);
assert.match(reconciliationDetail,/Back to reconciliation evidence/);assert.match(reconciliationDetail,/Statement ending 2026-07-31/);assert.match(reconciliationDetail,/\$1,000\.00/);assert.match(reconciliationDetail,/11111111-1111-4111-8111-111111111111/);

const source=readFileSync('src/authoritative-bank-workspace.jsx','utf8');
assert.match(source,/phase==='LOADING'.*role="status"/s,'authoritative reads must expose a loading status');
assert.match(source,/phase==='ERROR'.*<ReadError/s,'authoritative reads must expose an API error with retry');
assert.match(source,/phase==='READY'.*AuthoritativeBankTable/s,'Bank results must render only after an API success');
assert.match(source,/phase==='READY'.*AuthoritativeReconciliationSummary/s,'Reconciliation results must render only after an API success');
assert.match(source,/if\(selected\).*AuthoritativeBankDetail/s,'Bank detail must replace the list and retain an explicit Back path');
assert.match(source,/if\(detailOpen&&state\.row\).*AuthoritativeReconciliationDetail/s,'Reconciliation detail must replace the summary and retain an explicit Back path');
assert.doesNotMatch(source,/localStorage|SEED_|bankMatch|bankRecord|bankSignoff/,'authoritative Bank/Reconcile UI must not depend on demo state or mutation helpers');

console.log('authoritative-bank-workspace: scoped full-page read-only SSR contract passed');
