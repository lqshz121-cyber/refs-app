import React,{useEffect,useState} from 'react';
import {WBS_LIVE_PILOT_VIEWS,activateAuthoritativeWbsOperatorAccess,attestAuthoritativeWbsPayableObservation,refreshAuthoritativeWbsLivePilot,refreshAuthoritativeWbsOperatorPayableAttestations} from './accounting-api.js';
import {StateBlock} from './ui.jsx';

export const WBS_LIVE_PILOT_SURFACE_TOOLS=Object.freeze({
  dashboard:Object.freeze(['list_payables','list_bank_transactions','list_autorec_details','list_autorec_banks','list_journal_entries']),
  payables:Object.freeze(['list_payables']),
  bank:Object.freeze(['list_bank_transactions']),
  journal:Object.freeze(['list_journal_entries']),
  wbs:Object.freeze(['list_payables','list_bank_transactions','list_autorec_details','list_autorec_banks','list_journal_entries']),
});

const columnLabels=Object.freeze({source_record_hash:'Sanitized source hash',accounting_date:'Accounting date',currency:'Currency',amount:'Observed amount',direction:'Provider direction',status:'Provider status',payment_amount:'Observed payment',deposit_amount:'Observed deposit',match_status:'Provider match status',pay_amount:'Observed pay amount',debit_amount:'Observed debit',quantity:'Observed quantity',released_amount:'Observed released amount',released_quantity:'Observed released quantity',incurred_amount:'Observed incurred amount',credit_amount:'Observed credit',review_status:'Provider review status'});

const approvedTools=tools=>{
  const unique=[...new Set(Array.isArray(tools)?tools:[])];
  return unique.filter(tool=>Object.hasOwn(WBS_LIVE_PILOT_VIEWS,tool));
};

export function AuthoritativeWbsLivePilotObservation({config,fetcher=globalThis.fetch,tools=WBS_LIVE_PILOT_SURFACE_TOOLS.wbs,title='Production WBS provider observation',showRows=true}){
  const availableTools=approvedTools(tools);
  const [tool,setTool]=useState(availableTools[0]||'');
  const [state,setState]=useState({phase:'IDLE',data:null,error:null});
  const [attestationState,setAttestationState]=useState({phase:'IDLE',rows:[],error:null,result:null});
  const [capabilityState,setCapabilityState]=useState({phase:'LOADING',canAttest:false,error:null});
  const [attestationReason,setAttestationReason]=useState('Retain this exact production WBS Payable read as unsigned exception evidence');
  const [attestationConfirmation,setAttestationConfirmation]=useState(false);
  const view=WBS_LIVE_PILOT_VIEWS[tool];
  const observation=state.data;
  useEffect(()=>{let current=true;setCapabilityState({phase:'LOADING',canAttest:false,error:null});refreshAuthoritativeWbsOperatorPayableAttestations({config,fetcher}).then(result=>{if(current){setCapabilityState(result.ok?{phase:'READY',canAttest:true,error:null}:{phase:'BLOCKED',canAttest:false,error:result});if(result.ok)setAttestationState({phase:'READY',rows:result.rows,error:null,result:null});}});return()=>{current=false;};},[config,fetcher]);
  if(!view)return null;
  const read=async event=>{
    event.preventDefault();
    setState(current=>({...current,phase:'LOADING',error:null}));
    const result=await refreshAuthoritativeWbsLivePilot({config,tool,limit:10,fetcher});
    setAttestationConfirmation(false);
    setState(current=>result.ok?{phase:'READY',data:result.data,error:null}:{phase:'BLOCKED',data:current.data,error:result});
  };
  const readAttestations=async()=>{setAttestationState(current=>({...current,phase:'LOADING',error:null,result:null}));const result=await refreshAuthoritativeWbsOperatorPayableAttestations({config,fetcher});setAttestationState(result.ok?{phase:'READY',rows:result.rows,error:null,result:null}:{phase:'BLOCKED',rows:[],error:result,result:null});};
  const enableAttestation=async()=>{setCapabilityState({phase:'LOADING',canAttest:false,error:null});const result=await activateAuthoritativeWbsOperatorAccess({config,fetcher,idempotencyKey:`wbs-operator-access-${globalThis.crypto?.randomUUID?.()||Date.now().toString(36)}`});if(!result.ok){setCapabilityState({phase:'BLOCKED',canAttest:false,error:result});return;}const refreshed=await refreshAuthoritativeWbsOperatorPayableAttestations({config,fetcher});setCapabilityState(refreshed.ok?{phase:'READY',canAttest:true,error:null}:{phase:'BLOCKED',canAttest:false,error:refreshed});if(refreshed.ok)setAttestationState({phase:'READY',rows:refreshed.rows,error:null,result:null});};
  const attest=async()=>{if(tool!=='list_payables'||!observation||observation.record_count<1)return;setAttestationConfirmation(false);setAttestationState(current=>({...current,phase:'LOADING',error:null,result:null}));const result=await attestAuthoritativeWbsPayableObservation({config,observation,reason:attestationReason,idempotencyKey:`wbs-operator-attest-${globalThis.crypto?.randomUUID?.()||Date.now().toString(36)}`,fetcher});if(!result.ok){setAttestationState(current=>({...current,phase:'BLOCKED',error:result,result:null}));return;}const refreshed=await refreshAuthoritativeWbsOperatorPayableAttestations({config,fetcher});setAttestationState(refreshed.ok?{phase:'READY',rows:refreshed.rows,error:null,result:result.data}:{phase:'BLOCKED',rows:[],error:refreshed,result:result.data});};
  return <section className="report-workbench authoritative-wbs-live-pilot-observation" aria-label={title}>
    <div className="report-workbench-head"><div><b>{title}</b><div className="page-subtitle">Sanitized provider observations only. These rows are not REFS accounting records and are excluded from every accounting total, queue, Match, Reconcile, Draft, approval, and posting workflow.</div></div><div className="authoritative-wbs-live-pilot-status" aria-label="Production WBS observation boundary"><span className="badge badge-warn">UNSIGNED PILOT</span><span className="badge badge-muted">GET ONLY</span><span className="badge badge-muted">NOT ADMITTED</span><span className="badge badge-muted">NOT POSTABLE</span></div></div>
    <form className="filterbar authoritative-wbs-live-pilot-controls" onSubmit={read}>
      {availableTools.length>1?<label>WBS read-only view<select aria-label="WBS read-only view" value={tool} onChange={event=>{setTool(event.target.value);setState({phase:'IDLE',data:null,error:null});}}>{availableTools.map(name=><option key={name} value={name}>{WBS_LIVE_PILOT_VIEWS[name].label}</option>)}</select></label>:<span className="muted sm"><b>WBS read-only view:</b> {view.label}</span>}
      <button type="submit" className="btn" disabled={state.phase==='LOADING'}>{state.phase==='LOADING'?'Reading WBS observation...':'Load WBS observation (GET only)'}</button>
    </form>
    {state.phase==='LOADING'&&<StateBlock tone="loading" title="Reading production WBS observation">The accounting API is requesting at most ten sanitized rows from this fixed GET-only view.</StateBlock>}
    {state.phase==='BLOCKED'&&<StateBlock tone="blocked" title={state.error?.code||'WBS_LIVE_PILOT_BLOCKED'}>WBS observation unavailable. Authoritative accounting data and workflows are unchanged.{observation&&' The previous validated WBS observation remains below.'}</StateBlock>}
    {state.phase==='IDLE'&&<StateBlock tone="empty" title="No WBS observation loaded">Use the GET-only reader to inspect sanitized provider facts. No credential, raw business identifier, accounting record, or action is exposed.</StateBlock>}
    {observation&&<>
      <div className="qbo-toolgrid"><span><i>Admission</i><b>{observation.status}</b></span><span><i>Provider signature</i><b>Not supplied</b></span><span><i>Provider captured at</i><b>{observation.captured_at}</b></span><span><i>Observed provider rows</i><b>{observation.record_count}</b></span><span><i>Provider content hash</i><b>{observation.provider_content_sha256}</b></span><span><i>Action authority</i><b>None</b></span></div>
      {showRows&&(observation.rows.length===0?<StateBlock tone="empty" title="No WBS rows were observed in this bounded read">This does not mean zero accounting activity or zero WBS activity.</StateBlock>:<div className="table-wrap authoritative-wbs-live-pilot-table" role="region" tabIndex={0} aria-label={`${view.label} unsigned production observation; scroll horizontally to view every column`}><table className="tbl"><thead><tr>{view.fields.map(field=><th scope="col" key={field}>{columnLabels[field]}</th>)}</tr></thead><tbody>{observation.rows.map(row=><tr key={row.source_record_hash}>{view.fields.map(field=><td key={field}>{row[field]===null?'Unavailable':row[field]}</td>)}</tr>)}</tbody></table></div>)}
    </>}
    {tool==='list_payables'&&<section className="filterbar" aria-label="Operator-attested WBS Payable exception evidence">
      <div><b>Retained exception evidence</b><div className="page-subtitle">Operator-attested and unsigned. It stays outside Raw, Staging, AP Bills, Journals, GL, and Posted totals.</div></div>
      <div className="report-shelf" aria-label="Operator attestation boundary"><span className="report-shelf-chip report-shelf-chip-on">OPERATOR ATTESTED</span><span className="report-shelf-chip">UNSIGNED</span><span className="report-shelf-chip">EXCEPTION REVIEW REQUIRED</span><span className="report-shelf-chip">NOT POSTED</span></div>
      <label htmlFor="wbs-operator-attestation-reason">Attestation reason<textarea id="wbs-operator-attestation-reason" minLength="8" maxLength="2000" rows="3" value={attestationReason} onChange={event=>setAttestationReason(event.target.value)}/></label>
      <div><button type="button" className="btn" disabled={capabilityState.phase!=='READY'||!capabilityState.canAttest||!observation||observation.record_count<1||attestationState.phase==='LOADING'} onClick={()=>attestationConfirmation?attest():setAttestationConfirmation(true)}>{attestationConfirmation?'Confirm exception retain':'Retain as exception evidence'}</button> {attestationConfirmation&&<button type="button" className="btn" onClick={()=>setAttestationConfirmation(false)}>Cancel</button>} <button type="button" className="btn" disabled={capabilityState.phase!=='READY'||!capabilityState.canAttest||attestationState.phase==='LOADING'} onClick={readAttestations}>Refresh retained evidence</button></div>
      {attestationConfirmation&&<StateBlock tone="blocked" title="Confirm unsigned exception retain">This retains only the exact fresh WBS Payable observation for exception review. It will not create a Draft or post anything.</StateBlock>}
      {capabilityState.phase==='LOADING'&&<StateBlock tone="loading" title="Checking operator evidence access">No exception-evidence command is available while the server checks this authenticated actor.</StateBlock>}
      {capabilityState.phase==='BLOCKED'&&<StateBlock tone="blocked" title={capabilityState.error?.code||'WBS_OPERATOR_CAPABILITIES_BLOCKED'}>{capabilityState.error?.message}<div><button type="button" className="btn" onClick={enableAttestation}>Enable exception-evidence retain</button></div></StateBlock>}
      {attestationState.phase==='LOADING'&&<StateBlock tone="loading" title="Refreshing operator-attested evidence">The server revalidates scope and retained evidence. No accounting records are created.</StateBlock>}
      {attestationState.phase==='BLOCKED'&&<StateBlock tone="blocked" title={attestationState.error?.code||'WBS_OPERATOR_ATTESTATION_BLOCKED'}>{attestationState.error?.message}</StateBlock>}
      {attestationState.result&&<StateBlock tone="success" title="Unsigned exception evidence retained">The fresh WBS read was retained for controlled exception review. It is not provider-signed, not admitted, not a Draft, and not Posted.</StateBlock>}
      {attestationState.phase==='READY'&&attestationState.rows.length===0&&<StateBlock tone="empty" title="No retained operator-attested evidence">No unsigned exception evidence has been retained for this entity.</StateBlock>}
      {attestationState.rows.length>0&&<div className="table-wrap" role="region" tabIndex={0} aria-label="Operator-attested unsigned WBS Payable exception evidence"><table className="tbl"><thead><tr><th>Captured</th><th>Company</th><th>Rows</th><th>Provenance</th><th>Signature</th><th>Status</th><th>Draft</th><th>Posted</th></tr></thead><tbody>{attestationState.rows.map(row=><tr key={row.wbs_operator_payable_attestation_id}><td>{row.captured_at}</td><td>{row.company_code}</td><td>{row.row_count}</td><td>{row.provenance_mode}</td><td>Not supplied</td><td>{row.evidence_status}</td><td>Blocked</td><td>No</td></tr>)}</tbody></table></div>}
    </section>}
  </section>;
}
