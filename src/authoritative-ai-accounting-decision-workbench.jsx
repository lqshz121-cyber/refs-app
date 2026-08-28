import React,{useEffect,useMemo,useState} from 'react';
import {aiAccountingDecisionCommandIdempotencyKey,createAuthoritativeAiAccountingDecisionDraft,decideAuthoritativeAiAccountingDecision,refreshAuthoritativeAiAccountingDecisionQueue} from './accounting-api.js';
import {StateBlock} from './ui.jsx';

const PAGE_SIZE=25;
const initialQueue={phase:'LOADING',data:null,error:null};
const initialCommand={phase:'IDLE',data:null,error:null};
const shortHash=value=>typeof value==='string'&&value.length>26?`${value.slice(0,20)}...${value.slice(-4)}`:value||'Unavailable';

export function AuthoritativeAiAccountingDecisionWorkbench({config,fetcher=globalThis.fetch,onAccountingRefresh}){
  const [offset,setOffset]=useState(0),[queue,setQueue]=useState(initialQueue),[selection,setSelection]=useState(''),[outcome,setOutcome]=useState(''),[reason,setReason]=useState(''),[command,setCommand]=useState(initialCommand);
  const load=async requestedOffset=>{
    const pageOffset=Number.isSafeInteger(requestedOffset)?requestedOffset:offset;
    setQueue(current=>({...current,phase:'LOADING',error:null}));
    const result=await refreshAuthoritativeAiAccountingDecisionQueue({config,limit:PAGE_SIZE,offset:pageOffset,fetcher});
    setQueue(result.ok?{phase:'READY',data:result.data,error:null}:{phase:'BLOCKED',data:null,error:result});
  };
  useEffect(()=>{setOffset(0);setSelection('');setOutcome('');setReason('');setCommand(initialCommand);void load(0);},[config?.entityId,config?.periodId]);
  const rows=queue.data?.rows||[];
  const selected=useMemo(()=>rows.find(row=>row.ai_accounting_decision_id===selection)||null,[rows,selection]);
  const changePage=next=>{setOffset(next);setSelection('');setOutcome('');setReason('');setCommand(initialCommand);void load(next);};
  const decide=async()=>{
    const idempotencyKey=await aiAccountingDecisionCommandIdempotencyKey({config,decision:selected,action:outcome,reason});
    if(!idempotencyKey){setCommand({phase:'BLOCKED',data:null,error:{code:'AI_ACCOUNTING_DECISION_COMMAND_INVALID',message:'Choose an available decision, outcome, and an 8-2000 character human reason.'}});return;}
    setCommand({phase:'LOADING',data:null,error:null});
    const result=await decideAuthoritativeAiAccountingDecision({config,decision:selected,outcome,reason,idempotencyKey,fetcher});
    setCommand(result.ok?{phase:'READY',data:result.data,error:null}:{phase:'BLOCKED',data:null,error:result});
    if(result.ok){setOutcome('');setReason('');await load(offset);}
  };
  const createDraft=async()=>{
    const idempotencyKey=await aiAccountingDecisionCommandIdempotencyKey({config,decision:selected,action:'CREATE_DRAFT',reason});
    if(!idempotencyKey){setCommand({phase:'BLOCKED',data:null,error:{code:'AI_ACCOUNTING_DECISION_DRAFT_COMMAND_INVALID',message:'Choose an accepted decision and provide an 8-2000 character maker reason.'}});return;}
    setCommand({phase:'LOADING',data:null,error:null});
    const result=await createAuthoritativeAiAccountingDecisionDraft({config,decision:selected,reason,idempotencyKey,fetcher});
    setCommand(result.ok?{phase:'READY',data:result.data,error:null}:{phase:'BLOCKED',data:null,error:result});
    if(result.ok){setReason('');await load(offset);await onAccountingRefresh?.();}
  };
  const total=queue.data?.total_count||0,from=total===0?0:offset+1,to=Math.min(offset+rows.length,total);
  return <section className="card" aria-label="Retained AI accounting decision workflow">
    <div className="card-head"><div><h2>Accounting decision queue</h2><p className="muted sm">Resume immutable settings-bound decisions after a refresh. A human maker records Accept or Reject before a separate Draft is possible; standard Journal submit, review, approve, and post remain outside this queue.</p></div><button type="button" className="btn" onClick={()=>load(offset)} disabled={queue.phase==='LOADING'}>{queue.phase==='LOADING'?'Refreshing...':'Refresh queue'}</button></div>
    <p className="muted sm" aria-label="AI accounting decision authority boundary">PERSISTED EVIDENCE | HUMAN ACCEPT OR REJECT | HUMAN DRAFT ONLY | NO SUBMIT | NO REVIEW | NO APPROVE | NO POST</p>
    {queue.phase==='BLOCKED'?<StateBlock tone="blocked" title={queue.error?.code||'AI_ACCOUNTING_DECISION_QUEUE_BLOCKED'}>{queue.error?.message} No cached, local, or demonstration decision is substituted.</StateBlock>:null}
    {queue.phase==='READY'&&rows.length===0?<StateBlock tone="empty" title="No retained accounting decisions">Run and retain a complete accounting decision batch from the AI Audit Center. An empty page does not prove that source accounting is complete.</StateBlock>:null}
    {rows.length>0?<>
      <div className="table-wrap" role="region" tabIndex={0} aria-label="Retained AI accounting decisions; scroll horizontally to view every column"><table className="tbl"><thead><tr><th>Workflow</th><th>Decision</th><th>Suggested journal</th><th>Retained evidence</th><th>Authority</th></tr></thead><tbody>{rows.map(row=><tr key={row.ai_accounting_decision_id}><td><button type="button" className="report-open-link" onClick={()=>{setSelection(row.ai_accounting_decision_id);setOutcome('');setReason('');setCommand(initialCommand);}} aria-pressed={selection===row.ai_accounting_decision_id}><span>{row.workflow_state.replaceAll('_',' ')}</span></button><div className="muted sm">{row.packet_status.replaceAll('_',' ')}</div></td><td><b>{row.packet.classification}</b><div className="muted sm">{row.packet.reason}</div><div className="muted sm">Confidence {(row.packet.confidence*100).toFixed(2)}%</div></td><td>{row.packet.proposed_journal.lines.length===0?<span className="muted sm">No journal suggested</span>:row.packet.proposed_journal.lines.map(line=><div key={line.line_number}><b>{line.side==='DEBIT'?'Dr':'Cr'} {line.account_code}</b> {line.amount} {line.currency}</div>)}</td><td><details><summary>Immutable trace</summary><dl className="muted sm"><dt>Decision ID</dt><dd>{row.ai_accounting_decision_id}</dd><dt>Decision hash</dt><dd title={row.decision_hash}>{shortHash(row.decision_hash)}</dd><dt>Settings snapshot</dt><dd>{row.packet.settings_snapshot_id}</dd><dt>Settings hash</dt><dd title={row.packet.settings_snapshot_hash}>{shortHash(row.packet.settings_snapshot_hash)}</dd><dt>Source document</dt><dd>{row.packet.source.source_document_id}</dd>{row.human_decision?<><dt>Human outcome</dt><dd>{row.human_decision.outcome} by {row.human_decision.decided_by}</dd><dt>Acceptance evidence</dt><dd title={row.human_decision.evidence_hash}>{shortHash(row.human_decision.evidence_hash)}</dd></>:null}{row.draft_evidence?<><dt>Journal Entry</dt><dd>{row.draft_evidence.journal_entry_id}</dd><dt>Journal state</dt><dd>{row.draft_evidence.journal_status} / revision {row.draft_evidence.journal_revision}</dd></>:null}{row.latest_posted_outcome_review?<><dt>Latest Posted review</dt><dd>{row.latest_posted_outcome_review.status} / revision {row.latest_posted_outcome_review.review_revision}</dd></>:null}</dl></details></td><td><span className="badge badge-muted">HUMAN WORKFLOW</span><div className="muted sm">Submit / review / approve / post disabled here</div></td></tr>)}</tbody></table></div>
      <div className="pager" aria-label="Accounting decision queue pagination"><span>{from}-{to} of {total}</span><button type="button" className="btn" disabled={offset===0||queue.phase==='LOADING'} onClick={()=>changePage(Math.max(0,offset-PAGE_SIZE))}>Previous</button><button type="button" className="btn" disabled={queue.data?.population_complete===true||queue.phase==='LOADING'} onClick={()=>changePage(offset+PAGE_SIZE)}>Next</button></div>
    </>:null}
    {selected?<div className="report-workbench" aria-label="Selected AI accounting decision human workflow"><div className="report-workbench-head"><div><b>{selected.packet.classification} decision</b><div className="page-subtitle">The command binds the exact retained decision hash. A concurrent or changed decision fails closed.</div></div><span className={`badge ${selected.packet.risk.risk_level==='HIGH'?'badge-danger':selected.packet.risk.risk_level==='MEDIUM'?'badge-warning':'badge-muted'}`}>{selected.packet.risk.risk_level}</span></div>
      {selected.action_flags.can_accept_or_reject?<div className="filter-bar"><label>Human outcome<select value={outcome} onChange={event=>setOutcome(event.target.value)} disabled={command.phase==='LOADING'}><option value="">Select outcome</option><option value="ACCEPTED" disabled={selected.packet_status!=='READY_FOR_HUMAN_REVIEW'}>Accept decision evidence</option><option value="REJECTED">Reject decision evidence</option></select></label><label>Human review reason<input value={reason} onChange={event=>setReason(event.target.value)} placeholder="Explain the evidence-based conclusion" disabled={command.phase==='LOADING'}/></label><button type="button" className="btn" onClick={decide} disabled={command.phase==='LOADING'||!outcome}>{command.phase==='LOADING'?'Recording...':'Record Accept or Reject'}</button></div>:null}
      {selected.action_flags.can_create_draft?<div className="filter-bar"><label>Maker reason<input value={reason} onChange={event=>setReason(event.target.value)} placeholder="Explain why the accepted decision is ready for Draft" disabled={command.phase==='LOADING'}/></label><button type="button" className="btn btn-primary" onClick={createDraft} disabled={command.phase==='LOADING'}>{command.phase==='LOADING'?'Creating Draft...':'Create Draft JE'}</button></div>:null}
      {!selected.action_flags.can_accept_or_reject&&!selected.action_flags.can_create_draft?<StateBlock tone="empty" title="No decision command available">This retained decision is already decided, has a Draft, or the current actor lacks the exact maker permission. Continue any Draft in Journal entries with separately authorized actors.</StateBlock>:null}
    </div>:null}
    {command.phase==='BLOCKED'?<StateBlock tone="blocked" title={command.error?.code||'AI_ACCOUNTING_DECISION_COMMAND_BLOCKED'}>{command.error?.message} No later Journal workflow stage was performed.</StateBlock>:null}
    {command.phase==='READY'?<StateBlock tone="ok" title={command.data?.status==='DRAFT'?'AI accounting Draft created':'Human decision retained'}>{command.data?.status==='DRAFT'?`Journal ${command.data.journal_entry_id} is a Draft at revision 0. Continue in Journal entries.`:`The ${command.data?.outcome?.toLowerCase()} decision is retained as immutable human evidence.`}</StateBlock>:null}
  </section>;
}
