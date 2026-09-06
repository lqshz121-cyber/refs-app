import React,{useEffect,useRef,useState} from 'react';
import {readDocumentSettlementHistory,readSettlementJournal} from './document-settlement-history.js';
import {AuthoritativeLineageDrill} from './authoritative-lineage-drill.jsx';

export function DocumentSettlementHistory({config,businessDocumentId,kind,access,fetcher=globalThis.fetch}){
  const allowed=typeof access?.actor_id==='string'&&!!access.actor_id.trim()&&access?.entity_id===config?.entityId&&access?.session_refresh_required===false&&access?.permissions?.includes(kind==='AP_PAYMENT'?'AP.VIEW':'AR.VIEW');
  if(!allowed)return null;
  return <SettlementHistoryContent key={`${config.entityId}:${businessDocumentId}:${kind}:${access.actor_id}`} config={config} businessDocumentId={businessDocumentId} kind={kind} canReadJournal={access.permissions.includes('GL.JE.VIEW')} fetcher={fetcher}/>;
}
export function SettlementHistoryContent({config,businessDocumentId,kind,canReadJournal=false,fetcher=globalThis.fetch}){
  const [page,setPage]=useState(null),[cursors,setCursors]=useState([null]),[busy,setBusy]=useState(false),[error,setError]=useState(null),[detail,setDetail]=useState(null);
  const mounted=useRef(false),busyRef=useRef(false),buttons=useRef(new Map()),returnId=useRef(null),wasDetail=useRef(false);
  const load=async(nextCursors)=>{if(busyRef.current)return;busyRef.current=true;setBusy(true);setError(null);try{const result=await readDocumentSettlementHistory({config,businessDocumentId,kind,afterId:nextCursors.at(-1),fetcher});if(!mounted.current)return;if(result.ok){setPage(result.data);setCursors(nextCursors);}else{setPage(null);setError(result.message);}}catch{if(mounted.current){setPage(null);setError('History could not be loaded. Refresh to retry.');}}finally{busyRef.current=false;if(mounted.current)setBusy(false);}};
  useEffect(()=>{mounted.current=true;load([null]);return()=>{mounted.current=false;};},[]);
  useEffect(()=>{if(wasDetail.current&&!detail)buttons.current.get(returnId.current)?.focus();wasDetail.current=!!detail;},[detail]);
  const open=async row=>{if(busyRef.current)return;busyRef.current=true;setBusy(true);setError(null);returnId.current=row.payment_occurrence_id;try{const result=await readSettlementJournal({config,row,fetcher});if(mounted.current){if(result.ok)setDetail(result);else setError(result.message);}}catch{if(mounted.current)setError('Journal details could not be loaded. Refresh to retry.');}finally{busyRef.current=false;if(mounted.current)setBusy(false);}};
  if(detail)return <AuthoritativeLineageDrill config={detail.config} fetcher={fetcher} initial={{kind:'JOURNAL',journal:detail.journal,context:{entityId:detail.config.entityId,periodId:detail.config.periodId,journalId:detail.journal.journal_entry_id,journalRevision:detail.journal.revision,journalCurrency:detail.journal.currency}}} onExit={()=>setDetail(null)}/>;
  return <section className="card" aria-label={kind==='AP_PAYMENT'?'Payment history':'Receipt history'} aria-busy={busy}>
    <div className="card-head"><h2>{kind==='AP_PAYMENT'?'Payment history':'Receipt history'}</h2><button className="btn btn-sm btn-ghost" type="button" disabled={busy} onClick={()=>load([null])}>Refresh history</button></div>
    {busy&&<p role="status">Loading…</p>}{error&&<p role="alert">{error}</p>}
    {page?.rows.length>0&&<div className="table-wrap" role="region" tabIndex={0} aria-label="Settlement history; scroll horizontally to see all fields"><table className="tbl"><thead><tr><th>Reference</th><th>Date</th><th>Payment period</th><th>Amount</th><th>Status</th><th>Journal</th></tr></thead><tbody>{page.rows.map(row=><tr key={row.payment_occurrence_id}><td>{row.journal_number||'Reference unavailable'}</td><td>{row.accounting_date}</td><td>{row.period_code}</td><td>{row.amount} {row.currency}</td><td>{row.status.replaceAll('_',' ')}</td><td>{row.posted_journal_entry_id||row.draft_journal_entry_id?<button type="button" className="btn btn-sm btn-ghost" disabled={busy||!canReadJournal} ref={element=>{if(element)buttons.current.set(row.payment_occurrence_id,element);else buttons.current.delete(row.payment_occurrence_id);}} onClick={()=>open(row)}>View journal · {row.journal_status.replaceAll('_',' ')}</button>:'Journal unavailable'}</td></tr>)}</tbody></table></div>}
    {page&&!page.rows.length&&<p>No {kind==='AP_PAYMENT'?'payments':'receipts'} returned for this document.</p>}
    {page&&(cursors.length>1||page.next_id)&&<nav className="pagination" aria-label="Settlement history pages"><button type="button" className="btn btn-sm btn-ghost" disabled={busy||cursors.length===1} onClick={()=>load(cursors.slice(0,-1))}>Previous</button><span>Page {cursors.length}</span><button type="button" className="btn btn-sm btn-ghost" disabled={busy||!page.next_id} onClick={()=>load([...cursors,page.next_id])}>Next</button></nav>}
  </section>;
}
