import { useEffect, useMemo, useRef, useState } from 'react';
import { Btn, Badge, Money, Table, StateBlock, Unavailable } from './ui.jsx';
import { money } from './engine.js';
import { BANK_TRANSACTION_PAGE_SIZE, pageBankTransactionEvidence } from './bank-transaction-pagination.js';
import { bankTransactionFocus } from './bank-transaction-focus.js';
import { RECEIPT_VIEWS, RECEIPT_LOCAL_CLOSE_BOUNDARY, receiptEmptyState, receiptBankBridgeHint } from './receipt-view-state.js';
import { localReceiptBankEvidence, receiptEvidenceForView } from './receipt-bank-evidence.js';
import { matchBankTransactions } from './ai-accounting.js';
import { BANK_ACCOUNTS, COA, ENTITIES } from './data.js';
import { bankQueueSummary, BANK_QUEUE_DIMENSION_NOTE } from './bank-queue-summary.js';
import { bankActionVisibility } from './bank-action-visibility.js';
import { bankWorkspaceNavContext, bankWorkspaceUrlScopeLabel, bankWorkspaceUrlSearch, decodeBankWorkspaceUrlState, hasBankWorkspaceUrlState } from './bank-workspace-url-state.js';
import { localBankTransactionEvidence, localBankTransactionEvidenceRows } from './bank-transaction-evidence.js';
import { localUnidentifiedReceiptEvidence, localUnidentifiedReceiptView } from './unidentified-receipt-evidence.js';
import { localUnidentifiedDisbursementEvidence, localUnidentifiedDisbursementView } from './unidentified-disbursement-evidence.js';
import { localBankTransferEvidence } from './bank-transfer-evidence.js';
import { localBankDuplicateEvidence } from './bank-duplicate-evidence.js';
import { localBankTransactionLifecycle } from './bank-transaction-lifecycle.js';
import { localBankTransactionDetailBackTarget, localBankTransactionJournalReturnContext } from './bank-transaction-return.js';
import { localBankScopeEmptyState } from './bank-scope-empty-state.js';
import { localReportReturnScopeLabel } from './report-return-context.js';
import { localPaymentReturnScopeLabel, localPaymentBankEvidenceReturnContext } from './payment-return-context.js';

const queueLabel = { Review:'Pending', Posted:'Posted', Excluded:'Excluded' };

export function BankTransactions({ctx}) {
  const {bank, jes, goto, navContext, ar, entity} = ctx;
  if(ctx.authoritativeMode)return <section className="card"><h2 className="page-h">Bank Transactions</h2>
    <StateBlock tone="error" title="BANK_API_UNAVAILABLE">
      <span>This workspace reads bank evidence from the accounting API. No local browser record is substituted for it.</span>
      <Unavailable reason="The configured accounting API did not return bank evidence.">Server data required</Unavailable>
    </StateBlock></section>;
  const [acctCode, setAcct] = useState('BA-003');
  const [queue, setQueue] = useState('Review');
  const [query, setQuery] = useState('');
  const [dateRange, setDateRange] = useState('All dates');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [entityFilter, setEntityFilter] = useState(entity ? String(entity) : '');
  const [type, setType] = useState('All transactions');
  const [page, setPage] = useState(1);
  const hydratedFromUrl = useRef(false);
  const [receiptView, setReceiptView] = useState('For review');
  const [unidentifiedReceiptView, setUnidentifiedReceiptView] = useState('All');
  const [unidentifiedDisbursementView, setUnidentifiedDisbursementView] = useState('All');
  const account = bank.accounts[acctCode];
  const stateOf = t => localBankTransactionEvidence({...t, bank_account_code:t.bank_account_code || acctCode}, jes, BANK_ACCOUNTS).queue;
  const aiMatchByTxn = useMemo(()=>new Map(matchBankTransactions({bankTransactions:account.txns,bills:ctx.ap?.bills||[]}).map(match=>[String(match.bank_txn_id),match])),[account.txns,ctx.ap?.bills]);
  const transactions = localBankTransactionEvidenceRows(account.txns.map(t=>({...t,bank_account_code:acctCode})), jes, BANK_ACCOUNTS)
    .map(evidence=>({...evidence.transaction,_state:evidence.queue,local_evidence:evidence,lifecycle:localBankTransactionLifecycle(evidence.transaction,{accountCode:acctCode,period:account.period,statementDate:account.stmt_date,history:bank.history}),ai_match:aiMatchByTxn.get(String(evidence.transaction.bank_txn_id))||null}));
  const requestedFocus = navContext?.route === 'banktx' && navContext.bankTxnId != null ? bankTransactionFocus(transactions, navContext.bankTxnId, BANK_TRANSACTION_PAGE_SIZE) : null;
  const receiptEvidence = useMemo(() => localReceiptBankEvidence(jes, Object.entries(bank.accounts).flatMap(([bank_account_code, ac]) => (ac.txns || []).map(transaction => ({ ...transaction, bank_account_code })))), [jes, bank.accounts]);
  const visibleReceiptEvidence = receiptEvidenceForView(receiptEvidence, receiptView);
  const allBankTransactions = Object.entries(bank.accounts).flatMap(([bank_account_code, ac]) => (ac.txns || []).map(transaction => ({...transaction, bank_account_code})));
  const unidentifiedReceiptRows = localUnidentifiedReceiptView(localUnidentifiedReceiptEvidence({bankTransactions:allBankTransactions,journals:jes || [],invoices:ar?.invoices || [],bankAccounts:BANK_ACCOUNTS}), unidentifiedReceiptView)
    .filter(row => row.bankTransaction.bank_account_code === acctCode)
    .map(row => ({...row, bank_txn_id:row.bankTransaction.bank_txn_id}));
  const matchingEntitySelected = Boolean(entity && unidentifiedReceiptRows.every(row => !row.entityId || row.entityId === entity));
  const unidentifiedDisbursementRows = localUnidentifiedDisbursementView(localUnidentifiedDisbursementEvidence({bankTransactions:allBankTransactions,journals:jes || [],bills:ctx.ap?.bills || [],bankAccounts:BANK_ACCOUNTS}), unidentifiedDisbursementView)
    .filter(row => row.bankTransaction.bank_account_code === acctCode)
    .map(row => ({...row, bank_txn_id:row.bankTransaction.bank_txn_id}));
  const matchingDisbursementEntitySelected = Boolean(entity && unidentifiedDisbursementRows.every(row => !row.entityId || row.entityId === entity));
  const transferEvidence = localBankTransferEvidence({bankTransactions:allBankTransactions,journals:jes || [],bankAccounts:BANK_ACCOUNTS});
  const duplicateEvidence = localBankDuplicateEvidence({bankTransactions:allBankTransactions,journals:jes || [],bankAccounts:BANK_ACCOUNTS});
  const duplicateByTxn = new Map(duplicateEvidence.map(row=>[String(row.transaction.bank_txn_id),row]));
  const difference = account.stmt_end - account.gl_book_balance;
  useEffect(() => {
    if (navContext?.route !== 'banktx') return;
    if (navContext.acctCode && bank.accounts[navContext.acctCode]) setAcct(navContext.acctCode);
    if (navContext.queue) setQueue(navContext.queue);
    if (navContext.query!=null) setQuery(navContext.query);
    if (navContext.type) setType(navContext.type);
    if (navContext.dateRange) setDateRange(navContext.dateRange);
    if (navContext.dateFrom != null) setDateFrom(navContext.dateFrom);
    if (navContext.dateTo != null) setDateTo(navContext.dateTo);
    if (navContext.entityId != null) setEntityFilter(String(navContext.entityId || ''));
    if (navContext.page) setPage(navContext.page);
  }, [navContext?.route, navContext?.acctCode, navContext?.queue, navContext?.query, navContext?.type, navContext?.dateRange, navContext?.dateFrom, navContext?.dateTo, navContext?.entityId, navContext?.page, bank.accounts]);
  const accountEntityOf = code => BANK_ACCOUNTS.find(row => row.bank_account_code === code)?.entity_id ?? '';
  const entityOptions = useMemo(() => {
    const ids = [...new Set(Object.keys(bank.accounts).map(code => accountEntityOf(code)).filter(id => id !== ''))];
    return ids.map(id => ({ id:String(id), label:ENTITIES.find(row => row.entity_id === id)?.entity_code || `Entity ${id}` }));
  }, [bank.accounts]);
  const entityScopedAccountCodes = useMemo(() => Object.keys(bank.accounts)
    .filter(code => !entityFilter || String(accountEntityOf(code)) === String(entityFilter)), [bank.accounts, entityFilter]);
  const accountInEntityScope = !entityFilter || String(accountEntityOf(acctCode)) === String(entityFilter);
  useEffect(() => {
    if (!entityFilter || accountInEntityScope) return;
    if (entityScopedAccountCodes.length) setAcct(entityScopedAccountCodes[0]);
  }, [entityFilter, accountInEntityScope, entityScopedAccountCodes.join('|')]);
  const withinDateFilter = value => {
    const date = String(value || '');
    if (dateRange === 'This month' && !date.startsWith('2026-07')) return false;
    if (dateRange === 'Last 90 days' && date < '2026-05-01') return false;
    if (dateRange === 'Custom range') {
      if (dateFrom && date < dateFrom) return false;
      if (dateTo && date > dateTo) return false;
    }
    return true;
  };
  const queueRows = useMemo(()=>transactions.filter(t=>{
    if(t._state!==queue) return false;
    if(!accountInEntityScope) return false;
    if(!withinDateFilter(t.txn_date)) return false;
    if(type==='Money in' && t.direction!=='CREDIT') return false;
    if(type==='Money out' && t.direction!=='DEBIT') return false;
    return !query || `${t.reference} ${t.external_id}`.toLowerCase().includes(query.toLowerCase());
  }),[transactions,queue,dateRange,dateFrom,dateTo,type,query,accountInEntityScope]);
  const queueSummary = bankQueueSummary(accountInEntityScope ? transactions : [], queue);
  const workspaceUrlState = {acctCode, entityId:entityFilter, queue, query, dateRange, dateFrom, dateTo, type, page, bankTxnId:navContext?.route === 'banktx' ? (navContext.bankTxnId ?? '') : ''};
  const workspaceReturnExtras = {entityId:entityFilter, dateFrom, dateTo, scrollY:navContext?.scrollY ?? 0};
  const actionVisibility = bankActionVisibility({can:ctx.can, roleCode:ctx.user?.role_code});
  // Deep link: an address-bar scope is applied once, then re-validated by the
  // existing navContext machinery. It cannot assert a match or a posting state.
  useEffect(() => {
    if (hydratedFromUrl.current) return;
    hydratedFromUrl.current = true;
    if (typeof window === 'undefined' || navContext?.route === 'banktx') return;
    if (!hasBankWorkspaceUrlState(window.location.search)) return;
    const decoded = decodeBankWorkspaceUrlState(window.location.search);
    if (decoded.acctCode && !bank.accounts[decoded.acctCode]) return;
    goto('banktx', bankWorkspaceNavContext(decoded));
  }, []);
  // Mirror the live workspace scope into the address bar so Back, refresh and
  // sharing all restore the same read-only view.
  useEffect(() => {
    if (typeof window === 'undefined' || !window.history?.replaceState) return;
    const search = bankWorkspaceUrlSearch(workspaceUrlState);
    const next = `${window.location.pathname}${search}${window.location.hash || ''}`;
    if (next !== `${window.location.pathname}${window.location.search}${window.location.hash || ''}`) window.history.replaceState(null, '', next);
    return () => {
      if (typeof window === 'undefined' || !window.history?.replaceState) return;
      window.history.replaceState(null, '', `${window.location.pathname}${window.location.hash || ''}`);
    };
  }, [acctCode, entityFilter, queue, query, dateRange, dateFrom, dateTo, type, page, workspaceUrlState.bankTxnId]);
  // Exact Back restoration also returns the reader to the retained scroll offset.
  useEffect(() => {
    if (typeof window === 'undefined' || navContext?.route !== 'banktx') return;
    if (navContext.bankTxnId != null || !navContext.scrollY) return;
    const offset = Number(navContext.scrollY) || 0;
    const timer = setTimeout(() => window.scrollTo({top:offset}), 0);
    return () => clearTimeout(timer);
  }, [navContext?.route, navContext?.bankTxnId, navContext?.scrollY]);
  const pagedQueueRows = pageBankTransactionEvidence(queueRows, page, BANK_TRANSACTION_PAGE_SIZE);
  const bankScopeEmpty = localBankScopeEmptyState({account,transactions,queueRows,queue,entityId:entity});
  useEffect(()=>setPage(1),[acctCode, entityFilter, queue, dateRange, dateFrom, dateTo, type, query]);
  const sourceOf = t => t.suggest ? 'Bank import / local category suggestion' : t.reference.includes('RENT') ? 'Tenant / owner receipt candidate' : 'Needs source mapping';
  const counterpartyOf = t => t.reference.includes('RENT') ? 'Tenant / owner' : 'Needs review';
  const payeeOf = t => t?.payee || t?.local_evidence?.journal?.payee || (String(t?.reference || '').includes('RENT') ? 'Tenant / owner' : 'Payee not retained');
  const openEvidenceDetail = transaction => goto('banktx',{route:'banktx',acctCode,bankTxnId:transaction.bank_txn_id,queue,query,dateRange,type,page,...workspaceReturnExtras,scrollY:typeof window === 'undefined' ? 0 : window.scrollY || 0});
  const counts = k => transactions.filter(t=>t._state===k).length;
  useEffect(() => {
    if (navContext?.route !== 'banktx') return;
    if (!navContext.bankTxnId) return;
    if (requestedFocus?.found) {
      setQueue(navContext.queue || requestedFocus.queue);
      setQuery(navContext.query ?? '');
      setDateRange(navContext.dateRange || 'All dates');
      setDateFrom(navContext.dateFrom || '');
      setDateTo(navContext.dateTo || '');
      setEntityFilter(String(navContext.entityId || ''));
      setType(navContext.type || 'All transactions');
      setPage(navContext.page || requestedFocus.page);
    }
  }, [navContext?.route, navContext?.bankTxnId, requestedFocus?.found, requestedFocus?.queue, requestedFocus?.page, requestedFocus?.transaction?.bank_txn_id]);
  useEffect(() => {
    if (navContext?.route !== 'banktx') return;
    if (navContext.bankTxnId || !navContext.jeNumber) return;
    const all = Object.entries(bank.accounts).flatMap(([code, ac]) => (ac.txns||[]).map(txn=>({ acctCode:code, txn:{...txn, _state:stateOf(txn)} })));
    const hit = all.find(x=>x.txn.matched_je===navContext.jeNumber);
    if (hit) {
      setAcct(hit.acctCode);
      setQueue(hit.txn._state);
      goto('banktx',{route:'banktx',acctCode:hit.acctCode,bankTxnId:hit.txn.bank_txn_id,queue:hit.txn._state,query:'',dateRange:'All dates',type:'All transactions',page:1});
    }
  }, [navContext?.route, navContext?.bankTxnId, navContext?.jeNumber, bank.accounts]);
  const paymentBankDetail = navContext?.paymentReturn && requestedFocus?.found ? requestedFocus.transaction : null;
  if (paymentBankDetail) {
    const paymentReturn = navContext.paymentReturn;
    const bankEvidence = paymentBankDetail.local_evidence;
    const paymentBankReturn = localPaymentBankEvidenceReturnContext({acctCode, bankTxnId:paymentBankDetail.bank_txn_id, paymentReturn});
    const paymentSignedHistoryTarget = paymentBankDetail.lifecycle?.signedEntry ? {
      route:'bankrec', acctCode, historyId:paymentBankDetail.lifecycle.signedEntry.id,
      bankTransactionReturn:{route:'banktx',acctCode,bankTxnId:paymentBankDetail.bank_txn_id,paymentReturn},
    } : null;
    return <div className="full-bleed qbo-transaction-report" aria-label="Local payment bank evidence detail">
      <div className="qbo-report-back"><button type="button" onClick={() => goto('ap', paymentReturn)}>Back to Bill payments</button><span>Payment to retained bank evidence</span></div>
      <div className="gl-drill-head"><div><div className="gl-drill-crumb">Local payment bank drill</div><h2 className="page-h">{paymentBankDetail.external_id || paymentBankDetail.bank_txn_id}</h2><div className="gl-drill-account">{acctCode} · {account.bank_name} · statement {account.stmt_date}</div></div><Badge tone={bankEvidence?.state === 'VALID_LOCAL_MATCH' ? 'ok' : 'warn'}>{bankEvidence?.state || 'REVIEW_REQUIRED'}</Badge></div>
      <div className="qbo-drill-summary"><span><i>Bank date</i><b>{paymentBankDetail.txn_date || 'Not retained'}</b></span><span><i>Direction / amount</i><b>{paymentBankDetail.direction} / {money(paymentBankDetail.amount)}</b></span><span><i>Cash scope</i><b>{bankEvidence?.cashScope || 'Unmapped — review'}</b></span><span><i>Matched JE</i><b>{paymentBankDetail.matched_je || 'No retained match'}</b></span><span><i>Cleared</i><b>{paymentBankDetail.lifecycle?.clearingState || 'NOT_CLEARED'}</b></span><span><i>Reconcile</i><b>{paymentBankDetail.lifecycle?.reconciliationState || 'NOT_SIGNED_OFF'}</b></span></div>
      <p className="muted sm" style={{margin:'8px 0 0'}}>{localPaymentReturnScopeLabel(paymentReturn)}</p>
      <p className="report-drill-hint">This is a read-only local evidence view. Bank match, clearance and sign-off are independent facts; it cannot import a feed, match, clear, post, pay, refund or alter the statement.</p>
      <div className="row-acts" style={{ marginTop: 12 }}>
        {paymentBankDetail.matched_je ? <Btn size="sm" variant="ghost" onClick={() => goto('je', { jeNumber: paymentBankDetail.matched_je, paymentBankReturn })}>Open payment JE</Btn> : <Unavailable reason="No payment journal entry is retained for this bank item.">No retained payment JE</Unavailable>}
        <Btn size="sm" variant="ghost" disabled={bankEvidence?.state !== 'VALID_LOCAL_MATCH'} title={bankEvidence?.state === 'VALID_LOCAL_MATCH' ? 'Open GL Detail for this evidence' : 'Blocked: exact posted local bank evidence is required'} onClick={() => goto('gl', { route: 'gl', tab: 'GL Detail', drillLabel: paymentBankDetail.matched_je || paymentBankDetail.external_id, paymentReturn })}>Open GL Detail</Btn>
        <Btn size="sm" variant="ghost" disabled={bankEvidence?.state !== 'VALID_LOCAL_MATCH'} title={bankEvidence?.state === 'VALID_LOCAL_MATCH' ? 'Open Trial Balance for this evidence' : 'Blocked: exact posted local bank evidence is required'} onClick={() => goto('gl', { route: 'gl', tab: 'Trial Balance', drillLabel: paymentBankDetail.matched_je || paymentBankDetail.external_id, paymentReturn })}>Open Trial Balance</Btn>
        <Btn size="sm" variant="ghost" disabled={bankEvidence?.state !== 'VALID_LOCAL_MATCH'} title={bankEvidence?.state === 'VALID_LOCAL_MATCH' ? 'Open the retained local reconciliation evidence' : 'Blocked: exact posted local bank evidence is required'} onClick={() => goto('bankrec', { route: 'bankrec', acctCode, bankTxnId: paymentBankDetail.bank_txn_id, bankTransactionReturn: { route: 'banktx', acctCode, bankTxnId: paymentBankDetail.bank_txn_id, paymentReturn } })}>Open local reconcile evidence</Btn>
        <Btn size="sm" variant="ghost" disabled={!paymentSignedHistoryTarget} title={paymentSignedHistoryTarget ? 'Open the retained signed reconciliation snapshot for this payment' : paymentBankDetail.lifecycle?.clearingState === 'CLEARED' ? 'No retained signed-off reconciliation for this payment scope' : 'Payment bank evidence is not cleared in a retained signed statement'} onClick={() => goto('bankrec', paymentSignedHistoryTarget)}>Open signed reconciliation history</Btn>
      </div>
    </div>;
  }

  const bankEvidenceDetail = !navContext?.paymentReturn && navContext?.route === 'banktx' && navContext.bankTxnId != null && requestedFocus?.found ? requestedFocus.transaction : null;
  if (bankEvidenceDetail) {
    const bankEvidence = bankEvidenceDetail.local_evidence;
    const duplicateEvidence = duplicateByTxn.get(String(bankEvidenceDetail.bank_txn_id));
    const sourceJournal = bankEvidence?.journal || null;
    const dimensions = key => [...new Set((sourceJournal?.lines || []).map(line => line[key]).filter(value => value != null))];
    const decisionReasons = [
      `Decision: ${bankEvidence?.state || 'REVIEW_REQUIRED'}`,
      bankEvidence?.state === 'VALID_LOCAL_MATCH' ? 'Exact retained POSTED cash JE evidence is present.' : 'No eligible retained POSTED cash JE is proven.',
      duplicateEvidence?.state === 'SUSPECTED_DUPLICATE_BLOCKED' ? 'Duplicate bank-ID boundary requires review.' : null,
      bankEvidenceDetail.lifecycle?.clearingState === 'CLEARED' ? 'Clearing evidence retained.' : 'Not cleared in retained statement evidence.',
      bankEvidenceDetail.lifecycle?.reconciliationState === 'SIGNED_OFF' ? 'Signed-off statement evidence retained.' : 'Not signed off in retained reconciliation evidence.',
    ].filter(Boolean);
    const backTargetBase = localBankTransactionDetailBackTarget(navContext, requestedFocus);
    // Back restores the full workspace scope, including entity, custom dates and scroll offset.
    const backTarget = backTargetBase.route === 'banktx'
      ? {...backTargetBase, context:{...backTargetBase.context, entityId:navContext.entityId || '', dateFrom:navContext.dateFrom || '', dateTo:navContext.dateTo || '', scrollY:navContext.scrollY || 0}}
      : backTargetBase;
    const baseJournalReturn = localBankTransactionJournalReturnContext({acctCode,bankTxnId:bankEvidenceDetail.bank_txn_id,origin:navContext});
    const bankJournalReturn = baseJournalReturn ? {...baseJournalReturn, dateFrom:navContext.dateFrom || '', dateTo:navContext.dateTo || '', scrollY:navContext.scrollY || 0} : null;
    const linkedGlAccount = bankEvidence?.master?.gl_account_code || '';
    const linkedGlAccountName = COA.find(row => row.account_code === linkedGlAccount)?.account_name || '';
    const signedHistoryTarget = bankEvidenceDetail.lifecycle?.signedEntry ? {
      route:'bankrec', acctCode, historyId:bankEvidenceDetail.lifecycle.signedEntry.id,
      bankTransactionReturn:bankJournalReturn,
    } : null;
    return <div className="full-bleed qbo-transaction-report" aria-label="Local bank transaction evidence detail">
      <div className="qbo-report-back"><button type="button" onClick={() => goto(backTarget.route, backTarget.context)}>{backTarget.label}</button><span>Retained local bank evidence</span></div>
      <div className="gl-drill-head"><div><div className="gl-drill-crumb">Bank transactions / evidence detail</div><h2 className="page-h">{bankEvidenceDetail.external_id || bankEvidenceDetail.bank_txn_id}</h2><div className="gl-drill-account">{acctCode} · {account.bank_name} · statement {account.stmt_date}</div></div><Badge tone={bankEvidence?.state === 'VALID_LOCAL_MATCH' ? 'ok' : 'warn'}>{bankEvidence?.state || 'REVIEW_REQUIRED'}</Badge></div>
      <div className="qbo-drill-summary"><span><i>Bank / book date</i><b>{bankEvidenceDetail.txn_date || 'Not retained'} / {bankEvidence?.journal?.je_date || 'No retained JE'}</b></span><span><i>Direction / amount</i><b>{bankEvidenceDetail.direction} / {money(bankEvidenceDetail.amount)}</b></span><span><i>Cash scope</i><b>{bankEvidence?.cashScope || 'Unmapped — review'}</b></span><span><i>Entity</i><b>{bankEvidence?.entityId || 'Unproven'}</b></span><span><i>Matched JE</i><b>{bankEvidenceDetail.matched_je || 'No retained match'}</b></span><span><i>Lifecycle</i><b>{bankEvidenceDetail.lifecycle?.matchState || 'UNMATCHED'} / {bankEvidenceDetail.lifecycle?.clearingState || 'NOT_CLEARED'} / {bankEvidenceDetail.lifecycle?.reconciliationState || 'NOT_SIGNED_OFF'}</b></span></div>
      <section className="report-workbench" aria-label="Bank transaction evidence fields" style={{marginTop:12}}>
        <div className="report-workbench-head"><div><b>Transaction evidence</b><div className="page-subtitle">Full-page detail for one retained bank item. Every field is read from retained records; none of them can be edited here.</div></div><Badge tone={bankEvidenceDetail._state === 'Excluded' ? 'warn' : bankEvidenceDetail._state === 'Posted' ? 'ok' : 'muted'}>{queueLabel[bankEvidenceDetail._state] || 'Pending'}</Badge></div>
        <div className="qbo-toolgrid">
          <span><i>Amount</i><b>{money(bankEvidenceDetail.amount)} · {bankEvidenceDetail.direction === 'DEBIT' ? 'Money out' : 'Money in'}</b></span>
          <span><i>Payee</i><b>{payeeOf(bankEvidenceDetail)}</b></span>
          <span><i>Description</i><b>{bankEvidenceDetail.reference || 'Description not retained'}</b></span>
          <span><i>Queue status</i><b>{queueLabel[bankEvidenceDetail._state] || 'Pending'}</b></span>
          <span><i>Match evidence</i><b>{bankEvidence?.state || 'PENDING_REVIEW'} · {bankEvidence?.label || 'Pending review'}</b></span>
          <span><i>Linked journal entry</i><b>{bankEvidenceDetail.matched_je || 'No retained JE'}</b></span>
          <span><i>Linked GL account</i><b>{linkedGlAccount ? `${linkedGlAccount}${linkedGlAccountName ? ` ${linkedGlAccountName}` : ''}` : 'No mapped cash account'}</b></span>
          <span><i>Reconciliation status</i><b>{bankEvidenceDetail.lifecycle?.matchState || 'UNMATCHED'} / {bankEvidenceDetail.lifecycle?.clearingState || 'NOT_CLEARED'} / {bankEvidenceDetail.lifecycle?.reconciliationState || 'NOT_SIGNED_OFF'}</b></span>
        </div>
        <p className="muted sm" style={{margin:'10px 0 0'}}>{BANK_QUEUE_DIMENSION_NOTE}</p>
      </section>
      <section className="report-workbench bank-action-availability" aria-label="Bank workflow action availability" style={{marginTop:12}}>
        <div className="report-workbench-head"><div><b>Workflow action availability</b><div className="page-subtitle">Shows only the bank queue verbs your role already holds. Availability is reported, never offered: nothing on this page is clickable.</div></div><Badge tone="muted">{actionVisibility.readOnly ? 'READ_ONLY_ROLE' : 'PERMITTED_NOT_EXECUTABLE_HERE'}</Badge></div>
        {actionVisibility.visible.length
          ? <ul className="bank-action-list">{actionVisibility.visible.map(action => <li key={action.id} className="bank-action-item" aria-disabled="true"><span className="bank-action-name">{action.label}</span><span className="bank-action-state">Unavailable here</span><span className="bank-action-why">{action.intent}</span></li>)}</ul>
          : <p className="muted sm" style={{margin:0}}>{actionVisibility.statement}</p>}
        {actionVisibility.visible.length ? <p className="muted sm" style={{margin:'10px 0 0'}}>{actionVisibility.statement}</p> : null}
      </section>
      <section className="report-workbench" aria-label="Bank transaction evidence decision" style={{marginTop:12}}><div className="report-workbench-head"><div><b>Evidence decision</b><div className="page-subtitle">Decision labels are read-only: they do not categorize, match, clear, exclude, restore, or post this transaction.</div></div><Badge tone={bankEvidence?.state === 'VALID_LOCAL_MATCH' ? 'ok' : 'warn'}>{bankEvidence?.state || 'REVIEW_REQUIRED'}</Badge></div><div className="qbo-toolgrid"><span><i>Bank ID / description</i><b>{bankEvidenceDetail.external_id || bankEvidenceDetail.bank_txn_id} / {bankEvidenceDetail.reference || 'Not retained'}</b></span><span><i>Entity / account</i><b>{bankEvidence?.entityId || 'Unproven'} / {acctCode}</b></span><span><i>Property / project / loan</i><b>{dimensions('property_id').join(', ') || 'Unassigned'} / {dimensions('project_id').join(', ') || 'Unassigned'} / {dimensions('loan_id').join(', ') || 'Unassigned'}</b></span><span><i>Source completeness</i><b>{sourceJournal ? 'POSTED JE retained' : 'No eligible retained source'}</b></span><span><i>Candidate / linked source</i><b>{bankEvidenceDetail.matched_je || (bankEvidenceDetail.ai_match?.bill_id ? `Bill ${bankEvidenceDetail.ai_match.bill_id}` : 'No exact candidate')}</b></span><span><i>Reason code</i><b>{duplicateEvidence?.state || bankEvidence?.state || 'REVIEW_REQUIRED'}</b></span></div><p className="muted sm" style={{margin:'10px 0 0'}}>{decisionReasons.join(' ')}</p></section>
      <p className="report-drill-hint">This detail is read-only local evidence. An amount match alone never links a JE: entity, cash account, direction, amount, POSTED state and duplicate boundary must all agree. It cannot import, auto-match, categorize, post, clear, sign off, connect, pay or alter a statement.</p>
      <div className="row-acts" style={{marginTop:12}}>
        {bankEvidenceDetail.matched_je ? <Btn size="sm" variant="ghost" onClick={() => goto('je',{jeNumber:bankEvidenceDetail.matched_je,bankTransactionReturn:bankJournalReturn})}>Open retained JE</Btn> : <Unavailable reason="No journal entry is retained for this bank item.">No retained JE</Unavailable>}
        <Btn size="sm" variant="ghost" disabled={bankEvidence?.state !== 'VALID_LOCAL_MATCH'} title={bankEvidence?.state === 'VALID_LOCAL_MATCH' ? 'Open GL Detail for this evidence' : 'Blocked: exact posted local bank evidence is required'} onClick={() => goto('gl',{route:'gl',tab:'GL Detail',drillLabel:bankEvidenceDetail.matched_je || bankEvidenceDetail.external_id,bankTransactionReturn:bankJournalReturn})}>Open GL Detail</Btn>
        <Btn size="sm" variant="ghost" disabled={bankEvidence?.state !== 'VALID_LOCAL_MATCH'} title={bankEvidence?.state === 'VALID_LOCAL_MATCH' ? 'Open Trial Balance for this evidence' : 'Blocked: exact posted local bank evidence is required'} onClick={() => goto('gl',{route:'gl',tab:'Trial Balance',drillLabel:bankEvidenceDetail.matched_je || bankEvidenceDetail.external_id,bankTransactionReturn:bankJournalReturn})}>Open Trial Balance</Btn>
        <Btn size="sm" variant="ghost" disabled={bankEvidence?.state !== 'VALID_LOCAL_MATCH'} title={bankEvidence?.state === 'VALID_LOCAL_MATCH' ? 'Open the retained local reconciliation evidence' : 'Blocked: exact posted local bank evidence is required'} onClick={() => goto('bankrec',{route:'bankrec',acctCode,bankTxnId:bankEvidenceDetail.bank_txn_id,bankTransactionReturn:bankJournalReturn})}>Open local reconcile evidence</Btn>
        <Btn size="sm" variant="ghost" disabled={!signedHistoryTarget} title={signedHistoryTarget ? 'Open the retained signed reconciliation snapshot for this bank item' : bankEvidenceDetail.lifecycle?.clearingState === 'CLEARED' ? 'No eligible signed reconciliation record for this cleared bank item' : 'Not cleared in a retained signed statement'} onClick={() => goto('bankrec',signedHistoryTarget)}>Open signed reconciliation history</Btn>
      </div>
    </div>;
  }

  const cols = [
    {h:'Date',k:'txn_date'},
    {h:'Bank activity',render:r=><div className="bank-row-primary"><b>{r.reference || 'Description not retained'}</b><span>{r.external_id || r.bank_txn_id}</span><small>{counterpartyOf(r)}</small></div>},
    {h:'Amount',num:true,render:r=><div className="bank-amount"><Money v={r.amount}/><span>{r.direction==='DEBIT'?'Money out':'Money in'}</span></div>},
    {h:'Local evidence',render:r=>{ const recommendation=r.ai_match; const candidateLabel = queue==='Review' ? (r.suggest==='FEE' ? 'Bank fee candidate' : r.suggest==='INTEREST' ? 'Interest income candidate' : r.reference.includes('RENT') ? 'Receipt candidate' : 'No retained candidate') : (r.matched_je || 'No retained JE'); return <div className="bank-evidence-stack"><b>{r.local_evidence?.label || 'Pending review'}</b><span>{r.local_evidence?.cashScope || 'Cash scope unproven'}{r.local_evidence?.dateVariance ? ' · JE date differs' : ''}</span><small>{recommendation ? `${recommendation.status} · ${(recommendation.confidence*100).toFixed(0)}% · ${recommendation.reason}` : candidateLabel}</small></div>;}},
    {h:'Status',render:r=><div className="bank-status-stack"><Badge tone={r.local_evidence?.state==='VALID_LOCAL_MATCH'?'ok':r._state==='Excluded'?'warn':'bad'}>{r.local_evidence?.state || 'PENDING_REVIEW'}</Badge><span>{r.lifecycle.matchState} · {r.lifecycle.clearingState}</span><small>{r.lifecycle.reconciliationState}</small>{duplicateByTxn.get(String(r.bank_txn_id))?.state==='SUSPECTED_DUPLICATE_BLOCKED'&&<Badge tone="bad">DUPLICATE REVIEW</Badge>}</div>},
    {h:'Evidence',render:r=><Btn size="sm" variant="ghost" onClick={()=>openEvidenceDetail(r)}>Open detail</Btn>}
  ];

  return <div className="full-bleed bank-workbench">
    {navContext?.reconciliationReturn && <div className="qbo-report-back"><button type="button" onClick={()=>goto('bankrec',navContext.reconciliationReturn)}>Back to reconciliation history</button><span>Retained sign-off scope · {navContext.reconciliationReturn.historyId == null ? 'current worksheet' : `signed statement ${navContext.reconciliationReturn.historyId}`}</span></div>}
    {navContext?.reportReturn?.route==='gl' && <div className="qbo-report-back"><button type="button" onClick={()=>goto('gl',navContext.reportReturn)}>Back to {navContext.reportReturn.tab || 'report'}</button><span>{localReportReturnScopeLabel(navContext.reportReturn)}</span></div>}
    <div className="accounting-page-head">
      <div><p className="eyebrow">ACCOUNTING / BANKING</p><h2 className="page-h">Bank transactions</h2><p className="page-subtitle">Review retained local activity against existing records; no bank feed or external account connection is used.</p></div>
      <div className="row-acts"><Btn variant="ghost" onClick={()=>goto('register')}>Go to bank register</Btn></div>
    </div>

    <section className="report-workbench" aria-label="Local receipt evidence" style={{marginBottom:12}}>
      <div className="report-workbench-head"><div><b>Receipts</b><div className="page-subtitle">Retained local receipt evidence and bank-match hints.</div></div></div>
      <div className="report-shelf">{RECEIPT_VIEWS.map(view=><button key={view} type="button" aria-pressed={receiptView===view} className={`report-shelf-chip ${receiptView===view?'report-shelf-chip-on':''}`} onClick={()=>setReceiptView(view)}>{view}</button>)}</div>
      {visibleReceiptEvidence.length ? <Table exportName="local-receipt-evidence" features={{exportable:false}} rowKey="receipt_id" cols={[{h:'RECEIPT',k:'description'},{h:'DATE',k:'date'},{h:'VENDOR',k:'vendor'},{h:'AMOUNT',num:true,render:row=><Money v={row.amount}/>},{h:'SOURCE JE',render:row=><Btn size="sm" variant="ghost" onClick={()=>goto('je',{jeNumber:row.journal_number})}>{row.journal_number}</Btn>},{h:'ACTION',render:row=>row.bank_matches.length?<Btn size="sm" variant="ghost" onClick={()=>goto('banktx',{route:'banktx',acctCode:row.bank_matches[0].bank_account_code,bankTxnId:row.bank_matches[0].bank_txn_id})}>Open local bank evidence</Btn>:<span className="muted sm">No matched bank evidence</span>}]} rows={visibleReceiptEvidence}/> : <StateBlock tone="empty" title={receiptEmptyState(receiptView)}><span>{receiptView==='For review' ? "Receipt data is retained only when a local source record exists for review." : 'No local receipt evidence has been marked reviewed.'}</span></StateBlock>}
      <div className="qbo-drill-summary" aria-label="Local receipt to bank boundary"><span><i>Local close bridge</i><b>{receiptBankBridgeHint(receiptView, visibleReceiptEvidence.length)}</b></span><span><i>Excluded</i><b>{RECEIPT_LOCAL_CLOSE_BOUNDARY.excluded.join(' · ')}</b></span></div>
      <p className="muted sm">Local view: {receiptView}. Local evidence can drill only to its retained source JE or already matched bank record; selecting a view does not review, upload, filter, or modify a receipt. REFS does not upload, forward, autofill, or convert a document into a bill or expense.</p>
    </section>

    <section className="report-workbench" aria-label="Unidentified customer receipt evidence" style={{marginBottom:12}}>
      <div className="report-workbench-head"><div><b>Unmatched customer receipt exceptions</b><div className="page-subtitle">Bank CREDIT to local receipt/prepayment evidence to AR/reconcile review. No allocation or posting occurs here.</div></div><Badge tone={unidentifiedReceiptRows.length?'warn':'ok'}>{unidentifiedReceiptRows.length ? 'REVIEW REQUIRED' : 'NO LOCAL EXCEPTIONS'}</Badge></div>
      <div className="report-shelf">{['All','Investigating','Held as unapplied'].map(view=><button key={view} type="button" aria-pressed={unidentifiedReceiptView===view} className={`report-shelf-chip ${unidentifiedReceiptView===view?'report-shelf-chip-on':''}`} onClick={()=>setUnidentifiedReceiptView(view)}>{view}</button>)}</div>
      {unidentifiedReceiptRows.length ? <Table rowKey="bank_txn_id" features={{exportable:false}} cols={[
        {h:'Bank item',render:row=>row.bankTransaction.external_id || row.bankTransaction.bank_txn_id},
        {h:'Date',render:row=>row.bankTransaction.txn_date || '—'},
        {h:'Cash / entity',render:row=><div className="bank-source"><b>{row.cashScope || 'Unmapped'}</b><span>{row.entityId || 'Missing entity'} · {row.bankTransaction.bank_account_code}</span></div>},
        {h:'Received',num:true,render:row=><Money v={row.bankTransaction.amount}/>},
        {h:'Candidate',render:row=>row.candidate ? <span>{row.receiptKind}<br/><small>{row.candidate.je_number}</small></span> : <span className="muted">No exact local receipt JE</span>},
        {h:'Property / counterparty',render:row=><span>{row.propertyId || row.projectId || 'Not retained'}<br/><small>{row.counterparty || 'Unidentified'}</small></span>},
        {h:'State',render:row=><Badge tone={row.workflowState==='INVESTIGATING'?'warn':'bad'}>{row.workflowState}</Badge>},
        {h:'Review drill',render:row=><span className="row-acts">{row.candidate && <Btn size="sm" variant="ghost" onClick={()=>goto('je',{jeNumber:row.candidate.je_number})}>Open JE</Btn>}<Btn size="sm" variant="ghost" disabled={!matchingEntitySelected} title={matchingEntitySelected?'Open the active entity aging view':'Select the matching entity before opening aging'} onClick={()=>goto('ar',{route:'ar',tab:'AR Aging',asOfDate:account.stmt_date})}>AR Aging</Btn><Btn size="sm" variant="ghost" onClick={()=>goto('bankrec',{route:'bankrec',acctCode,bankTxnId:row.bankTransaction.bank_txn_id})}>Reconcile review</Btn></span>},
      ]} rows={unidentifiedReceiptRows}/> : <StateBlock tone="empty" title="No unmatched customer receipt exception">No unmatched CREDIT exception is retained for this local bank account/view.</StateBlock>}
      <p className="muted sm" style={{margin:'10px 0 0'}}>Exact amount alone never allocates a receipt. Cross-entity, same-amount multi-candidate, escrow/restricted/security-deposit, owner/related-party, or missing property/unit evidence remains held as unapplied for manual review; bank MATCHED, cleared, and signed-off are separate states.</p>
    </section>

    <section className="report-workbench" aria-label="Unidentified disbursement evidence" style={{marginBottom:12}}>
      <div className="report-workbench-head"><div><b>Unmatched disbursement exceptions</b><div className="page-subtitle">Bank DEBIT to AP / expense / CWIP candidate evidence to reconcile review. No category, payment, or posting action occurs here.</div></div><Badge tone={unidentifiedDisbursementRows.length?'warn':'ok'}>{unidentifiedDisbursementRows.length ? 'REVIEW REQUIRED' : 'NO LOCAL EXCEPTIONS'}</Badge></div>
      <div className="report-shelf">{['All','Investigating','Held unexplained'].map(view=><button key={view} type="button" aria-pressed={unidentifiedDisbursementView===view} className={`report-shelf-chip ${unidentifiedDisbursementView===view?'report-shelf-chip-on':''}`} onClick={()=>setUnidentifiedDisbursementView(view)}>{view}</button>)}</div>
      {unidentifiedDisbursementRows.length ? <Table rowKey="bank_txn_id" features={{exportable:false}} cols={[
        {h:'Bank item',render:row=>row.bankTransaction.external_id || row.bankTransaction.bank_txn_id},
        {h:'Date',render:row=>row.bankTransaction.txn_date || '—'},
        {h:'Cash / entity',render:row=><div className="bank-source"><b>{row.cashScope || 'Unmapped'}</b><span>{row.entityId || 'Missing entity'} · {row.bankTransaction.bank_account_code}</span></div>},
        {h:'Spent',num:true,render:row=><Money v={row.bankTransaction.amount}/>},
        {h:'Candidate',render:row=>row.candidate ? <span>{row.disbursementKind}<br/><small>{row.candidate.je_number}</small></span> : <span className="muted">No exact local payment/JE</span>},
        {h:'Property / payee',render:row=><span>{row.propertyId || row.projectId || 'Not retained'}<br/><small>{row.counterparty || 'Unidentified'}</small></span>},
        {h:'State',render:row=><Badge tone={row.workflowState==='INVESTIGATING'?'warn':'bad'}>{row.workflowState}</Badge>},
        {h:'Review drill',render:row=><span className="row-acts">{row.candidate && <Btn size="sm" variant="ghost" onClick={()=>goto('je',{jeNumber:row.candidate.je_number})}>Open JE</Btn>}<Btn size="sm" variant="ghost" disabled={!matchingDisbursementEntitySelected} title={matchingDisbursementEntitySelected?'Open the active entity AP aging view':'Select the matching entity before opening AP aging'} onClick={()=>goto('ap',{route:'ap',tab:'AP Aging'})}>AP Aging</Btn><Btn size="sm" variant="ghost" onClick={()=>goto('bankrec',{route:'bankrec',acctCode,bankTxnId:row.bankTransaction.bank_txn_id})}>Reconcile review</Btn></span>},
      ]} rows={unidentifiedDisbursementRows}/> : <StateBlock tone="empty" title="No unmatched disbursement exception">No unmatched DEBIT exception is retained for this local bank account/view.</StateBlock>}
      <p className="muted sm" style={{margin:'10px 0 0'}}>Exact amount is only a review candidate. Capitalized-vs-expense, prepaid/tax/insurance, related-party, loan/escrow/restricted cash, missing property/project, cross-entity, and same-amount multi-candidate payments remain held unexplained; they do not become matched, cleared, posted, or sign-off eligible.</p>
    </section>
    <section className="report-workbench" aria-label="Local bank transfer evidence" style={{marginBottom:12}}><div className="report-workbench-head"><div><b>Local bank-to-bank transfer evidence</b><div className="page-subtitle">Two-sided retained evidence only. Transfers are excluded from operating/investing/financing cash-flow classification.</div></div><Badge tone={transferEvidence.some(row=>row.state!=='CONFIRMED_LOCAL_TRANSFER_EVIDENCE')?'warn':'ok'}>{transferEvidence.length?'LOCAL REVIEW':'NO LOCAL TRANSFERS'}</Badge></div>{transferEvidence.length?<Table rowKey={row=>row.from.txn.bank_txn_id} features={{exportable:false}} cols={[{h:'From / to',render:row=><span>{row.from.master?.bank_account_code||'Unmapped'} to {row.to?.master?.bank_account_code||'Unpaired'}</span>},{h:'Amount',num:true,render:row=><Money v={row.amount}/>},{h:'Cash scope',render:row=><span>{row.fromScope||'—'} to {row.toScope||'—'}</span>},{h:'Transfer JE',render:row=>row.journal?<Btn size="sm" variant="ghost" onClick={()=>goto('je',{jeNumber:row.journal.je_number})}>{row.journal.je_number}</Btn>:'—'},{h:'State',render:row=><Badge tone={row.state==='CONFIRMED_LOCAL_TRANSFER_EVIDENCE'?'ok':'warn'}>{row.state}</Badge>}]} rows={transferEvidence}/>:<StateBlock tone="empty" title="No local bank-to-bank transfer evidence">No retained matched bank-transfer evidence is available.</StateBlock>}<p className="muted sm">Cross-entity, restricted/escrow, loan-draw, unpaired, same-amount ambiguous, or non-posted-transfer evidence remains held. This view cannot initiate a transfer, match bank items, or alter cash flow.</p></section>

    <div className="bank-health" role="status">
      <span className="bank-health-icon">!</span><div><b>Bank connection actions are outside REFS</b><p>REFS reviews retained local bank evidence only. External feed repair, linking, disconnecting, importing and reconnecting are not part of this controller workspace.</p></div>
    </div>
    {navContext?.route==='banktx' && (navContext.bankTxnId || navContext.jeNumber) && <div className="bank-health" role="status" style={{marginTop:12}}>
      <span className="bank-health-icon">i</span><div><b>{navContext.bankTxnId && requestedFocus && !requestedFocus.found ? 'No local bank evidence found' : 'Drill context applied'}</b><p>{navContext.bankTxnId ? (requestedFocus?.found ? `Focused retained local bank transaction ${navContext.bankTxnId} in ${requestedFocus.queue}, page ${requestedFocus.page}.` : `No retained local bank transaction matches ${navContext.bankTxnId}.`) : `Located the matched bank transaction for journal entry ${navContext.jeNumber}.`}</p></div></div>}
    <div className="acct-cards bank-account-strip">
      {Object.entries(bank.accounts).filter(([code])=>entityScopedAccountCodes.includes(code) || code===acctCode).map(([code,ac])=>{
        const cardDifference = ac.stmt_end - ac.gl_book_balance;
        return <button key={code} className={`acct-card bank-account-card ${acctCode===code?'acct-on':''}`} onClick={()=>setAcct(code)}>
          <div className="acct-head"><span><b>{ac.bank_name}</b><small>{code} - retained through {ac.stmt_date}</small></span><span className="bank-account-pill">{ac.txns.filter(t=>stateOf(t)==='Review').length}</span><Badge tone={Math.abs(cardDifference)>.005?'warn':'ok'}>{Math.abs(cardDifference)>.005?'Needs attention':'Local evidence'}</Badge></div>
          <div className="acct-bal"><span><i>Bank balance</i><Money v={ac.stmt_end}/></span><span><i>In REFS</i><Money v={ac.gl_book_balance}/></span></div>
          <div className="acct-review"><b>{ac.txns.filter(t=>stateOf(t)==='Review').length}</b> pending review</div>
        </button>;
      })}
    </div>

    {!accountInEntityScope && <div className="bank-health" role="status" style={{marginBottom:12}}><span className="bank-health-icon">i</span><div><b>Entity filter excludes this bank account</b><p>Bank account {acctCode} does not belong to the selected entity, so no rows are listed. Clear the entity filter or choose an in-scope account; REFS never lists cross-entity bank evidence together.</p></div></div>}
    <section className="bank-queue-card">
      <div className="bank-account-summary">
        <div className="bank-summary-title">
          <div>
            <b>{account.bank_name}</b>
            <span>{acctCode} - {counts('Review')} pending review</span>
          </div>
          <Badge tone={Math.abs(difference)>.005?'warn':'ok'}>{Math.abs(difference)>.005?'Out of balance':'In sync'}</Badge>
        </div>
        <div className="bank-summary-metrics">
          <span><i>Bank</i><b>{money(account.stmt_end)}</b></span>
          <span><i>Posted</i><b>{money(account.gl_book_balance)}</b></span>
          <span><i>Difference</i><b>{money(difference)}</b></span>
          <span><i>Updated</i><b>{account.stmt_date}</b></span>
        </div>
      </div>
      <div className="bank-queue-seg-row">
        <div className="bank-queue-seg" role="tablist" aria-label="Bank transaction queue status">
          {queueSummary.segments.map(segment=><button type="button" role="tab" key={segment.key} aria-selected={segment.selected} className={`bank-queue-seg-item ${segment.selected?'bank-queue-seg-on':''}`} onClick={()=>setQueue(segment.key)}>{segment.inlineLabel}</button>)}
        </div>
        <span className="bank-queue-seg-note">{BANK_QUEUE_DIMENSION_NOTE}</span>
      </div>
      <div className="bank-toolbar">
        <label className="bank-search"><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search bank description or ID"/><span className="bank-search-glyph" aria-hidden="true" /></label>
        <select aria-label="Bank account" value={acctCode} onChange={e=>setAcct(e.target.value)}>{Object.entries(bank.accounts).map(([code,ac])=><option key={code} value={code}>{code} {ac.bank_name}</option>)}</select>
        <select aria-label="Entity" value={entityFilter} onChange={e=>setEntityFilter(e.target.value)}><option value="">All entities</option>{entityOptions.map(option=><option key={option.id} value={option.id}>{option.label}</option>)}</select>
        <select aria-label="Date" value={dateRange} onChange={e=>setDateRange(e.target.value)}><option>All dates</option><option>This month</option><option>Last 90 days</option><option>Custom range</option></select>
        {dateRange==='Custom range' && <input type="date" aria-label="Date from" value={dateFrom} onChange={e=>setDateFrom(e.target.value)}/>}
        {dateRange==='Custom range' && <input type="date" aria-label="Date to" value={dateTo} onChange={e=>setDateTo(e.target.value)}/>}
        <select aria-label="Transaction type" value={type} onChange={e=>setType(e.target.value)}><option>All transactions</option><option>Money in</option><option>Money out</option></select>
        <span className="bank-result-count">{pagedQueueRows.total ? `${pagedQueueRows.start}-${pagedQueueRows.end} of ${pagedQueueRows.total}` : '0-0 of 0'} local transactions in {queueLabel[queue]}</span>
      </div>
      {pagedQueueRows.rows.length ? <div className="bank-table"><Table rowKey="bank_txn_id" features={{filterable:false}} cols={cols} rows={pagedQueueRows.rows}/></div> : <StateBlock tone="empty" className="bank-queue-empty" label="Local bank scope empty state"
        title={bankScopeEmpty.title || `No ${queueLabel[queue].toLowerCase()} transactions`}
        actions={<><Btn size="sm" variant="ghost" onClick={()=>goto('register')}>Open local bank register</Btn>
          {bankScopeEmpty.state==='NO_LOCAL_BANK_EVIDENCE'
            ? <Unavailable reason="No retained local cash evidence exists for this account and period.">Local GL Detail</Unavailable>
            : <Btn size="sm" variant="ghost" onClick={()=>goto('gl',{route:'gl',tab:'GL Detail',fromP:account.period,toP:account.period,drillLabel:`${acctCode} local cash evidence`})}>Open local GL Detail</Btn>}</>}>
        <span>{bankScopeEmpty.detail || 'No retained local bank evidence matches the selected account, queue, and filters.'}</span>
        <small>Scope: {acctCode} · {account.period} · {BANK_ACCOUNTS.find(row=>row.bank_account_code===acctCode)?.cash_scope || 'Unmapped cash scope'} · {entity || 'No active entity'}</small>
      </StateBlock>}
      <nav className="bank-pagination" aria-label="Local bank transaction pages"><span className="bank-pagination-range">{pagedQueueRows.total ? `${pagedQueueRows.start}-${pagedQueueRows.end} of ${pagedQueueRows.total}` : '0-0 of 0'}</span><button type="button" disabled={pagedQueueRows.currentPage===1} onClick={()=>setPage(p=>p-1)}>Previous</button><span>Page {pagedQueueRows.currentPage} of {pagedQueueRows.pageCount}</span><button type="button" disabled={pagedQueueRows.currentPage===pagedQueueRows.pageCount} onClick={()=>setPage(p=>p+1)}>Next</button></nav>
      <section className="bank-action-availability" aria-label="Bank queue action availability">
        <b>Workflow action availability</b>
        {actionVisibility.visible.length
          ? <ul className="bank-action-list">{actionVisibility.visible.map(action => <li key={action.id} className="bank-action-item" aria-disabled="true"><span className="bank-action-name">{action.label}</span><span className="bank-action-state">Unavailable here</span><span className="bank-action-why">{action.intent}</span></li>)}</ul>
          : null}
        <p className="muted sm" style={{margin:'8px 0 0'}}>{actionVisibility.statement}</p>
      </section>
      <div className="bank-footer"><span>Retained local bank evidence is read-only; no categorize, match, exclude, restore, or posting action is available.</span><span>Drill path: report to detail ledger to source-ready bank evidence</span></div>
      <p className="muted sm bank-url-scope" style={{margin:'0 14px 12px'}}>Shareable scope: {bankWorkspaceUrlScopeLabel(workspaceUrlState)}. The address bar retains filters and selection only; it can never assert a match, clearing, sign-off, posting state, or permission.</p>
    </section>
  </div>;
}
