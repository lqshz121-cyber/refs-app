import React,{useEffect,useRef,useState} from 'react';
import {readBankSalesReceipt,readBankSalesReceiptJournal} from './bank-sales-receipt-detail.js';
import {AuthoritativeLineageDrill} from './authoritative-lineage-drill.jsx';
import {formatExactCurrency} from './exact-currency.js';
export function BankSalesReceiptDetail({config,row,fetcher=globalThis.fetch}){
 const [record,setRecord]=useState(null),[journal,setJournal]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState(null);
 const mounted=useRef(false),busyRef=useRef(false),trigger=useRef(null),heading=useRef(null),journalTrigger=useRef(null),wasRecord=useRef(false),wasJournal=useRef(false);
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
 useEffect(()=>{if(record&&!journal)heading.current?.focus();if(wasRecord.current&&!record)trigger.current?.focus();if(wasJournal.current&&!journal)journalTrigger.current?.focus();wasRecord.current=!!record;wasJournal.current=!!journal;},[record,journal]);
 const open=async(asJournal=false)=>{if(busyRef.current)return;busyRef.current=true;setBusy(true);setError(null);try{
  const result=await (asJournal?readBankSalesReceiptJournal:readBankSalesReceipt)({config,row,fetcher});if(!mounted.current)return;
  if(!result.ok){setError(result.message);return;}setRecord(result.record);if(asJournal)setJournal(result);
 }catch{if(mounted.current)setError('The linked receipt could not be loaded. Retry.');}finally{busyRef.current=false;if(mounted.current)setBusy(false);}};
 if(journal)return <AuthoritativeLineageDrill config={journal.config} fetcher={fetcher} initial={{kind:'JOURNAL',journal:journal.journal,context:{entityId:config.entityId,periodId:record.period_id,journalId:journal.journal.journal_entry_id,journalRevision:journal.journal.revision,journalCurrency:journal.journal.currency}}} onExit={()=>setJournal(null)}/>;
 return <section className="stack" aria-label="Bank sales receipt source" aria-busy={busy} style={{overflowWrap:'anywhere'}}>
 {record?<><button type="button" className="btn btn-sm" disabled={busy} onClick={()=>{setRecord(null);setError(null);}}>Back to match evidence</button><h3 ref={heading} tabIndex={-1}>Sales receipt · {record.receipt_number}</h3><p>{record.customer_name} · {record.accounting_date}</p><strong>{formatExactCurrency(record.amount,record.currency)}</strong><dl className="detail-grid"><div><dt>Status</dt><dd>{record.status}</dd></div><div><dt>Bank</dt><dd>{record.bank_member_ref}</dd></div><div><dt>Cash account</dt><dd>{record.cash_account_code}</dd></div><div><dt>Category</dt><dd>{record.category_account_code}</dd></div><div><dt>Journal</dt><dd>{record.journal_number}</dd></div></dl><p>{record.description}</p><button ref={journalTrigger} type="button" className="btn btn-sm" disabled={busy} onClick={()=>open(true)}>Open matched journal</button></>:<button ref={trigger} type="button" className="btn btn-sm" disabled={busy} onClick={()=>open()}>Open sales receipt</button>}
 {busy&&<p role="status">Loading source evidence…</p>}{error&&<p role="alert">{error}</p>}
 </section>;
}
