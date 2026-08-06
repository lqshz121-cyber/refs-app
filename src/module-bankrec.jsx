import { useEffect, useMemo, useState } from 'react';
import { KPI, Btn, Badge, Money, Table, SectionTitle } from './ui.jsx';
import { money, sum } from './engine.js';
import { BANK_ACCOUNTS } from './data.js';
import { reconciliationBankEvidence, reconciliationHistoryState, reconciliationStatus } from './bank-reconciliation.js';
import { localReconciliationEvidence, localReconciliationPhase, localReconciliationReadiness, localReconciliationWorksheet } from './reconciliation-local-evidence.js';
import { localReconciliationReopenState } from './reconciliation-reopen-evidence.js';
import { localReconciliationHistoryDetail } from './reconciliation-history-detail.js';
import { localReconciliationHistoryRoute } from './reconciliation-history-route.js';
import { localReportReturnScopeLabel } from './report-return-context.js';
import { localPaymentReturnScopeLabel } from './payment-return-context.js';
import { localReconciliationJournalReturnContext } from './reconciliation-journal-return.js';
import { localReconciliationReportReturnContext } from './reconciliation-report-return.js';
import { localAccountRegisterReturnScopeLabel } from './account-register-return.js';
import { localReconciliationPaymentReturnTarget, localReconciliationReceiptReturnTarget } from './reconciliation-receipt-return.js';
import { localReconciliationHistoryRegisterContext } from './reconciliation-register-return.js';
import { buildWbsBankReconciliationEvidence } from './wbs-bank-reconciliation-evidence.js';
import { bankReconciliationSummary } from './bank-reconciliation-summary.js';
import { BANK_QUEUE_DIMENSION_NOTE } from './bank-queue-summary.js';

// Standard reconciliation model:
// Statement Ending Balance + Deposits in Transit - Outstanding Checks = Adjusted Bank Balance
// GL Book Balance +/- unrecorded items (bank fees, interest) = Adjusted Book Balance
// Sign-off allowed only when Adjusted Bank == Adjusted Book
export function BankRec2({ctx}) {
  const {bank, jes, actions, toast, can, goto, navContext, entity} = ctx;   // bank: {accounts:{code:{stmt_begin,stmt_end,txns:[...]}}, history:[]}
  if(ctx.authoritativeMode)return <section className="card" role="status"><h2 className="page-h">Reconciliation</h2><p>RECONCILIATION_API_UNAVAILABLE</p></section>;
  const [acctCode, setAcctCode] = useState('BA-003');
  const [reopenReason, setReopenReason] = useState('');
  const [historyDetailId, setHistoryDetailId] = useState(null);
  useEffect(() => {
    if (navContext?.route === 'bankrec' && navContext.acctCode && bank.accounts[navContext.acctCode]) setAcctCode(navContext.acctCode);
  }, [navContext?.route, navContext?.acctCode, bank.accounts]);
  useEffect(() => {
    if (navContext?.route !== 'bankrec') return;
    const requested = localReconciliationHistoryRoute(bank.history, navContext.historyId);
    setHistoryDetailId(requested?.id ?? null);
  }, [navContext?.route, navContext?.historyId, bank.history]);
  const a = bank.accounts[acctCode];
  const txns = a.txns;
  const matched = txns.filter(t=>t.match_status==='MATCHED');
  const unmatched = txns.filter(t=>t.match_status==='UNMATCHED');
  // book side
  const bookBalance = a.gl_book_balance;
  const outstanding = a.outstanding_checks;
  const inTransit = a.deposits_in_transit;
  const unrecorded = unmatched.filter(t=>t.suggest==='FEE'||t.suggest==='INTEREST');
  const unrecordedAdj = sum(unrecorded, t=>t.direction==='CREDIT'?t.amount:-t.amount);
  const clearedTransactions = txns.filter(transaction => transaction.cleared === true);
  const unclearedTransactions = txns.filter(transaction => transaction.cleared !== true);
  const directionalAmount = transaction => transaction.direction === 'CREDIT' ? Number(transaction.amount || 0) : -Number(transaction.amount || 0);
  const clearedMovement = sum(clearedTransactions, directionalAmount);
  const unclearedMovement = sum(unclearedTransactions, directionalAmount);
  const adjBank = a.stmt_end + sum(inTransit,d=>d.amount) - sum(outstanding,c=>c.amount);
  const adjBook = bookBalance + (a.recorded_adj||0);
  const diff = +(adjBank - adjBook).toFixed(2);
  const reconStatus = reconciliationStatus({...a, account_code:acctCode}, bank.history);
  // Presentation only: book, bank and difference are the values already computed above.
  const localEvidence = localReconciliationEvidence({accountCode:acctCode, bankAccount:a, journals:jes, bankAccountMaster:BANK_ACCOUNTS});
  const localReadiness = localReconciliationReadiness(reconStatus, localEvidence);
  const worksheet = localReconciliationWorksheet({accountCode:acctCode, bankAccount:a, baseStatus:reconStatus, evidence:localEvidence, readiness:localReadiness, phase:localReconciliationPhase(reconStatus, localReadiness, localEvidence)});
  const reconSummary = bankReconciliationSummary({bookBalance:adjBook, bankBalance:adjBank, difference:diff, transactions:txns, unverifiedMatchCount:localEvidence.invalidMatches?.length || 0});
  const wbsBankEvidence = useMemo(()=>buildWbsBankReconciliationEvidence(),[]);
  const canSign = localReadiness.canSign;
  const localPhase = worksheet.phase;
  const signedHistory = reconStatus.signedHistory;
  const historyState = reconciliationHistoryState(bank.history, acctCode);
  const reopen = localReconciliationReopenState(bank.history,{account:acctCode,period:a.period,statementDate:a.stmt_date});
  const sourceBankEvidence = navContext?.route === 'bankrec' && navContext.bankTxnId ? reconciliationBankEvidence(a, navContext.bankTxnId) : null;
  const receiptReturnTarget = localReconciliationReceiptReturnTarget(navContext);
  const paymentReturnTarget = localReconciliationPaymentReturnTarget(navContext);
  const historyEntry = bank.history.find(entry => String(entry.id) === String(historyDetailId)) || null;
  const historyDetail = historyEntry ? localReconciliationHistoryDetail(historyEntry, bank.accounts[historyEntry.account]) : null;
  const historyCashMaster = historyDetail ? BANK_ACCOUNTS.find(item => item.bank_account_code === historyDetail.entry.account) : null;
  const historyRegisterContext = historyDetail?.lifecycle === 'SIGNED_OFF' && historyCashMaster?.entity_id === entity ? localReconciliationHistoryRegisterContext({entityId:entity,acctCode:historyDetail.entry.account,cashAccountCode:historyCashMaster.gl_account_code,period:historyDetail.entry.period,statementDate:historyDetail.entry.stmt_date,historyId:historyDetail.entry.id,sourceTxnIds:historyDetail.sourceTxnIds}) : null;
  const historyReportScope = historyDetail ? localReconciliationReportReturnContext({
    acctCode:historyDetail.entry.account, period:historyDetail.entry.period, statementDate:historyDetail.entry.stmt_date,
    cashScope:BANK_ACCOUNTS.find(item=>item.bank_account_code===historyDetail.entry.account)?.cash_scope,
    cashAccountCode:BANK_ACCOUNTS.find(item=>item.bank_account_code===historyDetail.entry.account)?.gl_account_code, historyId:historyDetail.entry.id,
  }) : null;
  const reportScopeCompatible = Boolean(entity && localEvidence.entityId && entity === localEvidence.entityId);
  const openScopedReport = (route, tab, extra = {}) => goto(route, {route, tab, ...localReconciliationReportReturnContext({acctCode,period:a.period,statementDate:a.stmt_date,cashScope:localEvidence.master?.cash_scope,cashAccountCode:localEvidence.cashAccountCode,bankTxnId:sourceBankEvidence?.transaction?.bank_txn_id || null}), ...extra});

  const match = (t) => { goto('banktx',{route:'banktx',acctCode,bankTxnId:t.bank_txn_id,queue:'Review'}); toast('Select an exact posted source JE before matching this bank item.'); };
  const requestReopen = () => { const result=actions.bankRequestReopen(acctCode,reopenReason); toast(result.ok?'Local reopen request retained; no JE was changed.':`Reopen request blocked: ${result.reason}` ,result.ok?'warn':'bad'); if(result.ok) setReopenReason(''); };
  const reviewReopen = approved => { const result=actions.bankReviewReopen(acctCode,approved); toast(result.ok?(approved?'Local reopen approved; re-reconcile before sign-off.':'Local reopen rejected; signed snapshot retained.'):`Reopen review blocked: ${result.reason}`,result.ok?'warn':'bad'); };

  if (historyDetail) return <div className="full-bleed qbo-transaction-report" aria-label="Local reconciliation sign-off detail">
    <div className="qbo-report-back"><button type="button" onClick={()=>navContext?.bankTransactionReturn?.route === 'banktx' ? goto('banktx',navContext.bankTransactionReturn) : setHistoryDetailId(null)}>{navContext?.bankTransactionReturn?.route === 'banktx' ? 'Back to bank transaction' : 'Back to reconciliation history'}</button><span>{navContext?.bankTransactionReturn?.route === 'banktx' ? 'Retained bank item → signed statement snapshot' : 'Retained sign-off detail'}</span></div>
    <div className="gl-drill-head"><div><div className="gl-drill-crumb">Local reconciliation · immutable snapshot</div><h2 className="page-h">{historyDetail.entry.account} · {historyDetail.entry.period}</h2><div className="gl-drill-account">Statement cutoff {historyDetail.entry.stmt_date}</div></div><Badge tone={historyDetail.lifecycle==='SIGNED_OFF'?'ok':'warn'}>{historyDetail.lifecycle}</Badge></div>
    <div className="qbo-drill-summary"><span><i>Signed by / at</i><b>{historyDetail.entry.by || '—'} / {historyDetail.entry.at || '—'}</b></span><span><i>Snapshot difference</i><b>{money(historyDetail.snapshot.diff)}</b></span><span><i>Statement ending</i><b>{money(historyDetail.snapshot.statementEnding)}</b></span><span><i>Book balance</i><b>{money(historyDetail.snapshot.bookBalance)}</b></span><span><i>Retained bank items</i><b>{historyDetail.sourceTxnIds.length}</b></span><span><i>Snapshot policy</i><b>IMMUTABLE</b></span></div>
    <p className="report-drill-hint">A reopened/rejected request changes only reconciliation workflow metadata. It does not rewrite the signed snapshot, bank item, JE, GL/TB, or aging evidence.</p>
    <Table rowKey="bank_txn_id" features={{exportable:false}} cols={[{h:'Bank item',render:row=>row.external_id || row.bank_txn_id},{h:'Date',k:'txn_date'},{h:'Direction',k:'direction'},{h:'Amount',num:true,render:row=><Money v={row.amount}/>},{h:'Match',render:row=><Badge tone={row.match_status==='MATCHED'?'ok':'warn'}>{row.match_status}</Badge>},{h:'Cleared',render:row=><Badge tone={row.cleared?'ok':'muted'}>{row.cleared?'CLEARED':'NOT_CLEARED'}</Badge>},{h:'JE',render:row=>row.matched_je?<Btn size="sm" variant="ghost" onClick={()=>goto('je',{jeNumber:row.matched_je,reconciliationReturn:localReconciliationJournalReturnContext({acctCode:historyDetail.entry.account,historyId:historyDetail.entry.id,bankTxnId:row.bank_txn_id})})}>{row.matched_je}</Btn>:<span className="muted">No retained JE</span>},{h:'Bank drill',render:row=><Btn size="sm" variant="ghost" onClick={()=>goto('banktx',{route:'banktx',acctCode:historyDetail.entry.account,bankTxnId:row.bank_txn_id,reconciliationReturn:{route:'bankrec',acctCode:historyDetail.entry.account,historyId:historyDetail.entry.id}})}>Open bank evidence</Btn>}]} rows={historyDetail.sourceTransactions} empty="No current local bank item matches this retained signed snapshot."/>
    <div className="row-acts" style={{marginTop:12}}><Btn size="sm" variant="ghost" disabled={!historyRegisterContext} title={historyRegisterContext ? 'Open the same entity cash register with signed-snapshot evidence' : 'A signed snapshot and matching active entity/cash mapping are required'} onClick={()=>goto('register',historyRegisterContext)}>Open Account Register</Btn><Btn size="sm" variant="ghost" onClick={()=>goto('gl',{route:'gl',tab:'GL Detail',...historyReportScope})}>Open GL Detail</Btn><Btn size="sm" variant="ghost" onClick={()=>goto('gl',{route:'gl',tab:'Trial Balance',...historyReportScope})}>Open Trial Balance</Btn><Btn size="sm" variant="ghost" onClick={()=>goto('ar',{route:'ar',tab:'AR Aging',...historyReportScope})}>Open AR Aging</Btn><Btn size="sm" variant="ghost" onClick={()=>goto('ap',{route:'ap',tab:'AP Aging',...historyReportScope})}>Open AP Aging</Btn></div>
  </div>;

  return <div className="full-bleed">
    {navContext?.registerReturn?.route === 'register' && <div className="qbo-report-back"><button type="button" onClick={() => goto('register', navContext.registerReturn)}>Back to account register</button><span>{localAccountRegisterReturnScopeLabel(navContext.registerReturn)}</span></div>}
    {receiptReturnTarget ? <div className="qbo-report-back"><button type="button" onClick={() => goto(receiptReturnTarget.route, receiptReturnTarget.context)}>{receiptReturnTarget.label}</button><span>Customer Payment → retained bank CREDIT → reconciliation evidence</span></div> : paymentReturnTarget ? <div className="qbo-report-back"><button type="button" onClick={() => goto(paymentReturnTarget.route, paymentReturnTarget.context)}>{paymentReturnTarget.label}</button><span>Vendor Payment → retained bank DEBIT → reconciliation evidence</span></div> : navContext?.bankTransactionReturn?.route === 'banktx' && <div className="qbo-report-back"><button type="button" onClick={() => goto('banktx', navContext.bankTransactionReturn)}>Back to bank transaction</button><span>{localPaymentReturnScopeLabel(navContext.bankTransactionReturn)}</span></div>}
    {navContext?.reportReturn?.route === 'gl' && <div className="qbo-report-back"><button type="button" onClick={()=>goto('gl',navContext.reportReturn)}>Back to {navContext.reportReturn.tab || 'report'}</button><span>{localReportReturnScopeLabel(navContext.reportReturn)}</span></div>}
    <h2 className="page-h">Bank Reconciliation</h2>
    <section className="qbo-report-promo" aria-label="Observed QuickBooks Reconcile introduction" style={{marginBottom:12}}>
      <span>QUICKBOOKS RECONCILE</span><b>Match the books to the bank records</b>
      <p>Connected accounts are easier to reconcile.</p>
      <div className="qbo-toolgrid"><span><b>Keep yourself on track</b></span><span><b>Find holes in your accounting</b></span><span><b>Get things tidy for tax time</b></span></div>
      <div className="row-acts">{['Connect now','Video tutorials (7:48)','Get started'].map(label=><span key={label} className="bank-action-chip" aria-disabled="true"><span className="bank-action-name">{label}</span><span className="bank-action-state">Observed in QuickBooks only</span></span>)}</div>
    </section>
    <p className="muted sm" style={{margin:'0 0 12px'}}>QBO account connection, tutorial playback, reconciliation setup, permissions, audit, empty states, and responsive behavior remain unverified. These observed actions are evidence-only in REFS. POSTED is not treated as reconciled.</p>
    {sourceBankEvidence && <div className="bank-health" role="status" style={{marginBottom:12}}><span className="bank-health-icon">i</span><div><b>{sourceBankEvidence.eligible ? 'Local matched bank evidence applied' : 'No eligible local bank evidence'}</b><p>{sourceBankEvidence.eligible ? `Opened from ${sourceBankEvidence.transaction.external_id}; this does not alter the reconciliation worksheet or sign-off eligibility.` : `The requested bank item cannot enter local reconciliation context (${sourceBankEvidence.reason}).`}</p></div></div>}
    <div className="loan-select">{Object.keys(bank.accounts).map(c=><button key={c} className={`chip ${acctCode===c?'chip-on':''}`} onClick={()=>setAcctCode(c)}>{c} · {bank.accounts[c].bank_name}</button>)}
      <span className="muted sm" style={{marginLeft:'auto'}}>Reconciliation period {a.period} · cutoff {a.stmt_date}</span></div>
    <div className="row-acts" style={{marginBottom:10}}>
      <Badge tone={localEvidence.master?.cash_scope==='Operating'?'ok':'warn'}>{localEvidence.master?.cash_scope || 'UNMAPPED CASH SCOPE'}</Badge>
      <Badge tone={localPhase==='SIGNED_OFF'||localPhase==='BALANCED'?'ok':'warn'}>{localPhase}</Badge>
      <span className="muted sm">Local GL {localEvidence.cashAccountCode || 'unmapped'} · entity {localEvidence.entityId || 'unmapped'} · through {localEvidence.throughDate || 'unavailable'}</span>
    </div>
    <section className="report-workbench recon-summary" aria-label="Reconciliation book bank difference summary" style={{marginBottom:14}}>
      <div className="report-workbench-head"><div><b>Book / Bank / Difference</b><div className="page-subtitle">Adjusted book balance, adjusted bank balance, and their difference for this statement, with the uncleared items that keep sign-off blocked.</div></div><Badge tone={reconSummary.balanced?'ok':'warn'}>{reconSummary.balanced?'DIFFERENCE_ZERO':'DIFFERENCE_NOT_ZERO'}</Badge></div>
      <div className="recon-summary-grid">
        <span className="recon-summary-cell"><i>Book</i><b>{money(reconSummary.book)}</b></span>
        <span className="recon-summary-cell"><i>Bank</i><b>{money(reconSummary.bank)}</b></span>
        <span className={`recon-summary-cell ${reconSummary.balanced?'':'recon-summary-off'}`}><i>Difference</i><b>{money(reconSummary.difference)}</b></span>
        <span className="recon-summary-cell"><i>Uncleared items</i><b>{reconSummary.unclearedCount}</b></span>
        <span className="recon-summary-cell"><i>Cleared items</i><b>{reconSummary.clearedCount}</b></span>
        <span className="recon-summary-cell"><i>Matched without verified proof</i><b>{reconSummary.unverifiedMatchCount}</b></span>
      </div>
      <p className="muted sm" style={{margin:'10px 0 0'}}>Sign-off precondition: {reconSummary.signOffPrecondition}. {reconSummary.signOffBlockers.length ? `Blocked by: ${reconSummary.signOffBlockers.join('; ')}.` : 'Difference is zero and no unresolved item remains; the strict local sign-off gate below still applies.'} This panel restates the existing gate for the reader and never relaxes it.</p>
      <p className="muted sm" style={{margin:'6px 0 0'}}>{BANK_QUEUE_DIMENSION_NOTE}</p>
      <Table rowKey="bank_txn_id" features={{exportable:false}} pageSize={8} cols={[
        {h:'Bank item',render:row=>row.external_id},
        {h:'Date',k:'txn_date'},
        {h:'Description',k:'reference'},
        {h:'Direction',k:'direction'},
        {h:'Amount',num:true,render:row=><Money v={row.amount}/>,sortVal:row=>row.amount},
        {h:'Match',render:row=><Badge tone={row.match_status==='MATCHED'?'ok':'warn'}>{row.match_status}</Badge>},
        {h:'Linked JE',render:row=>row.matched_je || 'No retained JE'},
        {h:'Reconcile',render:row=><Badge tone="muted">{row.reconcile_state}</Badge>},
      ]} rows={reconSummary.uncleared} empty="No uncleared bank item is retained for this statement."/>
    </section>
    <section className="report-workbench" aria-label="Local reconciliation worksheet scope" style={{marginBottom:14}}>
      <div className="report-workbench-head"><div><b>Local reconciliation worksheet</b><div className="page-subtitle">One retained entity, bank account, cash scope, and statement cutoff. Clearing status does not alter GL/TB/BS.</div></div><Badge tone={worksheet.closeState==='READY_TO_SIGN_OFF'||worksheet.closeState==='SIGNED_OFF'?'ok':'warn'}>{worksheet.closeState}</Badge></div>
      <div className="qbo-toolgrid">
        <span><i>Entity</i><b>{worksheet.scope.entityId || 'Missing local entity'}</b></span>
        <span><i>Cash scope</i><b>{worksheet.scope.cashScope || 'Unmapped'}</b></span>
        <span><i>Statement period / cutoff</i><b>{worksheet.scope.period || '—'} · {worksheet.scope.statementDate || '—'}</b></span>
        <span><i>Statement beginning / ending</i><b>{money(worksheet.scope.statementBeginning)} / {money(worksheet.scope.statementEnding)}</b></span>
        <span><i>Locally matched / unverified proof</i><b>{worksheet.clearing.matchedCount} / {worksheet.clearing.invalidMatchCount}</b></span>
        <span><i>Unhandled / bank timing items</i><b>{worksheet.clearing.unmatchedCount} / {worksheet.clearing.depositInTransitCount + worksheet.clearing.outstandingCheckCount}</b></span>
        <span><i>Adjusted bank / book / difference</i><b>{money(worksheet.balances.adjustedBank)} / {money(worksheet.balances.adjustedBook)} / {money(worksheet.balances.difference)}</b></span>
      </div>
      <p className="muted sm" style={{margin:'10px 0 0'}}>Phase: {worksheet.phase}. A bank MATCHED item is not treated as cleared or signed off. Close is blocked by: {worksheet.closeReason || 'none'}. Existing adjustments are evidence-only; this worksheet has no quick-adjustment entry creation or auto-match behavior.</p>
      <div className="row-acts" style={{marginTop:10}}>
        <Btn size="sm" variant="ghost" disabled={!reportScopeCompatible} title={reportScopeCompatible?'Open the same active entity and statement period':'Select the matching local entity before drilling to a report'} onClick={()=>openScopedReport('gl','GL Detail')}>Open GL Detail</Btn>
        <Btn size="sm" variant="ghost" disabled={!reportScopeCompatible} title={reportScopeCompatible?'Open the same active entity and statement period':'Select the matching local entity before drilling to a report'} onClick={()=>openScopedReport('gl','Trial Balance')}>Open Trial Balance</Btn>
        <Btn size="sm" variant="ghost" disabled={!reportScopeCompatible} title={reportScopeCompatible?'Open the same active entity and statement cutoff':'Select the matching local entity before drilling to aging'} onClick={()=>openScopedReport('ar','AR Aging')}>Open AR Aging</Btn>
        <Btn size="sm" variant="ghost" disabled={!reportScopeCompatible} title={reportScopeCompatible?'Open the same active entity and statement cutoff':'Select the matching local entity before drilling to aging'} onClick={()=>openScopedReport('ap','AP Aging')}>Open AP Aging</Btn>
      </div>
    </section>
    <section className="report-workbench" aria-label="WBS mock bank rule evidence" style={{marginBottom:14}}>
      <div className="report-workbench-head"><div><b>WBS mock bank rule evidence</b><div className="page-subtitle">Read-only WBS mock bank transactions are classified before reconciliation. This layer never auto-matches, clears, posts, or signs off.</div></div><Badge tone={wbsBankEvidence.summary.reviewRequired?'warn':'ok'}>{wbsBankEvidence.mode}</Badge></div>
      <div className="qbo-toolgrid"><span><i>Total WBS bank rows</i><b>{wbsBankEvidence.summary.total}</b></span><span><i>Matched candidates</i><b>{wbsBankEvidence.summary.matched}</b></span><span><i>Missing AP exceptions</i><b>{wbsBankEvidence.summary.missingAp}</b></span><span><i>Loan draws detected</i><b>{wbsBankEvidence.summary.loanDraws}</b></span><span><i>Review required</i><b>{wbsBankEvidence.summary.reviewRequired}</b></span><span><i>Signed amount total</i><b>{money(wbsBankEvidence.summary.totalAmount)}</b></span></div>
      <Table rowKey="bank_txn_id" features={{exportable:false}} pageSize={8} cols={[
        {h:'WBS bank item',render:row=>row.bank_txn_id},
        {h:'Direction',k:'direction'},
        {h:'Amount',num:true,render:row=><Money v={row.amount}/>,sortVal:row=>row.amount},
        {h:'Rule',render:row=><span className="acct-code">{row.rule_id}</span>,csv:row=>row.rule_id},
        {h:'Queue',render:row=><Badge tone={row.suggested_queue==='EXACT_MATCH_REVIEW'?'ok':row.suggested_queue==='LOAN_DRAW_REVIEW'?'warn':'bad'}>{row.suggested_queue}</Badge>,csv:row=>row.suggested_queue},
        {h:'Control state',render:row=><Badge tone={row.control_state==='MATCH_CANDIDATE_RETAINED'?'ok':row.control_state==='LOAN_DRAW_DETECTED'?'warn':'bad'}>{row.control_state}</Badge>,csv:row=>row.control_state},
        {h:'Reason',k:'reason'},
      ]} rows={wbsBankEvidence.bankRows} empty="No WBS mock bank rows are available."/>
      <p className="muted sm" style={{margin:'10px 0 0'}}>Business boundary: WBS mock evidence can route exact matches, missing-AP exceptions and loan-draw review, but it cannot update the local worksheet or create accounting until a human-controlled Draft JE workflow is used.</p>
    </section>
    <section className="report-workbench" aria-label="Reconciliation statement bridge" style={{marginBottom:14}}>
      <div className="report-workbench-head"><div><b>Statement-level reconciliation bridge</b><div className="page-subtitle">Book balance + retained adjustments = adjusted book; statement ending + retained timing evidence = adjusted bank.</div></div><Badge tone={Math.abs(diff) < 0.005 && localEvidence.bookBalanceAligned ? 'ok' : 'warn'}>{Math.abs(diff) < 0.005 && localEvidence.bookBalanceAligned ? 'STATEMENT_TIED' : 'STATEMENT_REVIEW'}</Badge></div>
      <div className="qbo-toolgrid"><span><i>Entity / bank account</i><b>{localEvidence.entityId || 'Missing entity'} / {acctCode}</b></span><span><i>Cash scope</i><b>{localEvidence.master?.cash_scope || 'Unmapped'}</b></span><span><i>Statement dates</i><b>{a.period} / {a.stmt_date}</b></span><span><i>Book / retained adjustments</i><b>{money(bookBalance)} / {money(a.recorded_adj || 0)}</b></span><span><i>Cleared / uncleared movement</i><b>{money(clearedMovement)} / {money(unclearedMovement)}</b></span><span><i>Adjusted book / bank / difference</i><b>{money(adjBook)} / {money(adjBank)} / {money(diff)}</b></span></div>
      <Table rowKey="bank_txn_id" features={{exportable:false}} pageSize={8} cols={[{h:'Bank item',render:row=>row.external_id || row.bank_txn_id},{h:'Date',k:'txn_date'},{h:'Amount',num:true,render:row=><Money v={row.amount}/>},{h:'Match / cleared / reconcile',render:row=><span>{row.match_status} / {row.cleared?'CLEARED':'UNCLEARED'} / {row.reconcile_state || 'NOT_SIGNED_OFF'}</span>},{h:'Evidence drill',render:row=><Btn size="sm" variant="ghost" onClick={()=>goto('banktx',{route:'banktx',acctCode,bankTxnId:row.bank_txn_id,reconciliationReturn:{route:'bankrec',acctCode,statementDate:a.stmt_date,bankTxnId:row.bank_txn_id}})}>Open bank detail</Btn>}]} rows={txns} empty="No retained local bank evidence for this statement."/>
      <p className="muted sm" style={{margin:'10px 0 0'}}>A match never means cleared or signed off. Missing/cross-entity dimensions, property/project/loan or related-party Review, non-zero difference, and reopened statements remain explicit review boundaries.</p>
    </section>
    <div className="recon-model">
      <div className="recon-col">
        <div className="recon-title">Bank side</div>
        <div className="kv"><span>Statement Beginning Balance</span><Money v={a.stmt_begin}/></div>
        <div className="kv"><span>Statement Ending Balance</span><Money v={a.stmt_end} bold/></div>
        <div className="kv"><span>+ Deposits in Transit ({inTransit.length})</span><Money v={sum(inTransit,d=>d.amount)}/></div>
        <div className="kv"><span>− Outstanding Checks ({outstanding.length})</span><Money v={-sum(outstanding,c=>c.amount)}/></div>
        <div className="kv tot"><span>Adjusted Bank Balance</span><Money v={adjBank} bold/></div>
      </div>
      <div className="recon-col">
        <div className="recon-title">Book side</div>
        <div className="kv"><span>GL Book Balance (111000)</span><Money v={bookBalance} bold/></div>
        <div className="kv"><span>± Retained adjustments (fees / interest)</span><Money v={a.recorded_adj||0}/></div>
        <div className="kv"><span>Unrecorded adjustments (review below)</span><Money v={unrecordedAdj}/></div>
        <div className="kv tot"><span>Adjusted Book Balance</span><Money v={adjBook} bold/></div>
      </div>
      <div className={`recon-diff ${canSign?'ok':'bad'}`}>
        <div>Difference</div>
        <div className="recon-diff-n">{money(diff)}</div>
        <div className="sm">{canSign?'✓ Ready to sign off':`${unmatched.length} items awaiting review`}</div>
      </div>
    </div>
    <SectionTitle>Bank transactions ({txns.length} retained · {unmatched.length} unmatched)</SectionTitle>
    <SectionTitle>Local ledger proof</SectionTitle>
    <div className="recon-model" style={{marginBottom:14}}>
      <div className="recon-col"><div className="recon-title">Local cash evidence</div>
        <div className="kv"><span>Posted local cash balance</span>{localEvidence.localBookBalance == null ? <span>Unavailable</span> : <Money v={localEvidence.localBookBalance} bold/>}</div>
        <div className="kv"><span>Stored worksheet book balance</span><Money v={localEvidence.storedBookBalance}/></div>
        <div className="kv tot"><span>Ledger alignment</span><Badge tone={localEvidence.bookBalanceAligned?'ok':'bad'}>{localEvidence.bookBalanceAligned?'ALIGNED':'MISMATCH'}</Badge></div>
      </div>
      <div className="recon-col"><div className="recon-title">Matched-item proof</div>
        <div className="kv"><span>Matched bank items</span><b>{localEvidence.matched.length}</b></div>
        <div className="kv"><span>Unverified matched items</span><Badge tone={localEvidence.invalidMatches.length?'bad':'ok'}>{localEvidence.invalidMatches.length}</Badge></div>
        <div className="kv tot"><span>Strict local gate</span><Badge tone={canSign?'ok':'bad'}>{canSign?'READY':'BLOCKED'}</Badge></div>
      </div>
      <div className="recon-diff bad"><div>Sign-off boundary</div><div className="sm">Bank MATCHED is not enough: each item needs a retained, mapped, local POSTED cash JE and amount proof.</div></div>
    </div>
    <Table features={{exportable:false}} cols={[
      {h:'Bank item',render:row=>row.transaction.external_id || row.transaction.bank_txn_id},
      {h:'Matched JE',render:row=>row.journal ? <Btn size="sm" variant="ghost" onClick={()=>goto('je',{jeNumber:row.journal.je_number,reconciliationReturn:localReconciliationJournalReturnContext({acctCode,bankTxnId:row.transaction.bank_txn_id})})}>{row.journal.je_number}</Btn> : <span className="muted">Unavailable</span>},
      {h:'Expected cash',num:true,render:row=><Money v={row.expectedAmount}/>},
      {h:'Local cash JE',num:true,render:row=>row.cashAmount == null ? <span>—</span> : <Money v={row.cashAmount}/>},
      {h:'Proof',render:row=><Badge tone={row.state==='VERIFIED_LOCAL_MATCH'?'ok':'bad'}>{row.state}</Badge>},
    ]} rows={localEvidence.matched} empty="No locally matched bank items are retained for this worksheet."/>
    <Table rowKey="bank_txn_id" features={{exportable:false}} cols={[
      {h:'Transaction ID',k:'external_id'},{h:'Date',k:'txn_date'},
      {h:'Direction',render:r=><Badge tone="muted">{r.direction}</Badge>,csv:r=>r.direction},
      {h:'Amount',num:true,render:r=><Money v={r.amount}/>,sortVal:r=>r.amount,csv:r=>r.amount},
      {h:'Description',k:'reference'},
      {h:'Match state',render:r=><Badge>{r.match_status}</Badge>,csv:r=>r.match_status},
       {h:'Evidence action',render:r=> r.match_status==='MATCHED'? (r.matched_je&&jes.some(j=>j.je_number===r.matched_je) ? <Btn size="sm" variant="ghost" onClick={()=>goto('je',{jeNumber:r.matched_je,reconciliationReturn:localReconciliationJournalReturnContext({acctCode,bankTxnId:r.bank_txn_id})})}>Open JE</Btn> : <span className="muted sm">{r.matched_je||'—'}</span>) :
        <span className="row-acts">
          {r.suggest && ['FEE','INTEREST'].includes(r.suggest)
            ? <span className="bank-action-chip" aria-disabled="true"><span className="bank-action-name">Categorize</span><span className="bank-action-state">Unavailable here</span></span>
            : <Btn size="sm" onClick={()=>match(r)}>Open Match review</Btn>}
          <span className="bank-action-chip" aria-disabled="true"><span className="bank-action-name">Exclude</span><span className="bank-action-state">Unavailable here</span></span>
        </span>},
    ]} rows={txns} />
    <div className="muted sm" style={{marginTop:14}}>Strict local sign-off gate: {localReadiness.reason || 'READY'}.</div>
    <div style={{marginTop:14, display:'flex', gap:14, alignItems:'center'}}>
      <span className="bank-action-chip" aria-disabled="true"><span className="bank-action-name">Reconcile</span><span className="bank-action-state">Sign-off unavailable here</span></span>
      <span className="muted sm">{signedHistory ? `Signed off by ${signedHistory.by} on ${signedHistory.at}; duplicate sign-off is blocked.` : 'Adjusted Bank must equal Adjusted Book and all retained items must be handled before sign-off.'}</span>
    </div>
    {reopen.entry && <section className="report-workbench" aria-label="Local reconciliation reopen workflow" style={{marginTop:14}}><div className="report-workbench-head"><div><b>Local reopen / correction request</b><div className="page-subtitle">Changes reconciliation workflow metadata only; JE, GL/TB, and Aging remain read-only POSTED evidence.</div></div><Badge tone={reopen.state==='SIGNED_OFF'?'ok':'warn'}>{reopen.state}</Badge></div><div className="qbo-toolgrid"><span><i>Signed snapshot difference</i><b>{money(reopen.snapshot?.diff)}</b></span><span><i>Signed bank items</i><b>{(reopen.snapshot?.source_txn_ids||[]).length}</b></span><span><i>Statement cutoff</i><b>{reopen.snapshot?.statementDate||'—'}</b></span></div><p className="muted sm">Reason: {reopen.entry.reopen_reason||'No correction request retained.'} Requester/reviewer: {reopen.entry.reopen_requested_by||'—'} / {reopen.entry.reopen_reviewed_by||'—'}.</p>{reopen.canRequest&&<div className="row-acts"><input aria-label="Reopen correction reason" value={reopenReason} onChange={event=>setReopenReason(event.target.value)} placeholder="Reason for correction"/><Btn size="sm" variant="ghost" onClick={requestReopen}>Request reopen</Btn></div>}{reopen.state==='REOPEN_REQUESTED'&&<div className="row-acts"><Btn size="sm" variant="primary" disabled={!can('CASH.RECON.SIGNOFF')} onClick={()=>reviewReopen(true)}>Approve reopen</Btn><Btn size="sm" variant="ghost" disabled={!can('CASH.RECON.SIGNOFF')} onClick={()=>reviewReopen(false)}>Reject request</Btn></div>}<p className="muted sm">Reopened periods must satisfy the current zero-difference and local-source gates again before a new sign-off. The retained signed snapshot is not overwritten.</p></section>}
    {bank.history.length>0 && <><SectionTitle>Reconciliation history</SectionTitle>
      <Table rowKey="id" features={{exportable:false}} onRow={row=>setHistoryDetailId(row.id)} cols={[{h:'Account',render:r=>r.bank_name?`${r.account} · ${r.bank_name}`:r.account},{h:'Period',k:'period'},{h:'Bank items',render:r=><Badge tone="muted">{(r.source_txn_ids||[]).length}</Badge>},{h:'Difference',num:true,render:r=><Money v={r.diff}/>},{h:'Sign-off',k:'by'},{h:'Timestamp',k:'at'},{h:'Drill',render:r=><Btn size="sm" variant="ghost" onClick={event=>{event.stopPropagation();setHistoryDetailId(r.id)}}>View retained detail</Btn>}]} rows={bank.history}/></>}
    {historyState.isEmpty && <><SectionTitle>Local reconciliation history</SectionTitle><div className="empty-state"><b>{historyState.emptyLabel}</b><span>Complete the existing guarded local sign-off only when adjusted balances agree and all local activity is handled.</span><small>Local audit evidence will appear here; QBO completion history is unverified.</small></div></>}
  </div>;
}
