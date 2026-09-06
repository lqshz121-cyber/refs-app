import React,{useEffect,useRef,useState} from 'react';
import {readBusinessRecordJournal} from './business-record-detail.js';
import {AuthoritativeLineageDrill} from './authoritative-lineage-drill.jsx';
const labels={AP_BILL:'Bill',AR_INVOICE:'Invoice',AP_VENDOR_CREDIT:'Vendor credit',AR_CREDIT_MEMO:'Credit memo'};
export function BusinessRecordEvidence({config,record,canReadJournal=false,fetcher=globalThis.fetch,onBack}){
  const [journal,setJournal]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState(null);
  const mounted=useRef(false),busyRef=useRef(false),heading=useRef(null),trigger=useRef(null),wasJournal=useRef(false);
  useEffect(()=>{mounted.current=true;heading.current?.focus();return()=>{mounted.current=false;};},[]);
  useEffect(()=>{if(wasJournal.current&&!journal)trigger.current?.focus();wasJournal.current=!!journal;},[journal]);
  const open=async()=>{if(busyRef.current)return;busyRef.current=true;setBusy(true);setError(null);try{const result=await readBusinessRecordJournal({config,record,fetcher});if(mounted.current){if(result.ok)setJournal(result);else setError(result.message);}}catch{if(mounted.current)setError('Journal details could not be loaded. Retry.');}finally{busyRef.current=false;if(mounted.current)setBusy(false);}};
  if(journal)return <AuthoritativeLineageDrill config={journal.config} fetcher={fetcher} initial={{kind:'JOURNAL',journal:journal.journal,context:{entityId:journal.config.entityId,periodId:journal.config.periodId,journalId:journal.journal.journal_entry_id,journalRevision:journal.journal.revision,journalCurrency:journal.journal.currency}}} onExit={()=>setJournal(null)}/>;
  return <section className="card" aria-label="Linked business record" aria-busy={busy}>
    <button type="button" className="btn btn-sm btn-ghost" disabled={busy} onClick={onBack}>Back to credit history</button>
    <h2 tabIndex={-1} ref={heading}>{labels[record.record_kind]} · {record.number||'Reference unavailable'}</h2>
    <p>{record.status} · Revision {record.revision}</p>
    <dl className="detail-grid"><div><dt>Counterparty</dt><dd>{record.counterparty_name||record.counterparty_ref||'Not available'}</dd></div><div><dt>Date</dt><dd>{record.accounting_date}</dd></div><div><dt>Amount</dt><dd>{record.amount} {record.currency}</dd></div>{record.open_balance!==null&&<div><dt>Open balance</dt><dd>{record.open_balance} {record.currency}</dd></div>}{record.due_date&&<div><dt>Due date</dt><dd>{record.due_date}</dd></div>}</dl>
    {record.description&&<p>{record.description}</p>}
    {error&&<p role="alert">{error}</p>}
    {record.journal_entry_id?<button type="button" className="btn btn-sm" ref={trigger} disabled={busy||!canReadJournal} onClick={open}>View record journal · {record.journal_number}</button>:<p>No journal link returned for this record.</p>}
    <details><summary>Record identifiers</summary><p style={{overflowWrap:'anywhere'}}>Record: {record.record_id}<br/>Company: {config.entityId}<br/>Source document: {record.source_document_id||'Not available'}</p></details>
  </section>;
}
