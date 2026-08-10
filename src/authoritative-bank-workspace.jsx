import React, {useState} from 'react';
import {createAuthoritativeBankPaymentMatch,refreshAuthoritativeBankMatchCandidates,refreshAuthoritativeBankTransactions,refreshAuthoritativeReconciliation,refreshAuthoritativeReconciliationWorksheet,setAuthoritativeReconciliationClearance,unmatchAuthoritativeBankPayment} from './accounting-api.js';
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
  const loadWorksheet=async()=>{setWorksheet({phase:'LOADING',rows:[],error:null});const result=await refreshAuthoritativeReconciliationWorksheet({config,reconciliationId:row.reconciliation_id,fetcher});setWorksheet(result.ok?{phase:'READY',rows:result.rows,error:null}:{phase:'ERROR',rows:[],error:result});};
  const setClearance=async(item,clear)=>{setWorksheet(current=>({...current,phase:'COMMANDING',error:null}));const result=await setAuthoritativeReconciliationClearance({config,reconciliationId:row.reconciliation_id,reconciliationRevision:row.version,row:item,clear,reason,fetcher});if(result.ok){onChanged();await loadWorksheet();return;}setWorksheet(current=>({...current,phase:'READY',error:result}));};
  return <section className="full-bleed qbo-transaction-report" aria-label="Reconciliation statement detail">
  <div className="card-head"><div><button type="button" className="btn btn-sm" onClick={onBack}>Back to reconciliation evidence</button><h1>Statement ending {row.statement_ending_date}</h1><p className="muted sm">The worksheet is authoritative evidence. A controller may clear or unclear only a server-returned bank line; review, sign-off, adjustment, and posting remain separate commands.</p></div><span className="badge badge-muted">CONTROLLER REVIEW</span></div>
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
    <div className="card-head"><div><h2>Statement worksheet</h2><p className="muted sm">The API supplies the exact scoped bank line and active Match evidence. This screen cannot create a Match, sign off, reopen, create an adjustment, or post.</p></div><span className="badge badge-muted">SERVER EVIDENCE</span></div>
    {worksheet.phase==='IDLE'&&<button type="button" className="btn btn-sm" onClick={loadWorksheet}>Load reconciliation worksheet</button>}
    {worksheet.phase==='LOADING'&&<StateBlock tone="loading">Loading authoritative reconciliation worksheet...</StateBlock>}
    {worksheet.phase==='ERROR'&&<ReadError error={worksheet.error} onRetry={loadWorksheet}/>}
    {(worksheet.phase==='READY'||worksheet.phase==='COMMANDING')&&<><form className="filterbar" onSubmit={event=>event.preventDefault()}><label>Controller reason<input required minLength={8} maxLength={2000} value={reason} onChange={event=>setReason(event.target.value)}/></label></form>{!worksheet.rows.length?<StateBlock tone="empty" title="No worksheet items returned">This scoped empty result is not evidence of zero cash activity or a completed reconciliation.</StateBlock>:<div className="table-wrap"><table className="tbl"><thead><tr><th>Date</th><th>Bank evidence</th><th>Amount</th><th>Match</th><th>Clearance</th><th>Action</th></tr></thead><tbody>{worksheet.rows.map(item=><tr key={item.bank_source_id}><td>{item.transaction_date}</td><td><b>{item.external_bank_line_id}</b><div className="muted sm">{item.bank_source_id}</div></td><td className="num">{money(item.amount)} {item.currency}</td><td>{item.match_status==='ACTIVE'?<><b>ACTIVE</b><div className="muted sm">JE {item.journal_entry_id}</div></>:'No exact active Match'}</td><td>{item.clearance_state}</td><td>{item.clearance_state==='CLEARED'?<button type="button" className="btn btn-sm" disabled={worksheet.phase==='COMMANDING'} onClick={()=>setClearance(item,false)}>Unclear</button>:item.match_status==='ACTIVE'?<button type="button" className="btn btn-sm" disabled={worksheet.phase==='COMMANDING'} onClick={()=>setClearance(item,true)}>Clear matched item</button>:<span className="muted sm">Blocked</span>}</td></tr>)}</tbody></table></div>}{worksheet.error&&<ReadError error={worksheet.error} onRetry={loadWorksheet}/>}</>}
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
  const load=async event=>{event?.preventDefault?.();setSelected(null);setState(current=>({...current,phase:'LOADING',error:null}));const result=await refreshAuthoritativeReconciliation({config,bankAccountRef:scope.bankAccountRef,statementEndingDate:scope.statementEndingDate,fetcher});setState(result.ok?{phase:'READY',row:result.row,error:null}:{phase:'ERROR',row:null,error:result});};
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
  if(selected)return <AuthoritativeReconciliationDetail row={selected.row} scope={{...scope,entityId:config.entityId}} onBack={closeEvidence} config={config} fetcher={fetcher} onChanged={load}/>;
  return <div className="stack"><div><h1>Reconciliation evidence</h1><p className="page-subtitle">One authoritative statement cutoff for one entity and bank account. No reconciliation mutation is available.</p></div>
    <form className="filterbar" onSubmit={load} aria-label="Reconciliation statement scope">
      <label>Bank account<input required maxLength={128} value={scope.bankAccountRef} onChange={event=>setScope(current=>({...current,bankAccountRef:event.target.value}))}/></label>
      <label>Statement ending date<input required type="date" value={scope.statementEndingDate} onChange={event=>setScope(current=>({...current,statementEndingDate:event.target.value}))}/></label>
      <button type="submit" className="btn btn-primary" disabled={state.phase==='LOADING'}>Load statement</button>
    </form>
    <p className="muted sm">Entity {config.entityId}. The API rejects missing or cross-scope statement evidence.</p>
    {state.phase==='IDLE'&&<StateBlock tone="empty" title="No read requested yet">Choose one bank account and statement ending date to read reconciliation evidence.</StateBlock>}
    {state.phase==='LOADING'&&<StateBlock tone="loading">Loading authoritative reconciliation evidence...</StateBlock>}
    {state.phase==='ERROR'&&<ReadError error={state.error} onRetry={load}/>} 
    {state.phase==='READY'&&<AuthoritativeReconciliationSummary row={state.row} onOpen={openEvidence}/>}
  </div>;
}
