import React,{useEffect,useRef,useState} from 'react';
import {readAuthoritativeJournalEntryDetail,readAuthoritativeJournalWorkflowCapabilities} from './accounting-api.js';
import {nextAuthoritativeJournalWorkflowAction,runAuthoritativeJournalWorkflow} from './authoritative-journal-workspace.jsx';
import {AuthoritativeLineageDrill} from './authoritative-lineage-drill.jsx';
export function SingleJournalWorkflow({config,journalEntryId,fetcher=globalThis.fetch,environment=globalThis,onBack,onChanged}){
 const [journal,setJournal]=useState(null),[capabilities,setCapabilities]=useState(null),[busy,setBusy]=useState(true),[error,setError]=useState(null),[notice,setNotice]=useState(null),[evidence,setEvidence]=useState(false);
 const mounted=useRef(false),serial=useRef(0),busyRef=useRef(false),heading=useRef(null),evidenceTrigger=useRef(null),wasEvidence=useRef(false);
 const refresh=async()=>{const request=++serial.current;busyRef.current=true;setBusy(true);setJournal(null);setCapabilities(null);setError(null);setNotice(null);
  try{const [detail,access]=await Promise.all([readAuthoritativeJournalEntryDetail({config,journalEntryId,fetcher}),readAuthoritativeJournalWorkflowCapabilities({config,fetcher})]);
   if(!mounted.current||request!==serial.current)return;if(!detail.ok||!access.ok){setError((!detail.ok?detail:access).message);return;}setJournal(detail.journal);setCapabilities(access.capabilities);
  }catch{if(mounted.current&&request===serial.current)setError('This journal could not be loaded. Refresh and retry.');}
  finally{if(mounted.current&&request===serial.current){busyRef.current=false;setBusy(false);}}
 };
 useEffect(()=>{mounted.current=true;refresh();return()=>{mounted.current=false;serial.current++;};},[config,journalEntryId,fetcher]);
 useEffect(()=>{if(journal&&!evidence)heading.current?.focus();if(wasEvidence.current&&!evidence)evidenceTrigger.current?.focus();wasEvidence.current=evidence;},[journal?.journal_entry_id,evidence]);
 const act=async()=>{if(busyRef.current||!journal)return;const request=++serial.current;busyRef.current=true;setBusy(true);setError(null);setNotice(null);
  try{const result=await runAuthoritativeJournalWorkflow({journal,config,fetcher,environment,refreshMode:'DETAIL'});
   if(!result.cancelled)onChanged?.();
   if(!mounted.current||request!==serial.current)return;
   if(result.cancelled)return;
   if(!result.ok){setJournal(null);setCapabilities(null);setError(result.message);return;}
   setJournal(result.journal);setNotice(`${result.action} completed. The saved journal has been refreshed.`);
   const access=await readAuthoritativeJournalWorkflowCapabilities({config,fetcher});if(!mounted.current||request!==serial.current)return;
   if(access.ok)setCapabilities(access.capabilities);else{setCapabilities(null);setError(access.message);}
  }catch{if(mounted.current&&request===serial.current){setJournal(null);setCapabilities(null);setError('The workflow result could not be confirmed. Refresh this journal before continuing.');}onChanged?.();}
  finally{if(mounted.current&&request===serial.current){busyRef.current=false;setBusy(false);}}
 };
 if(evidence&&journal)return <AuthoritativeLineageDrill config={config} fetcher={fetcher} initial={{kind:'JOURNAL',journal,context:{entityId:config.entityId,periodId:config.periodId,journalId:journal.journal_entry_id,journalRevision:journal.revision,journalCurrency:journal.currency}}} onExit={()=>setEvidence(false)}/>;
 const next=nextAuthoritativeJournalWorkflowAction(journal,capabilities,config?.entityId);
 return <section className="card stack" aria-label="Single journal workflow" aria-busy={busy}>
  <div className="filter-bar"><button type="button" className="btn btn-ghost" disabled={busy} onClick={onBack}>Back to journal register</button><button type="button" className="btn btn-ghost" disabled={busy} onClick={refresh}>Refresh this journal</button></div>
  <h2 tabIndex={-1} ref={heading}>Journal workflow{journal?' · '+journal.journal_number:''}</h2>
  {busy&&<p role="status">Working…</p>}{error&&<p role="alert">{error}</p>}{notice&&<p role="status">{notice}</p>}
  {journal&&<><dl className="detail-grid"><div><dt>Status</dt><dd>{journal.status}</dd></div><div><dt>Revision</dt><dd>{journal.revision}</dd></div><div><dt>Date</dt><dd>{journal.journal_date}</dd></div><div><dt>Currency</dt><dd>{journal.currency}</dd></div></dl>
  <div className="filter-bar"><button type="button" className="btn" ref={evidenceTrigger} disabled={busy} onClick={()=>setEvidence(true)}>View journal evidence</button>{next&&<button type="button" className="btn" disabled={busy} onClick={act}>{next.label}</button>}</div>
  {!next&&<p className="muted sm">{journal.status==='POSTED'?'This journal is posted.':'No workflow action is available for your current access and this journal status.'}</p>}</>}
 </section>;
}
