import React, {useEffect,useState} from 'react';
import {createAuthoritativeBankPaymentMatch,createAuthoritativeReconciliationAdjustmentDraft,readAuthoritativeAdmittedBankStatement,refreshAuthoritativeAdmittedBankStatements,refreshAuthoritativeBankMatchCandidates,refreshAuthoritativeBankTransactions,refreshAuthoritativeReconciliation,refreshAuthoritativeReconciliationScopes,refreshAuthoritativeReconciliationWorksheet,setAuthoritativeReconciliationAdjustmentClearance,setAuthoritativeReconciliationClearance,startAuthoritativeReconciliationFromAdmittedStatement,transitionAuthoritativeReconciliation,unmatchAuthoritativeBankPayment} from './accounting-api.js';
import {StateBlock} from './ui.jsx';
import {AuthoritativeWorkspaceView,AuthoritativeWorkspaceHeader} from './authoritative-workbench-view.jsx';
import {AuthoritativeWbsLivePilotObservation,WBS_LIVE_PILOT_SURFACE_TOOLS} from './authoritative-wbs-live-pilot-observation.jsx';
import {AuthoritativeSecondaryDisclosure} from './authoritative-secondary-disclosure.jsx';
import {DEFAULT_AUTHORITATIVE_LIST_VIEW,createAuthoritativeReturnContext,restoreAuthoritativeReturnContext} from './authoritative-list-context.js';

const fixed4Units=value=>{
  if(typeof value==='number'){
    const scaled=value*10000;
    return Number.isFinite(value)&&Number.isSafeInteger(scaled)?BigInt(scaled):null;
  }
  const match=/^(-?)([0-9]{1,16})\.([0-9]{4})$/.exec(String(value??''));
  return match?BigInt(`${match[1]}${match[2]}${match[3]}`):null;
};

const money=value=>{
  const units=fixed4Units(value);
  if(units===null)return 'Unavailable';
  const negative=units<0n;
  const absolute=negative?-units:units;
  const whole=(absolute/10000n).toString().replace(/\B(?=(\d{3})+(?!\d))/g,',');
  const cents=((absolute%10000n)/100n).toString().padStart(2,'0');
  return `${negative?'-':''}$${whole}.${cents}`;
};

const absoluteMoney=value=>{
  const units=fixed4Units(value);
  if(units===null)return 'Unavailable';
  const absolute=units<0n?-units:units;
  const whole=(absolute/10000n).toString().replace(/\B(?=(\d{3})+(?!\d))/g,',');
  const cents=((absolute%10000n)/100n).toString().padStart(2,'0');
  return `$${whole}.${cents}`;
};

const bankAmountColumn=(value,side)=>{
  const units=fixed4Units(value);
  if(units===null)return 'Unavailable';
  if(side==='SPENT')return units<0n?absoluteMoney(value):'—';
  return units>0n?absoluteMoney(value):'—';
};

const direction=value=>{
  const units=fixed4Units(value);
  return units===null?'UNAVAILABLE':units<0n?'OUTFLOW':'INFLOW';
};

const ReadError=({error,onRetry})=><StateBlock tone="error" title={error?.code||'ACCOUNTING_API_UNAVAILABLE'}
  actions={<button type="button" className="btn btn-sm" onClick={onRetry}>Retry read</button>}>
  <p>{error?.message||'The authoritative read could not be completed.'}</p>
</StateBlock>;

const bankReadFailure=(error,subject)=>{
  if(['AUTHENTICATION_REQUIRED','AUTHORIZATION_DENIED'].includes(error?.code))return {
    tone:'blocked',title:'NO_PERMISSION — authoritative read denied',
    detail:`The current session cannot read ${subject} for this entity. Ask an administrator for read access, then retry the same scope.`,
  };
  if(['ACCOUNTING_API_SCOPE_INVALID','ACCOUNTING_API_SCOPE_NOT_FOUND'].includes(error?.code))return {
    tone:'blocked',title:'SCOPE_EMPTY — configured scope unavailable',
    detail:`The accounting API cannot resolve ${subject} for the selected entity, account, and date scope. Check the scope values; this is not evidence of a zero balance.`,
  };
  return {
    tone:'error',title:'API_ERROR — authoritative read failed',
    detail:'The accounting API did not return a usable response. Retry the same scope; do not treat this result as empty or zero.',
  };
};

const BankReadFailure=({error,onRetry,subject})=>{
  const diagnostic=bankReadFailure(error,subject);
  return <StateBlock tone={diagnostic.tone} title={diagnostic.title}
    actions={<button type="button" className="btn btn-sm" onClick={onRetry}>Retry authoritative read</button>}>
    <p>{error?.code||'ACCOUNTING_API_UNAVAILABLE'}: {error?.message||diagnostic.detail}</p>
    <p>{diagnostic.detail}</p>
  </StateBlock>;
};

const BankReadMetadata=({count,readAt,subject})=><p className="muted sm" aria-label={`${subject} authoritative read diagnostics`}>
  API records returned: {count}. Last authoritative API read: {readAt||'not completed'}. Source freshness: not supplied by this endpoint.
</p>;

const statusTone=status=>/^(ACTIVE|RECONCILED|CLEARED)$/i.test(String(status||''))?'badge-ok':/^(UNMATCHED|DRAFT|IN_REVIEW|REOPENED)$/i.test(String(status||''))?'badge-warn':'badge-muted';
const EvidenceBadge=({children})=><span className={`badge ${statusTone(children)}`}>{children||'UNMATCHED'}</span>;
const entityLabel=config=>config?.scopePresentation?.entityLabel||'Configured entity';

// A stale parent context or inconsistent response must never unlock a
// controller command on a different account or statement.
const bankRowMatchesScope=(row,scope)=>Boolean(row?.bank_account_ref&&scope?.bankAccountRef&&row.bank_account_ref===scope.bankAccountRef);
const reconciliationRowMatchesScope=(row,scope)=>Boolean(bankRowMatchesScope(row,scope)&&row?.statement_ending_date&&scope?.statementEndingDate&&row.statement_ending_date===scope.statementEndingDate);

const BankEvidenceLifecycle=({row})=>{
  const hasMatchHistory=Boolean(row.bank_match_id);
  const activeMatch=row.match_status==='ACTIVE';
  const hasJournalReference=Boolean(row.journal_entry_id);
  return <section className="authoritative-evidence-stage" aria-label="Bank evidence lifecycle">
    <span className="done">1 Source retained</span>
    <span className={activeMatch?'done':hasMatchHistory?'pending':'current'}>{activeMatch?'2 Active Match retained':hasMatchHistory?'2 Match history retained':'2 Match review'}</span>
    <span className={hasJournalReference?'done':'pending'}>{hasJournalReference?'3 Journal reference retained':'3 Journal reference unavailable'}</span>
    <span className="pending">4 Reconciliation separate</span>
  </section>;
};

const ReconciliationLifecycle=({status})=>{
  const signedOff=status==='RECONCILED';
  const reviewActive=status==='IN_REVIEW';
  const reopened=status==='REOPENED';
  return <section className="authoritative-evidence-stage" aria-label="Reconciliation lifecycle">
    <span className="done">1 Statement retained</span>
    <span className={reviewActive||reopened||status==='DRAFT'?'current':'done'}>{reopened?'2 Controller review reopened':'2 Controller review'}</span>
    <span className={signedOff?'done':reviewActive?'current':'pending'}>{signedOff?'3 Independent sign-off retained':'3 Independent sign-off'}</span>
    <span className={signedOff?'done':'pending'}>{signedOff?'4 Immutable history retained':'4 Immutable history'}</span>
  </section>;
};

const ScopeStrip=({items=[]})=><div className="authoritative-bank-scope-strip" aria-label="Authoritative evidence scope">
  {items.map(({label,value})=><span key={label}><i>{label}</i><b>{value||'Not retained'}</b></span>)}
</div>;

const BankQueueSummary=({rows=[]})=>{
  const matched=rows.filter(row=>row.match_status==='ACTIVE').length;
  const journaled=rows.filter(row=>Boolean(row.journal_entry_id)).length;
  const unmatched=Math.max(0,rows.length-matched);
  return <section className="qbo-grid authoritative-bank-summary-grid" aria-label="Bank queue read summary">
    <div className="qbo-card"><h4>Returned sources</h4><div className="qbo-big">{rows.length}</div><div className="qbo-sub">Current API response</div></div>
    <div className="qbo-card"><h4>Active Matches</h4><div className="qbo-big">{matched}</div><div className="qbo-sub">Retained evidence only</div></div>
    <div className="qbo-card"><h4>Unmatched sources</h4><div className="qbo-big">{unmatched}</div><div className="qbo-sub">Not a reconciliation state</div></div>
    <div className="qbo-card"><h4>Journal references</h4><div className="qbo-big">{journaled}</div><div className="qbo-sub">When supplied by the API</div></div>
  </section>;
};

export const AuthoritativeBankTable=({rows=[],readAt=null,onOpen=()=>{}})=><section className="bank-queue-card authoritative-bank-queue" aria-label="Authoritative bank transaction evidence">
  <div className="card-head"><div><p className="eyebrow">BANK ACTIVITY</p><h2>Transactions</h2><p className="muted sm">Review retained bank activity and match evidence.</p></div><span className="badge badge-muted">READ ONLY</span></div>
  <div className="authoritative-bank-queue-note"><b>{rows.length}</b> transaction{rows.length===1?'':'s'}. Status does not reconcile or post them.</div>
  {!!rows.length&&<BankQueueSummary rows={rows}/>}
  {!rows.length?<StateBlock tone="empty" title="No bank transactions in this scope">
    <p>Check the bank account and date range, then refresh.</p>
    <p>This result does not confirm a zero cash balance.</p>
    <BankReadMetadata count={0} readAt={readAt} subject="Bank transactions"/>
  </StateBlock>:<div className="table-wrap authoritative-bank-evidence-table" role="region" tabIndex={0} aria-label="Bank transactions; scroll horizontally to view every column"><table className="tbl">
    <thead><tr><th>Date</th><th>Source evidence</th><th>Spent</th><th>Received</th><th>Match evidence</th><th>Source version</th><th>Evidence</th></tr></thead>
    <tbody>{rows.map(row=><tr key={row.bank_source_id}>
      <td>{row.transaction_date}</td><td><b>{row.external_bank_line_id}</b><div className="muted sm">{row.source_ref}</div></td>
      <td className="num">{bankAmountColumn(row.amount,'SPENT')} <span className="muted sm">{row.currency}</span></td><td className="num">{bankAmountColumn(row.amount,'RECEIVED')} <span className="muted sm">{row.currency}</span></td>
      <td><EvidenceBadge>{row.match_status||'UNMATCHED'}</EvidenceBadge>{row.journal_entry_id&&<div className="muted sm">Journal retained</div>}</td><td>v{row.version}</td>
      <td><button id={`authoritative-bank-${row.bank_source_id}`} type="button" className="btn btn-sm" onClick={()=>onOpen(row,`authoritative-bank-${row.bank_source_id}`)}>Open detail</button></td>
    </tr>)}</tbody>
  </table></div>}
</section>;

export function AuthoritativeBankMatchReview({row,config,fetcher,onChanged=()=>{}}){
  const [candidateState,setCandidateState]=useState({phase:'IDLE',candidates:[],error:null});
  const [reason,setReason]=useState('');
  const loadCandidates=async()=>{setCandidateState({phase:'LOADING',candidates:[],error:null});const result=await refreshAuthoritativeBankMatchCandidates({config,bankSourceId:row.bank_source_id,fetcher});setCandidateState(result.ok?{phase:'READY',candidates:result.candidates,error:null}:{phase:'ERROR',candidates:[],error:result});};
  const createMatch=async event=>{event.preventDefault();const candidate=candidateState.candidates[0];setCandidateState(current=>({...current,phase:'COMMANDING',error:null}));const result=await createAuthoritativeBankPaymentMatch({config,bankSourceId:row.bank_source_id,bankRevision:row.version,candidate,reason,fetcher});if(result.ok){onChanged();return;}setCandidateState(current=>({...current,phase:'READY',error:result}));};
  const unmatch=async event=>{event.preventDefault();setCandidateState(current=>({...current,phase:'COMMANDING',error:null}));const result=await unmatchAuthoritativeBankPayment({config,bankSourceId:row.bank_source_id,bankMatchId:row.bank_match_id,bankMatchRevision:row.match_version,reason,fetcher});if(result.ok){onChanged();return;}setCandidateState(current=>({...current,phase:'READY',error:result}));};
  if(row.bank_match_id&&row.match_status!=='ACTIVE')return <section className="card" aria-label="Bank match correction blocked"><div className="card-head"><div><h2>Match correction blocked</h2><p className="muted sm">BLOCKED — This retained Match is not ACTIVE in the accounting API response. Its history remains visible, but no Unmatch command is available without an exact active Match and its current revision.</p></div><span className="badge badge-muted">READ ONLY HISTORY</span></div></section>;
  if(row.bank_match_id)return <section className="card" aria-label="Bank match correction"><div className="card-head"><div><h2>Active Match correction</h2><p className="muted sm">Unmatch preserves the immutable evidence and requires a controller reason. It cannot reverse or post a journal.</p></div><span className="badge badge-muted">CONTROLLER</span></div><form className="filterbar" onSubmit={unmatch}><label>Correction reason<input required minLength={8} maxLength={2000} value={reason} onChange={event=>setReason(event.target.value)}/></label><button type="submit" className="btn btn-sm" disabled={candidateState.phase==='COMMANDING'}>Unmatch evidence</button></form>{candidateState.error&&<ReadError error={candidateState.error} onRetry={()=>{}}/>}</section>;
  const candidate=candidateState.candidates[0];
  return <section className="card" aria-label="Bank match candidate review"><div className="card-head"><div><h2>Exact POSTED Match candidate</h2><p className="muted sm">Candidates are server-validated against posted AP/AR cash, account, currency, amount, date, source and ledger evidence. Zero or multiple candidates stop the command.</p></div><span className="badge badge-muted">CONTROLLER</span></div>{candidateState.phase==='IDLE'&&<button type="button" className="btn btn-sm" onClick={loadCandidates}>Load exact candidate</button>}{candidateState.phase==='LOADING'&&<StateBlock tone="loading">Reading exact POSTED match evidence...</StateBlock>}{candidateState.phase==='ERROR'&&<ReadError error={candidateState.error} onRetry={loadCandidates}/>} {candidateState.phase==='READY'&&candidateState.candidates.length!==1&&<StateBlock tone="empty" title="Match blocked">This bank transaction has {candidateState.candidates.length===0?'no':'multiple'} exact POSTED candidate{candidateState.candidates.length===1?'':'s'}. No Match command is available.</StateBlock>}{candidateState.phase==='READY'&&candidateState.candidates.length===1&&<><div className="qbo-toolgrid" aria-label="Exact posted candidate evidence"><span><i>Occurrence</i><b>{candidate.occurrence_kind}</b></span><span><i>Occurrence ID</i><b>{candidate.payment_occurrence_id}</b></span><span><i>Occurrence revision</i><b>v{candidate.occurrence_version}</b></span><span><i>Business source document</i><b>{candidate.business_source_document_id}</b></span><span><i>Amount</i><b>{money(candidate.amount)} {candidate.currency}</b></span><span><i>Accounting date</i><b>{candidate.accounting_date}</b></span><span><i>Date delta days</i><b>{candidate.date_delta_days}</b></span><span><i>Journal entry</i><b>{candidate.journal_entry_id}</b></span><span><i>Journal line</i><b>{candidate.journal_line_id}</b></span><span><i>Ledger line</i><b>{candidate.ledger_line_id}</b></span></div><form className="filterbar" onSubmit={createMatch}><label>Review reason<input required minLength={8} maxLength={2000} value={reason} onChange={event=>setReason(event.target.value)}/></label><button type="submit" className="btn btn-primary" disabled={candidateState.phase==='COMMANDING'}>Create reviewed Match</button></form>{candidateState.error&&<ReadError error={candidateState.error} onRetry={loadCandidates}/>}</>}</section>;
}

export const AuthoritativeBankDetail=({row,scope,onBack,config,fetcher,onMatchChanged})=>{
  const scopeMatches=bankRowMatchesScope(row,scope);
  return <section className="full-bleed qbo-transaction-report authoritative-bank-detail" aria-label="Bank transaction detail">
  <div className="card-head"><div><button type="button" className="btn btn-sm" onClick={onBack}>Back to bank transactions</button><p className="eyebrow">AUTHORITATIVE SOURCE EVIDENCE</p><h1>{row.external_bank_line_id}</h1><p className="muted sm">Review retained source and Match evidence. Controller corrections require server validation.</p></div><span className="badge badge-muted">READ ONLY</span></div>
  <ScopeStrip items={[{label:'Entity',value:scope.entityLabel||'Configured entity'},{label:'Account',value:row.bank_account_ref},{label:'Date range',value:`${scope.from||'Opening'} to ${scope.through||'Latest'}`},{label:'Source version',value:`v${row.version}`},{label:'Match state',value:row.match_status||'UNMATCHED'}]}/>
  <BankEvidenceLifecycle row={row}/>
  <div className="qbo-toolgrid">
    <span><i>Transaction date</i><b>{row.transaction_date}</b></span><span><i>Direction</i><b>{direction(row.amount)}</b></span><span><i>Amount</i><b>{money(row.amount)} {row.currency}</b></span><span><i>Type</i><b>{row.document_type}</b></span>
  </div>
  <div className="qbo-toolgrid">
    <span><i>Bank source ID</i><b>{row.bank_source_id}</b></span><span><i>Source reference</i><b>{row.source_ref||'Unavailable'}</b></span>
    <span><i>Source document</i><b>{row.source_document_id||'Unavailable'}</b></span><span><i>Journal entry</i><b>{row.journal_entry_id||'Unavailable'}</b></span>
  </div>
  {row.bank_match_id&&<div className="qbo-toolgrid">
    <span><i>Bank match ID</i><b>{row.bank_match_id}</b></span><span><i>Business source document</i><b>{row.business_source_document_id}</b></span>
    <span><i>Journal line</i><b>{row.journal_line_id||'Unavailable'}</b></span><span><i>Ledger line</i><b>Unavailable from the active-Match read</b></span><span><i>Candidate rule</i><b>{row.candidate_rule_code||'Unavailable'}</b></span>
    <span><i>Amount delta</i><b>{money(row.amount_delta)}</b></span><span><i>Currency match</i><b>{String(row.currency_match)}</b></span>
    <span><i>Date delta days</i><b>{row.date_delta_days??'Unavailable'}</b></span><span><i>Match version</i><b>{row.match_version}</b></span>
    <span><i>Matched by</i><b>{row.matched_by}</b></span><span><i>Matched at</i><b>{row.matched_at}</b></span>
  </div>}
  {!scopeMatches&&<StateBlock tone="blocked" title="BLOCKED — immutable bank scope mismatch">The returned bank record does not match the account retained in the parent evidence scope. Match review is unavailable; return to the scoped bank transaction list.</StateBlock>}
  {scopeMatches&&config&&<AuthoritativeBankMatchReview row={row} config={config} fetcher={fetcher} onChanged={onMatchChanged}/>}
</section>;
};

export const AuthoritativeReconciliationSummary=({row=null,scope=null,readAt=null,onOpen=()=>{}})=><section className="report-workbench recon-summary authoritative-reconciliation-summary" aria-label="Authoritative reconciliation evidence">
  <div className="card-head"><div><p className="eyebrow">STATEMENT → REVIEW → SIGN-OFF</p><h2>Reconciliation statement</h2><p className="muted sm">Statement-scoped evidence only; no action runs from this summary.</p></div><span className="badge badge-muted">READ ONLY</span></div>
  {!row?<StateBlock tone="blocked" title="Reconciliation evidence blocked">BLOCKED — The accounting API returned no authorized reconciliation statement for this account and cutoff. Reconciliation controls are unavailable until retained statement evidence is returned. This scoped result is not evidence of zero statement activity, zero difference, review, or sign-off.</StateBlock>:<>
  <ScopeStrip items={[{label:'Entity',value:scope?.entityLabel||'Configured entity'},{label:'Bank account',value:row.bank_account_ref},{label:'Statement cutoff',value:row.statement_ending_date},{label:'Statement version',value:`v${row.version}`},{label:'Status',value:row.status}]}/>
    <BankReadMetadata count={1} readAt={readAt} subject="Reconciliation statements"/>
    <ReconciliationLifecycle status={row.status}/>
    <div className="recon-summary-grid"><span className="recon-summary-cell"><i>Statement ending</i><b>{money(row.statement_ending_balance)}</b></span><span className="recon-summary-cell"><i>Statement activity</i><b>{money(row.statement_activity_amount)}</b></span><span className="recon-summary-cell"><i>Difference</i><b>{money(row.difference)}</b></span><span className="recon-summary-cell"><i>Bank transactions</i><b>{row.bank_transaction_count}</b></span><span className="recon-summary-cell"><i>Active matches</i><b>{row.active_match_count}</b></span><span className="recon-summary-cell"><i>Unmatched</i><b>{row.unmatched_transaction_count}</b></span></div>
    <button id={`authoritative-reconciliation-${row.reconciliation_id}`} type="button" className="btn btn-sm" onClick={()=>onOpen(row,`authoritative-reconciliation-${row.reconciliation_id}`)}>Open statement detail</button>
  </>}
</section>;

const compactReceipt=value=>typeof value==='string'&&value.length>12?`...${value.slice(-8)}`:value;

export function AuthoritativeAdmittedStatements({config,bankAccountRef,fetcher,onStarted=async()=>{}}){
  const [list,setList]=useState({phase:'IDLE',rows:[],error:null,readAt:null});
  const [detail,setDetail]=useState({phase:'IDLE',row:null,error:null});
  const [reason,setReason]=useState('');
  const account=String(bankAccountRef||'').trim();
  const load=async()=>{setDetail({phase:'IDLE',row:null,error:null});setReason('');setList({phase:'LOADING',rows:[],error:null,readAt:null});const result=await refreshAuthoritativeAdmittedBankStatements({config,bankAccountRef:account,limit:10,fetcher});const readAt=new Date().toISOString();setList(result.ok?{phase:'READY',rows:result.rows,error:null,readAt}:{phase:'ERROR',rows:[],error:result,readAt});};
  const select=async row=>{setReason('');setDetail({phase:'LOADING',row:null,error:null});const result=await readAuthoritativeAdmittedBankStatement({config,statementReceiptId:row.wbs_bank_statement_receipt_id,bankAccountRef:account,fetcher});const immutableMatch=result.ok&&['wbs_bank_statement_receipt_id','bank_account_ref','statement_start_date','statement_end_date','currency','opening_balance','ending_balance','transaction_count','statement_activity_amount','admission_hash','signature_verified','admission_status','admitted_at','reconciliation_id','reconciliation_status','reconciliation_version','selection_state'].every(field=>result.row[field]===row[field]);setDetail(immutableMatch?{phase:'READY',row:result.row,error:null}:{phase:'ERROR',row:null,error:result.ok?{code:'ACCOUNTING_API_PROTOCOL',message:'The admitted statement detail did not match the immutable selected receipt.'}:result});};
  const start=async()=>{const row=detail.row;if(!row)return;setDetail(current=>({...current,phase:'COMMANDING',error:null}));const result=await startAuthoritativeReconciliationFromAdmittedStatement({config,statement:row,reason,fetcher});if(!result.ok){setDetail(current=>({...current,phase:'READY',error:result}));return;}await onStarted(row,result.data);setDetail(current=>({...current,phase:'STARTED',error:null}));await load();};
  const row=detail.row,eligible=row?.bank_account_ref===account&&row?.signature_verified===true&&row?.admission_status==='ADMITTED'&&row?.selection_state==='AVAILABLE_FOR_SERVER_VALIDATION';
  return <section className="card authoritative-admitted-statements" aria-label="Signed admitted WBS statements">
    <div className="card-head authoritative-admitted-statements-head"><div><p className="eyebrow">SIGNED WBS STATEMENT EVIDENCE</p><h2>Signed admitted statements</h2><p className="muted sm">Authenticated GET evidence admitted by the server. This is separate from UNSIGNED PILOT observations. The browser cannot supply or override account, currency, dates, balances, transaction rows, or signature evidence.</p></div><div className="authoritative-admitted-badges"><span className="badge badge-ok">SIGNED + ADMITTED</span><span className="badge badge-muted">SERVER REVALIDATED</span></div></div>
    <div className="authoritative-admitted-actions"><button type="button" className="btn btn-sm" disabled={list.phase==='LOADING'||!account} onClick={load}>Load signed statements</button><span className="muted sm">Bank account {account||'required above'}; up to 10 receipts.</span></div>
    {list.phase==='IDLE'&&<StateBlock tone="empty" title="Signed statement read not requested">Enter one bank account above, then load signature-verified admitted statements.</StateBlock>}
    {list.phase==='LOADING'&&<StateBlock tone="loading">Loading signed admitted statement evidence...</StateBlock>}
    {list.phase==='ERROR'&&<BankReadFailure error={list.error} onRetry={load} subject="signed admitted bank statements"/>}
    {list.phase==='READY'&&!list.rows.length&&<StateBlock tone="blocked" title="INGESTION_BLOCKED — no signed admitted statements returned">No signature-verified ADMITTED WBS statement was returned for this account. This is not TRUE_EMPTY and does not imply a zero statement balance or completed reconciliation.<p>Next step: retain and admit a signed statement for this bank account, then refresh.</p><BankReadMetadata count={0} readAt={list.readAt} subject="Signed admitted statements"/></StateBlock>}
    {list.phase==='READY'&&!!list.rows.length&&<div className="table-wrap authoritative-admitted-statements-table" role="region" tabIndex={0} aria-label="Signed admitted statements; scroll horizontally to view every column"><table className="tbl"><thead><tr><th>Statement period</th><th>Currency</th><th>Opening</th><th>Activity</th><th>Ending</th><th>Rows</th><th>State</th><th>Evidence</th></tr></thead><tbody>{list.rows.map(item=><tr key={item.wbs_bank_statement_receipt_id}><td><b>{item.statement_start_date}</b><div className="muted sm">through {item.statement_end_date}</div></td><td>{item.currency}</td><td className="num">{money(item.opening_balance)}</td><td className="num">{money(item.statement_activity_amount)}</td><td className="num">{money(item.ending_balance)}</td><td>{item.transaction_count}</td><td><EvidenceBadge>{item.selection_state}</EvidenceBadge></td><td><button type="button" className="btn btn-sm" onClick={()=>select(item)} disabled={detail.phase==='LOADING'||detail.phase==='COMMANDING'}>Review signed statement <span className="sr-only">receipt {compactReceipt(item.wbs_bank_statement_receipt_id)}</span></button></td></tr>)}</tbody></table></div>}
    {detail.phase==='LOADING'&&<StateBlock tone="loading">Re-reading the selected immutable receipt by ID...</StateBlock>}
    {detail.phase==='ERROR'&&<ReadError error={detail.error} onRetry={()=>{}}/>}
    {row&&['READY','COMMANDING','STARTED'].includes(detail.phase)&&<section className="authoritative-admitted-detail" aria-label="Selected signed admitted statement"><div className="card-head"><div><h3>Selected signed statement</h3><p className="muted sm">Receipt {compactReceipt(row.wbs_bank_statement_receipt_id)} was re-read by UUID. The server will validate the immutable receipt again before creating a Draft.</p></div><span className="badge badge-ok">{row.signature_verified&&row.admission_status==='ADMITTED'?'SIGNED + ADMITTED':'BLOCKED'}</span></div><ScopeStrip items={[{label:'Bank account',value:row.bank_account_ref},{label:'Statement period',value:`${row.statement_start_date} to ${row.statement_end_date}`},{label:'Currency',value:row.currency},{label:'Selection state',value:row.selection_state}]}/><div className="qbo-toolgrid"><span><i>Opening balance</i><b>{money(row.opening_balance)}</b></span><span><i>Statement activity</i><b>{money(row.statement_activity_amount)}</b></span><span><i>Ending balance</i><b>{money(row.ending_balance)}</b></span><span><i>Retained rows</i><b>{row.transaction_count}</b></span><span><i>Admission</i><b>{row.admission_status}</b></span><span><i>Signature verified</i><b>{String(row.signature_verified)}</b></span></div>{eligible?<form className="filterbar authoritative-admitted-start" onSubmit={event=>{event.preventDefault();start();}}><label>Controller reason<input required minLength={8} maxLength={2000} value={reason} onChange={event=>setReason(event.target.value)}/></label><button type="submit" className="btn btn-primary" disabled={detail.phase!=='READY'||reason.trim().length<8}>Start Draft from signed statement</button></form>:<StateBlock tone="blocked" title="Draft start unavailable">{row.bank_account_ref!==account?'The re-read receipt no longer matches the retained bank account. No Draft command is exposed.':row.selection_state==='ALREADY_STARTED'?'This receipt already has a reconciliation. Open it through the exact account and statement cutoff above.':'The receipt is not AVAILABLE_FOR_SERVER_VALIDATION. No Draft command is exposed.'}</StateBlock>}{detail.phase==='COMMANDING'&&<StateBlock tone="loading">Starting one server-derived Draft reconciliation...</StateBlock>}{detail.phase==='STARTED'&&<StateBlock tone="loading" title="Draft started; refreshing evidence">The accounting API accepted the command. Refreshing the authoritative statement summary.</StateBlock>}{detail.error&&<ReadError error={detail.error} onRetry={()=>{}}/>}</section>}
  </section>;
}

export function AuthoritativeReconciliationDetail({row,scope,onBack,config,fetcher,onChanged=()=>{}}){
  const [worksheet,setWorksheet]=useState({phase:'IDLE',rows:[],error:null});
  const [reason,setReason]=useState('');
  const [transitionState,setTransitionState]=useState({phase:'IDLE',error:null});
  const [adjustment,setAdjustment]=useState({item:null,journalNumber:'',journalDate:'',offsetAccountCode:'',description:'',attachmentIds:'',phase:'IDLE',error:null});
  const reasonReady=reason.trim().length>=8;
  const transitionByStatus={DRAFT:{action:'REVIEW',label:'Send to independent review'},REOPENED:{action:'REVIEW',label:'Send reopened statement to independent review'},IN_REVIEW:{action:'SIGN_OFF',label:'Sign off reviewed statement'},RECONCILED:{action:'REOPEN',label:'Reopen signed statement'}};
  const transition=transitionByStatus[row.status]||null;
  const canChangeItems=['DRAFT','REOPENED'].includes(row.status);
  const hasPostedAdjustmentEvidence=item=>item?.match_status===null&&item?.adjustment_clearance_eligible===true&&item?.adjustment_journal_status==='POSTED'&&Boolean(item?.adjustment_journal_entry_id)&&Number.isSafeInteger(item?.adjustment_journal_version);
  const scopeMatches=reconciliationRowMatchesScope(row,scope);
  const hasAuthorizedWorksheetEvidence=scopeMatches&&worksheet.rows.length>0;
  const loadWorksheet=async()=>{setWorksheet({phase:'LOADING',rows:[],error:null});const result=await refreshAuthoritativeReconciliationWorksheet({config,reconciliationId:row.reconciliation_id,fetcher});setWorksheet(result.ok?{phase:'READY',rows:result.rows,error:null}:{phase:'ERROR',rows:[],error:result});};
  const setClearance=async(item,clear)=>{setWorksheet(current=>({...current,phase:'COMMANDING',error:null}));const result=await setAuthoritativeReconciliationClearance({config,reconciliationId:row.reconciliation_id,reconciliationRevision:row.version,row:item,clear,reason,fetcher});if(result.ok){onChanged();await loadWorksheet();return;}setWorksheet(current=>({...current,phase:'READY',error:result}));};
  const selectAdjustmentItem=item=>setAdjustment({item,journalNumber:'',journalDate:item.transaction_date,offsetAccountCode:'',description:`Reconciliation adjustment for ${item.external_bank_line_id}`,attachmentIds:'',phase:'READY',error:null});
  const createAdjustment=async event=>{event.preventDefault();const attachmentIds=adjustment.attachmentIds.split(',').map(value=>value.trim()).filter(Boolean);setAdjustment(current=>({...current,phase:'COMMANDING',error:null}));const result=await createAuthoritativeReconciliationAdjustmentDraft({config,reconciliationId:row.reconciliation_id,reconciliationRevision:row.version,row:adjustment.item,journalNumber:adjustment.journalNumber,journalDate:adjustment.journalDate,offsetAccountCode:adjustment.offsetAccountCode,description:adjustment.description,attachmentIds,reason,fetcher});if(result.ok){onChanged();await loadWorksheet();return;}setAdjustment(current=>({...current,phase:'READY',error:result}));};
  const setAdjustmentClearance=async(item,clear)=>{setWorksheet(current=>({...current,phase:'COMMANDING',error:null}));const result=await setAuthoritativeReconciliationAdjustmentClearance({config,reconciliationId:row.reconciliation_id,reconciliationRevision:row.version,row:item,clear,reason,fetcher});if(result.ok){onChanged();await loadWorksheet();return;}setWorksheet(current=>({...current,phase:'READY',error:result}));};
  const runTransition=async()=>{if(!transition||!reasonReady)return;setTransitionState({phase:'COMMANDING',error:null});const result=await transitionAuthoritativeReconciliation({config,reconciliationId:row.reconciliation_id,revision:row.version,action:transition.action,reason,fetcher});if(result.ok){onChanged();return;}setTransitionState({phase:'READY',error:result});};
  const commandInFlight=worksheet.phase==='COMMANDING'||transitionState.phase==='COMMANDING';
  return <section className="full-bleed qbo-transaction-report" aria-label="Reconciliation statement detail">
  <div className="card-head"><div><button type="button" className="btn btn-sm" onClick={onBack}>Back to reconciliation evidence</button><p className="eyebrow">AUTHORITATIVE STATEMENT WORKSHEET</p><h1>Statement ending {row.statement_ending_date}</h1><p className="muted sm">Review the exact worksheet. Commands require server-returned evidence and separate authorization.</p></div><span className="badge badge-muted">CONTROLLER REVIEW</span></div>
  <ScopeStrip items={[{label:'Entity',value:scope.entityLabel||'Configured entity'},{label:'Bank account',value:row.bank_account_ref},{label:'Cutoff',value:row.statement_ending_date},{label:'Statement version',value:`v${row.version}`}]}/>
  <ReconciliationLifecycle status={row.status}/>
  <div className="qbo-toolgrid">
    <span><i>Bank account</i><b>{row.bank_account_ref}</b></span><span><i>Status</i><b>{row.status}</b></span><span><i>Ending balance</i><b>{money(row.statement_ending_balance)}</b></span>
    <span><i>Activity</i><b>{money(row.statement_activity_amount)}</b></span><span><i>Difference</i><b>{money(row.difference)}</b></span><span><i>Version</i><b>{row.version}</b></span>
  </div>
  <div className="qbo-toolgrid">
    <span><i>Reconciliation ID</i><b>{row.reconciliation_id}</b></span><span><i>Bank transactions</i><b>{row.bank_transaction_count}</b></span>
    <span><i>Active matches</i><b>{row.active_match_count}</b></span><span><i>Unmatched</i><b>{row.unmatched_transaction_count}</b></span>
    <span><i>Reconciled by</i><b>{row.reconciled_by||'Unavailable'}</b></span><span><i>Reconciled at</i><b>{row.reconciled_at||'Unavailable'}</b></span>
    <span><i>Reopened by</i><b>{row.reopened_by||'Unavailable'}</b></span><span><i>Reopened at</i><b>{row.reopened_at||'Unavailable'}</b></span>
  </div>
  {!scopeMatches&&<StateBlock tone="blocked" title="BLOCKED — immutable reconciliation scope mismatch">The returned statement does not match the retained bank account and statement cutoff. Worksheet reads and Controller commands are unavailable; return to the scoped reconciliation evidence.</StateBlock>}
  <section className="card" aria-label="Reconciliation worksheet">
    <div className="card-head"><div><h2>Statement worksheet</h2><p className="muted sm">The API supplies the exact scoped bank line and active Match evidence. This worksheet cannot create a Match, adjustment, or post a Journal Entry.</p></div><span className="badge badge-muted">SERVER EVIDENCE</span></div>
    {scopeMatches&&worksheet.phase==='IDLE'&&<button type="button" className="btn btn-sm" onClick={loadWorksheet}>Load reconciliation worksheet</button>}
    {worksheet.phase==='LOADING'&&<StateBlock tone="loading">Loading authoritative reconciliation worksheet...</StateBlock>}
    {worksheet.phase==='ERROR'&&<ReadError error={worksheet.error} onRetry={loadWorksheet}/>}
    {(worksheet.phase==='READY'||worksheet.phase==='COMMANDING')&&<>{!hasAuthorizedWorksheetEvidence?<StateBlock tone="blocked" title="Reconciliation controls blocked">BLOCKED — The accounting API returned no authorized worksheet evidence for this statement. Clear, unclear, adjustment Draft, review, sign-off, and reopen controls are unavailable until the exact retained worksheet is returned.</StateBlock>:<><form className="filterbar" onSubmit={event=>event.preventDefault()}><label>Controller reason<input required minLength={8} maxLength={2000} value={reason} onChange={event=>setReason(event.target.value)}/></label></form><div className="table-wrap authoritative-bank-evidence-table" role="region" tabIndex={0} aria-label="Reconciliation worksheet; scroll horizontally to view every column"><table className="tbl"><thead><tr><th>Date</th><th>Bank evidence</th><th>Amount</th><th>Match</th><th>Clearance</th><th>Action</th></tr></thead><tbody>{worksheet.rows.map(item=><tr key={item.bank_source_id}><td>{item.transaction_date}</td><td><b>{item.external_bank_line_id}</b><div className="muted sm">{item.bank_source_id}</div></td><td className="num">{money(item.amount)} {item.currency}</td><td>{item.match_status==='ACTIVE'?<><b>ACTIVE</b><div className="muted sm">JE {item.journal_entry_id}</div></>:'No exact active Match'}</td><td>{item.clearance_state}</td><td>{item.clearance_state==='CLEARED'&&item.match_status==='ACTIVE'?<button type="button" className="btn btn-sm" disabled={commandInFlight||!reasonReady||!canChangeItems} onClick={()=>setClearance(item,false)}>Unclear matched item</button>:item.match_status==='ACTIVE'?<button type="button" className="btn btn-sm" disabled={commandInFlight||!reasonReady||!canChangeItems} onClick={()=>setClearance(item,true)}>Clear matched item</button>:<div className="button-row"><button type="button" className="btn btn-sm" disabled={commandInFlight||!reasonReady||!canChangeItems} onClick={()=>selectAdjustmentItem(item)}>Prepare adjustment Draft</button><p className="muted sm">Posted adjustment clearance is BLOCKED until the API returns separate posted adjustment evidence for this bank source.</p></div>}</td></tr>)}</tbody></table></div></>}{worksheet.error&&<ReadError error={worksheet.error} onRetry={loadWorksheet}/>}</>}
  </section>
  {adjustment.item&&<section className="card" aria-label="Create reconciliation adjustment Draft"><div className="card-head"><div><h2>Create controlled adjustment Draft</h2><p className="muted sm">This request binds the selected bank source, current statement revision, configured cash account, exact four-decimal source amount, a supplied offset account, and verified-clean attachment IDs. It cannot approve or post a Journal Entry.</p></div><span className="badge badge-muted">DRAFT ONLY</span></div><p className="muted sm">Selected bank source {adjustment.item.external_bank_line_id} · {money(adjustment.item.amount)} {adjustment.item.currency} · {adjustment.item.bank_source_id}</p><form className="filterbar" onSubmit={createAdjustment}><label>Journal number<input required maxLength={128} value={adjustment.journalNumber} onChange={event=>setAdjustment(current=>({...current,journalNumber:event.target.value}))}/></label><label>Journal date<input required type="date" value={adjustment.journalDate} onChange={event=>setAdjustment(current=>({...current,journalDate:event.target.value}))}/></label><label>Offset account code<input required maxLength={64} value={adjustment.offsetAccountCode} onChange={event=>setAdjustment(current=>({...current,offsetAccountCode:event.target.value}))}/></label><label>Verified-clean attachment IDs<input required value={adjustment.attachmentIds} onChange={event=>setAdjustment(current=>({...current,attachmentIds:event.target.value}))} placeholder="UUID, UUID"/></label><label>Description<input maxLength={2000} value={adjustment.description} onChange={event=>setAdjustment(current=>({...current,description:event.target.value}))}/></label><button type="submit" className="btn btn-primary" disabled={commandInFlight||!reasonReady||adjustment.phase==='COMMANDING'}>Create adjustment Draft</button><button type="button" className="btn btn-sm" disabled={commandInFlight||adjustment.phase==='COMMANDING'} onClick={()=>setAdjustment(current=>({...current,item:null,error:null}))}>Cancel</button></form>{!reasonReady&&<p className="muted sm">Enter the controller reason above before creating a Draft.</p>}{adjustment.error&&<ReadError error={adjustment.error} onRetry={()=>{}}/>}</section>}
  {scopeMatches&&hasAuthorizedWorksheetEvidence&&<section className="card" aria-label="Reconciliation lifecycle command">
    <div className="card-head"><div><h2>Controlled lifecycle</h2><p className="muted sm">The API enforces statement revision, separation of duties, zero difference, exact cleared evidence, and immutable sign-off snapshots. This control never posts a Journal Entry.</p></div><span className="badge badge-muted">AUDITED COMMAND</span></div>
    {!transition?<StateBlock tone="empty" title="No lifecycle action available">The server returned a reconciliation state without a permitted controller transition.</StateBlock>:<><button type="button" className="btn btn-primary" disabled={commandInFlight||!reasonReady} onClick={runTransition}>{transition.label}</button>{!reasonReady&&<p className="muted sm">Enter a controller reason of at least eight characters before issuing a lifecycle command.</p>}</>}
    {transitionState.error&&<ReadError error={transitionState.error} onRetry={()=>{}}/>}
  </section>}
  {scopeMatches&&hasAuthorizedWorksheetEvidence&&worksheet.rows.filter(hasPostedAdjustmentEvidence).length>0&&<section className="card" aria-label="Posted adjustment clearance evidence">
    <div className="card-head"><div><h2>Posted adjustment clearance</h2><p className="muted sm">The API independently verified the exact bank source, Posted Journal Entry, ledger lines, source link, and verified-clean attachment before enabling these controls.</p></div><span className="badge badge-ok">SERVER VERIFIED</span></div>
    <div className="table-wrap authoritative-bank-evidence-table" role="region" tabIndex={0} aria-label="Posted adjustment clearance evidence; scroll horizontally to view every column"><table className="tbl"><thead><tr><th>Bank evidence</th><th>Posted Journal Entry</th><th>Clearance</th><th>Action</th></tr></thead><tbody>{worksheet.rows.filter(hasPostedAdjustmentEvidence).map(item=><tr key={`adjustment-clearance-${item.bank_source_id}`}><td><b>{item.external_bank_line_id}</b><div className="muted sm">{item.bank_source_id}</div></td><td>{item.adjustment_journal_entry_id}<div className="muted sm">POSTED · v{item.adjustment_journal_version}</div></td><td>{item.clearance_state}</td><td><button type="button" className="btn btn-sm" disabled={commandInFlight||!reasonReady||!canChangeItems} onClick={()=>setAdjustmentClearance(item,item.clearance_state!=='CLEARED')}>{item.clearance_state==='CLEARED'?'Unclear posted adjustment':'Clear posted adjustment'}</button></td></tr>)}</tbody></table></div>
    {!reasonReady&&<p className="muted sm">Enter the controller reason above before changing posted adjustment clearance.</p>}
  </section>}
</section>;
}

export function AuthoritativeBankWorkspace({config,fetcher=globalThis.fetch,environment=globalThis}){
  const [scope,setScope]=useState({bankAccountRef:'',from:'',through:''});
  const [state,setState]=useState({phase:'IDLE',rows:[],error:null,offset:0,readAt:null});
  const [selected,setSelected]=useState(null);
  const load=async(event,{preserveDetail=false,offset=0}={})=>{event?.preventDefault?.();if(!preserveDetail)setSelected(null);setState(current=>({...current,phase:'LOADING',error:null}));const result=await refreshAuthoritativeBankTransactions({config,bankAccountRef:scope.bankAccountRef,from:scope.from||null,through:scope.through||null,limit:100,offset,fetcher});const readAt=new Date().toISOString();setState(result.ok?{phase:'READY',rows:result.rows,error:null,offset,readAt}:{phase:'ERROR',rows:[],error:result,offset,readAt});if(preserveDetail&&result.ok)setSelected(current=>{if(!current)return current;const refreshed=result.rows.find(row=>row.bank_source_id===current.row.bank_source_id);return refreshed?{...current,row:refreshed}:null;});return result;};
  const openEvidence=(row,focusId)=>{
    const tableX=Number(environment?.document?.getElementById?.(focusId)?.closest?.('.table-wrap')?.scrollLeft)||0;
    const base=createAuthoritativeReturnContext({config,view:{...DEFAULT_AUTHORITATIVE_LIST_VIEW,from:scope.from,through:scope.through,offset:state.offset},focusId,scrollY:Number(environment?.scrollY)||0,tableX});
    if(base)setSelected({row,returnContext:{...base,bankAccountRef:scope.bankAccountRef}});
  };
  const closeEvidence=()=>{
    const context=selected?.returnContext;
    if(context?.bankAccountRef)setScope({bankAccountRef:context.bankAccountRef,from:context.view.from,through:context.view.through});
    if(Number.isSafeInteger(context?.view?.offset)&&context.view.offset>=0)setState(current=>({...current,offset:context.view.offset}));
    setSelected(null);
    restoreAuthoritativeReturnContext(environment,config,context,{getTable:()=>environment?.document?.getElementById?.(context?.focusId)?.closest?.('.table-wrap')});
  };
  if(selected)return <AuthoritativeBankDetail row={selected.row} scope={{...scope,entityId:config.entityId,entityLabel:entityLabel(config)}} onBack={closeEvidence} config={config} fetcher={fetcher} onMatchChanged={()=>load(null,{preserveDetail:true,offset:state.offset})}/>;
  return <AuthoritativeWorkspaceView area="Bank transactions" className="stack authoritative-bank-workspace"><AuthoritativeWorkspaceHeader eyebrow="BANKING" title="Bank transactions" description="Review bank activity for one account and date range."/>
    <form className="filterbar" onSubmit={load} aria-label="Bank transaction scope">
      <label>Bank account<input required maxLength={128} value={scope.bankAccountRef} onChange={event=>setScope(current=>({...current,bankAccountRef:event.target.value}))}/></label>
      <label>From<input type="date" value={scope.from} onChange={event=>setScope(current=>({...current,from:event.target.value}))}/></label>
      <label>Through<input type="date" value={scope.through} onChange={event=>setScope(current=>({...current,through:event.target.value}))}/></label>
      <button type="submit" className="btn btn-primary" disabled={state.phase==='LOADING'}>Refresh</button>
    </form>
    <p className="muted sm">{entityLabel(config)}</p>
    {state.phase==='IDLE'&&<StateBlock tone="empty" title="Choose a bank account">Add an optional date range, then refresh.</StateBlock>}
    {state.phase==='LOADING'&&<StateBlock tone="loading">Loading bank transactions…</StateBlock>}
    {state.phase==='ERROR'&&<BankReadFailure error={state.error} onRetry={load} subject="bank transactions"/>}
    {state.phase==='READY'&&<><AuthoritativeBankTable rows={state.rows} readAt={state.readAt} onOpen={openEvidence}/>{state.rows.length>0&&<BankReadMetadata count={state.rows.length} readAt={state.readAt} subject="Bank transactions"/>}<div className="button-row authoritative-bank-pagination" aria-label="Bank transaction pagination"><button type="button" className="btn btn-sm" disabled={state.phase==='LOADING'||state.offset===0} onClick={()=>load(null,{offset:Math.max(0,state.offset-100)})}>Previous page</button><span className="muted sm">Offset {state.offset}</span><button type="button" className="btn btn-sm" disabled={state.phase==='LOADING'||state.rows.length<100} onClick={()=>load(null,{offset:state.offset+100})}>Next page</button></div></>}
    <AuthoritativeSecondaryDisclosure label="External WBS evidence"><AuthoritativeWbsLivePilotObservation config={config} fetcher={fetcher} tools={WBS_LIVE_PILOT_SURFACE_TOOLS.bank} title="External WBS bank observations"/></AuthoritativeSecondaryDisclosure>
  </AuthoritativeWorkspaceView>;
}

export function AuthoritativeReconciliationWorkspace({config,fetcher=globalThis.fetch,environment=globalThis}){
  const [scope,setScope]=useState({bankAccountRef:'',statementEndingDate:''});
  const [scopeDiscovery,setScopeDiscovery]=useState({phase:'LOADING',rows:[],error:null});
  const [state,setState]=useState({phase:'IDLE',row:null,error:null,readAt:null});
  const [selected,setSelected]=useState(null);
  const loadScopes=async()=>{setScopeDiscovery({phase:'LOADING',rows:[],error:null});const result=await refreshAuthoritativeReconciliationScopes({config,fetcher});setScopeDiscovery(result.ok?{phase:'READY',rows:result.rows,error:null}:{phase:'ERROR',rows:[],error:result});return result;};
  useEffect(()=>{let active=true;(async()=>{const result=await refreshAuthoritativeReconciliationScopes({config,fetcher});if(active)setScopeDiscovery(result.ok?{phase:'READY',rows:result.rows,error:null}:{phase:'ERROR',rows:[],error:result});})();return()=>{active=false;};},[config,fetcher]);
  const readSummary=async({bankAccountRef,statementEndingDate},preserveDetail=false)=>{if(!preserveDetail)setSelected(null);setState(current=>({...current,phase:'LOADING',error:null}));const result=await refreshAuthoritativeReconciliation({config,bankAccountRef,statementEndingDate,fetcher});const readAt=new Date().toISOString();setState(result.ok?{phase:'READY',row:result.row,error:null,readAt}:{phase:'ERROR',row:null,error:result,readAt});if(preserveDetail&&result.ok)setSelected(current=>current&&result.row?{...current,row:result.row}:current);return result;};
  const load=async(event,{preserveDetail=false}={})=>{event?.preventDefault?.();return readSummary(scope,preserveDetail);};
  const handleAdmittedStarted=async row=>{const nextScope={bankAccountRef:row.bank_account_ref,statementEndingDate:row.statement_end_date};setScope(nextScope);await readSummary(nextScope,false);};
  const openEvidence=(row,focusId)=>{
    const base=createAuthoritativeReturnContext({config,view:DEFAULT_AUTHORITATIVE_LIST_VIEW,focusId,scrollY:Number(environment?.scrollY)||0});
    if(base)setSelected({row,returnContext:{...base,bankAccountRef:scope.bankAccountRef,statementEndingDate:scope.statementEndingDate}});
  };
  const closeEvidence=()=>{
    const context=selected?.returnContext;
    if(context?.bankAccountRef&&context?.statementEndingDate)setScope({bankAccountRef:context.bankAccountRef,statementEndingDate:context.statementEndingDate});
    setSelected(null);
    restoreAuthoritativeReturnContext(environment,config,context);
  };
  if(selected)return <AuthoritativeReconciliationDetail row={selected.row} scope={{...scope,entityId:config.entityId,entityLabel:entityLabel(config)}} onBack={closeEvidence} config={config} fetcher={fetcher} onChanged={()=>load(null,{preserveDetail:true})}/>;
  return <AuthoritativeWorkspaceView area="Reconcile" className="stack authoritative-reconciliation-workspace"><AuthoritativeWorkspaceHeader eyebrow="BANKING" title="Reconcile" description="Match the books to bank records."/>
    <section className="report-workbench authoritative-reconciliation-scope-picker" aria-label="Reconciliation history"><div className="report-workbench-head"><div><b>Reconciliation history</b><div className="page-subtitle">Choose an existing statement to review.</div></div><span className="badge badge-muted">READ ONLY</span></div>
      {scopeDiscovery.phase==='LOADING'&&<StateBlock tone="loading">Loading reconciliation history...</StateBlock>}
      {scopeDiscovery.phase==='ERROR'&&<BankReadFailure error={scopeDiscovery.error} onRetry={loadScopes} subject="reconciliation scopes"/>}
      {scopeDiscovery.phase==='READY'&&!scopeDiscovery.rows.length&&<StateBlock tone="empty" title="No reconciliations found">No Draft, review, reopened, or signed statement is available for this entity. You can still review an admitted statement below.</StateBlock>}
      {scopeDiscovery.phase==='READY'&&scopeDiscovery.rows.length>0&&<label>Existing statement<select aria-label="Existing reconciliation statement" value={scope.bankAccountRef&&scope.statementEndingDate?`${scope.bankAccountRef}|${scope.statementEndingDate}`:''} onChange={event=>{const row=scopeDiscovery.rows.find(item=>`${item.bank_account_ref}|${item.statement_ending_date}`===event.target.value);if(row)setScope({bankAccountRef:row.bank_account_ref,statementEndingDate:row.statement_ending_date});}}><option value="">Choose a retained reconciliation</option>{scopeDiscovery.rows.map(row=><option key={row.reconciliation_id} value={`${row.bank_account_ref}|${row.statement_ending_date}`}>{row.bank_account_ref} · {row.statement_ending_date} · {row.status}</option>)}</select></label>}
    </section>
    <form className="filterbar" onSubmit={load} aria-label="Reconciliation statement scope">
      <label>Bank account<input required maxLength={128} value={scope.bankAccountRef} onChange={event=>setScope(current=>({...current,bankAccountRef:event.target.value}))}/></label>
      <label>Statement ending date<input required type="date" value={scope.statementEndingDate} onChange={event=>setScope(current=>({...current,statementEndingDate:event.target.value}))}/></label>
      <button type="submit" className="btn btn-primary" disabled={state.phase==='LOADING'}>Load statement</button>
    </form>
    <AuthoritativeAdmittedStatements config={config} bankAccountRef={scope.bankAccountRef} fetcher={fetcher} onStarted={handleAdmittedStarted}/>
    {state.phase==='IDLE'&&<StateBlock tone="empty" title="Choose a statement">Select a bank account and statement ending date.</StateBlock>}
    {state.phase==='LOADING'&&<StateBlock tone="loading">Loading authoritative reconciliation evidence...</StateBlock>}
    {state.phase==='ERROR'&&<BankReadFailure error={state.error} onRetry={load} subject="reconciliation statements"/>}
    {state.phase==='READY'&&<AuthoritativeReconciliationSummary row={state.row} scope={{...scope,entityId:config.entityId,entityLabel:entityLabel(config)}} readAt={state.readAt} onOpen={openEvidence}/>}
  </AuthoritativeWorkspaceView>;
}
