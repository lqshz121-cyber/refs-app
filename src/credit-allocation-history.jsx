import React,{useEffect,useRef,useState} from 'react';
import {readCreditAllocationHistory,readCreditAllocationJournal} from './credit-allocation-history.js';
import {AuthoritativeLineageDrill} from './authoritative-lineage-drill.jsx';
export function CreditAllocationHistory({config,subjectId,kind,access,fetcher=globalThis.fetch}){
  if(!['AP_VENDOR_CREDIT','AR_CREDIT_MEMO','AP_BILL','AR_INVOICE'].includes(kind)||typeof access?.actor_id!=='string'||!access.actor_id.trim()||access.entity_id!==config?.entityId||access.session_refresh_required!==false||!access.permissions?.includes(kind.startsWith('AP')?'AP.VIEW':'AR.VIEW'))return null;
  return <CreditAllocationHistoryContent key={`${config.baseUrl}:${config.entityId}:${subjectId}:${kind}:${access.actor_id}`} config={config} subjectId={subjectId} kind={kind} canReadJournal={access.permissions.includes('GL.JE.VIEW')} fetcher={fetcher}/>;
}
export function CreditAllocationHistoryContent({config,subjectId,kind,canReadJournal=false,fetcher=globalThis.fetch}){
  const [page,setPage]=useState(null),[cursors,setCursors]=useState([null]),[busy,setBusy]=useState(false),[error,setError]=useState(null),[detail,setDetail]=useState(null);
  const mounted=useRef(false),busyRef=useRef(false),buttons=useRef(new Map()),returnId=useRef(null),wasDetail=useRef(false);
  const load=async next=>{if(busyRef.current)return;busyRef.current=true;setBusy(true);setError(null);try{const r=await readCreditAllocationHistory({config,subjectId,kind,afterId:next.at(-1),fetcher});if(mounted.current){if(r.ok){setPage(r.data);setCursors(next);}else{setPage(null);setError(r.message);}}}catch{if(mounted.current){setPage(null);setError('History could not be loaded. Refresh to retry.');}}finally{busyRef.current=false;if(mounted.current)setBusy(false);}};
  useEffect(()=>{mounted.current=true;load([null]);return()=>{mounted.current=false;};},[]);
  useEffect(()=>{if(wasDetail.current&&!detail)buttons.current.get(returnId.current)?.focus();wasDetail.current=!!detail;},[detail]);
  const open=async row=>{if(busyRef.current)return;busyRef.current=true;setBusy(true);setError(null);returnId.current=row.business_allocation_id;try{const r=await readCreditAllocationJournal({config,row,fetcher});if(mounted.current){if(r.ok)setDetail(r);else setError(r.message);}}catch{if(mounted.current)setError('Journal details could not be loaded. Refresh to retry.');}finally{busyRef.current=false;if(mounted.current)setBusy(false);}};
  if(detail)return <AuthoritativeLineageDrill config={detail.config} fetcher={fetcher} initial={{kind:'JOURNAL',journal:detail.journal,context:{entityId:detail.config.entityId,periodId:detail.config.periodId,journalId:detail.journal.journal_entry_id,journalRevision:detail.journal.revision,journalCurrency:detail.journal.currency}}} onExit={()=>setDetail(null)}/>;
  return <section className="card" aria-label="Credit allocation history" aria-busy={busy}>
    <div className="card-head"><h2>Credit allocation history</h2><button type="button" className="btn btn-sm btn-ghost" disabled={busy} onClick={()=>load([null])}>Refresh credit history</button></div>
    {busy&&<p role="status">Loading…</p>}{error&&<p role="alert">{error}</p>}
    {page?.rows.length>0&&<div className="table-wrap" role="region" tabIndex={0} aria-label="Credit allocations; scroll horizontally to view all fields"><table className="tbl" style={{minWidth:760,whiteSpace:'nowrap'}}><thead><tr><th>Credit</th><th>Document</th><th>Recorded</th><th>Amount</th><th>Status</th><th>Journal</th></tr></thead><tbody>{page.rows.map(row=><tr key={row.business_allocation_id}><td title={row.business_adjustment_id}>{row.credit_number||'Reference unavailable'}</td><td title={row.business_document_id}>{row.document_number}</td><td>{row.created_at.replace('T',' ').slice(0,19)} UTC</td><td>{row.amount} {row.currency}</td><td>{row.status}</td><td>{row.journal_entry_id?<button type="button" className="btn btn-sm btn-ghost" disabled={busy||!canReadJournal} ref={element=>{if(element)buttons.current.set(row.business_allocation_id,element);else buttons.current.delete(row.business_allocation_id);}} onClick={()=>open(row)}>View journal · {row.journal_number}</button>:'Not posted'}</td></tr>)}</tbody></table></div>}
    {page&&!page.rows.length&&<p>No credit allocations recorded for this record.</p>}
    {page&&(cursors.length>1||page.next_id)&&<nav className="pagination" aria-label="Credit history pages"><button type="button" className="btn btn-sm btn-ghost" disabled={busy||cursors.length===1} onClick={()=>load(cursors.slice(0,-1))}>Previous</button><span>Page {cursors.length}</span><button type="button" className="btn btn-sm btn-ghost" disabled={busy||!page.next_id} onClick={()=>load([...cursors,page.next_id])}>Next</button></nav>}
  </section>;
}

