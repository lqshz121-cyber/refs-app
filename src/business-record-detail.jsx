import {NativeSettlementEntry} from './native-settlement-entry.jsx';
import {NativeRefundEntry} from './native-refund-entry.jsx';
import {NativeCreditAllocationEntry} from './native-credit-allocation.jsx';
import React,{useEffect,useRef,useState} from 'react';
import {readBusinessRecordJournal} from './business-record-detail.js';
import {AuthoritativeLineageDrill} from './authoritative-lineage-drill.jsx';
const labels={AP_BILL:'Bill',AR_INVOICE:'Invoice',AP_VENDOR_CREDIT:'Vendor credit',AR_CREDIT_MEMO:'Credit memo'};
export function BusinessRecordEvidence({config,record,canReadJournal=false,access,accounts=[],scopes=[],fetcher=globalThis.fetch,onBack,onOpenDraft,onRefresh}){
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
    {typeof onOpenDraft==='function'&&typeof onRefresh==='function'&&['AP_BILL','AR_INVOICE'].includes(record.record_kind)&&['APPROVED','OPEN','PARTIALLY_PAID'].includes(record.status)&&typeof record.open_balance==='string'&&/[1-9]/.test(record.open_balance)&&<NativeSettlementEntry config={config} kind={record.record_kind==='AP_BILL'?'AP_PAYMENT':'AR_RECEIPT'} businessDocumentId={record.record_id} access={access} accounts={accounts} scopes={scopes} fetcher={fetcher} onOpenDraft={onOpenDraft} onRefresh={onRefresh}/>}
    {typeof onRefresh==='function'&&['AP_VENDOR_CREDIT','AR_CREDIT_MEMO'].includes(record.record_kind)&&record.status==='POSTED'&&<NativeCreditAllocationEntry config={config} kind={record.record_kind} sourceAdjustmentId={record.record_id} access={access} fetcher={fetcher} onRefresh={onRefresh}/>}
    {typeof onOpenDraft==='function'&&typeof onRefresh==='function'&&record.record_kind==='AR_CREDIT_MEMO'&&record.status==='POSTED'&&<NativeRefundEntry config={config} sourceAdjustmentId={record.record_id} access={access} accounts={accounts} scopes={scopes} fetcher={fetcher} onOpenDraft={onOpenDraft} onRefresh={onRefresh}/>}
    {error&&<p role="alert">{error}</p>}
    {record.journal_entry_id?<button type="button" className="btn btn-sm" ref={trigger} disabled={busy||!canReadJournal} onClick={open}>View record journal · {record.journal_number}</button>:<p>No journal link returned for this record.</p>}
    <details><summary>Record identifiers</summary><p style={{overflowWrap:'anywhere'}}>Record: {record.record_id}<br/>Company: {config.entityId}<br/>Source document: {record.source_document_id||'Not available'}</p></details>
  </section>;
}
