import React,{useEffect,useRef,useState} from 'react';
import {readSalesBankAccess,readSalesBankCandidates,prepareSalesBankMatch,sendSalesBankMatch} from './sales-receipt-bank-api.js';
const pendingMatches=new Map();
export function SalesReceiptBankMatch({config,row,fetcher=globalThis.fetch,onChanged=()=>{},onLockChange}){
 const [actor,setActor]=useState(null),[page,setPage]=useState(null),[selection,setSelection]=useState(''),[reason,setReason]=useState(''),[busy,setBusy]=useState(false),[message,setMessage]=useState(null),[pending,setPending]=useState(null),[cursors,setCursors]=useState([null]);
 const mounted=useRef(false),busyRef=useRef(false),owner=useRef(null),actionRef=useRef(null),selectionRef=useRef(null);
 const selected=page?.rows.find(item=>item.sales_receipt_id===selection);
 const run=async action=>{if(busyRef.current)return;busyRef.current=true;if(mounted.current)setBusy(true);try{await action();}catch{if(mounted.current)setMessage('The operation could not be confirmed. Retry without changing the request.');}finally{busyRef.current=false;if(mounted.current)setBusy(false);}};
 const load=async nextCursors=>{
  setPage(null);setSelection('');setMessage(null);
  const result=await readSalesBankCandidates({config,bankSourceId:row.bank_source_id,afterId:nextCursors.at(-1),fetcher});if(!mounted.current)return;
  if(result.ok&&result.data.bank_revision===String(row.version)){setPage(result.data);setCursors(nextCursors);}else setMessage(result.ok?'This bank transaction changed. Refresh its details before matching.':result.message);
 };
 const initialize=async()=>{
  setPage(null);setSelection('');setMessage(null);
  const access=await readSalesBankAccess({config,fetcher});if(!mounted.current)return;if(!access.ok){setMessage(access.message);return;}
  setActor(access.actorId);owner.current=JSON.stringify([config.baseUrl,config.entityId,row.bank_source_id,access.actorId]);
  const saved=pendingMatches.get(owner.current);if(saved){setPending(saved);setMessage(saved.receipt?'Match saved. Refresh the bank transaction to verify it.':'An earlier match is awaiting confirmation. Retry the same request.');}else await load([null]);
 };
 useEffect(()=>{mounted.current=true;run(initialize);return()=>{mounted.current=false;};},[]);
 useEffect(()=>{onLockChange?.(busy||!!pending);},[busy,pending,onLockChange]);
 useEffect(()=>{if(!busy){if(pending)actionRef.current?.focus();else if(page&&!selection)selectionRef.current?.focus();}},[busy,pending,page,selection]);
 const refresh=async saved=>{
  const result=await onChanged();const fresh=result?.ok&&result.rows?.find(item=>item.bank_source_id===row.bank_source_id);
  if(fresh?.bank_match_id===saved.receipt.bank_match_id&&fresh.match_status==='ACTIVE'&&fresh.match_source_kind==='SALES_RECEIPT'&&fresh.sales_receipt_id===saved.command.body.salesReceiptId&&fresh.ledger_line_id===saved.command.trace.ledger_line_id){pendingMatches.delete(owner.current);if(mounted.current){setPending(saved);setMessage('Sales receipt matched and bank record refreshed.');}}
  else if(fresh){pendingMatches.delete(owner.current);if(mounted.current){setPending(null);setPage(null);setSelection('');setMessage('The bank match changed after this request. Review the current bank record before matching again.');}}
  else if(mounted.current)setMessage('Match saved. The refreshed bank record is not yet confirmed; refresh again.');
 };
 const submit=()=>run(async()=>{
  let saved=pending;
  if(!saved){const prepared=await prepareSalesBankMatch({config,bank:row,candidate:selected,bankRevision:page?.bank_revision,reason,expectedActorId:actor,fetcher});if(!mounted.current)return;if(!prepared.ok){setMessage(prepared.message);return;}saved={command:prepared.command};pendingMatches.set(owner.current,saved);setPending(saved);}
  if(saved.receipt){await refresh(saved);return;}
  const result=await sendSalesBankMatch({config,command:saved.command,fetcher});
  if(result.ok){saved={...saved,receipt:result.data};pendingMatches.set(owner.current,saved);if(mounted.current){setPending(saved);await refresh(saved);}return;}
  if(result.attempted&&result.unconfirmed===false){pendingMatches.delete(owner.current);if(mounted.current){setPending(null);setPage(null);setSelection('');}}
  if(mounted.current)setMessage(result.message);
 });
 return <section className="card" aria-label="Match a sales receipt"><div className="card-head"><div><h2>Match a sales receipt</h2><p className="muted sm">Choose a posted receipt for this bank deposit. Matching does not create another accounting entry.</p></div></div>
 {busy&&<p role="status">Loading or confirming the match…</p>}{message&&<p role="status">{message}</p>}
 {pending?<button ref={actionRef} type="button" className="btn btn-primary" disabled={busy} onClick={submit}>{pending.receipt?'Refresh matched bank record':'Retry same match request'}</button>:<>
 {!busy&&<div className="button-row"><button type="button" className="btn" onClick={()=>run(initialize)}>Reload matching receipts</button><button type="button" className="btn" onClick={()=>run(async()=>{const result=await onChanged();if(!mounted.current)return;if(result?.ok)await initialize();else setMessage('The bank record could not be refreshed. Retry the read.');})}>Refresh bank record</button></div>}
 {page&&<><p>{page.rows.length} matching receipts on this page.</p><label>Sales receipt<select ref={selectionRef} style={{maxWidth:'100%'}} value={selection} disabled={busy} onChange={event=>setSelection(event.target.value)}><option value="">Choose a receipt</option>{page.rows.map(item=><option key={item.sales_receipt_id} value={item.sales_receipt_id}>{item.receipt_number} · {item.customer_name} · {item.amount} {item.currency}</option>)}</select></label>
 <div className="button-row"><button type="button" className="btn btn-sm" disabled={busy||cursors.length<2} onClick={()=>run(()=>load(cursors.slice(0,-1)))}>Previous receipts</button><button type="button" className="btn btn-sm" disabled={busy||!page.next_id} onClick={()=>run(()=>load([...cursors,page.next_id]))}>Next receipts</button></div>
 {selected&&<div className="qbo-toolgrid" aria-label="Selected sales receipt evidence"><span><i>Receipt</i><b>{selected.receipt_number}</b></span><span><i>Customer</i><b>{selected.customer_name}</b></span><span><i>Amount</i><b>{selected.amount} {selected.currency}</b></span><span><i>Accounting date</i><b>{selected.accounting_date}</b></span><span><i>Journal</i><b style={{overflowWrap:'anywhere'}}>{selected.journal_entry_id}</b></span></div>}
 <form onSubmit={event=>{event.preventDefault();submit();}}><label>Review reason<input value={reason} minLength={8} maxLength={2000} required disabled={busy} onChange={event=>setReason(event.target.value)}/></label><button type="submit" className="btn btn-primary" disabled={busy||!selected||reason.trim().length<8}>Match sales receipt</button></form></>}
 </>}
 </section>;
}
