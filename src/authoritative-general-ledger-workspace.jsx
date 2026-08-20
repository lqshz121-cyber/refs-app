import React,{useEffect,useMemo,useRef,useState} from 'react';
import {refreshAuthoritativeGeneralLedger} from './accounting-api.js';
import {StateBlock} from './ui.jsx';
import {AuthoritativeReadFailure,AuthoritativeScopeEmpty,authoritativeReadFailurePhase} from './authoritative-read-state.jsx';
import {AuthoritativeGeneralLedgerDetailView,AuthoritativeGeneralLedgerView} from './authoritative-general-ledger-view.jsx';
import {AuthoritativeLineageDrill} from './authoritative-lineage-drill.jsx';

const PAGE_SIZE=50;
const money=value=>typeof value==='string'&&/^-?\d+\.\d{4}$/.test(value)?value:'Not returned';
const text=value=>value===null||value===undefined||value===''?'Not returned':value;
const scopeText=(scope,config)=>{
  const presentation=config?.scopePresentation||{};
  const entity=presentation.entityLabel||'Configured entity';
  const period=presentation.periodLabel||scope?.period_code||'Configured period';
  return `Entity ${entity} | period ${period}`;
};
const returnText=context=>[
  context.accountCode&&`account ${context.accountCode}`,
  context.query&&`search “${context.query}”`,
  `page ${context.page}`,
].join(' | ');
function EvidenceIds({label,ids}){
  return <div className="authoritative-gl-id-card"><i>{label}</i>{ids.length?<div>{ids.map(id=><code key={id}>{id}</code>)}</div>:<b>No retained source-document ID</b>}</div>;
}

export function AuthoritativeGeneralLedgerDetail({row,returnContext,onBack}){
  return <AuthoritativeGeneralLedgerDetailView eyebrow="GENERAL LEDGER" title="Posted ledger line" subtitle="Review this posted ledger line.">
    <div className="qbo-report-back authoritative-gl-back"><button type="button" className="btn btn-sm btn-ghost" onClick={onBack}>Back to General Ledger</button><span>Posted line details</span></div>
    <div className="authoritative-register-scope authoritative-gl-detail-scope" aria-label="Posted ledger line scope">
      <span><i>Account</i><b><code>{row.account_code}</code> · {row.account_name}</b></span>
      <span><i>Posting date</i><b>{row.journal_date}</b></span>
      <span><i>Currency</i><b>{row.currency}</b></span>
      <span><i>Member</i><b>{text(row.member_ref)}</b></span>
    </div>
    <details className="authoritative-return-context authoritative-gl-return-context"><summary>List filters retained</summary><span>{returnText(returnContext)}. Back restores this list position.</span></details>
    <section className="card authoritative-gl-amount-card" aria-label="Posted ledger amounts"><div><i>Debit</i><b>{money(row.debit_amount)}</b></div><div><i>Credit</i><b>{money(row.credit_amount)}</b></div><div><i>Journal</i><b><code>{row.journal_number}</code></b></div><div><i>Description</i><b>{text(row.description)}</b></div></section>
    <section className="card authoritative-gl-identifiers" aria-label="Immutable ledger identifiers"><div className="card-head"><div><h2>Identifiers</h2><p className="muted sm">Exact IDs for audit and drill-through.</p></div><span className="badge badge-muted">READ ONLY</span></div><div className="authoritative-gl-id-grid"><EvidenceIds label="Journal entry ID" ids={[row.journal_entry_id]}/><EvidenceIds label="Journal line ID" ids={[row.journal_line_id]}/><EvidenceIds label="Ledger line ID" ids={[row.ledger_line_id]}/><EvidenceIds label="Source document IDs" ids={row.source_document_ids}/></div></section>
    <p className="report-drill-hint authoritative-gl-lineage-note"><span className="badge badge-muted">READ ONLY</span> Journal and source drill-through are available only when an exact link is returned.</p>
  </AuthoritativeGeneralLedgerDetailView>;
}

export function AuthoritativeGeneralLedgerWorkspace({config,fetcher=globalThis.fetch,environment=globalThis}){
  const [query,setQuery]=useState('');const [accountCode,setAccountCode]=useState('');const [offset,setOffset]=useState(0);const [detail,setDetail]=useState(null);const [state,setState]=useState({phase:'LOADING',rows:[],total:0,error:null});const opener=useRef(null);const scrollY=useRef(0);const tableX=useRef(0);
  const load=async({nextOffset=offset,nextQuery=query,nextAccountCode=accountCode}={})=>{setState(current=>({...current,phase:'LOADING',error:null}));const result=await refreshAuthoritativeGeneralLedger({config,query:nextQuery||null,accountCode:nextAccountCode||null,limit:PAGE_SIZE,offset:nextOffset,fetcher});setState(result.ok?{phase:'READY',rows:result.rows,total:result.total,scope:result.scope,error:null}:{phase:authoritativeReadFailurePhase(result),rows:[],total:0,scope:null,error:result});};
  useEffect(()=>{void load({nextOffset:0,nextQuery:'',nextAccountCode:''});},[config,fetcher]);
  const loading=state.phase==='LOADING';
  const page=Math.floor(offset/PAGE_SIZE)+1;const pages=Math.max(1,Math.ceil(state.total/PAGE_SIZE));const canNext=offset+PAGE_SIZE<state.total;
  const apply=()=>{const nextQuery=query.trim();const nextAccountCode=accountCode.trim();setQuery(nextQuery);setAccountCode(nextAccountCode);setOffset(0);void load({nextOffset:0,nextQuery,nextAccountCode});};
  const reset=()=>{setQuery('');setAccountCode('');setOffset(0);void load({nextOffset:0,nextQuery:'',nextAccountCode:''});};
  const openDetail=(row,index)=>{opener.current=`authoritative-gl-line-${row.ledger_line_id}-${index}`;const button=environment?.document?.getElementById?.(opener.current);scrollY.current=Number(environment?.scrollY)||0;tableX.current=Number(button?.closest?.('.table-wrap')?.scrollLeft)||0;setDetail({row,returnContext:{query,accountCode,page}});};
  const closeDetail=()=>{setDetail(null);environment?.setTimeout?.(()=>{const button=environment?.document?.getElementById?.(opener.current);button?.closest?.('.table-wrap')?.scrollTo?.({left:tableX.current,behavior:'auto'});button?.focus?.();environment?.scrollTo?.({top:scrollY.current,behavior:'auto'});},0);};
  const rows=useMemo(()=>state.rows,[state.rows]);
  if(detail)return <AuthoritativeLineageDrill config={config} fetcher={fetcher} initial={{kind:'GL',row:detail.row,context:{entityId:config.entityId,periodId:config.periodId,journalEntryId:detail.row.journal_entry_id,journalLineId:detail.row.journal_line_id,ledgerLineId:detail.row.ledger_line_id}}} onExit={closeDetail}/>;
  return <AuthoritativeGeneralLedgerView eyebrow="ACCOUNTING" title="General Ledger" subtitle="Review posted ledger activity.">
    <div className="authoritative-coa-scope" title={`Entity ID: ${config.entityId}; Period ID: ${config.periodId}`}><span>{scopeText(state.scope||config,config)}</span><details className="authoritative-return-context"><summary>Scope rules</summary><span>The configured period is the immutable date scope; ad-hoc date overrides are not supplied by this API. Amounts are fixed four-decimal strings and currencies are never combined.</span></details></div>
    <div className="authoritative-filter-bar" aria-label="General Ledger filters"><label><span>Account code</span><input value={accountCode} onChange={event=>setAccountCode(event.target.value)} placeholder="Optional exact account"/></label><label><span>Search</span><input value={query} onChange={event=>setQuery(event.target.value)} placeholder="Account, journal, or description"/></label><button type="button" className="btn btn-sm" disabled={loading} onClick={apply}>Apply</button>{(query||accountCode)&&<button type="button" className="btn btn-sm btn-ghost" disabled={loading} onClick={reset}>Reset</button>}<button type="button" className="btn btn-sm btn-ghost" disabled={loading} onClick={()=>void load()}>{loading?'Loading…':'Refresh'}</button><span className="result-count" aria-live="polite"><b>{state.phase==='READY'?state.total:'—'}</b> {state.phase==='READY'&&state.total===1?'result':'results'}</span></div>
    {state.phase==='LOADING'&&<StateBlock tone="loading">Loading posted ledger lines…</StateBlock>}
    <AuthoritativeReadFailure state={state} onRetry={()=>void load()} retryLabel="Retry General Ledger read"/>
    {state.phase==='READY'&&!rows.length&&<AuthoritativeScopeEmpty subject="POSTED ledger lines" requiresPosted/>}
    {state.phase==='READY'&&rows.length>0&&<><div className="table-wrap authoritative-general-ledger-table" role="region" tabIndex={0} aria-label="General Ledger; scroll horizontally to view all columns"><table className="tbl"><thead><tr><th>Date</th><th>Account</th><th>Journal</th><th>Member</th><th>Description</th><th>Currency</th><th className="ta-r">Debit</th><th className="ta-r">Credit</th><th>Details</th></tr></thead><tbody>{rows.map((row,index)=><tr key={row.ledger_line_id}><td>{row.journal_date}</td><td><code>{row.account_code}</code><br/><small>{row.account_name}</small></td><td><code>{row.journal_number}</code></td><td>{text(row.member_ref)}</td><td>{text(row.description)}</td><td>{row.currency}</td><td className="ta-r">{money(row.debit_amount)}</td><td className="ta-r">{money(row.credit_amount)}</td><td><button id={`authoritative-gl-line-${row.ledger_line_id}-${index}`} type="button" className="btn btn-sm" onClick={()=>openDetail(row,index)}>View details</button></td></tr>)}</tbody></table></div><nav className="authoritative-coa-pagination" aria-label="General Ledger pages"><span>Page {page} of {pages}</span><button type="button" className="btn btn-sm btn-ghost" disabled={loading||offset===0} onClick={()=>{const next=Math.max(0,offset-PAGE_SIZE);setOffset(next);void load({nextOffset:next});}}>Previous</button><button type="button" className="btn btn-sm btn-ghost" disabled={loading||!canNext} onClick={()=>{const next=offset+PAGE_SIZE;setOffset(next);void load({nextOffset:next});}}>Next</button></nav></>}
  </AuthoritativeGeneralLedgerView>;
}
