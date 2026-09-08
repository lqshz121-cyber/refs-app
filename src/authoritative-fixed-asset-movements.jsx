import {matchesAssetMovementJournal} from './asset-movement-journal-contract.js';
import React,{useEffect,useRef,useState} from 'react';
import {refreshAuthoritativeFixedAssetMovements,readAuthoritativeJournalEntryDetail,readAuthoritativeSourceDocumentDetail} from './accounting-api.js';
import {AuthoritativeLineageDrill} from './authoritative-lineage-drill.jsx';
import {StateBlock} from './ui.jsx';

export function AuthoritativeFixedAssetMovements({config,assetId,asOfDate,fetcher}){
 const [cursor,setCursor]=useState(null),[history,setHistory]=useState([]),[retry,setRetry]=useState(0),[page,setPage]=useState({phase:'LOADING'}),[drill,setDrill]=useState(null),[error,setError]=useState(null),[busy,setBusy]=useState(false);
 const generation=useRef(0),origin=useRef(null),heading=useRef(null),returnPending=useRef(false),drillContainer=useRef(null);
 useEffect(()=>{if(drill)drillContainer.current?.focus();else if(returnPending.current){returnPending.current=false;const target=origin.current?.ownerDocument.getElementById(origin.current.id);if(target)target.focus();else heading.current?.focus();}},[drill]);
 useEffect(()=>()=>{generation.current++;},[]);
 useEffect(()=>{let active=true;setPage({phase:'LOADING'});refreshAuthoritativeFixedAssetMovements({config,assetId,asOfDate,after:cursor,fetcher}).then(result=>{if(active)setPage(result.ok?{phase:'READY',data:result.data}:{phase:'ERROR',message:result.message});});return()=>{active=false;};},[config.tenantId,config.entityId,config.baseUrl,assetId,asOfDate,cursor,retry,fetcher]);
 const close=()=>{returnPending.current=true;generation.current++;setDrill(null);setBusy(false);setError(null);if(origin.current?.isConnected)origin.current.focus();else heading.current?.focus();};
 const open=async(row,kind,button)=>{
  const token=++generation.current;origin.current=button;setBusy(true);setError(null);
  const scoped={...config,periodId:row.accounting_period_id,scopePresentation:{...config.scopePresentation,periodLabel:row.journal_date.slice(0,7)}};
  const result=kind==='JOURNAL'?await readAuthoritativeJournalEntryDetail({config:scoped,journalEntryId:row.journal_entry_id,fetcher}):await readAuthoritativeSourceDocumentDetail({config:scoped,sourceDocumentId:row.source_document_id,fetcher});
  if(token!==generation.current)return;setBusy(false);
  if(!result.ok){setError(result.message);return;}
  if(kind==='JOURNAL'){
   const journal=result.journal;
   if(!matchesAssetMovementJournal(journal,row)){setError('The journal no longer matches the selected asset activity.');return;}
   setDrill({config:scoped,initial:{kind,journal,context:{entityId:config.entityId,periodId:row.accounting_period_id,journalId:journal.journal_entry_id,journalRevision:journal.revision,journalCurrency:journal.currency}}});
  }else{
   const detail=result.detail;
   if(detail.payload_hash!==row.source_payload_hash||detail.source_document_revision!==row.source_document_version||detail.currency!==row.currency||!detail.posted_journal_entry_ids.includes(row.journal_entry_id)){setError('The current source differs from the source retained at posting.');return;}
   setDrill({config:scoped,initial:{kind,detail,context:{entityId:config.entityId,periodId:row.accounting_period_id,sourceDocumentId:detail.source_document_id,sourceRevision:detail.source_document_revision,payloadHash:detail.payload_hash}}});
  }
 };
 if(drill)return <div ref={drillContainer} tabIndex={-1}><AuthoritativeLineageDrill config={drill.config} fetcher={fetcher} initial={drill.initial} onExit={close}/></div>;
 return <section aria-label="Asset activity"><h3 ref={heading} tabIndex={-1}>Posted activity</h3>
  {page.phase==='LOADING'?<StateBlock tone="loading" title="Loading activity">Reading posted asset entries.</StateBlock>:null}
  {page.phase==='ERROR'?<StateBlock tone="error" title="Could not load activity">{page.message}<button type="button" onClick={()=>setRetry(value=>value+1)}>Retry activity</button></StateBlock>:null}
  {busy?<p role="status">Opening entry…</p>:null}{error?<p role="alert">{error}</p>:null}
  {page.phase==='READY'?<><div className="fixed-assets-register-table" role="region" aria-label="Posted asset activity" tabIndex={0}><table className="data-table"><thead><tr><th>Date</th><th>Journal</th><th>Account</th><th>Currency</th><th>Debit</th><th>Credit</th><th>Source</th><th>Trace</th></tr></thead><tbody>{page.data.rows.map(row=><tr key={row.ledger_line_id}><td>{row.journal_date}</td><td><button type="button" id={'asset-movement-journal-'+row.ledger_line_id} disabled={busy} onClick={event=>open(row,'JOURNAL',event.currentTarget)}>{row.journal_number}</button></td><td>{row.account_code}</td><td>{row.currency}</td><td>{row.debit_amount}</td><td>{row.credit_amount}</td><td>{row.source_binding_status==='EXACT_DISPOSAL_SOURCE'?<button type="button" id={'asset-movement-source-'+row.ledger_line_id} disabled={busy} onClick={event=>open(row,'SOURCE',event.currentTarget)}>View posting source</button>:'Posting source link not retained'}</td><td><details><summary>View trace</summary><dl>{[['Ledger line',row.ledger_line_id],['Journal line',row.journal_line_id],['Posting audit',row.posting_audit_event_id],['Ledger link',row.ledger_source_link_id||'Not retained'],['Assessment',row.impairment_assessment_evidence_id||'Not retained'],['Posting source hash',row.source_payload_hash||'Not retained'],['Journal total debit',row.journal_total_debit],['Journal total credit',row.journal_total_credit]].map(([label,value])=><React.Fragment key={label}><dt>{label}</dt><dd>{value}</dd></React.Fragment>)}</dl></details></td></tr>)}</tbody></table></div>
  {!page.data.rows.length?<p>No posted activity through this date.</p>:null}<div className="filter-bar"><button type="button" disabled={!history.length||busy} onClick={()=>{setCursor(history.at(-1));setHistory(history.slice(0,-1));}}>Previous activity</button><span>Page {history.length+1}</span><button type="button" disabled={!page.data.next_cursor||busy} onClick={()=>{setHistory([...history,cursor]);setCursor(page.data.next_cursor);}}>Next activity</button></div></>:null}
 </section>;
}
