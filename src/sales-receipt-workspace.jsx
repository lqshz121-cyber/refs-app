import React,{useEffect,useRef,useState} from 'react';
import {readSalesReceiptPage,readSalesReceipt} from './sales-receipt-api.js';
import {readBusinessRecordJournal} from './business-record-detail.js';
import {AuthoritativeLineageDrill} from './authoritative-lineage-drill.jsx';
import {formatExactCurrency} from './exact-currency.js';
import {SalesReceiptEntry} from './sales-receipt-entry.jsx';
import {readSalesReceiptForWorkflow} from './sales-receipt-workflow.js';
export function SalesReceiptWorkspace({config,access,scope,fetcher=globalThis.fetch,onOpenDraft}){
 const [version,setVersion]=useState(0);
 const allowed=access?.entity_id===config?.entityId&&typeof access?.actor_id==='string'&&access.actor_id.length>0&&access.session_refresh_required===false&&access.permissions?.includes('AR.VIEW');
 return <div className="stack"><SalesReceiptEntry key={`${config?.baseUrl}:${config?.entityId}:${config?.periodId}:${access?.actor_id}`} config={config} access={access} scope={scope} fetcher={fetcher} onOpenDraft={onOpenDraft} onSaved={()=>setVersion(v=>v+1)}/>
 {allowed?<ReceiptList key={`${config.baseUrl}:${config.entityId}:${config.periodId}:${access.actor_id}:${version}`} config={config} access={access} fetcher={fetcher} onOpenDraft={onOpenDraft}/>:<section className="card"><h2>Sales receipts</h2><p role="status">Sales receipt access is unavailable for this company.</p></section>}</div>;
}
function ReceiptList({config,access,fetcher,onOpenDraft}){
 const [cursors,setCursors]=useState([null]),[version,setVersion]=useState(0),[page,setPage]=useState(null),[record,setRecord]=useState(null),[journal,setJournal]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState(null);
 const mounted=useRef(false),busyRef=useRef(false),heading=useRef(null),returnRef=useRef(null),returnId=useRef(null),journalTrigger=useRef(null),wasDetail=useRef(false),wasJournal=useRef(false);
 const cursor=cursors[cursors.length-1];
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
 useEffect(()=>{let current=true;setPage(null);setError(null);setBusy(true);busyRef.current=true;
  readSalesReceiptPage({config,afterId:cursor,fetcher}).then(result=>{if(current){if(result.ok)setPage(result.data);else setError(result.message);}}).catch(()=>{if(current)setError('Sales receipts could not be loaded. Retry.');}).finally(()=>{if(current){setBusy(false);busyRef.current=false;}});
  return()=>{current=false;};
 },[config,fetcher,cursor,version]);
 useEffect(()=>{if(record&&!journal)heading.current?.focus();if(wasDetail.current&&!record)returnRef.current?.focus();if(wasJournal.current&&!journal)journalTrigger.current?.focus();wasDetail.current=!!record;wasJournal.current=!!journal;},[record,journal]);
 const run=async task=>{if(busyRef.current)return;busyRef.current=true;setBusy(true);setError(null);try{await task();}catch{if(mounted.current)setError('The receipt could not be opened. Retry.');}finally{busyRef.current=false;if(mounted.current)setBusy(false);}};
 const open=(row,button)=>run(async()=>{returnId.current=row.sales_receipt_id;returnRef.current=button;const result=await readSalesReceipt({config,receiptId:row.sales_receipt_id,fetcher});if(!mounted.current)return;
  if(!result.ok){setError(result.message);return;}
  const current=result.data.record;if(current.period_id!==config.periodId||current.revision!==row.revision||current.status!==row.status||current.journal_revision!==row.journal_revision){setError('This receipt changed. Refresh the list and reopen it.');return;}
  setRecord(current);
 });
 const openJournal=()=>run(async()=>{const result=await readBusinessRecordJournal({config,record,fetcher});if(mounted.current){if(result.ok)setJournal(result);else setError(result.message);}});
 const openDraft=()=>run(async()=>{const result=await readSalesReceiptForWorkflow({config,record,fetcher});if(!mounted.current)return;if(!result.ok){setError(result.message);return;}await onOpenDraft(result.record);});
 if(journal)return <AuthoritativeLineageDrill config={journal.config} fetcher={fetcher} initial={{kind:'JOURNAL',journal:journal.journal,context:{entityId:config.entityId,periodId:record.period_id,journalId:journal.journal.journal_entry_id,journalRevision:journal.journal.revision,journalCurrency:journal.journal.currency}}} onExit={()=>setJournal(null)}/>;
 if(record)return <section className="card stack" aria-label="Sales receipt details" aria-busy={busy}>
  <button className="btn btn-ghost" type="button" disabled={busy} onClick={()=>{setRecord(null);setError(null);}}>Back to sales receipts</button>
  <h2 ref={heading} tabIndex={-1}>Sales receipt · {record.receipt_number}</h2>
  <p>{record.customer_name} · {record.accounting_date}</p><strong>{formatExactCurrency(record.amount,record.currency)}</strong>
  <dl className="detail-grid"><div><dt>Status</dt><dd>{record.status}</dd></div><div><dt>Journal status</dt><dd>{record.journal_status}</dd></div><div><dt>Bank</dt><dd>{record.bank_member_ref}</dd></div><div><dt>Cash account</dt><dd>{record.cash_account_code}</dd></div><div><dt>Category</dt><dd>{record.category_account_code}</dd></div><div><dt>Reference</dt><dd>{record.journal_number}</dd></div></dl>
  <p>{record.description}</p>{error&&<p role="alert">{error}</p>}
  {access.permissions.includes('GL.JE.VIEW')&&<button className="btn" type="button" ref={journalTrigger} disabled={busy} onClick={openJournal}>Open journal</button>}
  {record.journal_status==='DRAFT'&&access.permissions.includes('GL.JE.VIEW')&&typeof onOpenDraft==='function'&&<button className="btn" type="button" disabled={busy} onClick={openDraft}>Open draft workflow</button>}
 </section>;
 return <section className="card stack" aria-label="Sales receipts" aria-busy={busy}>
  <div className="filter-bar"><h2>Sales receipts</h2><button className="btn btn-ghost" type="button" disabled={busy} onClick={()=>{setCursors([null]);setVersion(v=>v+1);}}>Refresh sales receipts</button></div>
  {busy&&<p role="status">Loading sales receipts…</p>}{error&&<p role="alert">{error}</p>}
  {page&&<><div className="table-wrap" role="region" tabIndex={0} aria-label="Sales receipts table; scroll horizontally" style={{overflowX:'auto'}}><table className="tbl" style={{minWidth:700}}><thead><tr><th>Number</th><th>Customer</th><th>Date</th><th>Amount</th><th>Status</th><th>Journal</th></tr></thead><tbody>{page.rows.map(row=><tr key={row.sales_receipt_id}><td><button className="btn btn-sm btn-ghost" type="button" disabled={busy} ref={element=>{if(row.sales_receipt_id===returnId.current)returnRef.current=element;}} onClick={event=>open(row,event.currentTarget)}>{row.receipt_number}</button></td><td>{row.customer_name}</td><td>{row.accounting_date}</td><td>{formatExactCurrency(row.amount,row.currency)}</td><td>{row.status}</td><td>{row.journal_status}</td></tr>)}</tbody></table></div>
  {page.rows.length===0&&<p>No sales receipts in this period.</p>}
  <div className="filter-bar"><button className="btn btn-sm" type="button" disabled={busy||cursors.length===1} onClick={()=>setCursors(current=>current.slice(0,-1))}>Previous receipts</button><span>Page {cursors.length} · {page.rows.length} receipts</span><button className="btn btn-sm" type="button" disabled={busy||!page.next_id} onClick={()=>setCursors(current=>[...current,page.next_id])}>Next receipts</button></div></>}
 </section>;
}
