import React,{useEffect,useMemo,useState} from 'react';
import {refreshAuthoritativeAccountRegister,refreshAuthoritativeChartOfAccounts} from './accounting-api.js';
import {StateBlock} from './ui.jsx';

const fixedMoney=value=>typeof value==='string'&&/^-?[0-9]+\.[0-9]{4}$/.test(value)?value:'Not returned';
const evidenceScope=scope=><p className="muted sm">Entity {scope?.entityId} · period {scope?.periodId}. Amounts remain separate for each currency and are returned as fixed four-decimal strings.</p>;
const ErrorBlock=({state,onRetry})=>state.phase==='ERROR'?<StateBlock tone="error" title={state.error?.code||'ACCOUNTING_API_READ_FAILED'} actions={<button type="button" className="btn btn-sm" onClick={onRetry}>Retry read</button>}>{state.error?.message}</StateBlock>:null;

function Register({config,accountCode,accountName,onBack,fetcher}){
  const [state,setState]=useState({phase:'LOADING',rows:[],error:null});
  const load=async()=>{setState(current=>({...current,phase:'LOADING',error:null}));const result=await refreshAuthoritativeAccountRegister({config,accountCode,fetcher});setState(result.ok?{phase:'READY',rows:result.rows,scope:result.scope,error:null}:{phase:'ERROR',rows:[],scope:null,error:result});};
  useEffect(()=>{void load();},[accountCode,config,fetcher]);
  return <section className="full-bleed authoritative-register" aria-label="Authoritative account register">
    <div className="qbo-report-back"><button type="button" className="btn btn-sm btn-ghost" onClick={onBack}>Back to Chart of Accounts</button><span>Read-only POSTED ledger evidence</span></div>
    <header className="journal-evidence-header"><div><div className="authoritative-eyebrow">GENERAL LEDGER · ACCOUNT REGISTER</div><h1>{accountCode} — {accountName}</h1><p className="page-subtitle">One account, one entity, one accounting period. No bank connection, export, reconciliation, or posting action is available here.</p></div><span className="badge badge-muted">READ ONLY</span></header>
    {evidenceScope(state.scope||{entityId:config.entityId,periodId:config.periodId})}
    {state.phase==='LOADING'&&<StateBlock tone="loading">Loading POSTED register evidence…</StateBlock>}
    <ErrorBlock state={state} onRetry={load}/>
    {state.phase==='READY'&&!state.rows.length&&<StateBlock tone="empty" title="No posted register entries returned">No POSTED ledger entry was returned for this account and period. This scoped empty result is not evidence of zero activity outside this retained period.</StateBlock>}
    {state.phase==='READY'&&state.rows.length>0&&<div className="table-wrap authoritative-register-table" tabIndex={0} aria-label="Account register; scroll horizontally to view every column"><table className="tbl"><thead><tr><th>Date</th><th>Journal</th><th>Member</th><th>Description</th><th>Currency</th><th>Debit</th><th>Credit</th><th>Opening</th><th>Running balance</th><th>Retained source IDs</th></tr></thead><tbody>{state.rows.map(row=><tr key={row.ledger_line_id}><td>{row.journal_date}</td><td><code>{row.journal_number}</code></td><td>{row.member_ref||'—'}</td><td>{row.description||'—'}</td><td>{row.currency}</td><td>{fixedMoney(row.debit_amount)}</td><td>{fixedMoney(row.credit_amount)}</td><td>{fixedMoney(row.opening_balance)}</td><td>{fixedMoney(row.running_balance)}</td><td>{row.source_document_ids.length?row.source_document_ids.map(id=><code key={id}>{id}</code>):'No retained source ID'}</td></tr>)}</tbody></table></div>}
  </section>;
}

export function AuthoritativeChartOfAccountsWorkspace({config,fetcher=globalThis.fetch}){
  const [state,setState]=useState({phase:'LOADING',rows:[],error:null});
  const [query,setQuery]=useState('');const [selected,setSelected]=useState(null);
  const load=async()=>{setState(current=>({...current,phase:'LOADING',error:null}));const result=await refreshAuthoritativeChartOfAccounts({config,fetcher});setState(result.ok?{phase:'READY',rows:result.rows,scope:result.scope,error:null}:{phase:'ERROR',rows:[],scope:null,error:result});};
  useEffect(()=>{void load();},[config,fetcher]);
  const rows=useMemo(()=>state.rows.filter(row=>`${row.account_code} ${row.account_name}`.toLowerCase().includes(query.trim().toLowerCase())),[state.rows,query]);
  if(selected)return <Register config={config} fetcher={fetcher} accountCode={selected.account_code} accountName={selected.account_name} onBack={()=>setSelected(null)}/>;
  return <section className="authoritative-coa" aria-label="Authoritative Chart of Accounts">
    <header className="journal-evidence-header"><div><div className="authoritative-eyebrow">GENERAL LEDGER · ACCOUNT MASTER</div><h1>Chart of Accounts</h1><p className="page-subtitle">Entity-scoped account master facts with one separate POSTED-ledger balance per retained currency.</p></div><span className="badge badge-muted">READ ONLY</span></header>
    <div className="authoritative-filter-bar"><label>Account name or number<input value={query} onChange={event=>setQuery(event.target.value)} placeholder="Filter accounts"/></label><button type="button" className="btn btn-sm" onClick={load}>Refresh</button></div>
    {evidenceScope(state.scope||{entityId:config.entityId,periodId:config.periodId})}
    {state.phase==='LOADING'&&<StateBlock tone="loading">Loading authoritative account master and POSTED balances…</StateBlock>}
    <ErrorBlock state={state} onRetry={load}/>
    {state.phase==='READY'&&!rows.length&&<StateBlock tone="empty" title={state.rows.length?'No accounts match this filter':'No accounts returned'}>{state.rows.length?'Change the local presentation filter. The retained API snapshot was not changed.':'No entity-scoped account-master row was returned for this period.'}</StateBlock>}
    {state.phase==='READY'&&rows.length>0&&<div className="table-wrap authoritative-coa-table" tabIndex={0} aria-label="Chart of Accounts; scroll horizontally to view every column"><table className="tbl"><thead><tr><th>Account</th><th>Name</th><th>Member rule</th><th>Status</th><th>Currency</th><th>Opening</th><th>Period debit</th><th>Period credit</th><th>Ending</th><th>Posted lines</th><th>Evidence</th></tr></thead><tbody>{rows.map((row,index)=><tr key={`${row.account_code}:${row.currency||'none'}:${index}`}><td><code>{row.account_code}</code></td><td>{row.account_name}</td><td>{row.requires_member?row.required_member_type||'Required':'None'}</td><td>{row.active?'Active':'Inactive'}</td><td>{row.currency||'No posted currency evidence'}</td><td>{row.opening_balance===null?'—':fixedMoney(row.opening_balance)}</td><td>{row.period_debit===null?'—':fixedMoney(row.period_debit)}</td><td>{row.period_credit===null?'—':fixedMoney(row.period_credit)}</td><td>{row.ending_balance===null?'—':fixedMoney(row.ending_balance)}</td><td>{row.posted_ledger_line_count}</td><td><button type="button" className="btn btn-sm" onClick={()=>setSelected(row)}>View register</button></td></tr>)}</tbody></table></div>}
  </section>;
}
