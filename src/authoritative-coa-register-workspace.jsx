import React,{useEffect,useMemo,useState} from 'react';
import {refreshAuthoritativeAccountRegister,refreshAuthoritativeChartOfAccounts} from './accounting-api.js';
import {StateBlock} from './ui.jsx';

const fixedMoney=value=>typeof value==='string'&&/^-?[0-9]+\.[0-9]{4}$/.test(value)?value:'Not returned';
const scopeText=scope=>`Entity ${scope?.entityId} | period ${scope?.periodId}`;
const evidenceScope=scope=><p className="authoritative-coa-scope">{scopeText(scope)}. Amounts remain separate for each currency and are returned as fixed four-decimal strings.</p>;
const ErrorBlock=({state,onRetry})=>state.phase==='ERROR'?<StateBlock tone="error" title={state.error?.code||'ACCOUNTING_API_READ_FAILED'} actions={<button type="button" className="btn btn-sm" onClick={onRetry}>Retry read</button>}>{state.error?.message}</StateBlock>:null;

function Register({config,accountCode,accountName,onBack,fetcher}){
  const [state,setState]=useState({phase:'LOADING',rows:[],error:null});
  const load=async()=>{setState(current=>({...current,phase:'LOADING',error:null}));const result=await refreshAuthoritativeAccountRegister({config,accountCode,fetcher});setState(result.ok?{phase:'READY',rows:result.rows,scope:result.scope,error:null}:{phase:'ERROR',rows:[],scope:null,error:result});};
  useEffect(()=>{void load();},[accountCode,config,fetcher]);
  const currencies=useMemo(()=>[...new Set(state.rows.map(row=>row.currency))],[state.rows]);
  return <section className="full-bleed authoritative-register" aria-label="Authoritative account register">
    <div className="qbo-report-back authoritative-register-back"><button type="button" className="btn btn-sm btn-ghost" onClick={onBack}>Back to Chart of Accounts</button><span>Read-only POSTED ledger evidence</span></div>
    <header className="journal-evidence-header"><div><div className="authoritative-eyebrow">GENERAL LEDGER | ACCOUNT REGISTER</div><h1>{accountCode} — {accountName}</h1><p className="page-subtitle">One account, one entity, one accounting period. No bank connection, export, reconciliation, or posting action is available here.</p></div><span className="badge badge-muted">READ ONLY</span></header>
    <div className="authoritative-register-scope" aria-label="Account register scope"><span><i>Account</i><b>{accountCode}</b></span><span><i>Evidence scope</i><b>{scopeText(state.scope||config)}</b></span><span><i>Currencies returned</i><b>{currencies.length?currencies.join(', '):'Loading or no retained entries'}</b></span><span><i>POSTED entries</i><b>{state.phase==='READY'?state.rows.length:'—'}</b></span></div>
    {state.phase==='LOADING'&&<StateBlock tone="loading">Loading POSTED register evidence…</StateBlock>}
    <ErrorBlock state={state} onRetry={load}/>
    {state.phase==='READY'&&!state.rows.length&&<StateBlock tone="empty" title="No posted register entries returned">No POSTED ledger entry was returned for this account and period. This scoped empty result is not evidence of zero activity outside this retained period.</StateBlock>}
    {state.phase==='READY'&&state.rows.length>0&&<div className="table-wrap authoritative-register-table" tabIndex={0} aria-label="Account register; scroll horizontally to view every column"><table className="tbl"><thead><tr><th scope="col">Date</th><th scope="col">Journal</th><th scope="col">Member</th><th scope="col">Description</th><th scope="col">Currency</th><th scope="col" className="ta-r">Debit</th><th scope="col" className="ta-r">Credit</th><th scope="col" className="ta-r">Opening</th><th scope="col" className="ta-r">Running balance</th><th scope="col">Retained source IDs</th></tr></thead><tbody>{state.rows.map(row=><tr key={row.ledger_line_id}><td>{row.journal_date}</td><td><code>{row.journal_number}</code></td><td>{row.member_ref||'—'}</td><td>{row.description||'—'}</td><td>{row.currency}</td><td className="ta-r">{fixedMoney(row.debit_amount)}</td><td className="ta-r">{fixedMoney(row.credit_amount)}</td><td className="ta-r">{fixedMoney(row.opening_balance)}</td><td className="ta-r">{fixedMoney(row.running_balance)}</td><td>{row.source_document_ids.length?row.source_document_ids.map(id=><code key={id}>{id}</code>):'No retained source ID'}</td></tr>)}</tbody></table></div>}
  </section>;
}

const coaSummary=rows=>({
  accounts:new Set(rows.map(row=>row.account_code)).size,
  active:new Set(rows.filter(row=>row.active).map(row=>row.account_code)).size,
  currencies:new Set(rows.map(row=>row.currency).filter(Boolean)).size,
  postedLines:rows.reduce((total,row)=>total+row.posted_ledger_line_count,0),
});

export function AuthoritativeChartOfAccountsWorkspace({config,fetcher=globalThis.fetch}){
  const [state,setState]=useState({phase:'LOADING',rows:[],error:null});
  const [query,setQuery]=useState('');const [selected,setSelected]=useState(null);
  const load=async()=>{setState(current=>({...current,phase:'LOADING',error:null}));const result=await refreshAuthoritativeChartOfAccounts({config,fetcher});setState(result.ok?{phase:'READY',rows:result.rows,scope:result.scope,error:null}:{phase:'ERROR',rows:[],scope:null,error:result});};
  useEffect(()=>{void load();},[config,fetcher]);
  const rows=useMemo(()=>state.rows.filter(row=>`${row.account_code} ${row.account_name}`.toLowerCase().includes(query.trim().toLowerCase())),[state.rows,query]);
  const summary=useMemo(()=>coaSummary(state.rows),[state.rows]);
  if(selected)return <Register config={config} fetcher={fetcher} accountCode={selected.account_code} accountName={selected.account_name} onBack={()=>setSelected(null)}/>;
  return <section className="authoritative-coa" aria-label="Authoritative Chart of Accounts">
    <header className="journal-evidence-header"><div><div className="authoritative-eyebrow">GENERAL LEDGER | ACCOUNT MASTER</div><h1>Chart of Accounts</h1><p className="page-subtitle">Entity-scoped account master facts with one separate POSTED-ledger balance per retained currency.</p></div><span className="badge badge-muted">READ ONLY</span></header>
    <div className="authoritative-coa-summary" aria-label="Authoritative account master summary"><span><i>Accounts returned</i><b>{state.phase==='READY'?summary.accounts:'—'}</b><small>Exact API snapshot</small></span><span><i>Active accounts</i><b>{state.phase==='READY'?summary.active:'—'}</b><small>Retained master status</small></span><span><i>Currencies returned</i><b>{state.phase==='READY'?summary.currencies:'—'}</b><small>Never co-mingled</small></span><span><i>POSTED ledger lines</i><b>{state.phase==='READY'?summary.postedLines:'—'}</b><small>Evidence, not a bank balance</small></span></div>
    <div className="authoritative-filter-bar authoritative-coa-filter"><label><span>Account name or number</span><input value={query} onChange={event=>setQuery(event.target.value)} placeholder="Filter accounts"/></label><span className="result-count"><b>{state.phase==='READY'?rows.length:'—'}</b> shown</span>{query&&<button type="button" className="btn btn-sm btn-ghost" onClick={()=>setQuery('')}>Clear filter</button>}<button type="button" className="btn btn-sm" onClick={load}>Refresh evidence</button></div>
    {evidenceScope(state.scope||{entityId:config.entityId,periodId:config.periodId})}
    {state.phase==='LOADING'&&<StateBlock tone="loading">Loading authoritative account master and POSTED balances…</StateBlock>}
    <ErrorBlock state={state} onRetry={load}/>
    {state.phase==='READY'&&!rows.length&&<StateBlock tone="empty" title={state.rows.length?'No accounts match this filter':'No accounts returned'}>{state.rows.length?'Change the presentation filter. The retained API snapshot was not changed.':'No entity-scoped account-master row was returned for this period.'}</StateBlock>}
    {state.phase==='READY'&&rows.length>0&&<div className="table-wrap authoritative-coa-table" tabIndex={0} aria-label="Chart of Accounts; scroll horizontally to view every column"><table className="tbl"><thead><tr><th scope="col">Account</th><th scope="col">Name</th><th scope="col">Member rule</th><th scope="col">Status</th><th scope="col">Currency</th><th scope="col" className="ta-r">Opening</th><th scope="col" className="ta-r">Period debit</th><th scope="col" className="ta-r">Period credit</th><th scope="col" className="ta-r">Ending</th><th scope="col" className="ta-r">Posted lines</th><th scope="col">Evidence</th></tr></thead><tbody>{rows.map((row,index)=><tr key={`${row.account_code}:${row.currency||'none'}:${index}`}><td><code>{row.account_code}</code></td><td>{row.account_name}</td><td>{row.requires_member?row.required_member_type||'Required':'None'}</td><td>{row.active?'Active':'Inactive'}</td><td>{row.currency||'No posted currency evidence'}</td><td className="ta-r">{row.opening_balance===null?'—':fixedMoney(row.opening_balance)}</td><td className="ta-r">{row.period_debit===null?'—':fixedMoney(row.period_debit)}</td><td className="ta-r">{row.period_credit===null?'—':fixedMoney(row.period_credit)}</td><td className="ta-r">{row.ending_balance===null?'—':fixedMoney(row.ending_balance)}</td><td className="ta-r">{row.posted_ledger_line_count}</td><td><button type="button" className="btn btn-sm" onClick={()=>setSelected(row)}>Open register</button></td></tr>)}</tbody></table></div>}
  </section>;
}
