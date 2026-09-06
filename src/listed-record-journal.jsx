import React,{useEffect,useRef,useState} from 'react';
import {readListedBusinessRecordJournal} from './business-record-detail.js';
import {AuthoritativeLineageDrill} from './authoritative-lineage-drill.jsx';
export function ListedRecordJournal({config,row,recordKind,access,fetcher=globalThis.fetch}){
  const [detail,setDetail]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState(null);
  const mounted=useRef(false),pending=useRef(false),trigger=useRef(null),wasDetail=useRef(false);
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
  useEffect(()=>{if(wasDetail.current&&!detail)trigger.current?.focus();wasDetail.current=!!detail;},[detail]);
  if(!['AP_BILL','AR_INVOICE','AP_VENDOR_CREDIT','AR_CREDIT_MEMO'].includes(recordKind)||access?.entity_id!==config?.entityId||access?.session_refresh_required!==false||!access?.actor_id||!access?.permissions?.includes('GL.JE.VIEW')||!access.permissions.includes(recordKind.startsWith('AP')?'AP.VIEW':'AR.VIEW'))return null;
  const open=async()=>{if(pending.current)return;pending.current=true;setBusy(true);setError(null);try{const r=await readListedBusinessRecordJournal({config,row,recordKind,fetcher});if(mounted.current){if(r.ok)setDetail(r);else setError(r.message);}}catch{if(mounted.current)setError('Journal could not be loaded. Retry.');}finally{pending.current=false;if(mounted.current)setBusy(false);}};
  if(detail)return <AuthoritativeLineageDrill config={detail.config} fetcher={fetcher} initial={{kind:'JOURNAL',journal:detail.journal,context:{entityId:detail.config.entityId,periodId:detail.config.periodId,journalId:detail.journal.journal_entry_id,journalRevision:detail.journal.revision,journalCurrency:detail.journal.currency}}} onExit={()=>setDetail(null)}/>;
  return <section aria-label="Business record journal"><button type="button" className="btn btn-sm" ref={trigger} disabled={busy} onClick={open}>{busy?'Loading journal…':'View journal'}</button>{error&&<p role="alert">{error}</p>}</section>;
}
