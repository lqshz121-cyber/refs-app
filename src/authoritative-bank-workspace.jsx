import React, {useState} from 'react';
import {refreshAuthoritativeBankTransactions,refreshAuthoritativeReconciliation} from './accounting-api.js';

const money=value=>Number(value||0).toLocaleString('en-US',{style:'currency',currency:'USD'});

const ReadError=({error,onRetry})=><div className="empty" role="alert">
  <b>{error?.code||'ACCOUNTING_API_UNAVAILABLE'}</b>
  <p>{error?.message||'The authoritative read could not be completed.'}</p>
  <button type="button" className="btn btn-sm" onClick={onRetry}>Retry read</button>
</div>;

export const AuthoritativeBankTable=({rows=[]})=><section className="card" aria-label="Authoritative bank transaction evidence">
  <div className="card-head"><div><h2>Bank transactions</h2><p className="muted sm">Read-only source and retained match evidence from the accounting API.</p></div><span className="badge badge-muted">READ ONLY</span></div>
  {!rows.length?<div className="empty">No bank transactions were returned for this account and date scope.</div>:<div className="table-wrap"><table className="tbl">
    <thead><tr><th>Date</th><th>Source</th><th>Type</th><th>Amount</th><th>Match evidence</th><th>Version</th></tr></thead>
    <tbody>{rows.map(row=><tr key={row.bank_source_id}>
      <td>{row.transaction_date}</td>
      <td><b>{row.external_bank_line_id}</b><div className="muted sm">{row.source_ref}</div></td>
      <td>{row.document_type}</td>
      <td className="num">{money(row.amount)} <span className="muted sm">{row.currency}</span></td>
      <td>{row.match_status||'Unmatched'}{row.journal_entry_id&&<div className="muted sm">Journal {row.journal_entry_id}</div>}</td>
      <td>{row.version}</td>
    </tr>)}</tbody>
  </table></div>}
</section>;

export const AuthoritativeReconciliationSummary=({row=null})=><section className="card" aria-label="Authoritative reconciliation evidence">
  <div className="card-head"><div><h2>Reconciliation statement</h2><p className="muted sm">Statement-scoped evidence only. This page cannot match, clear, reopen, sign off, or post.</p></div><span className="badge badge-muted">READ ONLY</span></div>
  {!row?<div className="empty">No reconciliation statement was returned for this account and cutoff.</div>:<>
    <div className="qbo-toolgrid">
      <span><i>Status</i><b>{row.status}</b></span><span><i>Statement ending balance</i><b>{money(row.statement_ending_balance)}</b></span>
      <span><i>Statement activity</i><b>{money(row.statement_activity_amount)}</b></span><span><i>Difference</i><b>{money(row.difference)}</b></span>
    </div>
    <div className="qbo-toolgrid">
      <span><i>Bank transactions</i><b>{row.bank_transaction_count}</b></span><span><i>Active matches</i><b>{row.active_match_count}</b></span>
      <span><i>Unmatched</i><b>{row.unmatched_transaction_count}</b></span><span><i>Version</i><b>{row.version}</b></span>
    </div>
  </>}
</section>;

export function AuthoritativeBankWorkspace({config,fetcher=globalThis.fetch}){
  const [scope,setScope]=useState({bankAccountRef:'',from:'',through:''});
  const [state,setState]=useState({phase:'IDLE',rows:[],error:null});
  const load=async event=>{event?.preventDefault?.();setState(current=>({...current,phase:'LOADING',error:null}));const result=await refreshAuthoritativeBankTransactions({config,bankAccountRef:scope.bankAccountRef,from:scope.from||null,through:scope.through||null,limit:100,fetcher});setState(result.ok?{phase:'READY',rows:result.rows,error:null}:{phase:'ERROR',rows:[],error:result});};
  return <div className="stack"><div><h1>Bank transaction evidence</h1><p className="page-subtitle">Entity-scoped, OIDC-authenticated records only. Browser seeds and local storage are never used.</p></div>
    <form className="filterbar" onSubmit={load} aria-label="Bank transaction scope">
      <label>Bank account<input required maxLength={128} value={scope.bankAccountRef} onChange={event=>setScope(current=>({...current,bankAccountRef:event.target.value}))}/></label>
      <label>From<input type="date" value={scope.from} onChange={event=>setScope(current=>({...current,from:event.target.value}))}/></label>
      <label>Through<input type="date" value={scope.through} onChange={event=>setScope(current=>({...current,through:event.target.value}))}/></label>
      <button type="submit" className="btn btn-primary" disabled={state.phase==='LOADING'}>Load evidence</button>
    </form>
    <p className="muted sm">Entity {config.entityId} · Account and date scope are required at the API boundary.</p>
    {state.phase==='IDLE'&&<div className="empty">Choose one bank account and an optional date range to read authoritative evidence.</div>}
    {state.phase==='LOADING'&&<div className="empty" role="status">Loading authoritative bank transaction evidence…</div>}
    {state.phase==='ERROR'&&<ReadError error={state.error} onRetry={load}/>} 
    {state.phase==='READY'&&<AuthoritativeBankTable rows={state.rows}/>} 
  </div>;
}

export function AuthoritativeReconciliationWorkspace({config,fetcher=globalThis.fetch}){
  const [scope,setScope]=useState({bankAccountRef:'',statementEndingDate:''});
  const [state,setState]=useState({phase:'IDLE',row:null,error:null});
  const load=async event=>{event?.preventDefault?.();setState(current=>({...current,phase:'LOADING',error:null}));const result=await refreshAuthoritativeReconciliation({config,bankAccountRef:scope.bankAccountRef,statementEndingDate:scope.statementEndingDate,fetcher});setState(result.ok?{phase:'READY',row:result.row,error:null}:{phase:'ERROR',row:null,error:result});};
  return <div className="stack"><div><h1>Reconciliation evidence</h1><p className="page-subtitle">One authoritative statement cutoff for one entity and bank account. No reconciliation mutation is available.</p></div>
    <form className="filterbar" onSubmit={load} aria-label="Reconciliation statement scope">
      <label>Bank account<input required maxLength={128} value={scope.bankAccountRef} onChange={event=>setScope(current=>({...current,bankAccountRef:event.target.value}))}/></label>
      <label>Statement ending date<input required type="date" value={scope.statementEndingDate} onChange={event=>setScope(current=>({...current,statementEndingDate:event.target.value}))}/></label>
      <button type="submit" className="btn btn-primary" disabled={state.phase==='LOADING'}>Load statement</button>
    </form>
    <p className="muted sm">Entity {config.entityId} · The API rejects missing or cross-scope statement evidence.</p>
    {state.phase==='IDLE'&&<div className="empty">Choose one bank account and statement ending date to read reconciliation evidence.</div>}
    {state.phase==='LOADING'&&<div className="empty" role="status">Loading authoritative reconciliation evidence…</div>}
    {state.phase==='ERROR'&&<ReadError error={state.error} onRetry={load}/>} 
    {state.phase==='READY'&&<AuthoritativeReconciliationSummary row={state.row}/>} 
  </div>;
}
