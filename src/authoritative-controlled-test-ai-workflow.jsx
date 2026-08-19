import React,{useEffect,useMemo,useState} from 'react';
import {controlledTestAiWorkflowIdempotencyKey,refreshAuthoritativeScope,refreshControlledTestAiSources,runControlledTestAiWorkflow} from './accounting-api.js';
import {StateBlock} from './ui.jsx';

const idle={phase:'LOADING',sources:[],scope:null,error:null};
const monthEnd=start=>new Date(Date.UTC(Number(start.slice(0,4)),Number(start.slice(5,7)),0)).toISOString().slice(0,10);

export function AuthoritativeControlledTestAiWorkflow({config,fetcher=globalThis.fetch,onAccountingRefresh=async()=>{}}){
  const enabled=config?.deploymentEnvironment==='staging'&&config?.controlledTestAiWorkflowMode==='ENABLED';
  const [evidence,setEvidence]=useState(idle),[selection,setSelection]=useState(''),[reason,setReason]=useState('Run TEST_ONLY AI accounting workflow for this posted WBS payable.'),[command,setCommand]=useState({phase:'IDLE',data:null,error:null,retry:null});
  const load=async()=>{
    setEvidence(idle);
    const [documents,scope]=await Promise.all([refreshControlledTestAiSources({config,limit:100,fetcher}),refreshAuthoritativeScope({config,fetcher})]);
    if(!documents.ok||!scope.ok){const error=!documents.ok?documents:scope;setEvidence({phase:'BLOCKED',sources:[],scope:null,error});return;}
    if(scope.row.period_status!=='OPEN'){setEvidence({phase:'BLOCKED',sources:[],scope:scope.row,error:{code:'CONTROLLED_TEST_AI_PERIOD_NOT_OPEN',message:'The configured accounting period is not OPEN.'}});return;}
    const sources=documents.rows.filter(row=>['WBS','REFS_STAGE1'].includes(row.source_system)&&row.source_module==='payable'&&row.document_type==='WBS_TEST_PAYABLE'&&row.status==='POSTED'&&row.accounting_date>=scope.row.period_start&&row.accounting_date<=scope.row.period_end&&row.posted_journal_entry_ids.length>0);
    setEvidence({phase:'READY',sources,scope:scope.row,error:null});
  };
  useEffect(()=>{if(enabled)void load();},[enabled,config?.entityId,config?.periodId]);
  const selected=useMemo(()=>evidence.sources.find(row=>row.source_document_id===selection)||null,[evidence.sources,selection]);
  const run=async()=>{
    const retry=command.retry;
    const source=retry?evidence.sources.find(row=>row.source_document_id===retry.parentSourceDocumentId):selected;
    if(!source||!evidence.scope){setCommand({phase:'BLOCKED',data:null,retry:null,error:{code:'CONTROLLED_TEST_AI_SOURCE_REQUIRED',message:'Select one POSTED WBS TEST_ONLY source in the configured OPEN period.'}});return;}
    const request=retry||{periodId:evidence.scope.period_id,parentSourceDocumentId:source.source_document_id,coverageStart:`${source.accounting_date.slice(0,7)}-01`,coverageEnd:monthEnd(source.accounting_date),reason:reason.trim()};
    const key=retry?.idempotencyKey||await controlledTestAiWorkflowIdempotencyKey({config,...request});
    if(!key){setCommand({phase:'BLOCKED',data:null,retry:null,error:{code:'CONTROLLED_TEST_AI_COMMAND_INVALID',message:'A stable test command could not be derived from this source, OPEN period, and reason.'}});return;}
    setCommand({phase:'LOADING',data:command.data,error:null,retry:retry||{...request,idempotencyKey:key}});
    const result=await runControlledTestAiWorkflow({config,...request,idempotencyKey:key,fetcher});
    if(!result.ok){setCommand({phase:'BLOCKED',data:null,error:result,retry:{...request,idempotencyKey:key}});return;}
    if(result.data.status==='CONTROLLED_TEST_AI_WORKFLOW_PARTIAL'){setCommand({phase:'PARTIAL',data:result.data,error:null,retry:{...request,idempotencyKey:key}});return;}
    setCommand({phase:'POSTED',data:result.data,error:null,retry:null});
    await onAccountingRefresh();await load();
  };
  if(!enabled)return null;
  const frozen=Boolean(command.retry),coverage=selected?`${selected.accounting_date.slice(0,7)}-01 to ${monthEnd(selected.accounting_date)}`:'Select a source';
  return <section className="card" aria-label="Controlled staging AI accounting workflow">
    <div className="card-head"><div><h2>Run WBS TEST_ONLY AI flow</h2><p className="muted sm">Staging only. Select a POSTED WBS_TEST_PAYABLE source in the corresponding OPEN period. The server keeps its fixed seven distinct actors; this browser receives no AI.TEST.WORKFLOW grant.</p></div><span className="badge badge-warning">UNSIGNED TEST ONLY</span></div>
    {evidence.phase==='LOADING'?<StateBlock tone="loading" title="Loading TEST_ONLY sources">Reading POSTED WBS test sources and the configured accounting period.</StateBlock>:null}
    {evidence.phase==='BLOCKED'?<StateBlock tone="blocked" title={evidence.error?.code||'CONTROLLED_TEST_AI_READ_BLOCKED'}>{evidence.error?.message} No workflow command is available.</StateBlock>:null}
    {evidence.phase==='READY'&&evidence.sources.length===0?<StateBlock tone="empty" title="No eligible WBS TEST_ONLY source">Import and post a WBS test payable in the configured OPEN period, then refresh this page.</StateBlock>:null}
    {evidence.sources.length>0?<><div className="filter-bar"><label>Parent source<select value={selection} disabled={frozen||command.phase==='LOADING'} onChange={event=>{setSelection(event.target.value);setCommand({phase:'IDLE',data:null,error:null,retry:null});}}><option value="">Select POSTED WBS_TEST_PAYABLE</option>{evidence.sources.map(row=><option key={row.source_document_id} value={row.source_document_id}>{row.document_no||row.source_record_id} / {row.accounting_date} / {row.currency} {row.gross_amount}</option>)}</select></label><label>OPEN period<select value={evidence.scope?.period_id||''} disabled><option value={evidence.scope?.period_id||''}>{evidence.scope?.period_code||config.periodId} / OPEN</option></select></label><label>Coverage<input value={coverage} disabled/></label><label>Test reason<input value={reason} disabled={frozen||command.phase==='LOADING'} onChange={event=>{setReason(event.target.value);setCommand({phase:'IDLE',data:null,error:null,retry:null});}} placeholder="Explain this test run"/></label><button type="button" className="btn btn-primary" onClick={run} disabled={command.phase==='LOADING'||(!selected&&!command.retry)}>{command.phase==='LOADING'?'Running TEST_ONLY flow...':command.retry?'Continue same TEST_ONLY run':'Run full TEST_ONLY flow'}</button></div><div className="muted sm">Durable path: source derivation - proposal - MANUAL Draft - Submit - Review - Approve - Post. A PARTIAL receipt is continued with the exact same Idempotency-Key.</div></>:null}
    {command.phase==='BLOCKED'?<StateBlock tone="blocked" title={command.error?.code||'CONTROLLED_TEST_AI_BLOCKED'}>{command.error?.message} Retry continues with the same frozen command identity.</StateBlock>:null}
    {command.phase==='PARTIAL'?<StateBlock tone="blocked" title={`PARTIAL after ${command.data.completed_stage}`}>Durable progress was retained. Continue this exact run with key <span className="mono sm">{command.data.idempotency_key}</span>.</StateBlock>:null}
    {command.phase==='POSTED'?<StateBlock tone="ok" title="TEST_ONLY AI journal POSTED">Journal {command.data.journal_entry_id} posted in batch {command.data.posting_batch_id}. Journal Entries, GL, reports, and Source Documents have been refreshed.</StateBlock>:null}
  </section>;
}
