import React,{useEffect,useMemo,useState} from 'react';
import {aiAmortizationDraftIdempotencyKey,createAuthoritativeAiAmortizationDraft,refreshAuthoritativeAiAmortizationSchedules} from './accounting-api.js';
import {AuthoritativeWorkspaceHeader,AuthoritativeWorkspaceView} from './authoritative-workbench-view.jsx';
import {StateBlock} from './ui.jsx';

const empty={phase:'LOADING',rows:[],error:null};
export function AuthoritativeAiJeWorkspace({config,fetcher=globalThis.fetch}){
  const [schedules,setSchedules]=useState(empty),[selection,setSelection]=useState(''),[reason,setReason]=useState(''),[command,setCommand]=useState({phase:'IDLE',data:null,error:null});
  const load=async()=>{setSchedules(current=>({...current,phase:'LOADING',error:null}));const result=await refreshAuthoritativeAiAmortizationSchedules({config,fetcher});setSchedules(result.ok?{phase:'READY',rows:result.rows,error:null}:{phase:'BLOCKED',rows:[],error:result});};
  useEffect(()=>{void load();},[config?.entityId]);
  const choices=useMemo(()=>schedules.rows.flatMap(schedule=>schedule.schedule_lines.map(line=>({schedule,line,key:`${schedule.ai_amortization_schedule_id}:${line.ai_amortization_schedule_line_id}`}))),[schedules.rows]);
  const selected=choices.find(choice=>choice.key===selection)||null;
  const createDraft=async()=>{
    if(!selected){setCommand({phase:'BLOCKED',data:null,error:{code:'AI_AMORTIZATION_LINE_REQUIRED',message:'Select one retained immutable schedule line.'}});return;}
    const attachmentIds=selected.schedule.eligible_source_attachment_ids;
    if(attachmentIds.length===0){setCommand({phase:'BLOCKED',data:null,error:{code:'AI_AMORTIZATION_SOURCE_ATTACHMENT_REQUIRED',message:'The exact source document has no finalized, verified-clean attachment eligible for this Draft.'}});return;}
    setCommand({phase:'LOADING',data:null,error:null});
    const idempotencyKey=await aiAmortizationDraftIdempotencyKey({config,schedule:selected.schedule,scheduleLine:selected.line,attachmentIds,reason});
    if(!idempotencyKey){setCommand({phase:'BLOCKED',data:null,error:{code:'AI_AMORTIZATION_DRAFT_COMMAND_INVALID',message:'The selected line, source-bound attachment IDs, maker reason, or browser cryptography is invalid.'}});return;}
    const result=await createAuthoritativeAiAmortizationDraft({config,schedule:selected.schedule,scheduleLine:selected.line,attachmentIds,reason,idempotencyKey,fetcher});
    setCommand(result.ok?{phase:'READY',data:result.data,error:null}:{phase:'BLOCKED',data:null,error:result});
    if(result.ok){setSelection('');setReason('');await load();}
  };
  return <AuthoritativeWorkspaceView area="AI JE Workbench">
    <AuthoritativeWorkspaceHeader eyebrow="AUTHORITATIVE - HUMAN-CONTROLLED AI DRAFT" title="AI JE Workbench" description="A separately authorized human maker may convert one immutable amortization proposal line into a standard MANUAL Draft. Submit, review, approve, and post remain separate Journal Entry actions." status="DRAFT ONLY"/>
    <section className="report-workbench" aria-label="AI amortization Draft workbench">
      <div className="report-workbench-head"><div><b>Source-bound amortization proposals</b><div className="page-subtitle">The proposer cannot use this command. Every Draft remains unsubmitted and carries the exact schedule line, source document, proposal hash, period, and clean attachment evidence.</div></div><button type="button" className="btn" onClick={load} disabled={schedules.phase==='LOADING'}>{schedules.phase==='LOADING'?'Refreshing...':'Refresh proposals'}</button></div>
      <div className="report-shelf" aria-label="AI Draft authority boundary"><span className="report-shelf-chip report-shelf-chip-on">HUMAN MAKER</span><span className="report-shelf-chip">MANUAL DRAFT ONLY</span><span className="report-shelf-chip">NO SUBMIT</span><span className="report-shelf-chip">NO REVIEW</span><span className="report-shelf-chip">NO APPROVE</span><span className="report-shelf-chip">NO POST</span></div>
      {schedules.phase==='BLOCKED'?<StateBlock tone="blocked" title={schedules.error?.code||'AI_AMORTIZATION_SCHEDULE_READ_BLOCKED'}>{schedules.error?.message} No browser or demonstration proposal is substituted.</StateBlock>:null}
      {schedules.phase==='READY'&&choices.length===0?<StateBlock tone="empty" title="No proposed amortization lines">Create and retain an evidence-backed proposal in AI Audit Center before preparing a Draft.</StateBlock>:null}
      {choices.length>0?<>
        <div className="filter-bar">
          <label>Proposed line<select value={selection} onChange={event=>setSelection(event.target.value)} disabled={command.phase==='LOADING'}><option value="">Select immutable schedule line</option>{choices.map(({schedule,line,key})=><option key={key} value={key}>{line.amortization_month} / {schedule.currency} {line.amount} / source {schedule.source_document_id}</option>)}</select></label>
          <label>Maker reason<input value={reason} onChange={event=>setReason(event.target.value)} placeholder="Explain why this month is ready for Draft" disabled={command.phase==='LOADING'}/></label>
          <button type="button" className="btn btn-primary" onClick={createDraft} disabled={command.phase==='LOADING'||!selected||selected.schedule.eligible_source_attachment_ids.length===0}>{command.phase==='LOADING'?'Creating Draft...':'Create Draft JE'}</button>
        </div>
        {selected?<div className="kv-grid" aria-label="Selected immutable proposal evidence"><div><span>Schedule line</span><b>{selected.line.ai_amortization_schedule_line_id}</b></div><div><span>Period / amount</span><b>{selected.line.amortization_month} / {selected.schedule.currency} {selected.line.amount}</b></div><div><span>Accounts</span><b>Dr {selected.schedule.expense_account_code} / Cr {selected.schedule.prepaid_account_code}</b></div><div><span>Proposal hash</span><b className="mono sm">{selected.schedule.proposal_hash}</b></div><div><span>Source document</span><b>{selected.schedule.source_document_id}</b></div><div><span>Eligible clean attachments</span><b>{selected.schedule.eligible_source_attachment_ids.length||'None - Draft blocked'}</b></div><div><span>Resulting state</span><b>DRAFT / revision 0</b></div></div>:null}
      </>:null}
      {command.phase==='BLOCKED'?<StateBlock tone="blocked" title={command.error?.code||'AI_AMORTIZATION_DRAFT_BLOCKED'}>{command.error?.message} No Draft or later journal action was created.</StateBlock>:null}
      {command.phase==='READY'?<StateBlock tone="ok" title="Amortization Draft created">Journal {command.data.journal_entry_id} is a MANUAL Draft at revision 0. Continue in Journal entries with separately authorized submit, review, approve, and post actors.</StateBlock>:null}
    </section>
  </AuthoritativeWorkspaceView>;
}
