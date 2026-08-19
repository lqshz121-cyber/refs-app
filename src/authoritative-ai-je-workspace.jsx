import React,{useEffect,useMemo,useState} from 'react';
import {aiAmortizationDraftIdempotencyKey,createAuthoritativeAiAmortizationDraft,refreshAuthoritativeAiAmortizationSchedules,refreshAuthoritativeAiWbsPayableDraftProposals,reviewAuthoritativeAiWbsPayableDraftProposal} from './accounting-api.js';
import {AuthoritativeWorkspaceHeader,AuthoritativeWorkspaceView} from './authoritative-workbench-view.jsx';
import {StateBlock} from './ui.jsx';
import {AuthoritativeControlledTestAiWorkflow} from './authoritative-controlled-test-ai-workflow.jsx';
import {AuthoritativeCapitalizationPanel} from './authoritative-capitalization-panel.jsx';

const empty={phase:'LOADING',rows:[],error:null};
export function AuthoritativeAiJeWorkspace({config,fetcher=globalThis.fetch,onAccountingRefresh}){
  const [schedules,setSchedules]=useState(empty),[payableProposals,setPayableProposals]=useState(empty),[selection,setSelection]=useState(''),[reason,setReason]=useState(''),[command,setCommand]=useState({phase:'IDLE',data:null,error:null}),[payableReview,setPayableReview]=useState({proposalId:'',decision:'',reason:''}),[payableCommand,setPayableCommand]=useState({phase:'IDLE',data:null,error:null});
  const load=async()=>{setSchedules(current=>({...current,phase:'LOADING',error:null}));setPayableProposals(current=>({...current,phase:'LOADING',error:null}));const [scheduleResult,payableResult]=await Promise.all([refreshAuthoritativeAiAmortizationSchedules({config,fetcher}),refreshAuthoritativeAiWbsPayableDraftProposals({config,fetcher})]);setSchedules(scheduleResult.ok?{phase:'READY',rows:scheduleResult.rows,error:null}:{phase:'BLOCKED',rows:[],error:scheduleResult});setPayableProposals(payableResult.ok?{phase:'READY',rows:payableResult.rows,error:null}:{phase:'BLOCKED',rows:[],error:payableResult});};
  useEffect(()=>{void load();},[config?.entityId]);
  const choices=useMemo(()=>schedules.rows.flatMap(schedule=>schedule.schedule_lines.map(line=>({schedule,line,key:`${schedule.ai_amortization_schedule_id}:${line.ai_amortization_schedule_line_id}`}))),[schedules.rows]);
  const selected=choices.find(choice=>choice.key===selection)||null;
  const selectedPayableProposal=payableProposals.rows.find(proposal=>proposal.ai_wbs_payable_draft_proposal_id===payableReview.proposalId&&proposal.decision===null)||null;
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
  const reviewPayableProposal=async()=>{
    if(!selectedPayableProposal){setPayableCommand({phase:'BLOCKED',data:null,error:{code:'AI_WBS_PAYABLE_PROPOSAL_REQUIRED',message:'Select one pending immutable payable proposal.'}});return;}
    setPayableCommand({phase:'LOADING',data:null,error:null});
    const idempotencyKey=`ai-wbs-payable-review:${selectedPayableProposal.ai_wbs_payable_draft_proposal_id}:${payableReview.decision}`;
    const result=await reviewAuthoritativeAiWbsPayableDraftProposal({config,proposal:selectedPayableProposal,decision:payableReview.decision,reason:payableReview.reason,idempotencyKey,fetcher});
    setPayableCommand(result.ok?{phase:'READY',data:result.data,error:null}:{phase:'BLOCKED',data:null,error:result});
    if(result.ok){setPayableReview({proposalId:'',decision:'',reason:''});await load();}
  };
  return <AuthoritativeWorkspaceView area="AI JE Workbench">
    <AuthoritativeWorkspaceHeader eyebrow="AUTHORITATIVE - HUMAN-CONTROLLED AI DRAFT" title="AI JE Workbench" description="Create one source-bound Draft. Journal review and posting remain separate." status="DRAFT ONLY"/>
    <AuthoritativeControlledTestAiWorkflow config={config} fetcher={fetcher} onAccountingRefresh={onAccountingRefresh}/>
    <AuthoritativeCapitalizationPanel config={config} fetcher={fetcher}/>
    <section className="report-workbench" aria-label="AI amortization Draft workbench">
      <div className="report-workbench-head"><div><b>Source-bound amortization proposals</b><div className="page-subtitle">Every Draft keeps its exact schedule, source, period and clean attachments.</div></div><button type="button" className="btn" onClick={load} disabled={schedules.phase==='LOADING'}>{schedules.phase==='LOADING'?'Refreshing...':'Refresh'}</button></div>
      <p className="muted sm" aria-label="AI Draft authority boundary">HUMAN MAKER | MANUAL DRAFT ONLY | NO SUBMIT | NO REVIEW | NO APPROVE | NO POST</p>
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
      <section className="card" aria-label="AI WBS Payable journal proposals">
        <div className="card-head"><div><h2>WBS Payable journal proposals</h2><p className="muted sm">Two balanced lines derived from retained human-reviewed evidence and an approved mapping snapshot. Accepting or rejecting a proposal records evidence only; it does not create, submit, review, approve, or post a Journal Entry.</p></div><span className="badge badge-muted">HUMAN DECISION ONLY</span></div>
        {payableProposals.phase==='BLOCKED'?<StateBlock tone="blocked" title={payableProposals.error?.code||'AI_WBS_PAYABLE_PROPOSAL_READ_BLOCKED'}>{payableProposals.error?.message} No local, cached, or demonstration proposal is substituted.</StateBlock>:null}
        {payableProposals.phase==='READY'&&payableProposals.rows.length===0?<StateBlock tone="empty" title="No retained WBS Payable proposals">No authoritative payable proposal was returned for this entity.</StateBlock>:null}
        {payableProposals.rows.length>0?<div className="table-wrap" role="region" tabIndex={0} aria-label="AI WBS Payable proposals; scroll horizontally to view every column"><table className="tbl"><thead><tr><th>Status</th><th>Balanced proposal</th><th>Source trace</th><th>Model evidence</th><th>Authority</th></tr></thead><tbody>{payableProposals.rows.map(proposal=><tr key={proposal.ai_wbs_payable_draft_proposal_id}><td><b>{proposal.decision||'PENDING HUMAN REVIEW'}</b>{proposal.decision_reason?<div className="muted sm">{proposal.decision_reason}</div>:null}</td><td>{proposal.proposal_lines.map(line=><div key={line.line_no}><b>{line.debit_amount!=='0.0000'?'Dr':'Cr'} {line.account_code}</b> {line.debit_amount!=='0.0000'?line.debit_amount:line.credit_amount}</div>)}</td><td><details><summary>Reviewed source evidence</summary><dl className="muted sm"><dt>Source document</dt><dd>{proposal.source_document_id}</dd><dt>Staging item</dt><dd>{proposal.staging_item_id}</dd><dt>Review evidence</dt><dd>{proposal.wbs_payable_review_evidence_id}</dd><dt>Mapping snapshot</dt><dd>{proposal.mapping_snapshot_id}</dd><dt>Proposal hash</dt><dd className="mono">{proposal.proposal_hash}</dd></dl></details></td><td>{proposal.model_id}<div className="muted sm">Prompt {proposal.prompt_version}</div></td><td><span className="badge badge-muted">NO JOURNAL EFFECT</span><div className="muted sm">Draft / submit / review / approve / post: disabled</div></td></tr>)}</tbody></table></div>:null}
        {payableProposals.rows.some(proposal=>proposal.decision===null)?<div className="filter-bar"><label>Pending proposal<select value={payableReview.proposalId} onChange={event=>setPayableReview(current=>({...current,proposalId:event.target.value}))} disabled={payableCommand.phase==='LOADING'}><option value="">Select immutable proposal</option>{payableProposals.rows.filter(proposal=>proposal.decision===null).map(proposal=><option key={proposal.ai_wbs_payable_draft_proposal_id} value={proposal.ai_wbs_payable_draft_proposal_id}>{proposal.source_document_id} / {proposal.proposal_hash.slice(0,20)}...</option>)}</select></label><label>Human decision<select value={payableReview.decision} onChange={event=>setPayableReview(current=>({...current,decision:event.target.value}))} disabled={payableCommand.phase==='LOADING'}><option value="">Select decision</option><option value="ACCEPTED">Accept proposal evidence</option><option value="REJECTED">Reject proposal evidence</option></select></label><label>Decision reason<input value={payableReview.reason} onChange={event=>setPayableReview(current=>({...current,reason:event.target.value}))} placeholder="Explain the evidence-based decision" disabled={payableCommand.phase==='LOADING'}/></label><button type="button" className="btn" onClick={reviewPayableProposal} disabled={payableCommand.phase==='LOADING'||!selectedPayableProposal||!payableReview.decision}>{payableCommand.phase==='LOADING'?'Recording decision...':'Record decision only'}</button></div>:null}
        {payableCommand.phase==='BLOCKED'?<StateBlock tone="blocked" title={payableCommand.error?.code||'AI_WBS_PAYABLE_PROPOSAL_REVIEW_BLOCKED'}>{payableCommand.error?.message} No Journal Entry or later accounting action was created.</StateBlock>:null}
        {payableCommand.phase==='READY'?<StateBlock tone="ok" title="Payable proposal decision retained">The {payableCommand.data.decision.toLowerCase()} decision is immutable evidence only. Create any AP Draft through the separately authorized WBS Payable Review workflow.</StateBlock>:null}
      </section>
    </section>
  </AuthoritativeWorkspaceView>;
}
