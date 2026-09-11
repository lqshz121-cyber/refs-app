import React,{useCallback,useEffect,useMemo,useRef,useState} from 'react';
import {refreshAuthoritativeReconciliationScopes} from './accounting-api.js';
import {AuthoritativeWorkspaceHeader,AuthoritativeWorkspaceView} from './authoritative-workbench-view.jsx';
import {StateBlock} from './ui.jsx';

export const summarizeReconciliationBackedAccounts=(rows=[])=>{
  const accounts=new Map();
  for(const row of rows){
    if(!row?.bank_account_ref||!row?.currency)continue;
    const key=`${row.bank_account_ref}\u0000${row.currency}`;
    const current=accounts.get(key)||{bank_account_ref:row.bank_account_ref,currency:row.currency,statements:[]};
    current.statements.push(row);
    accounts.set(key,current);
  }
  return [...accounts.values()].map(account=>{
    const statements=[...account.statements].sort((left,right)=>right.statement_ending_date.localeCompare(left.statement_ending_date)||right.version-left.version);
    const latest=statements[0];
    return Object.freeze({
      bank_account_ref:account.bank_account_ref,
      currency:account.currency,
      statement_count:statements.length,
      latest_reconciliation_id:latest.reconciliation_id,
      latest_statement_ending_date:latest.statement_ending_date,
      latest_status:latest.status,
      latest_version:latest.version,
    });
  }).sort((left,right)=>left.bank_account_ref.localeCompare(right.bank_account_ref)||left.currency.localeCompare(right.currency));
};

const statusTone=status=>status==='RECONCILED'?'badge-ok':['DRAFT','IN_REVIEW','REOPENED'].includes(status)?'badge-warn':'badge-muted';

export function AuthoritativeBankAccountsTable({accounts=[],onOpenTransactions=()=>{},onOpenReconciliation=()=>{}}){
  return <section className="card" aria-label="Reconciliation-backed bank accounts">
    <div className="card-head"><div><h2>Accounts with retained reconciliation evidence</h2><p className="muted sm">Each row comes from the authenticated reconciliation-scope API for this company.</p></div><span className="badge badge-muted">READ ONLY</span></div>
    <div className="table-wrap" role="region" tabIndex={0} aria-label="Bank account evidence; scroll horizontally to view every column"><table className="tbl">
      <thead><tr><th>Bank account</th><th>Currency</th><th>Latest statement</th><th>Status</th><th>Retained statements</th><th>Open</th></tr></thead>
      <tbody>{accounts.map(account=><tr key={`${account.bank_account_ref}:${account.currency}`}>
        <td><b>{account.bank_account_ref}</b><div className="muted sm">Latest evidence v{account.latest_version}</div></td>
        <td>{account.currency}</td><td>{account.latest_statement_ending_date}</td>
        <td><span className={`badge ${statusTone(account.latest_status)}`}>{account.latest_status}</span></td>
        <td>{account.statement_count}</td>
        <td><span className="row-acts"><button type="button" className="btn btn-sm btn-ghost" onClick={()=>onOpenTransactions(account.bank_account_ref)}>Transactions</button><button type="button" className="btn btn-sm" onClick={()=>onOpenReconciliation(account.bank_account_ref,account.latest_statement_ending_date)}>Reconcile</button></span></td>
      </tr>)}</tbody>
    </table></div>
  </section>;
}

export function AuthoritativeBankAccountsWorkspace({config,fetcher=globalThis.fetch,onOpenTransactions=()=>{},onOpenReconciliation=()=>{}}){
  const [state,setState]=useState({phase:'LOADING',rows:[],error:null,readAt:null});
  const readGeneration=useRef(0);
  const load=useCallback(async()=>{
    const generation=++readGeneration.current;
    setState(current=>({...current,phase:'LOADING',error:null}));
    const result=await refreshAuthoritativeReconciliationScopes({config,limit:200,fetcher});
    if(generation!==readGeneration.current)return result;
    const readAt=new Date().toISOString();
    setState(result.ok?{phase:'READY',rows:result.rows,error:null,readAt}:{phase:'ERROR',rows:[],error:result,readAt});
    return result;
  },[config,fetcher]);
  useEffect(()=>{void load();return()=>{readGeneration.current+=1;};},[load]);
  const accounts=useMemo(()=>summarizeReconciliationBackedAccounts(state.rows),[state.rows]);
  return <AuthoritativeWorkspaceView area="Bank Accounts" className="stack authoritative-bank-accounts-workspace">
    <AuthoritativeWorkspaceHeader eyebrow="AUTHORITATIVE - ADMINISTRATION" title="Bank Accounts" description="Open retained bank activity and reconciliation evidence for the current company." status="API EVIDENCE"/>
    <div className="card-head"><div><p className="page-subtitle">This register lists bank account references that have retained reconciliation history. It is not a complete bank-account master or a source of current balances.</p>{state.readAt&&<p className="muted sm">Last authoritative read: {state.readAt} · up to 200 retained statement scopes</p>}</div><button type="button" className="btn btn-sm" disabled={state.phase==='LOADING'} onClick={load}>Refresh</button></div>
    {state.phase==='LOADING'&&<StateBlock tone="loading">Loading bank account evidence…</StateBlock>}
    {state.phase==='ERROR'&&<StateBlock tone="error" title={state.error?.code||'BANK_ACCOUNT_EVIDENCE_UNAVAILABLE'} actions={<button type="button" className="btn btn-sm" onClick={load}>Retry read</button>}><p>{state.error?.message||'The accounting API did not return bank account evidence.'}</p><p>This failure is not evidence that the company has no bank accounts.</p></StateBlock>}
    {state.phase==='READY'&&!accounts.length&&<StateBlock tone="empty" title="No retained reconciliation history"><p>The API returned no reconciliation-backed bank account references for this company.</p><p>This does not prove that the company has no bank accounts or a zero cash balance.</p></StateBlock>}
    {state.phase==='READY'&&accounts.length>0&&<AuthoritativeBankAccountsTable accounts={accounts} onOpenTransactions={onOpenTransactions} onOpenReconciliation={onOpenReconciliation}/>}
    <p className="muted sm">Bank connections, credentials, account creation or editing, balance refresh, transfers, payments, and posting are not available from this evidence register.</p>
  </AuthoritativeWorkspaceView>;
}
