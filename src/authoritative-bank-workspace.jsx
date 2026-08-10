import React, {useState} from 'react';
import {createAuthoritativeBankPaymentMatch,createAuthoritativeReconciliationAdjustmentDraft,refreshAuthoritativeBankMatchCandidates,refreshAuthoritativeBankTransactions,refreshAuthoritativeReconciliation,refreshAuthoritativeReconciliationWorksheet,setAuthoritativeReconciliationAdjustmentClearance,setAuthoritativeReconciliationClearance,startAuthoritativeReconciliation,transitionAuthoritativeReconciliation,unmatchAuthoritativeBankPayment} from './accounting-api.js';
import {StateBlock} from './ui.jsx';
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

const ReadError=({error,onRetry})=><StateBlock tone="error" title={error?.code||'ACCOUNTING_API_UNAVAILABLE'}
  actions={<button type="button" className="btn btn-sm" onClick={onRetry}>Retry read</button>}>
  <p>{error?.message||'The authoritative read could not be completed.'}</p>
</StateBlock>;

export const AuthoritativeBankTable=({rows=[],onOpen=()=>{}})=><section className="card" aria-label="Authoritative bank transaction evidence">
  <div className="card-head"><div><h2>Bank transactions</h2><p className="muted sm">Read-only source and retained match evidence from the accounting API.</p></div><span className="badge badge-muted">READ ONLY</span></div>
  {!rows.length?<StateBlock tone="empty" title="No bank transactions returned">No bank transactions were returned for this account and date scope. This scoped empty result is not evidence of zero cash activity, zero ledger activity, or a completed reconciliation.</StateBlock>:<div className="table-wrap"><table className="tbl">
    <thead><tr><th>Date</th><th>Source</th><th>Type</th><th>Amount</th><th>Match evidence</th><th>Version</th><th>Evidence</th></tr></thead>
    <tbody>{rows.map(row=><tr key={row.bank_source_id}>
      <td>{row.transaction_date}</td><td><b>{row.external_bank_line_id}</b><div className="muted sm">{row.source_ref}</div></td>
      <td>{row.document_type}</td><td className="num">{money(row.amount)} <span className="muted sm">{row.currency}</span></td>
      <td>{row.match_status||'Unmatched'}{row.journal_entry_id&&<div className="muted sm">Journal {row.journal_entry_id}</div>}</td><td>{row.version}</td>
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
  if(row.bank_match_id)return <section className="card" aria-label="Bank match correction"><div className="card-head"><div><h2>Active Match correction</h2><p className="muted sm">Unmatch preserves the immutable evidence and requires a controller reason. It cannot reverse or post a journal.</p></div><span className="badge badge-muted">CONTROLLER</span></div><form className="filterbar" onSubmit={unmatch}><label>Correction reason<input required minLength={8} maxLength={2000} value={reason} onChange={event=>setReason(event.target.value)}/></label><button type="submit" className="btn btn-sm" disabled={candidateState.phase==='COMMANDING'}>Unmatch evidence</button></form>{candidateState.error&&<ReadError error={candidateState.error} onRetry={()=>{}}/>}</section>;
  const candidate=candidateState.candidates[0];
  return <section className="card" aria-label="Bank match candidate review"><div className="card-head"><div><h2>Exact POSTED Match candidate</h2><p className="muted sm">Candidates are server-validated against posted AP/AR cash, account, currency, amount, date, source and ledger evidence. Zero or multiple candidates stop the command.</p></div><span className="badge badge-muted">CONTROLLER</span></div>{candidateState.phase==='IDLE'&&<button type="button" className="btn btn-sm" onClick={loadCandidates}>Load exact candidate</button>}{candidateState.phase==='LOADING'&&<StateBlock tone="loading">Reading exact POSTED match evidence...</StateBlock>}{candidateState.phase==='ERROR'&&<ReadError error={candidateState.error} onRetry={loadCandidates}/>} {candidateState.phase==='READY'&&candidateState.candidates.length!==1&&<StateBlock tone="empty" title="Match blocked">This bank transaction has {candidateState.candidates.length===0?'no':'multiple'} exact POSTED candidate{candidateState.candidates.length===1?'':'s'}. No Match command is available.</StateBlock>}{candidateState.phase==='READY'&&candidateState.candidates.length===1&&<><div className="qbo-toolgrid"><span><i>Occurrence</i><b>{candidate.occurrence_kind}</b></span><span><i>Occurrence ID</i><b>{candidate.payment_occurrence_id}</b></span><span><i>Amount</i><b>{money(candidate.amount)} {candidate.currency}</b></span><span><i>Accounting date</i><b>{candidate.accounting_date}</b></span><span><i>Journal entry</i><b>{candidate.journal_entry_id}</b></span><span><i>Ledger line</i><b>{candidate.ledger_line_id}</b></span></div><form className="filterbar" onSubmit={createMatch}><label>Review reason<input required minLength={8} maxLength={2000} value={reason} onChange={event=>setReason(event.target.value)}/></label><button type="submit" className="btn btn-primary" disabled={candidateState.phase==='COMMANDING'}>Create reviewed Match</button></form>{candidateState.error&&<ReadError error={candidateState.error} onRetry={loadCandidates}/>}</>}</section>;
}

export const AuthoritativeBankDetail=({row,scope,onBack,config,fetcher,onMatchChanged})=><section className="full-bleed qbo-transaction-report" aria-label="Bank transaction detail">
  <div className="card-head"><div><button type="button" className="btn btn-sm" onClick={onBack}>Back to bank transactions</button><h1>{row.external_bank_line_id}</h1><p className="muted sm">Independent source evidence. Only a controller may create or correct a server-validated Match; clearing, categorizing, posting, and deletion are unavailable.</p></div><span className="badge badge-muted">READ ONLY</span></div>
  <div className="qbo-toolgrid">
    <span><i>Bank account</i><b>{row.bank_account_ref}</b></span><span><i>Transaction date</i><b>{row.transaction_date}</b></span>
    <span><i>Amount</i><b>{money(row.amount)} {row.currency}</b></span><span><i>Type</i><b>{row.document_type}</b></span>
    <span><i>Match evidence</i><b>{row.match_status||'Unmatched'}</b></span><span><i>Version</i><b>{row.version}</b></span>
  </div>
  <div className="qbo-toolgrid">
    <span><i>Bank source ID</i><b>{row.bank_source_id}</b></span><span><i>Source reference</i><b>{row.source_ref||'Unavailable'}</b></span>
    <span><i>Source document</i><b>{row.source_document_id||'Unavailable'}</b></span><span><i>Journal entry</i><b>{row.journal_entry_id||'Unavailable'}</b></span>
  </div>
  {row.bank_match_id&&<div className="qbo-toolgrid">
    <span><i>Bank match ID</i><b>{row.bank_match_id}</b></span><span><i>Business source document</i><b>{row.business_source_document_id}</b></span>
    <span><i>Journal line</i><b>{row.journal_line_id||'Unavailable'}</b></span><span><i>Candidate rule</i><b>{row.candidate_rule_code||'Unavailable'}</b></span>
    <span><i>Amount delta</i><b>{money(row.amount_delta)}</b></span><span><i>Currency match</i><b>{String(row.currency_match)}</b></span>
    <span><i>Date delta days</i><b>{row.date_delta_days??'Unavailable'}</b></span><span><i>Match version</i><b>{row.match_version}</b></span>
    <span><i>Matched by</i><b>{row.matched_by}</b></span><span><i>Matched at</i><b>{row.matched_at}</b></span>
  </div>}
  {config&&<AuthoritativeBankMatchReview row={row} config={config} fetcher={fetcher} onChanged={onMatchChanged}/>}
  <p className="muted sm">Scope: entity {scope.entityId}; account {scope.bankAccountRef}; from {scope.from||'opening'} through {scope.through||'latest'}.</p>
</section>;

export const AuthoritativeReconciliationSummary=({row=null,onOpen=()=>{}})=><section className="card" aria-label="Authoritative reconciliation evidence">
  <div className="card-head"><div><h2>Reconciliation statement</h2><p className="muted sm">Statement-scoped evidence only. This page cannot match, clear, reopen, sign off, or post.</p></div><span className="badge badge-muted">READ ONLY</span></div>
  {!row?<StateBlock tone="empty" title="No reconciliation statement returned">No reconciliation statement was returned for this account and cutoff. This scoped empty result is not evidence of zero statement activity, zero difference, review, or sign-off.</StateBlock>:<>
    <div className="qbo-toolgrid"><span><i>Status</i><b>{row.status}</b></span><span><i>Statement ending balance</i><b>{money(row.statement_ending_balance)}</b></span><span><i>Statement activity</i><b>{money(row.statement_activity_amount)}</b></span><span><i>Difference</i><b>{money(row.difference)}</b></span></div>
    <div className="qbo-toolgrid"><span><i>Bank transactions</i><b>{row.bank_transaction_count}</b></span><span><i>Active matches</i><b>{row.active_match_count}</b></span><span><i>Unmatched</i><b>{row.unmatched_transaction_count}</b></span><span><i>Version</i><b>{row.version}</b></span></div>
    <button id={`authoritative-reconciliation-${row.reconciliation_id}`} type="button" className="btn btn-sm" onClick={()=>onOpen(row,`authoritative-reconciliation-${row.reconciliation_id}`)}>Open statement detail</button>
  </>}
</section>;

export function AuthoritativeReconciliationDetail({row,scope,onBack,config,fetcher,onChanged=()=>{}}){
  const [worksheet,setWorksheet]=useState({phase:'IDLE',rows:[],error:null});
  const [reason,setReason]=useState('');
  const [transitionState,setTransitionState]=useState({phase:'IDLE',error:null});
  const [adjustment,setAdjustment]=useState({item:null,journalNumber:'',journalDate:'',offsetAccountCode:'',description:'',attachmentIds:'',phase:'IDLE',error:null});
  const reasonReady=reason.trim().length>=8;
  const transitionByStatus={DRAFT:{action:'REVIEW',label:'Send to independent review'},IN_REVIEW:{action:'SIGN_OFF',label:'Sign off reviewed statement'},RECONCILED:{action:'REOPEN',label:'Reopen signed statement'}};
  const transition=transitionByStatus[row.status]||null;
  const canChangeItems=['DRAFT','REOPENED'].includes(row.status);
  const loadWorksheet=async()=>{setWorksheet({phase:'LOADING',rows:[],error:null});const result=await refreshAuthoritativeReconciliationWorksheet({config,reconciliationId:row.reconciliation_id,fetcher});setWorksheet(result.ok?{phase:'READY',rows:result.rows,error:null}:{phase:'ERROR',rows:[],error:result});};
  const setClearance=async(item,clear)=>{setWorksheet(current=>({...current,phase:'COMMANDING',error:null}));const result=await setAuthoritativeReconciliationClearance({config,reconciliationId:row.reconciliation_id,reconciliationRevision:row.version,row:item,clear,reason,fetcher});if(result.ok){onChanged();await loadWorksheet();return;}setWorksheet(current=>({...current,phase:'READY',error:result}));};
  const setAdjustmentClearance=async(item,clear)=>{setWorksheet(current=>({...current,phase:'COMMANDING',error:null}));const result=await setAuthoritativeReconciliationAdjustmentClearance({config,reconciliationId:row.reconciliation_id,reconciliationRevision:row.version,row:item,clear,reason,fetcher});if(result.ok){onChanged();await loadWorksheet();return;}setWorksheet(current=>({...current,phase:'READY',error:result}));};
  const selectAdjustmentItem=item=>setAdjustment({item,journalNumber:'',journalDate:item.transaction_date,offsetAccountCode:'',description:`Reconciliation adjustment for ${item.external_bank_line_id}`,attachmentIds:'',phase:'READY',error:null});
  const createAdjustment=async event=>{event.preventDefault();const attachmentIds=adjustment.attachmentIds.split(',').map(value=>value.trim()).filter(Boolean);setAdjustment(current=>({...current,phase:'COMMANDING',error:null}));const result=await createAuthoritativeReconciliationAdjustmentDraft({config,reconciliationId:row.reconciliation_id,reconciliationRevision:row.version,row:adjustment.item,journalNumber:adjustment.journalNumber,journalDate:adjustment.journalDate,offsetAccountCode:adjustment.offsetAccountCode,description:adjustment.description,attachmentIds,reason,fetcher});if(result.ok){onChanged();await loadWorksheet();return;}setAdjustment(current=>({...current,phase:'READY',error:result}));};
  const runTransition=async()=>{if(!transition||!reasonReady)return;setTransitionState({phase:'COMMANDING',error:null});const result=await transitionAuthoritativeReconciliation({config,reconciliationId:row.reconciliation_id,revision:row.version,action:transition.action,reason,fetcher});if(result.ok){onChanged();return;}setTransitionState({phase:'READY',error:result});};
  const commandInFlight=worksheet.phase==='COMMANDING'||transitionState.phase==='COMMANDING';
  return <section className="full-bleed qbo-transaction-report" aria-label="Reconciliation statement detail">
  <div className="card-head"><div><button type="button" className="btn btn-sm" onClick={onBack}>Back to reconciliation evidence</button><h1>Statement ending {row.statement_ending_date}</h1><p className="muted sm">The worksheet is authoritative evidence. A controller may clear or unclear only a server-returned bank line; review, sign-off, and reopen are separately audited commands. An adjustment may create only a Draft Journal Entry; independent workflow approval and posting remain outside this screen.</p></div><span className="badge badge-muted">CONTROLLER REVIEW</span></div>
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
  <section className="card" aria-label="Reconciliation worksheet">
    <div className="card-head"><div><h2>Statement worksheet</h2><p className="muted sm">The API supplies the exact scoped bank line and active Match evidence. This worksheet cannot create a Match, adjustment, or post a Journal Entry.</p></div><span className="badge badge-muted">SERVER EVIDENCE</span></div>
    {worksheet.phase==='IDLE'&&<button type="button" className="btn btn-sm" onClick={loadWorksheet}>Load reconciliation worksheet</button>}
    {worksheet.phase==='LOADING'&&<StateBlock tone="loading">Loading authoritative reconciliation worksheet...</StateBlock>}
    {worksheet.phase==='ERROR'&&<ReadError error={worksheet.error} onRetry={loadWorksheet}/>}
    {(worksheet.phase==='READY'||worksheet.phase==='COMMANDING')&&<><form className="filterbar" onSubmit={event=>event.preventDefault()}><label>Controller reason<input required minLength={8} maxLength={2000} value={reason} onChange={event=>setReason(event.target.value)}/></label></form>{!worksheet.rows.length?<StateBlock tone="empty" title="No worksheet items returned">This scoped empty result is not evidence of zero cash activity or a completed reconciliation.</StateBlock>:<div className="table-wrap"><table className="tbl"><thead><tr><th>Date</th><th>Bank evidence</th><th>Amount</th><th>Match</th><th>Clearance</th><th>Action</th></tr></thead><tbody>{worksheet.rows.map(item=><tr key={item.bank_source_id}><td>{item.transaction_date}</td><td><b>{item.external_bank_line_id}</b><div className="muted sm">{item.bank_source_id}</div></td><td className="num">{money(item.amount)} {item.currency}</td><td>{item.match_status==='ACTIVE'?<><b>ACTIVE</b><div className="muted sm">JE {item.journal_entry_id}</div></>:'No exact active Match'}</td><td>{item.clearance_state}</td><td>{item.clearance_state==='CLEARED'?<button type="button" className="btn btn-sm" disabled={commandInFlight||!reasonReady||!canChangeItems} onClick={()=>item.match_status==='ACTIVE'?setClearance(item,false):setAdjustmentClearance(item,false)}>Unclear</button>:item.match_status==='ACTIVE'?<button type="button" className="btn btn-sm" disabled={commandInFlight||!reasonReady||!canChangeItems} onClick={()=>setClearance(item,true)}>Clear matched item</button>:<div className="button-row"><button type="button" className="btn btn-sm" disabled={commandInFlight||!reasonReady||!canChangeItems} onClick={()=>selectAdjustmentItem(item)}>Prepare adjustment Draft</button><button type="button" className="btn btn-sm btn-ghost" disabled={commandInFlight||!reasonReady||!canChangeItems} onClick={()=>setAdjustmentClearance(item,true)}>Clear Posted adjustment</button></div>}</td></tr>)}</tbody></table></div>}{worksheet.error&&<ReadError error={worksheet.error} onRetry={loadWorksheet}/>}</>}
  </section>
  {adjustment.item&&<section className="card" aria-label="Create reconciliation adjustment Draft"><div className="card-head"><div><h2>Create controlled adjustment Draft</h2><p className="muted sm">This request binds the selected bank source, current statement revision, configured cash account, exact four-decimal source amount, a supplied offset account, and verified-clean attachment IDs. It cannot approve or post a Journal Entry.</p></div><span className="badge badge-muted">DRAFT ONLY</span></div><p className="muted sm">Selected bank source {adjustment.item.external_bank_line_id} · {money(adjustment.item.amount)} {adjustment.item.currency} · {adjustment.item.bank_source_id}</p><form className="filterbar" onSubmit={createAdjustment}><label>Journal number<input required maxLength={128} value={adjustment.journalNumber} onChange={event=>setAdjustment(current=>({...current,journalNumber:event.target.value}))}/></label><label>Journal date<input required type="date" value={adjustment.journalDate} onChange={event=>setAdjustment(current=>({...current,journalDate:event.target.value}))}/></label><label>Offset account code<input required maxLength={64} value={adjustment.offsetAccountCode} onChange={event=>setAdjustment(current=>({...current,offsetAccountCode:event.target.value}))}/></label><label>Verified-clean attachment IDs<input required value={adjustment.attachmentIds} onChange={event=>setAdjustment(current=>({...current,attachmentIds:event.target.value}))} placeholder="UUID, UUID"/></label><label>Description<input maxLength={2000} value={adjustment.description} onChange={event=>setAdjustment(current=>({...current,description:event.target.value}))}/></label><button type="submit" className="btn btn-primary" disabled={commandInFlight||!reasonReady||adjustment.phase==='COMMANDING'}>Create adjustment Draft</button><button type="button" className="btn btn-sm" disabled={commandInFlight||adjustment.phase==='COMMANDING'} onClick={()=>setAdjustment(current=>({...current,item:null,error:null}))}>Cancel</button></form>{!reasonReady&&<p className="muted sm">Enter the controller reason above before creating a Draft.</p>}{adjustment.error&&<ReadError error={adjustment.error} onRetry={()=>{}}/>}</section>}
  <section className="card" aria-label="Reconciliation lifecycle command">
    <div className="card-head"><div><h2>Controlled lifecycle</h2><p className="muted sm">The API enforces statement revision, separation of duties, zero difference, exact cleared evidence, and immutable sign-off snapshots. This control never posts a Journal Entry.</p></div><span className="badge badge-muted">AUDITED COMMAND</span></div>
    {!transition?<StateBlock tone="empty" title="No lifecycle action available">The server returned a reconciliation state without a permitted controller transition.</StateBlock>:<><button type="button" className="btn btn-primary" disabled={commandInFlight||!reasonReady} onClick={runTransition}>{transition.label}</button>{!reasonReady&&<p className="muted sm">Enter a controller reason of at least eight characters before issuing a lifecycle command.</p>}</>}
    {transitionState.error&&<ReadError error={transitionState.error} onRetry={()=>{}}/>}
  </section>
  <p className="muted sm">Scope: entity {scope.entityId}; account {scope.bankAccountRef}; statement cutoff {scope.statementEndingDate}.</p>
</section>;
}

export function AuthoritativeBankWorkspace({config,fetcher=globalThis.fetch,environment=globalThis}){
  const [scope,setScope]=useState({bankAccountRef:'',from:'',through:''});
  const [state,setState]=useState({phase:'IDLE',rows:[],error:null});
  const [selected,setSelected]=useState(null);
  const load=async event=>{event?.preventDefault?.();setSelected(null);setState(current=>({...current,phase:'LOADING',error:null}));const result=await refreshAuthoritativeBankTransactions({config,bankAccountRef:scope.bankAccountRef,from:scope.from||null,through:scope.through||null,limit:100,fetcher});setState(result.ok?{phase:'READY',rows:result.rows,error:null}:{phase:'ERROR',rows:[],error:result});};
  const openEvidence=(row,focusId)=>{
    const base=createAuthoritativeReturnContext({config,view:{...DEFAULT_AUTHORITATIVE_LIST_VIEW,from:scope.from,through:scope.through},focusId,scrollY:Number(environment?.scrollY)||0});
    if(base)setSelected({row,returnContext:{...base,bankAccountRef:scope.bankAccountRef}});
  };
  const closeEvidence=()=>{
    const context=selected?.returnContext;
    if(context?.bankAccountRef)setScope({bankAccountRef:context.bankAccountRef,from:context.view.from,through:context.view.through});
    setSelected(null);
    restoreAuthoritativeReturnContext(environment,config,context);
  };
  if(selected)return <AuthoritativeBankDetail row={selected.row} scope={{...scope,entityId:config.entityId}} onBack={closeEvidence} config={config} fetcher={fetcher} onMatchChanged={()=>load()}/>;
  return <div className="stack"><div><h1>Bank transaction evidence</h1><p className="page-subtitle">Entity-scoped, OIDC-authenticated records only. Browser seeds and local storage are never used.</p></div>
    <form className="filterbar" onSubmit={load} aria-label="Bank transaction scope">
      <label>Bank account<input required maxLength={128} value={scope.bankAccountRef} onChange={event=>setScope(current=>({...current,bankAccountRef:event.target.value}))}/></label>
      <label>From<input type="date" value={scope.from} onChange={event=>setScope(current=>({...current,from:event.target.value}))}/></label>
      <label>Through<input type="date" value={scope.through} onChange={event=>setScope(current=>({...current,through:event.target.value}))}/></label>
      <button type="submit" className="btn btn-primary" disabled={state.phase==='LOADING'}>Load evidence</button>
    </form>
    <p className="muted sm">Entity {config.entityId}. Account and date scope are required at the API boundary.</p>
    {state.phase==='IDLE'&&<StateBlock tone="empty" title="No read requested yet">Choose one bank account and an optional date range to read authoritative evidence.</StateBlock>}
    {state.phase==='LOADING'&&<StateBlock tone="loading">Loading authoritative bank transaction evidence...</StateBlock>}
    {state.phase==='ERROR'&&<ReadError error={state.error} onRetry={load}/>} 
    {state.phase==='READY'&&<AuthoritativeBankTable rows={state.rows} onOpen={openEvidence}/>}
  </div>;
}

export function AuthoritativeReconciliationWorkspace({config,fetcher=globalThis.fetch,environment=globalThis}){
  const [scope,setScope]=useState({bankAccountRef:'',statementEndingDate:''});
  const [state,setState]=useState({phase:'IDLE',row:null,error:null});
  const [selected,setSelected]=useState(null);
  const [start,setStart]=useState({statementOpeningBalance:'',statementEndingBalance:'',reason:''});
  const [startState,setStartState]=useState({phase:'IDLE',error:null});
  const load=async(event,{preserveDetail=false}={})=>{event?.preventDefault?.();if(!preserveDetail)setSelected(null);setState(current=>({...current,phase:'LOADING',error:null}));const result=await refreshAuthoritativeReconciliation({config,bankAccountRef:scope.bankAccountRef,statementEndingDate:scope.statementEndingDate,fetcher});setState(result.ok?{phase:'READY',row:result.row,error:null}:{phase:'ERROR',row:null,error:result});if(preserveDetail&&result.ok)setSelected(current=>current&&result.row?{...current,row:result.row}:current);};
  const startStatement=async event=>{event.preventDefault();setStartState({phase:'COMMANDING',error:null});const result=await startAuthoritativeReconciliation({config,bankAccountRef:scope.bankAccountRef,statementEndingDate:scope.statementEndingDate,statementOpeningBalance:start.statementOpeningBalance,statementEndingBalance:start.statementEndingBalance,reason:start.reason,fetcher});if(result.ok){setStart({statementOpeningBalance:'',statementEndingBalance:'',reason:''});await load();return;}setStartState({phase:'READY',error:result});};
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
  if(selected)return <AuthoritativeReconciliationDetail row={selected.row} scope={{...scope,entityId:config.entityId}} onBack={closeEvidence} config={config} fetcher={fetcher} onChanged={()=>load(null,{preserveDetail:true})}/>;
  return <div className="stack"><div><h1>Reconciliation evidence</h1><p className="page-subtitle">One authoritative statement cutoff for one entity and bank account. Lifecycle commands are controller-gated, revision-bound, idempotent, and audited by the accounting API.</p></div>
    <form className="filterbar" onSubmit={load} aria-label="Reconciliation statement scope">
      <label>Bank account<input required maxLength={128} value={scope.bankAccountRef} onChange={event=>setScope(current=>({...current,bankAccountRef:event.target.value}))}/></label>
      <label>Statement ending date<input required type="date" value={scope.statementEndingDate} onChange={event=>setScope(current=>({...current,statementEndingDate:event.target.value}))}/></label>
      <button type="submit" className="btn btn-primary" disabled={state.phase==='LOADING'}>Load statement</button>
    </form>
    <p className="muted sm">Entity {config.entityId}. The API rejects missing or cross-scope statement evidence.</p>
    {state.phase==='IDLE'&&<StateBlock tone="empty" title="No read requested yet">Choose one bank account and statement ending date to read reconciliation evidence.</StateBlock>}
    {state.phase==='LOADING'&&<StateBlock tone="loading">Loading authoritative reconciliation evidence...</StateBlock>}
    {state.phase==='ERROR'&&<ReadError error={state.error} onRetry={load}/>} 
    {state.phase==='READY'&&<><AuthoritativeReconciliationSummary row={state.row} onOpen={openEvidence}/>{!state.row&&<section className="card" aria-label="Start reconciliation"><div className="card-head"><div><h2>Start controlled reconciliation</h2><p className="muted sm">Creates only a DRAFT statement scope. It cannot clear items, sign off, create an adjustment, or post a Journal Entry.</p></div><span className="badge badge-muted">CONTROLLER</span></div><form className="filterbar" onSubmit={startStatement}><label>Statement opening balance<input required inputMode="decimal" pattern="-?(?:0|[1-9][0-9]{0,15})\\.[0-9]{4}" value={start.statementOpeningBalance} onChange={event=>setStart(current=>({...current,statementOpeningBalance:event.target.value}))} placeholder="0.0000"/></label><label>Statement ending balance<input required inputMode="decimal" pattern="-?(?:0|[1-9][0-9]{0,15})\\.[0-9]{4}" value={start.statementEndingBalance} onChange={event=>setStart(current=>({...current,statementEndingBalance:event.target.value}))} placeholder="0.0000"/></label><label>Controller reason<input required minLength={8} maxLength={2000} value={start.reason} onChange={event=>setStart(current=>({...current,reason:event.target.value}))}/></label><button type="submit" className="btn btn-primary" disabled={startState.phase==='COMMANDING'}>Start DRAFT reconciliation</button></form>{startState.error&&<ReadError error={startState.error} onRetry={()=>{}}/>}</section>}</>}
  </div>;
}
