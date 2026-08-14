import React,{useEffect,useMemo,useRef,useState} from 'react';
import {refreshAuthoritativeGeneralLedger} from './accounting-api.js';
import {StateBlock} from './ui.jsx';
import {AuthoritativeScopeEmpty} from './authoritative-read-state.jsx';
import {AuthoritativeDemoGeneralLedgerDetailView,AuthoritativeDemoGeneralLedgerView} from './authoritative-demo-general-ledger-view.jsx';
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
const ReadingRail=({items,label})=><div className="authoritative-workbench-rail authoritative-ledger-reading-rail" aria-label={label}>{items.map((item,index)=><span key={item}><b>{index+1}</b>{item}</span>)}</div>;

function EvidenceIds({label,ids}){
  return <div className="authoritative-gl-id-card"><i>{label}</i>{ids.length?<div>{ids.map(id=><code key={id}>{id}</code>)}</div>:<b>No retained source-document ID</b>}</div>;
}

export function AuthoritativeGeneralLedgerDetail({row,returnContext,onBack}){
  return <AuthoritativeDemoGeneralLedgerDetailView eyebrow="GENERAL LEDGER · LINE EVIDENCE" title="Posted ledger line" subtitle="Read-only evidence returned by the scoped General Ledger API. No journal reconstruction, export, posting, adjustment, or provider action is available.">
    <div className="qbo-report-back authoritative-gl-back"><button type="button" className="btn btn-sm btn-ghost" onClick={onBack}>Back to General Ledger</button><span>Exact API snapshot</span></div>
    <ReadingRail label="Ledger line evidence reading path" items={['Immutable line','Posted amounts','Retained identifiers']}/>
    <div className="authoritative-register-scope authoritative-gl-detail-scope" aria-label="Posted ledger line scope">
      <span><i>Account</i><b><code>{row.account_code}</code> · {row.account_name}</b></span>
      <span><i>Posting date</i><b>{row.journal_date}</b></span>
      <span><i>Currency</i><b>{row.currency}</b></span>
      <span><i>Member</i><b>{text(row.member_ref)}</b></span>
    </div>
    <p className="authoritative-register-return">Return context: {returnText(returnContext)}. The list filters, server page, and the current API snapshot remain intact on Back.</p>
    <section className="card authoritative-gl-amount-card" aria-label="Posted ledger amounts"><div><i>Debit</i><b>{money(row.debit_amount)}</b></div><div><i>Credit</i><b>{money(row.credit_amount)}</b></div><div><i>Journal</i><b><code>{row.journal_number}</code></b></div><div><i>Description</i><b>{text(row.description)}</b></div></section>
    <section className="card authoritative-gl-identifiers" aria-label="Immutable ledger identifiers"><div className="card-head"><div><h2>Immutable evidence identifiers</h2><p className="muted sm">These identifiers are displayed exactly as returned. This surface does not invent a journal, source, or mapping drill when the corresponding API reader has not been requested.</p></div><span className="badge badge-muted">API READ</span></div><div className="authoritative-gl-id-grid"><EvidenceIds label="Journal entry ID" ids={[row.journal_entry_id]}/><EvidenceIds label="Journal line ID" ids={[row.journal_line_id]}/><EvidenceIds label="Ledger line ID" ids={[row.ledger_line_id]}/><EvidenceIds label="Source document IDs" ids={row.source_document_ids}/></div></section>
    <StateBlock tone="empty" title="Further lineage is not loaded here">Open an available, separately authorised journal or source-document workspace only when its API contract and immutable evidence are present. This General Ledger detail remains a read-only list snapshot.</StateBlock>
  </AuthoritativeDemoGeneralLedgerDetailView>;
}

export function AuthoritativeGeneralLedgerWorkspace({config,fetcher=globalThis.fetch}){
  const [query,setQuery]=useState('');const [accountCode,setAccountCode]=useState('');const [offset,setOffset]=useState(0);const [detail,setDetail]=useState(null);const [state,setState]=useState({phase:'LOADING',rows:[],total:0,error:null});const opener=useRef(null);const scrollY=useRef(0);
  const load=async({nextOffset=offset,nextQuery=query,nextAccountCode=accountCode}={})=>{setState(current=>({...current,phase:'LOADING',error:null}));const result=await refreshAuthoritativeGeneralLedger({config,query:nextQuery||null,accountCode:nextAccountCode||null,limit:PAGE_SIZE,offset:nextOffset,fetcher});setState(result.ok?{phase:'READY',rows:result.rows,total:result.total,scope:result.scope,error:null}:{phase:'ERROR',rows:[],total:0,scope:null,error:result});};
  useEffect(()=>{void load({nextOffset:0,nextQuery:'',nextAccountCode:''});},[config,fetcher]);
  const page=Math.floor(offset/PAGE_SIZE)+1;const pages=Math.max(1,Math.ceil(state.total/PAGE_SIZE));const canNext=offset+PAGE_SIZE<state.total;
  const apply=()=>{const nextQuery=query.trim();const nextAccountCode=accountCode.trim();setQuery(nextQuery);setAccountCode(nextAccountCode);setOffset(0);void load({nextOffset:0,nextQuery,nextAccountCode});};
  const reset=()=>{setQuery('');setAccountCode('');setOffset(0);void load({nextOffset:0,nextQuery:'',nextAccountCode:''});};
  const openDetail=(row,index)=>{opener.current=`authoritative-gl-line-${row.ledger_line_id}-${index}`;scrollY.current=globalThis.window?.scrollY||0;setDetail({row,returnContext:{query,accountCode,page}});};
  const closeDetail=()=>{setDetail(null);setTimeout(()=>{globalThis.document?.getElementById(opener.current)?.focus();globalThis.window?.scrollTo?.({top:scrollY.current,behavior:'auto'});},0);};
  const rows=useMemo(()=>state.rows,[state.rows]);
  if(detail)return <AuthoritativeLineageDrill config={config} fetcher={fetcher} initial={{kind:'GL',row:detail.row,context:{entityId:config.entityId,periodId:config.periodId,journalEntryId:detail.row.journal_entry_id,journalLineId:detail.row.journal_line_id,ledgerLineId:detail.row.ledger_line_id}}} onExit={closeDetail}/>;
  return <AuthoritativeDemoGeneralLedgerView eyebrow="GENERAL LEDGER · POSTED EVIDENCE" title="General Ledger" subtitle="Entity and accounting-period scoped POSTED ledger lines only. No export, posting, adjustment, or provider action is available.">
    <ReadingRail label="General Ledger reading path" items={['Scoped ledger','POSTED evidence','Immutable line detail']}/>
    <p className="authoritative-coa-scope" title={`Entity ID: ${config.entityId}; Period ID: ${config.periodId}`}>{scopeText(state.scope||config,config)}. The configured period is the immutable date scope; ad-hoc date overrides are not supplied by this API. Amounts are fixed four-decimal strings and currencies are never combined.</p>
    <div className="authoritative-filter-bar" aria-label="General Ledger filters"><label><span>Account code</span><input value={accountCode} onChange={event=>setAccountCode(event.target.value)} placeholder="Optional exact account"/></label><label><span>Search posted evidence</span><input value={query} onChange={event=>setQuery(event.target.value)} placeholder="Account, journal, or description"/></label><button type="button" className="btn btn-sm" onClick={apply}>Apply</button>{(query||accountCode)&&<button type="button" className="btn btn-sm btn-ghost" onClick={reset}>Reset</button>}<button type="button" className="btn btn-sm btn-ghost" onClick={()=>void load()}>Refresh evidence</button><span className="result-count"><b>{state.phase==='READY'?state.total:'—'}</b> POSTED lines</span></div>
    {state.phase==='LOADING'&&<StateBlock tone="loading">Loading authoritative POSTED ledger evidence…</StateBlock>}
    {state.phase==='ERROR'&&<StateBlock tone="error" title={state.error?.code||'GENERAL_LEDGER_READ_FAILED'} actions={<button type="button" className="btn btn-sm" onClick={()=>void load()}>Retry read</button>}>{state.error?.message}</StateBlock>}
    {state.phase==='READY'&&!rows.length&&<AuthoritativeScopeEmpty subject="POSTED ledger lines" requiresPosted/>}
    {state.phase==='READY'&&rows.length>0&&<><div className="table-wrap authoritative-general-ledger-table" role="region" tabIndex={0} aria-label="General Ledger; scroll horizontally to view all retained evidence columns"><table className="tbl"><thead><tr><th>Date</th><th>Account</th><th>Journal</th><th>Member</th><th>Description</th><th>Currency</th><th className="ta-r">Debit</th><th className="ta-r">Credit</th><th>Evidence</th></tr></thead><tbody>{rows.map((row,index)=><tr key={row.ledger_line_id}><td>{row.journal_date}</td><td><code>{row.account_code}</code><br/><small>{row.account_name}</small></td><td><code>{row.journal_number}</code></td><td>{text(row.member_ref)}</td><td>{text(row.description)}</td><td>{row.currency}</td><td className="ta-r">{money(row.debit_amount)}</td><td className="ta-r">{money(row.credit_amount)}</td><td><button id={`authoritative-gl-line-${row.ledger_line_id}-${index}`} type="button" className="btn btn-sm" onClick={()=>openDetail(row,index)}>Open evidence</button></td></tr>)}</tbody></table></div><nav className="authoritative-coa-pagination" aria-label="General Ledger pages"><span>Showing server page {page} of {pages}</span><button type="button" className="btn btn-sm btn-ghost" disabled={offset===0} onClick={()=>{const next=Math.max(0,offset-PAGE_SIZE);setOffset(next);void load({nextOffset:next});}}>Previous</button><button type="button" className="btn btn-sm btn-ghost" disabled={!canNext} onClick={()=>{const next=offset+PAGE_SIZE;setOffset(next);void load({nextOffset:next});}}>Next</button></nav></>}
  </AuthoritativeDemoGeneralLedgerView>;
}
