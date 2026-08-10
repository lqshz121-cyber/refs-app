import React, {useState} from 'react';
import {refreshAuthoritativeBankTransactions,refreshAuthoritativeReconciliation} from './accounting-api.js';
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

export const AuthoritativeBankDetail=({row,scope,onBack})=><section className="full-bleed qbo-transaction-report" aria-label="Bank transaction detail">
  <div className="card-head"><div><button type="button" className="btn btn-sm" onClick={onBack}>Back to bank transactions</button><h1>{row.external_bank_line_id}</h1><p className="muted sm">Independent, read-only evidence detail. Matching, clearing, categorizing, posting, and deletion are unavailable.</p></div><span className="badge badge-muted">READ ONLY</span></div>
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

export const AuthoritativeReconciliationDetail=({row,scope,onBack})=><section className="full-bleed qbo-transaction-report" aria-label="Reconciliation statement detail">
  <div className="card-head"><div><button type="button" className="btn btn-sm" onClick={onBack}>Back to reconciliation evidence</button><h1>Statement ending {row.statement_ending_date}</h1><p className="muted sm">Independent statement evidence. Matching, clearing, reopening, sign-off, adjustment, and posting are unavailable.</p></div><span className="badge badge-muted">READ ONLY</span></div>
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
  <p className="muted sm">Scope: entity {scope.entityId}; account {scope.bankAccountRef}; statement cutoff {scope.statementEndingDate}.</p>
</section>;

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
  if(selected)return <AuthoritativeBankDetail row={selected.row} scope={{...scope,entityId:config.entityId}} onBack={closeEvidence}/>;
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
  if(selected)return <AuthoritativeReconciliationDetail row={selected.row} scope={{...scope,entityId:config.entityId}} onBack={closeEvidence}/>;
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
