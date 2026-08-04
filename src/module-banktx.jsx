import { useEffect, useMemo, useState } from 'react';
import { Btn, Badge, Money, Table } from './ui.jsx';
import { money } from './engine.js';
import { cashImpact, eligibleBankMatchCandidates, localBankPostingTrace } from './bank-matching.js';
import { BANK_TRANSACTION_PAGE_SIZE, pageBankTransactionEvidence } from './bank-transaction-pagination.js';
import { bankTransactionFocus } from './bank-transaction-focus.js';
import { RECEIPT_VIEWS, RECEIPT_LOCAL_CLOSE_BOUNDARY, receiptEmptyState, receiptBankBridgeHint } from './receipt-view-state.js';
import { localReceiptBankEvidence, receiptEvidenceForView } from './receipt-bank-evidence.js';
import { matchBankTransactions } from './ai-accounting.js';
import { BANK_ACCOUNTS } from './data.js';
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
  const {bank, jes, actions, toast, goto, navContext, ar, entity} = ctx;
  const [acctCode, setAcct] = useState('BA-003');
  const [queue, setQueue] = useState('Review');
  const [query, setQuery] = useState('');
  const [dateRange, setDateRange] = useState('All dates');
  const [type, setType] = useState('All transactions');
  const [page, setPage] = useState(1);
  const [receiptView, setReceiptView] = useState('For review');
  const [checked, setChecked] = useState({});
  const [matchTxn, setMatchTxn] = useState(null);
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
  const matchCandidates = useMemo(()=>eligibleBankMatchCandidates(jes,matchTxn).filter(journal => localBankTransactionEvidence({...matchTxn,bank_account_code:acctCode,match_status:'MATCHED',matched_je:journal.je_number}, jes, BANK_ACCOUNTS).state === 'VALID_LOCAL_MATCH'),[jes,matchTxn,acctCode]);
  useEffect(() => {
    if (navContext?.route !== 'banktx') return;
    if (navContext.acctCode && bank.accounts[navContext.acctCode]) setAcct(navContext.acctCode);
    if (navContext.queue) setQueue(navContext.queue);
    if (navContext.query!=null) setQuery(navContext.query);
    if (navContext.type) setType(navContext.type);
    if (navContext.dateRange) setDateRange(navContext.dateRange);
    if (navContext.page) setPage(navContext.page);
  }, [navContext?.route, navContext?.acctCode, navContext?.queue, navContext?.query, navContext?.type, navContext?.dateRange, navContext?.page, bank.accounts]);
  const queueRows = useMemo(()=>transactions.filter(t=>{
    if(t._state!==queue) return false;
    if(dateRange==='This month' && !String(t.txn_date||'').startsWith('2026-07')) return false;
    if(dateRange==='Last 90 days' && String(t.txn_date||'')<'2026-05-01') return false;
    if(type==='Money in' && t.direction!=='CREDIT') return false;
    if(type==='Money out' && t.direction!=='DEBIT') return false;
    return !query || `${t.reference} ${t.external_id}`.toLowerCase().includes(query.toLowerCase());
  }),[transactions,queue,dateRange,type,query]);
  const pagedQueueRows = pageBankTransactionEvidence(queueRows, page, BANK_TRANSACTION_PAGE_SIZE);
  const bankScopeEmpty = localBankScopeEmptyState({account,transactions,queueRows,queue,entityId:entity});
  useEffect(()=>setPage(1),[acctCode, queue, dateRange, type, query]);
  const suggested = t => t.suggest==='FEE' ? 'Bank fees' : t.suggest==='INTEREST' ? 'Interest income' : t.reference.includes('RENT') ? 'Match existing rent receipt' : 'Uncategorized - review required';
  const confidence = t => t.suggest ? 92 : t.reference.includes('RENT') ? 88 : 40;
  const sourceOf = t => t.suggest ? 'Bank import / local category suggestion' : t.reference.includes('RENT') ? 'Tenant / owner receipt candidate' : 'Needs source mapping';
  const counterpartyOf = t => t.reference.includes('RENT') ? 'Tenant / owner' : 'Needs review';
  const actionLabel = t => t.suggest ? 'Categorize' : 'Match';
  const accept = t => {
    const duplicate=duplicateByTxn.get(String(t.bank_txn_id));
    if (duplicate?.state==='SUSPECTED_DUPLICATE_BLOCKED') { toast('Suspected duplicate: retain for review before any match or category action.','bad'); return; }
    if(t.suggest) { actions.bankRecord(acctCode,t.bank_txn_id); toast(`Recorded using suggestion: ${suggested(t)}`); }
    else setMatchTxn(t);
  };
  const completeMatch = je => {
    if(!matchTxn) return;
    actions.bankMatch(acctCode,matchTxn.bank_txn_id,je.je_number);
    toast(`Matched ${matchTxn.external_id} to ${je.je_number}.`);
    setMatchTxn(null);
  };
  const counts = k => transactions.filter(t=>t._state===k).length;
  const selected = Object.keys(checked).filter(k=>checked[k]);
  const selectedPostedTxn = queue==='Posted' && selected.length===1 ? transactions.find(t=>String(t.bank_txn_id)===selected[0]) : null;
  const selectedPostedTrace = selectedPostedTxn ? localBankPostingTrace(selectedPostedTxn, jes) : null;
  useEffect(() => {
    if (navContext?.route !== 'banktx') return;
    if (!navContext.bankTxnId) return;
    if (requestedFocus?.found) {
      setChecked(current => current[requestedFocus.transaction.bank_txn_id] && Object.keys(current).length === 1 ? current : { [requestedFocus.transaction.bank_txn_id]: true });
      setQueue(requestedFocus.queue);
      setQuery('');
      setDateRange('All dates');
      setType('All transactions');
      setPage(requestedFocus.page);
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
      setChecked({ [hit.txn.bank_txn_id]: true });
    }
  }, [navContext?.route, navContext?.bankTxnId, navContext?.jeNumber, bank.accounts]);
  const batchAccept = () => {
    if(!selected.length){ toast('Select at least one transaction first','warn'); return; }
    selected.forEach(id=>{ const t=transactions.find(x=>String(x.bank_txn_id)===id); if(t) accept(t); });
    setChecked({});
  };
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
      <div className="qbo-report-back"><button type="button" onClick={() => goto('ap', paymentReturn)}>Back to Bill payments</button><span>Payment → retained bank evidence</span></div>
      <div className="gl-drill-head"><div><div className="gl-drill-crumb">Local payment bank drill</div><h2 className="page-h">{paymentBankDetail.external_id || paymentBankDetail.bank_txn_id}</h2><div className="gl-drill-account">{acctCode} · {account.bank_name} · statement {account.stmt_date}</div></div><Badge tone={bankEvidence?.state === 'VALID_LOCAL_MATCH' ? 'ok' : 'warn'}>{bankEvidence?.state || 'REVIEW_REQUIRED'}</Badge></div>
      <div className="qbo-drill-summary"><span><i>Bank date</i><b>{paymentBankDetail.txn_date || 'Not retained'}</b></span><span><i>Direction / amount</i><b>{paymentBankDetail.direction} / {money(paymentBankDetail.amount)}</b></span><span><i>Cash scope</i><b>{bankEvidence?.cashScope || 'Unmapped — review'}</b></span><span><i>Matched JE</i><b>{paymentBankDetail.matched_je || 'No retained match'}</b></span><span><i>Cleared</i><b>{paymentBankDetail.lifecycle?.clearingState || 'NOT_CLEARED'}</b></span><span><i>Reconcile</i><b>{paymentBankDetail.lifecycle?.reconciliationState || 'NOT_SIGNED_OFF'}</b></span></div>
      <p className="muted sm" style={{margin:'8px 0 0'}}>{localPaymentReturnScopeLabel(paymentReturn)}</p>
      <p className="report-drill-hint">This is a read-only local evidence view. Bank match, clearance and sign-off are independent facts; it cannot import a feed, match, clear, post, pay, refund or alter the statement.</p>
      <div className="row-acts" style={{ marginTop: 12 }}>
        {paymentBankDetail.matched_je ? <Btn size="sm" variant="ghost" onClick={() => goto('je', { jeNumber: paymentBankDetail.matched_je, paymentBankReturn })}>Open payment JE</Btn> : <Btn size="sm" variant="ghost" disabled>No retained payment JE</Btn>}
        <Btn size="sm" variant="ghost" disabled={bankEvidence?.state !== 'VALID_LOCAL_MATCH'} onClick={() => goto('gl', { route: 'gl', tab: 'GL Detail', drillLabel: paymentBankDetail.matched_je || paymentBankDetail.external_id, paymentReturn })}>Open GL Detail</Btn>
        <Btn size="sm" variant="ghost" disabled={bankEvidence?.state !== 'VALID_LOCAL_MATCH'} onClick={() => goto('gl', { route: 'gl', tab: 'Trial Balance', drillLabel: paymentBankDetail.matched_je || paymentBankDetail.external_id, paymentReturn })}>Open Trial Balance</Btn>
        <Btn size="sm" variant="ghost" disabled={bankEvidence?.state !== 'VALID_LOCAL_MATCH'} title={bankEvidence?.state === 'VALID_LOCAL_MATCH' ? 'Open the retained local reconciliation evidence' : 'Blocked: exact posted local bank evidence is required'} onClick={() => goto('bankrec', { route: 'bankrec', acctCode, bankTxnId: paymentBankDetail.bank_txn_id, bankTransactionReturn: { route: 'banktx', acctCode, bankTxnId: paymentBankDetail.bank_txn_id, paymentReturn } })}>Open local reconcile evidence</Btn>
        <Btn size="sm" variant="ghost" disabled={!paymentSignedHistoryTarget} title={paymentSignedHistoryTarget ? 'Open the retained signed reconciliation snapshot for this payment' : paymentBankDetail.lifecycle?.clearingState === 'CLEARED' ? 'No retained signed-off reconciliation for this payment scope' : 'Payment bank evidence is not cleared in a retained signed statement'} onClick={() => goto('bankrec', paymentSignedHistoryTarget)}>Open signed reconciliation history</Btn>
      </div>
    </div>;
  }

  const bankEvidenceDetail = !navContext?.paymentReturn && navContext?.route === 'banktx' && navContext.bankTxnId != null && requestedFocus?.found ? requestedFocus.transaction : null;
  if (bankEvidenceDetail) {
    const bankEvidence = bankEvidenceDetail.local_evidence;
    const backTarget = localBankTransactionDetailBackTarget(navContext, requestedFocus);
    const bankJournalReturn = localBankTransactionJournalReturnContext({acctCode,bankTxnId:bankEvidenceDetail.bank_txn_id,origin:navContext});
    const signedHistoryTarget = bankEvidenceDetail.lifecycle?.signedEntry ? {
      route:'bankrec', acctCode, historyId:bankEvidenceDetail.lifecycle.signedEntry.id,
      bankTransactionReturn:{route:'banktx',acctCode,bankTxnId:bankEvidenceDetail.bank_txn_id,queue:requestedFocus.queue || navContext.queue || 'Review'},
    } : null;
    return <div className="full-bleed qbo-transaction-report" aria-label="Local bank transaction evidence detail">
      <div className="qbo-report-back"><button type="button" onClick={() => goto(backTarget.route, backTarget.context)}>{backTarget.label}</button><span>Retained local bank evidence</span></div>
      <div className="gl-drill-head"><div><div className="gl-drill-crumb">Bank transactions / evidence detail</div><h2 className="page-h">{bankEvidenceDetail.external_id || bankEvidenceDetail.bank_txn_id}</h2><div className="gl-drill-account">{acctCode} · {account.bank_name} · statement {account.stmt_date}</div></div><Badge tone={bankEvidence?.state === 'VALID_LOCAL_MATCH' ? 'ok' : 'warn'}>{bankEvidence?.state || 'REVIEW_REQUIRED'}</Badge></div>
      <div className="qbo-drill-summary"><span><i>Bank / book date</i><b>{bankEvidenceDetail.txn_date || 'Not retained'} / {bankEvidence?.journal?.je_date || 'No retained JE'}</b></span><span><i>Direction / amount</i><b>{bankEvidenceDetail.direction} / {money(bankEvidenceDetail.amount)}</b></span><span><i>Cash scope</i><b>{bankEvidence?.cashScope || 'Unmapped — review'}</b></span><span><i>Entity</i><b>{bankEvidence?.entityId || 'Unproven'}</b></span><span><i>Matched JE</i><b>{bankEvidenceDetail.matched_je || 'No retained match'}</b></span><span><i>Lifecycle</i><b>{bankEvidenceDetail.lifecycle?.matchState || 'UNMATCHED'} / {bankEvidenceDetail.lifecycle?.clearingState || 'NOT_CLEARED'} / {bankEvidenceDetail.lifecycle?.reconciliationState || 'NOT_SIGNED_OFF'}</b></span></div>
      <p className="report-drill-hint">This detail is read-only local evidence. An amount match alone never links a JE: entity, cash account, direction, amount, POSTED state and duplicate boundary must all agree. It cannot import, auto-match, categorize, post, clear, sign off, connect, pay or alter a statement.</p>
      <div className="row-acts" style={{marginTop:12}}>
        {bankEvidenceDetail.matched_je ? <Btn size="sm" variant="ghost" onClick={() => goto('je',{jeNumber:bankEvidenceDetail.matched_je,bankTransactionReturn:bankJournalReturn})}>Open retained JE</Btn> : <Btn size="sm" variant="ghost" disabled>No retained JE</Btn>}
        <Btn size="sm" variant="ghost" disabled={bankEvidence?.state !== 'VALID_LOCAL_MATCH'} onClick={() => goto('gl',{route:'gl',tab:'GL Detail',drillLabel:bankEvidenceDetail.matched_je || bankEvidenceDetail.external_id,bankTransactionReturn:bankJournalReturn})}>Open GL Detail</Btn>
        <Btn size="sm" variant="ghost" disabled={bankEvidence?.state !== 'VALID_LOCAL_MATCH'} onClick={() => goto('gl',{route:'gl',tab:'Trial Balance',drillLabel:bankEvidenceDetail.matched_je || bankEvidenceDetail.external_id,bankTransactionReturn:bankJournalReturn})}>Open Trial Balance</Btn>
        <Btn size="sm" variant="ghost" disabled={bankEvidence?.state !== 'VALID_LOCAL_MATCH'} title={bankEvidence?.state === 'VALID_LOCAL_MATCH' ? 'Open the retained local reconciliation evidence' : 'Blocked: exact posted local bank evidence is required'} onClick={() => goto('bankrec',{route:'bankrec',acctCode,bankTxnId:bankEvidenceDetail.bank_txn_id,bankTransactionReturn:{route:'banktx',acctCode,bankTxnId:bankEvidenceDetail.bank_txn_id,arReturn:navContext.arReturn || null,reconciliationReturn:navContext.reconciliationReturn || null}})}>Open local reconcile evidence</Btn>
        <Btn size="sm" variant="ghost" disabled={!signedHistoryTarget} title={signedHistoryTarget ? 'Open the retained signed reconciliation snapshot for this bank item' : bankEvidenceDetail.lifecycle?.clearingState === 'CLEARED' ? 'No eligible signed reconciliation record for this cleared bank item' : 'Not cleared in a retained signed statement'} onClick={() => goto('bankrec',signedHistoryTarget)}>Open signed reconciliation history</Btn>
      </div>
    </div>;
  }

  const cols = [
    {h:'',w:36,render:r=><input aria-label={`Select ${r.external_id}`} type="checkbox" checked={!!checked[r.bank_txn_id]} onChange={e=>setChecked(c=>({...c,[r.bank_txn_id]:e.target.checked}))}/>},
    {h:'Date',k:'txn_date'},
    {h:'Bank description',render:r=><div className="bank-desc"><b>{r.reference}</b><span>{r.external_id}</span></div>},
    {h:'Local proof',render:r=><div className="bank-source"><b>{r.local_evidence?.label || 'Pending review'}</b><span>{r.local_evidence?.cashScope || 'Cash scope unproven'}{r.local_evidence?.dateVariance ? ' · JE date differs' : ''}</span></div>},
    {h:'Spent',num:true,render:r=>r.direction==='DEBIT'?<Money v={r.amount}/>:<span className="muted">--</span>},
    {h:'Received',num:true,render:r=>r.direction==='CREDIT'?<Money v={r.amount}/>:<span className="muted">--</span>},
    {h:'From / To',render:r=><div className="bank-party"><b>{counterpartyOf(r)}</b><span>{r.reference.includes('RENT')?'Receipt can link to subledger activity':'No counterparty confirmed yet'}</span></div>},
    {h:'Proof state',render:r=><span className="row-acts"><Badge tone={r.local_evidence?.state==='VALID_LOCAL_MATCH'?'ok':r._state==='Excluded'?'warn':'bad'}>{r.local_evidence?.state || 'PENDING_REVIEW'}</Badge>{duplicateByTxn.get(String(r.bank_txn_id))?.state==='SUSPECTED_DUPLICATE_BLOCKED'&&<Badge tone="bad">DUPLICATE REVIEW</Badge>}</span>},
    {h:'Lifecycle',render:r=><span className="row-acts"><Badge tone={r.lifecycle.matchState==='MATCHED'?'ok':'warn'}>{r.lifecycle.matchState}</Badge><Badge tone={r.lifecycle.clearingState==='CLEARED'?'ok':'muted'}>{r.lifecycle.clearingState}</Badge><Badge tone={r.lifecycle.reconciliationState==='SIGNED_OFF'?'ok':'muted'}>{r.lifecycle.reconciliationState}</Badge></span>},
    {h:'AI evidence',render:r=>{ const recommendation=r.ai_match; if(!recommendation) return <span className="muted sm">No recommendation</span>; const tone=recommendation.status==='SUSPICIOUS'?'bad':recommendation.status==='MATCHED'?'ok':'warn'; return <div className="bank-suggestion"><Badge tone={tone}>{recommendation.status}</Badge><span><i className={recommendation.confidence>=.8?'confidence-good':'confidence-low'}>{(recommendation.confidence*100).toFixed(0)}%</i> · {recommendation.reason}</span>{recommendation.bill_id&&<span className="acct-code">Source: bill:{recommendation.bill_id}</span>}</div>;}},
    {h:'Match / Categorize',render:r=>queue==='Review' ? <div className="bank-suggestion"><b>{suggested(r)}</b><span><i className={confidence(r)>=80?'confidence-good':'confidence-low'}>{confidence(r)}%</i> confidence</span></div> : (r.matched_je&&jes.some(j=>j.je_number===r.matched_je) ? <Btn size="sm" variant="ghost" onClick={()=>goto('je',{jeNumber:r.matched_je})}>{r.matched_je}</Btn> : <span className="muted sm">{r.matched_je||'—'}</span>)},
    {h:'Action',render:r=>queue==='Review'
      ? <span className="row-acts bank-row-actions"><Btn size="sm" variant="primary" onClick={()=>accept(r)}>{actionLabel(r)}</Btn><Btn size="sm" variant="ghost" disabled title="QBO Post semantics are not verified for this local record">Post</Btn><Btn size="sm" variant="ghost" onClick={()=>{actions.bankExclude(acctCode,r.bank_txn_id);toast('Moved to Excluded','warn')}}>Exclude</Btn></span>
      : <Btn size="sm" variant="ghost" onClick={()=>{actions.bankUndo(acctCode,r.bank_txn_id);toast('Returned to Pending')}}>{queue==='Excluded'?'Restore':'Undo'}</Btn>}
  ];

  return <div className="full-bleed bank-workbench">
    {navContext?.reconciliationReturn && <div className="qbo-report-back"><button type="button" onClick={()=>goto('bankrec',navContext.reconciliationReturn)}>Back to reconciliation history</button><span>Retained sign-off scope · {navContext.reconciliationReturn.historyId == null ? 'current worksheet' : `signed statement ${navContext.reconciliationReturn.historyId}`}</span></div>}
    {navContext?.reportReturn?.route==='gl' && <div className="qbo-report-back"><button type="button" onClick={()=>goto('gl',navContext.reportReturn)}>Back to {navContext.reportReturn.tab || 'report'}</button><span>{localReportReturnScopeLabel(navContext.reportReturn)}</span></div>}
    <div className="accounting-page-head">
      <div><p className="eyebrow">ACCOUNTING / BANKING</p><h2 className="page-h">Bank transactions</h2><p className="page-subtitle">Review retained local activity against existing records; no bank feed or external account connection is used.</p></div>
      <div className="row-acts"><Btn variant="ghost" onClick={()=>goto('register')}>Go to bank register</Btn><Btn variant="ghost" disabled title="External bank feeds are excluded from the local close workflow">Update accounts</Btn><Btn variant="primary" disabled title="External account connections are excluded from the local close workflow">Link account</Btn></div>
    </div>

    <nav aria-label="Observed QuickBooks Accounting navigation" style={{display:'flex',gap:8,flexWrap:'wrap',margin:'0 0 12px'}}>
      {['Bank transactions','Integration transactions','Receipts','Reconcile','Rules','Chart of accounts','Recurring transactions','Revenue recognition','Fixed assets','Prepaid expenses','My accountant','Intuit Experts'].map(label=><span key={label} className="badge muted">{label}</span>)}
    </nav>
    <p className="muted sm" style={{margin:'0 0 12px'}}>Observed QBO Accounting navigation shell. REFS coverage in this workspace is limited to its local Bank transactions flow; other destinations remain unverified.</p>

    <section className="report-workbench" aria-label="Observed QuickBooks Receipts shell" style={{marginBottom:12}}>
      <div className="report-workbench-head"><div><b>Receipts</b><div className="page-subtitle">Observed QBO receipt-capture list and empty state.</div></div><Btn size="sm" variant="ghost" disabled>Upload receipts</Btn></div>
      <p className="muted sm">Observed QBO supports drag/drop, device upload, and PDF/PNG/JPEG/HEIC files. REFS retains only local queue visibility and a bank-match hint; it does not upload, forward, autofill, or convert a document into a bill or expense.</p>
      <div className="report-shelf">{RECEIPT_VIEWS.map(view=><button key={view} type="button" aria-pressed={receiptView===view} className={`report-shelf-chip ${receiptView===view?'report-shelf-chip-on':''}`} onClick={()=>setReceiptView(view)}>{view}</button>)}<span className="report-shelf-spacer" /><Btn size="sm" variant="ghost" disabled>Filter</Btn><Btn size="sm" variant="ghost" disabled>Export</Btn><Btn size="sm" variant="ghost" disabled>Customize</Btn></div>
      <div className="qbo-drill-summary">{['Bulk Checkbox','RECEIPT','CREATED BY','DATE','VENDOR','PAYMENT ACCOUNT','AMOUNT / TAX','CATEGORY','ACTION'].map(label=><span key={label}><i>{label}</i><b>{['DATE','VENDOR','AMOUNT / TAX'].includes(label)?'Sortable column':'Observed column'}</b></span>)}</div>
      {visibleReceiptEvidence.length ? <Table exportName="local-receipt-evidence" features={{exportable:false}} rowKey="receipt_id" cols={[{h:'RECEIPT',k:'description'},{h:'DATE',k:'date'},{h:'VENDOR',k:'vendor'},{h:'AMOUNT',num:true,render:row=><Money v={row.amount}/>},{h:'SOURCE JE',render:row=><Btn size="sm" variant="ghost" onClick={()=>goto('je',{jeNumber:row.journal_number})}>{row.journal_number}</Btn>},{h:'ACTION',render:row=>row.bank_matches.length?<Btn size="sm" variant="ghost" onClick={()=>goto('banktx',{route:'banktx',acctCode:row.bank_matches[0].bank_account_code,bankTxnId:row.bank_matches[0].bank_txn_id})}>Open local bank evidence</Btn>:<span className="muted sm">No matched bank evidence</span>}]} rows={visibleReceiptEvidence}/> : <div className="empty-state"><b>{receiptEmptyState(receiptView)}</b><span>{receiptView==='For review' ? "We'll pull out the info so you can review it and add it to your books." : 'No local receipt evidence has been marked reviewed.'}</span><small>0 - 0 of 0 items · Page 1 of 1</small></div>}
      <div className="qbo-drill-summary" aria-label="Local receipt to bank boundary"><span><i>Local close bridge</i><b>{receiptBankBridgeHint(receiptView, visibleReceiptEvidence.length)}</b></span><span><i>Excluded</i><b>{RECEIPT_LOCAL_CLOSE_BOUNDARY.excluded.join(' · ')}</b></span></div>
      <p className="muted sm">Local view: {receiptView}. Local evidence can drill only to its retained source JE or already matched bank record; selecting a view does not review, upload, filter, or modify a receipt.</p>
    </section>
    <p className="muted sm" style={{margin:'0 0 12px'}}>Receipt queue-view selection is local-only. Upload, email forwarding, autofill, review writing, bill/expense creation, filters, export, customization, row actions, permissions, audit, and responsive behavior remain unverified in REFS.</p>

    <section className="report-workbench" aria-label="Unidentified customer receipt evidence" style={{marginBottom:12}}>
      <div className="report-workbench-head"><div><b>Unmatched customer receipt exceptions</b><div className="page-subtitle">Bank CREDIT → local receipt/prepayment evidence → AR/reconcile review. No allocation or posting occurs here.</div></div><Badge tone={unidentifiedReceiptRows.length?'warn':'ok'}>{unidentifiedReceiptRows.length ? 'REVIEW REQUIRED' : 'NO LOCAL EXCEPTIONS'}</Badge></div>
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
      ]} rows={unidentifiedReceiptRows}/> : <div className="empty-state">No unmatched CREDIT exception is retained for this local bank account/view.</div>}
      <p className="muted sm" style={{margin:'10px 0 0'}}>Exact amount alone never allocates a receipt. Cross-entity, same-amount multi-candidate, escrow/restricted/security-deposit, owner/related-party, or missing property/unit evidence remains held as unapplied for manual review; bank MATCHED, cleared, and signed-off are separate states.</p>
    </section>

    <section className="report-workbench" aria-label="Unidentified disbursement evidence" style={{marginBottom:12}}>
      <div className="report-workbench-head"><div><b>Unmatched disbursement exceptions</b><div className="page-subtitle">Bank DEBIT → AP / expense / CWIP candidate evidence → reconcile review. No category, payment, or posting action occurs here.</div></div><Badge tone={unidentifiedDisbursementRows.length?'warn':'ok'}>{unidentifiedDisbursementRows.length ? 'REVIEW REQUIRED' : 'NO LOCAL EXCEPTIONS'}</Badge></div>
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
      ]} rows={unidentifiedDisbursementRows}/> : <div className="empty-state">No unmatched DEBIT exception is retained for this local bank account/view.</div>}
      <p className="muted sm" style={{margin:'10px 0 0'}}>Exact amount is only a review candidate. Capitalized-vs-expense, prepaid/tax/insurance, related-party, loan/escrow/restricted cash, missing property/project, cross-entity, and same-amount multi-candidate payments remain held unexplained; they do not become matched, cleared, posted, or sign-off eligible.</p>
    </section>
    <section className="report-workbench" aria-label="Local bank transfer evidence" style={{marginBottom:12}}><div className="report-workbench-head"><div><b>Local bank-to-bank transfer evidence</b><div className="page-subtitle">Two-sided retained evidence only. Transfers are excluded from operating/investing/financing cash-flow classification.</div></div><Badge tone={transferEvidence.some(row=>row.state!=='CONFIRMED_LOCAL_TRANSFER_EVIDENCE')?'warn':'ok'}>{transferEvidence.length?'LOCAL REVIEW':'NO LOCAL TRANSFERS'}</Badge></div>{transferEvidence.length?<Table rowKey={row=>row.from.txn.bank_txn_id} features={{exportable:false}} cols={[{h:'From / to',render:row=><span>{row.from.master?.bank_account_code||'Unmapped'} → {row.to?.master?.bank_account_code||'Unpaired'}</span>},{h:'Amount',num:true,render:row=><Money v={row.amount}/>},{h:'Cash scope',render:row=><span>{row.fromScope||'—'} → {row.toScope||'—'}</span>},{h:'Transfer JE',render:row=>row.journal?<Btn size="sm" variant="ghost" onClick={()=>goto('je',{jeNumber:row.journal.je_number})}>{row.journal.je_number}</Btn>:'—'},{h:'State',render:row=><Badge tone={row.state==='CONFIRMED_LOCAL_TRANSFER_EVIDENCE'?'ok':'warn'}>{row.state}</Badge>}]} rows={transferEvidence}/>:<div className="empty-state">No retained matched bank-transfer evidence is available.</div>}<p className="muted sm">Cross-entity, restricted/escrow, loan-draw, unpaired, same-amount ambiguous, or non-posted-transfer evidence remains held. This view cannot initiate a transfer, match bank items, or alter cash flow.</p></section>

    <div className="bank-health" role="status">
      <span className="bank-health-icon">!</span><div><b>Unable to get transactions for connected accounts</b><p>Observed QBO connection states include temporarily unavailable data (Error 355), an unlinked account (Error 353), and a missing account (Error 324). Existing imported transactions remain available for review.</p><p className="muted sm">REFS displays this evidence only; connection repair and disconnection behavior are not implemented.</p></div><div className="bank-health-actions"><button type="button" disabled>Report now</button><button type="button" disabled>Fix now</button><button type="button" disabled>Disconnect</button></div>
    </div>
    {navContext?.route==='banktx' && (navContext.bankTxnId || navContext.jeNumber) && <div className="bank-health" role="status" style={{marginTop:12}}>
      <span className="bank-health-icon">i</span><div><b>{navContext.bankTxnId && requestedFocus && !requestedFocus.found ? 'No local bank evidence found' : 'Drill context applied'}</b><p>{navContext.bankTxnId ? (requestedFocus?.found ? `Focused retained local bank transaction ${navContext.bankTxnId} in ${requestedFocus.queue}, page ${requestedFocus.page}.` : `No retained local bank transaction matches ${navContext.bankTxnId}.`) : `Located the matched bank transaction for journal entry ${navContext.jeNumber}.`}</p></div></div>}
    {matchTxn && <section className="expense-shell-panel" role="dialog" aria-modal="false" aria-label="Match an existing journal entry" style={{marginTop:12}}>
      <div><b>Match existing record</b><span>{matchTxn.external_id} · {money(matchTxn.amount)} · {matchTxn.direction}. Only posted JEs with the same cash impact are eligible.</span></div>
      {matchCandidates.length ? <Table rowKey="je_id" cols={[
        {h:'Date',k:'je_date'},{h:'Journal No.',k:'je_number'},{h:'Source',k:'source_system'},{h:'Description',k:'description'},
        {h:'Cash impact',num:true,render:r=><Money v={cashImpact(r)}/>,sortVal:r=>cashImpact(r)},
        {h:'Action',render:r=><Btn size="sm" variant="primary" onClick={()=>completeMatch(r)}>Match</Btn>},
      ]} rows={matchCandidates}/> : <div className="empty-state"><b>No exact posted JE found</b><span>Choose Categorize or create/approve the source transaction before matching this bank item.</span></div>}
      <div className="expense-shell-actions"><button type="button" onClick={()=>setMatchTxn(null)}>Cancel</button></div>
    </section>}
    {selectedPostedTxn && <section className="expense-shell-panel" aria-label="Local posted bank trace" style={{marginTop:12}}>
      <div><b>Local posted-bank trace</b><span>{selectedPostedTxn.external_id} · {selectedPostedTrace?.isPosted ? `Posted JE ${selectedPostedTrace.journalNumber}` : 'No retained posted local JE is available for this bank item.'}</span></div>
        <div className="expense-shell-actions"><Btn size="sm" variant="ghost" disabled={!selectedPostedTrace?.isPosted} onClick={()=>goto('je',{jeNumber:selectedPostedTrace.journalNumber})}>Open Journal Entry</Btn><Btn size="sm" variant="ghost" disabled={!selectedPostedTrace?.canDrillGL} onClick={()=>goto('gl',{route:'gl',tab:'GL Detail',drillLabel:selectedPostedTrace.journalNumber})}>Open GL Detail</Btn><Btn size="sm" variant="ghost" disabled={!selectedPostedTrace?.canDrillTB} onClick={()=>goto('gl',{route:'gl',tab:'Trial Balance',drillLabel:selectedPostedTrace.journalNumber})}>Open Trial Balance</Btn><Btn size="sm" variant="ghost" disabled={!selectedPostedTxn} onClick={()=>goto('bankrec',{route:'bankrec',acctCode,bankTxnId:selectedPostedTxn.bank_txn_id})}>Open local reconcile</Btn></div>
      <p className="muted sm">Read-only local drill context only. QBO Post is visible above but remains unavailable because its semantics were not exercised.</p>
    </section>}

    <div className="acct-cards bank-account-strip">
      {Object.entries(bank.accounts).map(([code,ac])=>{
        const cardDifference = ac.stmt_end - ac.gl_book_balance;
        return <button key={code} className={`acct-card bank-account-card ${acctCode===code?'acct-on':''}`} onClick={()=>{setAcct(code);setChecked({})}}>
          <div className="acct-head"><span><b>{ac.bank_name}</b><small>{code} - retained through {ac.stmt_date}</small></span><Badge tone={Math.abs(cardDifference)>.005?'warn':'ok'}>{Math.abs(cardDifference)>.005?'Needs attention':'Local evidence'}</Badge></div>
          <div className="acct-bal"><span><i>Bank balance</i><Money v={ac.stmt_end}/></span><span><i>In REFS</i><Money v={ac.gl_book_balance}/></span></div>
          <div className="acct-review"><b>{ac.txns.filter(t=>stateOf(t)==='Review').length}</b> pending review</div>
        </button>;
      })}
    </div>

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
      <div className="bank-queue-tabs" role="tablist">
        {['Review','Posted','Excluded'].map(k=><button role="tab" aria-selected={queue===k} className={queue===k?'active':''} key={k} onClick={()=>{setQueue(k);setChecked({})}}>{queueLabel[k]} <span>{counts(k)}</span></button>)}
      </div>
      <div className="bank-toolbar">
        <label className="bank-search"><span className="bank-search-glyph" aria-hidden="true" /><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search bank description or ID"/></label>
        <select aria-label="Date" value={dateRange} onChange={e=>setDateRange(e.target.value)}><option>All dates</option><option>This month</option><option>Last 90 days</option></select>
        <select aria-label="Transaction type" value={type} onChange={e=>setType(e.target.value)}><option>All transactions</option><option>Money in</option><option>Money out</option></select>
        <span className="bank-result-count">{pagedQueueRows.total ? `${pagedQueueRows.start}-${pagedQueueRows.end} of ${pagedQueueRows.total}` : '0-0 of 0'} local transactions in {queueLabel[queue]}</span>
        {queue==='Review'&&<Btn size="sm" variant="primary" onClick={batchAccept}>Accept selected ({selected.length})</Btn>}
        <span className="bank-toolbar-actions"><button type="button" disabled>Print</button><button type="button" disabled>Export CSV</button><button type="button" disabled>Columns</button></span>
      </div>
      <div className="bank-table"><Table rowKey="bank_txn_id" className="table-journal-entries" features={{filterable:false}} cols={cols} rows={pagedQueueRows.rows} empty={bankScopeEmpty.title || `No ${queueLabel[queue].toLowerCase()} transactions`}/></div>
      {!pagedQueueRows.rows.length && <div className="empty-state" aria-label="Local bank scope empty state"><b>{bankScopeEmpty.title}</b><span>{bankScopeEmpty.detail}</span><small>Scope: {acctCode} · {account.period} · {BANK_ACCOUNTS.find(row=>row.bank_account_code===acctCode)?.cash_scope || 'Unmapped cash scope'} · {entity || 'No active entity'}</small><div className="row-acts" style={{marginTop:10}}><Btn size="sm" variant="ghost" onClick={()=>goto('register')}>Open local bank register</Btn><Btn size="sm" variant="ghost" disabled={bankScopeEmpty.state==='NO_LOCAL_BANK_EVIDENCE'} onClick={()=>goto('gl',{route:'gl',tab:'GL Detail',fromP:account.period,toP:account.period,drillLabel:`${acctCode} local cash evidence`})}>Open local GL Detail</Btn></div></div>}
      <nav className="bank-pagination" aria-label="Local bank transaction pages"><button type="button" disabled={pagedQueueRows.currentPage===1} onClick={()=>setPage(p=>p-1)}>Previous</button><span>Page {pagedQueueRows.currentPage} of {pagedQueueRows.pageCount}</span><button type="button" disabled={pagedQueueRows.currentPage===pagedQueueRows.pageCount} onClick={()=>setPage(p=>p+1)}>Next</button></nav>
      <div className="bank-footer"><span>Imported bank activity stays unchanged until you categorize, match, exclude, or restore it.</span><span>Drill path: report {'→'} detail ledger {'→'} source-ready bank evidence</span></div>
    </section>
  </div>;
}
