import React,{useEffect,useState} from 'react';
import {WBS_LIVE_PILOT_VIEWS,activateAuthoritativeWbsOperatorAccess,attestAuthoritativeWbsPayableObservation,refreshAuthoritativeAiWbsExceptionFindings,refreshAuthoritativeWbsLivePilot,refreshAuthoritativeWbsOperatorPayableAttestations,refreshAuthoritativeWbsOperatorPayableExceptionRows} from './accounting-api.js';
import {StateBlock} from './ui.jsx';

export const WBS_LIVE_PILOT_SURFACE_TOOLS=Object.freeze({
  dashboard:Object.freeze(['list_payables','list_bank_transactions','list_autorec_details','list_autorec_banks','list_journal_entries']),
  payables:Object.freeze(['list_payables']),
  bank:Object.freeze(['list_bank_transactions']),
  journal:Object.freeze(['list_journal_entries']),
  wbs:Object.freeze(['list_payables','list_bank_transactions','list_autorec_details','list_autorec_banks','list_journal_entries']),
});

const columnLabels=Object.freeze({source_record_hash:'Sanitized source hash',accounting_date:'Accounting date',currency:'Currency',amount:'Observed amount',direction:'Provider direction',status:'Provider status',payment_amount:'Observed payment',deposit_amount:'Observed deposit',match_status:'Provider match status',pay_amount:'Observed pay amount',debit_amount:'Observed debit',quantity:'Observed quantity',released_amount:'Observed released amount',released_quantity:'Observed released quantity',incurred_amount:'Observed incurred amount',credit_amount:'Observed credit',review_status:'Provider review status'});
// Stable audit vocabulary: Approved WBS company code, WBS observation date from,
// WBS observation date to. The rendered label avoids action-like "Approve" copy.

// Server values remain available as title attributes for audit work, while the
// interface speaks in the language a finance team uses to route the record.
export const wbsReviewStatusLabel=value=>({
  MIXED_COMPANY:'Multiple companies',
  OPERATOR_ATTESTED:'Saved for finance review',
  EXCEPTION_REVIEW_REQUIRED:'Needs finance review',
  AWAITING_SIGNED_REDELIVERY:'Waiting for verified source',
  ELIGIBLE_FOR_SIGNED_REVIEW:'Ready for verified source',
  AUTHORIZATION_DENIED:'Additional review access required',
  NOT_ADMITTED:'Not ready for accounting',
  NOT_POSTED:'Not in books',
}[value]||value||'Not available');
const ReviewStatus=({value})=><span title={value||undefined}>{wbsReviewStatusLabel(value)}</span>;

const approvedTools=tools=>{
  const unique=[...new Set(Array.isArray(tools)?tools:[])];
  return unique.filter(tool=>Object.hasOwn(WBS_LIVE_PILOT_VIEWS,tool));
};

export const wbsLivePilotErrorGuidance=code=>{
  if(code==='ACCOUNTING_API_SERVER_ERROR')return 'Try again when the WBS connection is available. These records will not affect your books while the connection is unavailable.';
  if(code==='WBS_LIVE_PILOT_SCOPE_INVALID'||code==='WBS_LIVE_PILOT_SCOPE_MISMATCH')return 'Enter the exact WBS company code and matching 2026 dates, then refresh the records.';
  if(code==='WBS_LIVE_PILOT_PROTOCOL')return 'Ask the WBS data owner to confirm the company, date, currency, and source record before finance can use these records.';
  if(code==='AUTHENTICATION_REQUIRED'||code==='AUTHORIZATION_DENIED')return 'Sign in with an account that has access to this company, then try again.';
  return 'Try again or contact the WBS data owner. No accounting record has been created.';
};

export function AuthoritativeWbsLivePilotObservation({config,fetcher=globalThis.fetch,tools=WBS_LIVE_PILOT_SURFACE_TOOLS.wbs,title='Production WBS provider observation',showRows=true}){
  const availableTools=approvedTools(tools);
  const [tool,setTool]=useState(availableTools[0]||'');
  const [companyCode,setCompanyCode]=useState('');
  const [dateFrom,setDateFrom]=useState('2026-01-01');
  // The approved production read targets WBPA for the complete 2026 year.
  // Keep that exact range as the rendered default; the provider must echo it
  // back before the observation can be used for exception retention.
  const [dateTo,setDateTo]=useState('2026-12-31');
  const [state,setState]=useState({phase:'IDLE',data:null,error:null});
  const [attestationState,setAttestationState]=useState({phase:'IDLE',rows:[],error:null,result:null});
  const [capabilityState,setCapabilityState]=useState({phase:'LOADING',canAttest:false,error:null});
  const [exceptionRowsState,setExceptionRowsState]=useState({phase:'IDLE',attestationId:null,rows:[],error:null});
  const [aiFindingsState,setAiFindingsState]=useState({phase:'LOADING',rows:[],error:null});
  const [selectedExceptionRowId,setSelectedExceptionRowId]=useState(null);
  const [attestationReason,setAttestationReason]=useState('Keep this WBS payable record for finance review while its source is verified');
  const [attestationConfirmation,setAttestationConfirmation]=useState(false);
  const view=WBS_LIVE_PILOT_VIEWS[tool];
  const observation=state.data;
  const scopeCompany=['list_payables','list_bank_transactions','list_autorec_banks','list_journal_entries'].includes(tool);
  const scopeDates=['list_payables','list_bank_transactions','list_autorec_details','list_journal_entries'].includes(tool);
  const scopedPayables=tool==='list_payables';
  const requestedCompany=companyCode.trim();
  const hasExactAttestationScope=requestedCompany.length>0&&observation?.scope?.company_codes?.length===1&&observation.scope.company_codes[0]===requestedCompany&&observation.scope.date_range?.[0]===dateFrom&&observation.scope.date_range?.[1]===dateTo;
  const retainPathReady=true;
  const liveStatus=state.phase==='LOADING'?'Refreshing':state.phase==='BLOCKED'?(state.error?.code?.includes('SCOPE')?'Select company':'Connection needs attention'):observation?(observation.record_count>0?'Ready for review':'No records received'):'Not checked';
  const liveStatusTone=liveStatus==='Ready for review'?'badge-ok':liveStatus==='Refreshing'?'badge-muted':'badge-warn';
  const selectedExceptionRow=exceptionRowsState.rows.find(row=>row.wbs_operator_payable_evidence_row_id===selectedExceptionRowId)||exceptionRowsState.rows[0]||null;
  const selectedAiFinding=selectedExceptionRow?aiFindingsState.rows.find(row=>row.source_evidence_row_id===selectedExceptionRow.wbs_operator_payable_evidence_row_id)||null:null;
  useEffect(()=>{let current=true;setCapabilityState({phase:'LOADING',canAttest:false,error:null});refreshAuthoritativeWbsOperatorPayableAttestations({config,fetcher}).then(async result=>{if(!current)return;setCapabilityState(result.ok?{phase:'READY',canAttest:true,error:null}:{phase:'BLOCKED',canAttest:false,error:result});if(!result.ok)return;setAttestationState({phase:'READY',rows:result.rows,error:null,result:null});if(result.rows.length){const attestationId=result.rows[0].wbs_operator_payable_attestation_id;setExceptionRowsState({phase:'LOADING',attestationId,rows:[],error:null});const detail=await refreshAuthoritativeWbsOperatorPayableExceptionRows({config,attestationId,fetcher});if(current)setExceptionRowsState(detail.ok?{phase:'READY',attestationId,rows:detail.rows,error:null}:{phase:'BLOCKED',attestationId,rows:[],error:detail});}});return()=>{current=false;};},[config,fetcher]);
  useEffect(()=>{let current=true;setAiFindingsState({phase:'LOADING',rows:[],error:null});refreshAuthoritativeAiWbsExceptionFindings({config,fetcher}).then(result=>{if(current)setAiFindingsState(result.ok?{phase:'READY',rows:result.rows,error:null}:{phase:'BLOCKED',rows:[],error:result});});return()=>{current=false;};},[config,fetcher]);
  if(!view)return null;
  const read=async event=>{
    event.preventDefault();
    setState(current=>({...current,phase:'LOADING',error:null}));
    const requestedCompanyCode=scopeCompany?companyCode.trim():'';
    // Provider observation dates are meaningful only alongside one explicit
    // provider-native company scope.  Do not issue a date-only WBS read.
    const result=await refreshAuthoritativeWbsLivePilot({config,tool,limit:10,companyCode:scopeCompany?requestedCompanyCode||null:null,dateFrom:requestedCompanyCode?dateFrom:null,dateTo:requestedCompanyCode?dateTo:null,fetcher});
    setAttestationConfirmation(false);
    setState(current=>result.ok?{phase:'READY',data:result.data,error:null}:{phase:'BLOCKED',data:current.data,error:result});
  };
  const readExceptionRows=async attestationId=>{setSelectedExceptionRowId(null);setExceptionRowsState({phase:'LOADING',attestationId,rows:[],error:null});const result=await refreshAuthoritativeWbsOperatorPayableExceptionRows({config,attestationId,fetcher});setExceptionRowsState(result.ok?{phase:'READY',attestationId,rows:result.rows,error:null}:{phase:'BLOCKED',attestationId,rows:[],error:result});};
  const readAttestations=async()=>{setAttestationState(current=>({...current,phase:'LOADING',error:null,result:null}));const result=await refreshAuthoritativeWbsOperatorPayableAttestations({config,fetcher});setAttestationState(result.ok?{phase:'READY',rows:result.rows,error:null,result:null}:{phase:'BLOCKED',rows:[],error:result,result:null});if(result.ok&&result.rows.length)await readExceptionRows(result.rows[0].wbs_operator_payable_attestation_id);};
  const enableAttestation=async()=>{setCapabilityState({phase:'LOADING',canAttest:false,error:null});const result=await activateAuthoritativeWbsOperatorAccess({config,fetcher,idempotencyKey:`wbs-operator-access-${globalThis.crypto?.randomUUID?.()||Date.now().toString(36)}`});if(!result.ok){setCapabilityState({phase:'BLOCKED',canAttest:false,error:result});return;}const refreshed=await refreshAuthoritativeWbsOperatorPayableAttestations({config,fetcher});setCapabilityState(refreshed.ok?{phase:'READY',canAttest:true,error:null}:{phase:'BLOCKED',canAttest:false,error:refreshed});if(refreshed.ok)setAttestationState({phase:'READY',rows:refreshed.rows,error:null,result:null});};
  const attest=async()=>{if(tool!=='list_payables'||!observation||observation.record_count<1)return;setAttestationConfirmation(false);setAttestationState(current=>({...current,phase:'LOADING',error:null,result:null}));const result=await attestAuthoritativeWbsPayableObservation({config,observation,expectedCompanyCode:requestedCompany||null,dateFrom:requestedCompany?dateFrom:null,dateTo:requestedCompany?dateTo:null,reason:attestationReason,idempotencyKey:`wbs-operator-attest-${globalThis.crypto?.randomUUID?.()||Date.now().toString(36)}`,fetcher});if(!result.ok){setAttestationState(current=>({...current,phase:'BLOCKED',error:result,result:null}));return;}const refreshed=await refreshAuthoritativeWbsOperatorPayableAttestations({config,fetcher});setAttestationState(refreshed.ok?{phase:'READY',rows:refreshed.rows,error:null,result:result.data}:{phase:'BLOCKED',rows:[],error:refreshed,result:result.data});};
  return <section className="report-workbench authoritative-wbs-live-pilot-observation" aria-label={title}>
    <div className="report-workbench-head"><div><b>WBS records for finance review</b><div className="page-subtitle">Review records received from WBS for the selected company. They are not added to your books until their source and company assignment are verified.</div></div><div className="authoritative-wbs-live-pilot-status" aria-label="WBS records status"><span className={`badge ${liveStatusTone}`}>{liveStatus}</span><span className="badge badge-muted">Review only</span></div></div>
    <div className="report-shelf" aria-label="WBS review boundary"><span className="report-shelf-chip report-shelf-chip-on">Review records</span><span className="report-shelf-chip">Verify source</span><span className="report-shelf-chip">Assign company</span><span className="report-shelf-chip">Not yet in books</span></div>
    <div className="qbo-toolgrid" aria-label="WBS review facts"><span><i>Status</i><b>{liveStatus}</b></span><span><i>Last refreshed</i><b>{observation?.captured_at||'Not yet refreshed'}</b></span><span><i>Records received</i><b>{observation?.record_count??'Not available yet'}</b></span><span><i>Selected company</i><b>{config?.scopePresentation?.entityLabel||'Company name not available yet'}</b></span><span><i>Reporting period</i><b>{scopeDates?`${dateFrom} to ${dateTo}`:'Current WBS scope'}</b></span><span><i>Source</i><b>WBS data connection</b></span></div>
    <form className="filterbar authoritative-wbs-live-pilot-controls" onSubmit={read}>
      {availableTools.length>1?<label>Record type<select aria-label="WBS record type" value={tool} onChange={event=>{setTool(event.target.value);setState({phase:'IDLE',data:null,error:null});}}>{availableTools.map(name=><option key={name} value={name}>{WBS_LIVE_PILOT_VIEWS[name].label}</option>)}</select></label>:<span className="muted sm"><b>Record type:</b> {view.label}</span>}
      {scopeCompany&&<label>WBS company code<input aria-label="WBS company code" maxLength="128" placeholder="Optional exact company code" value={companyCode} onChange={event=>{setCompanyCode(event.target.value);setState({phase:'IDLE',data:null,error:null});setAttestationConfirmation(false);}}/></label>}
      {scopeDates&&<><label>From<input aria-label="WBS observation date from" type="date" value={dateFrom} onChange={event=>{setDateFrom(event.target.value);setState({phase:'IDLE',data:null,error:null});setAttestationConfirmation(false);}}/></label><label>To<input aria-label="WBS observation date to" type="date" value={dateTo} onChange={event=>{setDateTo(event.target.value);setState({phase:'IDLE',data:null,error:null});setAttestationConfirmation(false);}}/></label></>}
      <button type="submit" className="btn" aria-label="Refresh WBS records" disabled={state.phase==='LOADING'}>{state.phase==='LOADING'?'Refreshing WBS records...':'Refresh WBS records'}</button>
    </form>
    {(scopeCompany||scopeDates)&&<p className="muted sm">REFS uses the company code and dates exactly as entered. Records that cover more than one company stay in review and cannot be drafted or posted.</p>}
    {state.phase==='LOADING'&&<StateBlock tone="loading" title="Refreshing WBS records">Loading up to ten records for this selected view.</StateBlock>}
    {state.phase==='BLOCKED'&&<StateBlock tone="blocked" title="WBS records need attention">{state.error?.message||'WBS records are not available right now.'}<div>{wbsLivePilotErrorGuidance(state.error?.code)}</div><div>Your accounting records are unchanged.{observation&&' The last verified WBS records remain below.'}</div></StateBlock>}
    {state.phase==='IDLE'&&<StateBlock tone="empty" title="No WBS records loaded yet">Choose a company when available, then refresh. Mixed-company records can be saved for review, but cannot be drafted or posted.</StateBlock>}
    {observation&&<>
      <div className="qbo-toolgrid"><span><i>Finance status</i><b>Needs source verification</b></span><span><i>Source signature</i><b>Not supplied</b></span><span><i>Received</i><b>{observation.captured_at}</b></span><span><i>WBS company scope</i><b>{observation.scope.company_codes.join(', ')||'Needs confirmation'}</b></span><span><i>Date range</i><b>{observation.scope.date_range.filter(Boolean).join(' to ')||'Needs confirmation'}</b></span><span><i>Records received</i><b>{observation.record_count}</b></span><span><i>Source version</i><b>{observation.provider_content_sha256}</b></span><span><i>Next step</i><b>Finance review</b></span></div>
      {showRows&&(observation.rows.length===0?<StateBlock tone="empty" title="No WBS records were received">This does not mean that there is no accounting activity or no WBS activity.</StateBlock>:<div className="table-wrap authoritative-wbs-live-pilot-table" role="region" tabIndex={0} aria-label={`${view.label} records; scroll horizontally to view every column`}><table className="tbl"><thead><tr>{view.fields.map(field=><th scope="col" key={field}>{columnLabels[field]}</th>)}</tr></thead><tbody>{observation.rows.map(row=><tr key={row.source_record_hash}>{view.fields.map(field=><td key={field}>{row[field]===null?'Not provided':row[field]}</td>)}</tr>)}</tbody></table></div>)}
    </>}
    {tool==='list_payables'&&<section className="filterbar" aria-label="WBS Payable records held for review">
      <div><b>Records held for review</b><div className="page-subtitle">Finance has kept these source records for review. They do not create bills, journals, general-ledger activity, or posted balances.</div></div>
      <div className="report-shelf" aria-label="WBS finance review boundary"><span className="report-shelf-chip report-shelf-chip-on">Record retained</span><span className="report-shelf-chip">Source needs verification</span><span className="report-shelf-chip">Finance review required</span><span className="report-shelf-chip">Not in books</span></div>
      <label htmlFor="wbs-operator-attestation-reason">Reason for keeping this record<textarea id="wbs-operator-attestation-reason" minLength="8" maxLength="2000" rows="3" value={attestationReason} onChange={event=>setAttestationReason(event.target.value)}/></label>
      <div><button type="button" className="btn" title={!retainPathReady||capabilityState.phase!=='READY'||!capabilityState.canAttest||!observation||observation.record_count<1||attestationState.phase==='LOADING'?'Available after you have permission to keep WBS review records and at least one WBS payable record has been loaded.':undefined} disabled={!retainPathReady||capabilityState.phase!=='READY'||!capabilityState.canAttest||!observation||observation.record_count<1||attestationState.phase==='LOADING'} onClick={()=>attestationConfirmation?attest():setAttestationConfirmation(true)}>{attestationConfirmation?'Confirm keep for review':'Keep for review'}</button> {attestationConfirmation&&<button type="button" className="btn" onClick={()=>setAttestationConfirmation(false)}>Cancel</button>} <button type="button" className="btn" disabled={capabilityState.phase!=='READY'||!capabilityState.canAttest||attestationState.phase==='LOADING'} onClick={readAttestations}>Refresh review records</button></div>
      {observation&&!hasExactAttestationScope&&<StateBlock tone="warn" title="Company assignment is needed">These WBS records can be kept for review now. A finance administrator must confirm the company before they can move into the normal review, draft, and posting workflow.</StateBlock>}
      {attestationConfirmation&&<StateBlock tone="blocked" title="Keep these records for review?">This keeps only the exact WBS payable records shown above for finance review. It will not create a draft or post anything.</StateBlock>}
      {capabilityState.phase==='LOADING'&&<StateBlock tone="loading" title="Checking access to review records">REFS is checking whether this account can keep records for finance review.</StateBlock>}
      {capabilityState.phase==='BLOCKED'&&<StateBlock tone="blocked" title="Access is needed to keep these records">{capabilityState.error?.message}<div><button type="button" className="btn" onClick={enableAttestation}>Request review access</button></div></StateBlock>}
      {attestationState.phase==='LOADING'&&<StateBlock tone="loading" title="Refreshing review records">REFS is confirming the company scope and retained records. No accounting records are created.</StateBlock>}
      {attestationState.phase==='BLOCKED'&&<StateBlock tone="blocked" title="Review records need attention">{attestationState.error?.message}</StateBlock>}
      {attestationState.result&&<StateBlock tone="success" title="Record saved for finance review">The WBS record was saved for controlled finance review. It has not created a draft or posted any accounting activity.</StateBlock>}
      {attestationState.phase==='READY'&&attestationState.rows.length===0&&<StateBlock tone="empty" title="No review records yet">No WBS records have been saved for finance review for this company.</StateBlock>}
      {attestationState.rows.length>0&&<div className="table-wrap" role="region" tabIndex={0} aria-label="Retained WBS Payable exception batches"><table className="tbl"><thead><tr><th>Captured</th><th>Company scope</th><th>Rows</th><th>Record status</th><th>Review status</th><th>Detail</th></tr></thead><tbody>{attestationState.rows.map(row=><tr key={row.wbs_operator_payable_attestation_id}><td>{row.captured_at}</td><td><ReviewStatus value={row.company_scope_status}/></td><td>{row.row_count}</td><td><ReviewStatus value={row.provenance_mode}/></td><td><ReviewStatus value={row.evidence_status}/></td><td><button type="button" className="btn" onClick={()=>readExceptionRows(row.wbs_operator_payable_attestation_id)}>View review records</button></td></tr>)}</tbody></table></div>}
      {exceptionRowsState.phase==='LOADING'&&<StateBlock tone="loading" title="Loading retained exception rows">Reading the immutable rows retained for this exact observation.</StateBlock>}
      {exceptionRowsState.phase==='BLOCKED'&&<StateBlock tone="blocked" title={exceptionRowsState.error?.code||'WBS_OPERATOR_EXCEPTION_ROWS_BLOCKED'}>{exceptionRowsState.error?.message}</StateBlock>}
      {exceptionRowsState.phase==='READY'&&exceptionRowsState.rows.length===0&&<StateBlock tone="empty" title="No retained rows found">The selected retained observation has no visible exception rows.</StateBlock>}
      {exceptionRowsState.rows.length>0&&<>
        <div className="report-shelf" aria-label="WBS Payable path status"><span className="report-shelf-chip report-shelf-chip-on">EXCEPTION</span><span className="report-shelf-chip">AWAITING SIGNED REDELIVERY</span><span className="report-shelf-chip">SIGNED REVIEW</span><span className="report-shelf-chip">DRAFT</span><span className="report-shelf-chip">APPROVAL / POST</span><span className="report-shelf-chip">GL / REPORT</span></div>
        <div className="table-wrap" role="region" tabIndex={0} aria-label="WBS Payable records held for finance review"><table className="tbl"><thead><tr><th>Document</th><th>Accounting date</th><th>Company</th><th>Amount</th><th>Source status</th><th>Review status</th><th>Next owner</th><th>Detail</th></tr></thead><tbody>{exceptionRowsState.rows.map(row=><tr key={row.wbs_operator_payable_evidence_row_id}><td>{row.document_number||`Source ${row.source_record_id}`}</td><td>{row.accounting_date||'Not supplied by Provider'}</td><td>{row.company_code||<ReviewStatus value={row.company_scope_status}/>}</td><td>{row.currency&&row.observed_amount?`${row.currency} ${row.observed_amount}`:row.observed_amount||'Not provided'}</td><td>{row.provider_status||'Not provided'}</td><td><ReviewStatus value={row.signed_link_status}/></td><td>{row.next_owner}</td><td><button type="button" className="btn" onClick={()=>setSelectedExceptionRowId(row.wbs_operator_payable_evidence_row_id)}>View details</button></td></tr>)}</tbody></table></div>
        {selectedExceptionRow&&<section className="report-workbench" aria-label="WBS Payable record detail"><div className="report-workbench-head"><div><b>{selectedExceptionRow.document_number||`Source ${selectedExceptionRow.source_record_id}`}</b><div className="page-subtitle">This source record is held for finance review. A later verified source is assessed separately; this record does not become verified by itself.</div></div><span className={`badge ${selectedExceptionRow.signed_link_status==='ELIGIBLE_FOR_SIGNED_REVIEW'?'badge-ok':'badge-warn'}`} title={selectedExceptionRow.signed_link_status}><ReviewStatus value={selectedExceptionRow.signed_link_status}/></span></div><div className="qbo-toolgrid"><span><i>Company scope</i><b><ReviewStatus value={selectedExceptionRow.company_scope_status}/></b></span><span><i>Captured</i><b>{selectedExceptionRow.captured_at}</b></span><span><i>Source version</i><b>{selectedExceptionRow.provider_content_hash}</b></span><span><i>Review record</i><b>{selectedExceptionRow.observation_hash}</b></span><span><i>Source reference</i><b>{selectedExceptionRow.source_version}</b></span><span><i>Next owner</i><b>{selectedExceptionRow.next_owner}</b></span></div><StateBlock tone={selectedExceptionRow.signed_link_status==='ELIGIBLE_FOR_SIGNED_REVIEW'?'success':'warn'} title={wbsReviewStatusLabel(selectedExceptionRow.signed_link_status)}>{selectedExceptionRow.next_action}</StateBlock>{aiFindingsState.phase==='LOADING'&&<StateBlock tone="loading" title="Loading review explanation">Loading the saved explanation for this source record.</StateBlock>}{aiFindingsState.phase==='BLOCKED'&&<StateBlock tone="warn" title="Additional review access is needed">{aiFindingsState.error?.message||'An explanation is not available for this record.'}</StateBlock>}{aiFindingsState.phase==='READY'&&!selectedAiFinding&&<StateBlock tone="warn" title="Review explanation pending">This source record does not have a saved explanation yet. It remains in finance review and cannot be drafted, approved, or posted.</StateBlock>}{selectedAiFinding&&<section className="report-workbench" aria-label="Review explanation"><div className="report-workbench-head"><div><b>Review explanation</b><div className="page-subtitle">A read-only explanation for this exact source record.</div></div><span className="badge badge-warn">{selectedAiFinding.risk_level}</span></div><div className="qbo-toolgrid"><span><i>Rule</i><b>{selectedAiFinding.rule_id}</b></span><span><i>Confidence</i><b>{selectedAiFinding.confidence}</b></span><span><i>Owner</i><b>{selectedAiFinding.suggested_owner}</b></span><span><i>Due date</i><b>{selectedAiFinding.due_date||selectedAiFinding.due_date_status}</b></span></div><StateBlock tone="warn" title="Why this needs review">{selectedAiFinding.reason}</StateBlock><StateBlock tone="info" title="Next action">{selectedAiFinding.suggested_action}</StateBlock></section>}</section>}
      </>}
    </section>}
  </section>;
}
