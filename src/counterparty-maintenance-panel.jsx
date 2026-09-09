import React,{useEffect,useRef,useState} from 'react';
import {readCounterpartyAccess,readCounterpartyMaintenance,prepareCounterpartyCommand,sendCounterpartyCommand} from './counterparty-maintenance-api.js';
import {recoverCounterpartyCommand,retainCounterpartyCommand,releaseCounterpartyCommand} from './counterparty-maintenance-recovery.js';
export function CounterpartyMaintenancePanel({config,kind,mode='detail',memberRef=null,fetcher=globalThis.fetch,onClose,onSaved}){
 const [state,setState]=useState({phase:'LOADING'}),[refresh,setRefresh]=useState(0),[status,setStatus]=useState('PENDING'),[cursors,setCursors]=useState([null]);
 const [draft,setDraft]=useState({memberRef:'',displayName:'',active:true,reason:''}),[pending,setPending]=useState(null),[message,setMessage]=useState(''),[busy,setBusy]=useState(false),[reviewReasons,setReviewReasons]=useState({});
 const alive=useRef(false),busyRef=useRef(false),heading=useRef(null),sequence=useRef(0),uncertain=useRef(false);
 const scopeKey=JSON.stringify([config?.baseUrl,config?.tenantId,config?.entityId,kind,mode,memberRef]);
 const requestKey=JSON.stringify([scopeKey,refresh,status,cursors.at(-1)]);
 useEffect(()=>{alive.current=true;heading.current?.focus();return()=>{alive.current=false;};},[]);
 useEffect(()=>{
  const id=++sequence.current,controller=new AbortController();setState({phase:'LOADING',key:requestKey});
  Promise.all([readCounterpartyAccess({config,fetcher}),mode==='detail'?readCounterpartyMaintenance({config,kind,memberRef,detail:true,fetcher,signal:controller.signal}):Promise.resolve(null),
   mode!=='create'?readCounterpartyMaintenance({config,kind,memberRef,status,afterId:cursors.at(-1),fetcher,signal:controller.signal}):Promise.resolve(null)]).then(([access,detail,history])=>{
   if(controller.signal.aborted||id!==sequence.current)return;
   if(detail&&!detail.ok||history&&!history.ok){setState({phase:'ERROR',key:requestKey,message:detail&&!detail.ok?detail.message:history.message});return;}
   const row=access.ok?access.row:null,stored=row?recoverCounterpartyCommand({config,actorId:row.actor_id}):null;
   setPending(stored);uncertain.current=!!stored;
   setState({phase:'READY',key:requestKey,access:row,detail:detail?.data,history:history?.data,accessMessage:access.ok?'':access.message});
   if(detail?.data)setDraft({memberRef:detail.data.member_ref,displayName:detail.data.display_name,active:detail.data.active,reason:''});
  });
  return()=>controller.abort();
 },[requestKey,fetcher,config?.getAccessToken]);
 const current=state.key===requestKey?state:{phase:'LOADING'},access=current.access,recoveryScope={config,actorId:access?.actor_id};
 const canPropose=access?.permissions.includes('MASTER.COUNTERPARTY.PROPOSE'),canReview=access?.permissions.includes('MASTER.COUNTERPARTY.APPROVE');
 const run=async(proposal)=>{
  if(busyRef.current)return;busyRef.current=true;setBusy(true);setMessage('');
  try{
   let command=pending;
   if(!command){const prepared=prepareCounterpartyCommand({config,actorId:access?.actor_id,...proposal});if(!prepared.ok){setMessage(prepared.message);return;}command=prepared.command;retainCounterpartyCommand(recoveryScope,command);setPending(command);}
   const result=await sendCounterpartyCommand({config,command,fetcher});
   if(result.ok){releaseCounterpartyCommand(recoveryScope,command);if(!alive.current)return;setPending(null);uncertain.current=false;setMessage(result.data.status==='PENDING'?'Change submitted for review.':result.data.status==='APPROVED'?'Change approved and saved.':'Change rejected.');onSaved?.();if(mode!=='create'){setCursors([null]);setRefresh(v=>v+1);}else setDraft({memberRef:'',displayName:'',active:true,reason:''});}
   else{if(!uncertain.current&&!result.unconfirmed){releaseCounterpartyCommand(recoveryScope,command);if(alive.current)setPending(null);}else uncertain.current=true;if(alive.current)setMessage(result.message);}
  }catch{if(alive.current)setMessage('The request could not be safely retained or confirmed. Please retry.');}
  finally{busyRef.current=false;if(alive.current)setBusy(false);}
 };
 const submit=event=>{event.preventDefault();run({body:{kind,...draft,changeType:mode==='create'?'CREATE':'UPDATE'},expectedVersion:mode==='create'?0:current.detail?.revision});};
 const review=(row,decision)=>run({changeId:row.counterparty_change_id,expectedVersion:row.revision,body:{decision,reason:reviewReasons[row.counterparty_change_id]||''}});
 const title=mode==='create'?`New ${kind==='VENDOR'?'vendor':'customer'}`:mode==='history'?'Contact changes':current.detail?.display_name||'Contact details';
 return <section className="card" aria-label="Contact maintenance" style={{padding:20,minWidth:0}}>
  <button className="btn" onClick={onClose} disabled={busy}>Back to {kind==='VENDOR'?'vendors':'customers'}</button><button className="btn" disabled={busy||!!pending} onClick={()=>setRefresh(v=>v+1)}>Refresh details</button><h2 ref={heading} tabIndex={-1}>{title}</h2>
  <p className="muted">{config?.scopePresentation?.entityLabel||'Current company'}</p>
  {message&&<p role="status">{message}</p>}
  {current.phase==='LOADING'&&<p role="status">Loading contact details…</p>}
  {current.phase==='ERROR'&&<div role="alert"><p>{current.message}</p><button className="btn" onClick={()=>setRefresh(v=>v+1)}>Retry</button></div>}
  {current.phase==='READY'&&<>
   {current.accessMessage&&<p role="status">{current.accessMessage}</p>}
   {pending&&<div role="status"><p>An earlier request is awaiting confirmation. Retry it before starting another change.</p><p>{pending.body.memberRef||pending.changeId} · {pending.body.displayName||pending.body.decision}</p><button className="btn" disabled={busy||!access} onClick={()=>run(null)}>Retry saved request</button></div>}
   {mode!=='history'&&<form onSubmit={submit} style={{display:'grid',gap:12,maxWidth:600}}>
    <label>Reference<input required maxLength={128} value={draft.memberRef} disabled={busy||!!pending||mode!=='create'||!canPropose} onChange={e=>setDraft(d=>({...d,memberRef:e.target.value}))}/></label>
    <label>Name<input required maxLength={256} value={draft.displayName} disabled={busy||!!pending||!canPropose} onChange={e=>setDraft(d=>({...d,displayName:e.target.value}))}/></label>
    {mode!=='create'&&<label><input type="checkbox" checked={draft.active} disabled={busy||!!pending||!canPropose} onChange={e=>setDraft(d=>({...d,active:e.target.checked}))}/> Active</label>}
    {canPropose?<><label>Reason for change<textarea required minLength={8} maxLength={2000} value={draft.reason} disabled={busy||!!pending} onChange={e=>setDraft(d=>({...d,reason:e.target.value}))}/></label><button className="btn" disabled={busy||!!pending} type="submit">Submit for review</button></>:<p>Read-only access</p>}
   </form>}
   {mode!=='create'&&<><h3>Change history</h3><label>Show<select value={status} disabled={busy||!!pending} onChange={e=>{setStatus(e.target.value);setCursors([null]);}}><option value="PENDING">Pending review</option><option value="APPROVED">Approved</option><option value="REJECTED">Rejected</option><option value="ALL">All changes</option></select></label>
    {!current.history.rows.length&&<p>No changes in this selection.</p>}
    {current.history.rows.map(row=><article key={row.counterparty_change_id} style={{borderTop:'1px solid #ddd',padding:'16px 0',overflowWrap:'anywhere'}}>
     <h4>{row.member_ref} · {row.desired_state.display_name}</h4><p>{row.status} · {row.proposed_by} · {new Date(row.created_at).toLocaleString()}</p>
     <p>{row.before_state?`${row.before_state.display_name} (${row.before_state.active?'active':'inactive'}) → `:'New contact: '}{row.desired_state.display_name} ({row.desired_state.active?'active':'inactive'})</p><p>{row.reason}</p>
     {row.reviewed_by&&<p>Reviewed by {row.reviewed_by}: {row.review_reason}</p>}
     {row.status==='PENDING'&&canReview&&row.proposed_by!==access.actor_id&&<><label>Review reason for {row.member_ref}<textarea value={reviewReasons[row.counterparty_change_id]||''} maxLength={2000} disabled={busy||!!pending} onChange={e=>setReviewReasons(v=>({...v,[row.counterparty_change_id]:e.target.value}))}/></label><button className="btn" disabled={busy||!!pending} onClick={()=>review(row,'APPROVE')}>Approve {row.member_ref}</button><button className="btn" disabled={busy||!!pending} onClick={()=>review(row,'REJECT')}>Reject {row.member_ref}</button></>}
    </article>)}
    <nav aria-label="Change history pages"><button className="btn" disabled={busy||!!pending||cursors.length===1} onClick={()=>{setCursors(v=>v.slice(0,-1));heading.current?.focus();}}>Previous changes</button><button className="btn" disabled={busy||!!pending||!current.history.next_change_id} onClick={()=>{setCursors(v=>[...v,current.history.next_change_id]);heading.current?.focus();}}>Next changes</button></nav>
   </>}
  </>}
 </section>;
}
