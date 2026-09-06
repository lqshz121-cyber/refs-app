import React,{useEffect,useId,useRef,useState} from 'react';
import {refreshAuthoritativeChartOfAccounts} from './accounting-api.js';
import {nativeSettlementAccess,readNativeSettlementContext,readNativeSettlementBanks,validateNativeSettlementDraft,uploadNativeSettlementSupport,prepareNativeSettlement,sendNativeSettlement} from './native-settlement-entry.js';

export function NativeSettlementEntry({config,kind,businessDocumentId,access,accounts=[],scopes=[],fetcher=globalThis.fetch,onOpenDraft,onRefresh}){
  const [periodId,setPeriodId]=useState('');
  const choices=scopes.filter(row=>row.entity_id===config?.entityId&&row.period_status==='OPEN');
  const selected=choices.find(row=>row.period_id===(periodId||config?.periodId))||choices[0]||{entity_id:config?.entityId,period_id:config?.periodId};
  const paymentConfig={...config,periodId:selected.period_id};
  const [open,setOpen]=useState(false),trigger=useRef(null),wasOpen=useRef(false),id=useId();
  useEffect(()=>{if(wasOpen.current&&!open)trigger.current?.focus();wasOpen.current=open;},[open]);
  if(!nativeSettlementAccess(config,kind,access))return null;
  return <section className="card native-document-entry" aria-label={kind==='AP_PAYMENT'?'Bill payment':'Invoice receipt'}>
    <button type="button" className="btn" ref={trigger} disabled={open||scopes.length>0&&!choices.length} aria-expanded={open} aria-controls={id} onClick={()=>setOpen(true)}>{kind==='AP_PAYMENT'?'Record payment':'Receive payment'}</button>
    {scopes.length>0&&<label>Payment period<select disabled={open||!choices.length} value={selected.period_id} onChange={event=>setPeriodId(event.target.value)}>{!choices.length&&<option value={config.periodId}>No open payment period</option>}{choices.map(row=><option key={row.period_id} value={row.period_id}>{row.period_code}</option>)}</select></label>}
    {open&&<NativeSettlementForm key={`${config.entityId}:${selected.period_id}:${businessDocumentId}:${access.actor_id}`} id={id} config={paymentConfig} kind={kind} businessDocumentId={businessDocumentId} access={access} accounts={accounts} fetcher={fetcher} onOpenDraft={receipt=>onOpenDraft?.(receipt,selected)} onClose={saved=>{setOpen(false);if(saved)onRefresh?.();}}/>}
  </section>;
}
export function NativeSettlementForm({id,config,kind,businessDocumentId,access,accounts=[],fetcher=globalThis.fetch,onOpenDraft,onClose}){
  const [currentAccounts,setCurrentAccounts]=useState([]);
  const [context,setContext]=useState(null),[page,setPage]=useState(null),[query,setQuery]=useState(''),[bank,setBank]=useState(null);
  const [draft,setDraft]=useState({number:'',date:'',amount:'',cashAccountCode:'',reason:''}),[file,setFile]=useState(null),[attachment,setAttachment]=useState(null);
  const [uploadAttempt,setUploadAttempt]=useState(0),[uploadClosed,setUploadClosed]=useState(false),[command,setCommand]=useState(null),[receipt,setReceipt]=useState(null);
  const [busy,setBusy]=useState(false),[message,setMessage]=useState('Loading payment details…');
  const mounted=useRef(false),busyRef=useRef(false),heading=useRef(null),attempted=useRef(false);
  const run=async action=>{if(busyRef.current)return;busyRef.current=true;setBusy(true);try{await action();}catch{if(mounted.current)setMessage('The result could not be confirmed. Retry the same request.');}finally{busyRef.current=false;if(mounted.current)setBusy(false);}};
  const load=()=>run(async()=>{const [c,b,a]=await Promise.all([readNativeSettlementContext({config,kind,businessDocumentId,fetcher}),readNativeSettlementBanks({config,kind,fetcher}),refreshAuthoritativeChartOfAccounts({config,fetcher})]);if(!mounted.current)return;setContext(c.ok?c.data:null);setCurrentAccounts(a.ok?a.rows:[]);if(b.ok)setPage(b.data);setMessage(!c.ok?c.message:!b.ok?b.message:!a.ok?a.message:c.data.can_create_draft?'':'This document has no available balance in the selected open period.');});
  useEffect(()=>{mounted.current=true;heading.current?.focus();load();return()=>{mounted.current=false;};},[]);
  useEffect(()=>{if(!command||receipt)return;const warn=event=>{event.preventDefault();event.returnValue='';};globalThis.addEventListener?.('beforeunload',warn);return()=>globalThis.removeEventListener?.('beforeunload',warn);},[command,receipt]);
  const search=afterRef=>run(async()=>{const result=await readNativeSettlementBanks({config,kind,query:query.trim(),afterRef,fetcher});if(!mounted.current)return;if(result.ok){setPage(result.data);setBank(null);setMessage('');}else setMessage(result.message);});
  const save=()=>run(async()=>{
    let prepared=command;
    if(!prepared){
      const valid=validateNativeSettlementDraft({config,kind,businessDocumentId,draft,bank,context,accounts:currentAccounts});if(!valid.ok){setMessage(valid.message);return;}
      let support=attachment;
      if(!support){setMessage('Uploading supporting document…');const attempt=uploadAttempt+(uploadClosed?1:0);setUploadAttempt(attempt);setUploadClosed(false);support=await uploadNativeSettlementSupport({config,kind,file,expectedActorId:access.actor_id,uploadAttempt:attempt,fetcher});if(!mounted.current)return;if(!support.ok){setUploadClosed(support.code==='ATTACHMENT_RESERVATION_CLOSED');setMessage(support.message);return;}setAttachment(support);}
      setMessage('Saving draft…');const result=await prepareNativeSettlement({config,kind,businessDocumentId,draft,bank,attachmentId:support.attachmentId,expectedActorId:access.actor_id,fetcher});if(!mounted.current)return;if(!result.ok){setMessage(result.message);return;}prepared=result.command;setCommand(prepared);
    }
    const result=await sendNativeSettlement({config,command:prepared,fetcher});if(!mounted.current)return;
    if(result.ok){setReceipt(result.data);setMessage('Draft saved. Open it to review and continue the approval workflow.');}
    else{if(result.unconfirmed)attempted.current=true;if(!attempted.current)setCommand(null);setMessage(result.message);}
  });
  const update=(key,value)=>setDraft(current=>({...current,[key]:value}));
  const eligible=currentAccounts.filter(row=>row.active===true&&row.requires_member===true&&row.required_member_type==='BANK'&&row.period_id===config.periodId&&(!row.entity_id||row.entity_id===config.entityId));
  return <div id={id} className="native-document-form"><h3 ref={heading} tabIndex={-1}>{kind==='AP_PAYMENT'?'Record bill payment':'Receive invoice payment'}</h3>
    {context&&<p>{context.document.document_number} · {context.document.counterparty_name} · {context.document.currency}<br/>Open balance {context.document.open_balance} · Pending drafts {context.pending_allocation_amount} · Available {context.available_amount}</p>}
    <form aria-busy={busy} onSubmit={event=>{event.preventDefault();save();}}><fieldset disabled={busy||!!command||!!receipt||!context?.can_create_draft}><legend>Payment details</legend><div className="native-document-grid">
      <label>Reference number<input required maxLength={128} value={draft.number} onChange={event=>update('number',event.target.value)}/></label>
      <label>Date<input required type="date" min={context?.payment_period.starts_on} max={context?.payment_period.ends_on} value={draft.date} onChange={event=>update('date',event.target.value)}/></label>
      <label>Amount<input required inputMode="decimal" value={draft.amount} onChange={event=>update('amount',event.target.value)}/></label>
      <label>Bank ledger account<select required value={draft.cashAccountCode} onChange={event=>update('cashAccountCode',event.target.value)}><option value="">Choose an account</option>{eligible.map(row=><option key={row.account_code} value={row.account_code}>{row.account_code} · {row.account_name}</option>)}</select></label>
      <label>Find bank<input value={query} maxLength={128} onChange={event=>{setQuery(event.target.value);setPage(null);setBank(null);}} onKeyDown={event=>{if(event.key==='Enter'){event.preventDefault();search(null);}}}/></label><button type="button" className="btn btn-sm" onClick={()=>search(null)}>Search banks</button>
      <label>Bank<select required value={bank?.member_ref||''} onChange={event=>setBank(page?.rows.find(row=>row.member_ref===event.target.value)||null)}><option value="">Choose a bank</option>{page?.rows.map(row=><option key={row.member_ref} value={row.member_ref}>{row.display_name} · {row.member_ref}</option>)}</select></label>
      <button type="button" className="btn btn-sm btn-ghost" disabled={!page?.next_ref} onClick={()=>search(page.next_ref)}>Next banks</button>
    </div><label>Description<textarea required minLength={8} maxLength={2000} value={draft.reason} onChange={event=>update('reason',event.target.value)}/></label>
    <label>Supporting document<input type="file" accept=".pdf,.png,.jpg,.jpeg,.csv" onChange={event=>{setFile(event.target.files?.[0]||null);setAttachment(null);setUploadAttempt(0);setUploadClosed(false);}}/></label><p className="muted sm">PDF, PNG, JPEG or CSV, up to 50 MB. Uploaded when you save.</p></fieldset>
    {message&&<p role="status" aria-live="polite">{message}</p>}<div className="native-document-actions">
      {!receipt&&<button type="submit" className="btn" disabled={busy||!command&&(!file||!bank||!context?.can_create_draft)}>{busy?'Working…':command?'Retry same draft':'Save draft'}</button>}
      {!command&&!receipt&&<button type="button" className="btn btn-ghost" disabled={busy} onClick={load}>Refresh balance</button>}
      {receipt&&<button type="button" className="btn" disabled={busy||!onOpenDraft} onClick={()=>run(()=>onOpenDraft(receipt))}>Open saved draft</button>}
      <button type="button" className="btn btn-ghost" disabled={busy||!!command&&!receipt} onClick={()=>onClose?.(!!receipt)}>{receipt?'Close and refresh':'Close'}</button>
    </div></form></div>;
}
