import React,{useEffect,useRef,useState} from 'react';
import {readAuthoritativeJournalEntryDetail,readAuthoritativeSourceDocumentDetail,refreshAuthoritativeFinancialStatements,refreshAuthoritativeGeneralLedger} from './accounting-api.js';
import {adaptProviderTraceForUi} from './provider-trace-adapter.js';
import {StateBlock} from './ui.jsx';

const MONEY4=/^-?(?:0|[1-9][0-9]{0,15})\.\d{4}$/;
const money=value=>typeof value==='string'&&MONEY4.test(value)?value:'Not returned';
const ids=value=>Array.isArray(value)?value:[];
const includesAll=(haystack,needles)=>needles.every(value=>haystack.includes(value));
const journalContext=(config,journal)=>({entityId:config.entityId,periodId:config.periodId,journalId:journal.journal_entry_id,journalRevision:journal.revision,journalCurrency:journal.currency});
export const exactLineageIdSet=(left,right)=>Array.isArray(left)&&Array.isArray(right)&&left.length===right.length&&[...left].sort().every((value,index)=>value===[...right].sort()[index]);
export const journalLineMatchesLedger=(journal,line,row)=>Boolean(journal&&line&&row&&journal.journal_entry_id===row.journal_entry_id&&line.journal_line_id===row.journal_line_id&&line.ledger_line_id===row.ledger_line_id&&line.account_code===row.account_code&&journal.currency===row.currency&&MONEY4.test(line.debit_amount)&&line.debit_amount===row.debit_amount&&MONEY4.test(line.credit_amount)&&line.credit_amount===row.credit_amount&&exactLineageIdSet(line.source_document_ids,row.source_document_ids));
export const createLineageRequestGuard=()=>{let version=0;return {start:()=>++version,isCurrent:token=>token===version,invalidate:()=>++version};};
const providerValue=value=>value===null||value===undefined||value===''?'Not supplied by Provider':String(value);
const ProviderValue=({value})=>{const text=providerValue(value);const display=text.length>64?`${text.slice(0,61)}...`:text;return <b title={display===text?undefined:text}>{display}</b>;};
const providerMatchCount=count=>count===0?'0':count===1?'1':'2+';
const mappingTitle=status=>status==='RESOLVED'?'Controller mapping resolved':status==='QUARANTINED'?'Mapping quarantined':status==='REJECTED'?'Mapping rejected':'Mapping review required';
const traceRows=detail=>Array.isArray(detail?.lines)?detail.lines.filter(line=>line?.provider_trace):[];
export function ProviderEvidenceTrace({lines=[]}){
  const rows=lines.filter(line=>line?.provider_trace).map(line=>({...line,provider_trace:adaptProviderTraceForUi(line.provider_trace)}));
  if(!rows.length)return null;
  return <section className="report-workbench" aria-label="Provider source trace">
    <div className="report-workbench-head"><div><b>Provider source trace</b><div className="page-subtitle">Selected source facts retained by the authenticated API with a no-store read. Missing values are shown as supplied; they are not inferred as errors.</div></div><span className="badge badge-muted">READ ONLY</span></div>
    {rows.map(line=>{
      const trace=line.provider_trace;
      if(trace.supported===false)return <StateBlock key={line.source_document_line_id} tone="warn" title="Unsupported provider trace">This source document is retained, but its provider trace is not supported by this application version. No trace facts or accounting actions are shown.</StateBlock>;
      if(trace.domain==='PAYABLES')return <section key={line.source_document_line_id} className="qbo-toolgrid" aria-label={`Payable source trace line ${line.line_no}`}><span><i>Invoice number</i><ProviderValue value={trace.invoice_no}/></span><span><i>Invoice date</i><ProviderValue value={trace.invoice_date}/></span><span><i>Business ID</i><ProviderValue value={trace.business_id}/></span><span><i>Source payload hash</i><ProviderValue value={trace.source_payload_hash}/></span><span><i>Service period</i><ProviderValue value={`${providerValue(trace.accrual.service_period_start)} to ${providerValue(trace.accrual.service_period_end)}`}/></span><span><i>Recurring obligation</i><ProviderValue value={trace.accrual.recurring_obligation_id}/></span><span><i>Contract / charge</i><ProviderValue value={`${providerValue(trace.accrual.contract_id)} / ${providerValue(trace.accrual.charge_code)}`}/></span><span><i>Service frequency</i><ProviderValue value={trace.accrual.service_frequency}/></span><span><i>Obligation status</i><ProviderValue value={trace.accrual.obligation_status}/></span></section>;
      return <section key={line.source_document_line_id} className="qbo-toolgrid" aria-label={`Insurance source trace line ${line.line_no}`}><span><i>Policy</i><ProviderValue value={trace.policy_id}/></span><span><i>Provider source ID</i><ProviderValue value={trace.source_id}/></span><span><i>Provider PC code</i><ProviderValue value={trace.pc_code}/></span><span><i>Final premium</i><ProviderValue value={trace.final_premium}/></span><span><i>Source payload hash</i><ProviderValue value={trace.source_payload_hash}/></span><span><i>Resolved company</i><ProviderValue value={trace.resolved_company_code}/></span><span><i>Mapping decision</i><ProviderValue value={trace.mapping_decision_id}/></span><span><i>Mapping decision hash</i><ProviderValue value={trace.mapping_decision_hash}/></span><span><i>Company mapping hash</i><ProviderValue value={trace.company_mapping_hash}/></span><span><i>Mapping matches</i><ProviderValue value={providerMatchCount(trace.match_count)}/></span><span><i>Coverage</i><ProviderValue value={`${providerValue(trace.coverage_start)} to ${providerValue(trace.coverage_end)}`}/></span><span><i>Coverage status</i><ProviderValue value={trace.coverage_disposition}/></span><StateBlock tone={trace.disposition==='RESOLVED'?'info':'warn'} title={mappingTitle(trace.disposition)}>{trace.disposition==='RESOLVED'?'This immutable evidence is readable only. A separate authorized workflow decides any accounting action.':'The Controller mapping needs finance review. No Draft or Post action is available.'}</StateBlock></section>;
    })}
  </section>;
}

export function AuthoritativeLineageDrill({config,fetcher=globalThis.fetch,initial,onExit}){
  const entityLabel=config?.scopePresentation?.entityLabel||'Configured entity',periodLabel=config?.scopePresentation?.periodLabel||'Configured period';
  const [stack,setStack]=useState([initial]);
  const [read,setRead]=useState({phase:'READY',error:null});
  const requestGuard=useRef(null);
  if(!requestGuard.current)requestGuard.current=createLineageRequestGuard();
  useEffect(()=>()=>{requestGuard.current.invalidate();},[]);
  const frame=stack.at(-1);
  const beginRead=()=>{const token=requestGuard.current.start();setRead({phase:'LOADING',error:null});return token;};
  const push=(value,token)=>{if(token!==undefined&&!requestGuard.current.isCurrent(token))return;setRead({phase:'READY',error:null});setStack(current=>[...current,value]);};
  const fail=(token,message)=>{if(requestGuard.current.isCurrent(token))setRead({phase:'BLOCKED',error:{message}});};
  const block=message=>{const token=requestGuard.current.start();fail(token,message);};
  const clearBlocked=()=>{requestGuard.current.invalidate();setRead({phase:'READY',error:null});};
  const back=()=>stack.length===1?onExit():setStack(current=>current.slice(0,-1));
  const readJournal=async(journalEntryId,expected={})=>{
    const token=beginRead();
    const result=await readAuthoritativeJournalEntryDetail({config,journalEntryId,fetcher});
    if(!requestGuard.current.isCurrent(token))return;
    if(!result.ok){fail(token,result.message);return;}
    const journal=result.journal;
    const lines=journal.lines||[];
    const exact=journal.entity_id===config.entityId&&journal.period_id===config.periodId
      &&(!expected.sourceDocumentId||lines.some(line=>line.source_document_ids.includes(expected.sourceDocumentId)))
      &&(!expected.ledgerRow||lines.some(line=>journalLineMatchesLedger(journal,line,expected.ledgerRow)));
    if(!exact){fail(token,'The Journal detail did not retain the immutable entity, period, account, currency, MONEY4 debit and credit, line, ledger, and exact source relationship used to open it.');return;}
    push({kind:'JOURNAL',journal,context:journalContext(config,journal)},token);
  };
  const readLedger=async(journal,line)=>{
    if(!line.ledger_line_id){block('This Journal line is not POSTED and has no immutable ledger-line identity.');return;}
    const token=beginRead();
    const result=await refreshAuthoritativeGeneralLedger({config,accountCode:line.account_code,query:journal.journal_number,limit:200,offset:0,fetcher});
    if(!requestGuard.current.isCurrent(token))return;
    if(!result.ok){fail(token,result.message);return;}
    const matches=result.rows.filter(row=>journalLineMatchesLedger(journal,line,row));
    if(matches.length!==1){fail(token,'The General Ledger read did not return exactly one line matching the frozen Journal Entry, Journal Line, ledger line, account, currency, MONEY4 debit and credit, exact source set, entity, and period.');return;}
    push({kind:'GL',row:matches[0],context:{entityId:config.entityId,periodId:config.periodId,journalEntryId:journal.journal_entry_id,journalLineId:line.journal_line_id,ledgerLineId:line.ledger_line_id}},token);
  };
  const readSource=async(sourceDocumentId,expectedJournalId)=>{
    const token=beginRead();
    const result=await readAuthoritativeSourceDocumentDetail({config,sourceDocumentId,fetcher});
    if(!requestGuard.current.isCurrent(token))return;
    if(!result.ok){fail(token,result.message);return;}
    const detail=result.detail;
    if(detail.source_document_id!==sourceDocumentId||(expectedJournalId&&!detail.posted_journal_entry_ids.includes(expectedJournalId))){fail(token,'The Source Document detail did not retain the exact source-to-Journal relationship used to open it.');return;}
    push({kind:'SOURCE',detail,context:{entityId:config.entityId,periodId:config.periodId,sourceDocumentId,sourceRevision:detail.source_document_revision,payloadHash:detail.payload_hash}},token);
  };
  const readReports=async row=>{
    const token=beginRead();
    const result=await refreshAuthoritativeFinancialStatements({config,fetcher});
    if(!requestGuard.current.isCurrent(token))return;
    if(!result.ok){fail(token,result.message);return;}
    const matches=result.rows.filter(item=>item.period_id===config.periodId&&item.account_code===row.account_code&&item.currency===row.currency&&item.journal_entry_ids.includes(row.journal_entry_id)&&item.journal_line_ids.includes(row.journal_line_id)&&item.ledger_line_ids.includes(row.ledger_line_id)&&includesAll(item.source_document_ids,row.source_document_ids));
    if(!matches.length){fail(token,'No report row retained this exact posted ledger line and its complete source relationship.');return;}
    push({kind:'REPORT_CHOOSER',rows:matches,ledger:row,context:{entityId:config.entityId,periodId:config.periodId,ledgerLineId:row.ledger_line_id}},token);
  };
  const readLedgerFromReport=async(row,ledgerLineId)=>{
    if(!row.ledger_line_ids.includes(ledgerLineId)){block('The selected ledger line is outside the immutable report row.');return;}
    const token=beginRead();
    const result=await refreshAuthoritativeGeneralLedger({config,accountCode:row.account_code,query:null,limit:200,offset:0,fetcher});
    if(!requestGuard.current.isCurrent(token))return;
    if(!result.ok){fail(token,result.message);return;}
    const matches=result.rows.filter(item=>item.ledger_line_id===ledgerLineId&&item.account_code===row.account_code&&(!row.currency||item.currency===row.currency)&&row.journal_entry_ids.includes(item.journal_entry_id)&&row.journal_line_ids.includes(item.journal_line_id)&&includesAll(row.source_document_ids,item.source_document_ids));
    if(matches.length!==1){fail(token,'The General Ledger read did not return exactly one immutable line contained by the selected report row.');return;}
    const item=matches[0];push({kind:'GL',row:item,context:{entityId:config.entityId,periodId:config.periodId,journalEntryId:item.journal_entry_id,journalLineId:item.journal_line_id,ledgerLineId:item.ledger_line_id}},token);
  };
  const readLedgerFromEvidence=async(evidence,ledgerLineId)=>{
    if(!ids(evidence?.ledger_line_ids).includes(ledgerLineId)){block('The selected ledger line is outside the immutable evidence row.');return;}
    const token=beginRead();
    const accountCode=typeof evidence.account_code==='string'&&evidence.account_code?evidence.account_code:null;
    const result=await refreshAuthoritativeGeneralLedger({config,accountCode,query:null,limit:200,offset:0,fetcher});
    if(!requestGuard.current.isCurrent(token))return;
    if(!result.ok){fail(token,result.message);return;}
    const matches=result.rows.filter(item=>item.ledger_line_id===ledgerLineId&&(!accountCode||item.account_code===accountCode)&&(!evidence.currency||item.currency===evidence.currency)&&ids(evidence.journal_entry_ids).includes(item.journal_entry_id)&&ids(evidence.journal_line_ids).includes(item.journal_line_id)&&includesAll(ids(evidence.source_document_ids),item.source_document_ids));
    if(matches.length!==1){fail(token,'The General Ledger read did not return exactly one immutable line contained by the selected evidence row.');return;}
    const item=matches[0];push({kind:'GL',row:item,context:{entityId:config.entityId,periodId:config.periodId,journalEntryId:item.journal_entry_id,journalLineId:item.journal_line_id,ledgerLineId:item.ledger_line_id}},token);
  };
  if(read.phase==='LOADING')return <section className="full-bleed qbo-transaction-report authoritative-evidence-page"><StateBlock tone="loading" title="Reading evidence">Re-reading immutable lineage evidence. Navigation resumes when this exact GET completes.</StateBlock></section>;
  if(read.phase==='BLOCKED')return <section className="full-bleed qbo-transaction-report authoritative-evidence-page"><div className="qbo-report-back"><button type="button" className="btn btn-sm btn-ghost" onClick={clearBlocked}>Back to current evidence</button><span title={`Entity ID: ${config.entityId}; Period ID: ${config.periodId}`}>Entity {entityLabel} | Period {periodLabel}</span></div><StateBlock tone="blocked" title="BLOCKED - immutable lineage mismatch">{read.error.message}</StateBlock></section>;
  const presentedFrame={...frame,context:{...frame.context,entityLabel,periodLabel}};
  if(frame.kind==='JOURNAL')return <JournalFrame frame={presentedFrame} back={back} readLedger={readLedger} readSource={readSource}/>;
  if(frame.kind==='GL')return <LedgerFrame frame={presentedFrame} back={back} readJournal={readJournal} readSource={readSource} readReports={readReports}/>;
  if(frame.kind==='SOURCE')return <SourceFrame frame={presentedFrame} back={back} readJournal={readJournal}/>;
  if(frame.kind==='REPORT_CHOOSER')return <ReportChooser frame={presentedFrame} back={back} open={row=>{requestGuard.current.invalidate();push({kind:'REPORT',row,context:{entityId:config.entityId,periodId:config.periodId,report:row.statement_type,accountCode:row.account_code,section:row.statement_section,ledgerLineId:frame.ledger.ledger_line_id}});}}/>;
  if(frame.kind==='EVIDENCE')return <EvidenceFrame frame={presentedFrame} back={back} readLedger={readLedgerFromEvidence}/>;
  return <ReportFrame frame={presentedFrame} back={back} readLedger={readLedgerFromReport}/>;
}

const Back=({onClick,label='Back to prior evidence',context})=><div className="qbo-report-back"><button type="button" className="btn btn-sm btn-ghost" onClick={onClick}>{label}</button><span title={`Entity ID: ${context.entityId}; Period ID: ${context.periodId}`}>Entity {context.entityLabel||'Configured entity'} | Period {context.periodLabel||'Configured period'}</span></div>;

function JournalFrame({frame,back,readLedger,readSource}){const j=frame.journal;return <section className="full-bleed qbo-transaction-report authoritative-evidence-page" aria-label="Journal lineage evidence"><Back onClick={back} context={frame.context}/><h1>Journal entry {j.journal_number}</h1><p className="page-subtitle">Exact GET evidence for Journal {j.journal_entry_id}, revision {j.revision}, currency {j.currency}.</p><div className="table-wrap" role="region" tabIndex={0} aria-label="Journal lineage lines; scroll horizontally"><table className="tbl"><thead><tr><th>Line</th><th>Account</th><th>Debit</th><th>Credit</th><th>Ledger</th><th>Sources</th></tr></thead><tbody>{j.lines.map(line=><tr key={line.journal_line_id}><td>{line.line_no}</td><td>{line.account_code}</td><td>{money(line.debit_amount)}</td><td>{money(line.credit_amount)}</td><td>{line.ledger_line_id?<button type="button" className="btn btn-sm" onClick={()=>readLedger(j,line)}>Open GL evidence</button>:'Not posted'}</td><td>{line.source_document_ids.length?line.source_document_ids.map(id=><button key={id} type="button" className="btn btn-sm btn-ghost" onClick={()=>readSource(id,j.journal_entry_id)}>Open source</button>):'None returned'}</td></tr>)}</tbody></table></div><StateBlock tone="empty" title="GET only">No edit, workflow, posting, export, or reconstructed lineage action is available.</StateBlock></section>}

function LedgerFrame({frame,back,readJournal,readSource,readReports}){const row=frame.row;return <section className="full-bleed qbo-transaction-report authoritative-evidence-page" aria-label="General Ledger lineage evidence"><Back onClick={back} context={frame.context}/><h1>Posted ledger line</h1><div className="qbo-toolgrid"><span><i>Account</i><b>{row.account_code}</b></span><span><i>Journal</i><b>{row.journal_number}</b></span><span><i>Debit</i><b>{money(row.debit_amount)}</b></span><span><i>Credit</i><b>{money(row.credit_amount)}</b></span></div><div className="row-acts"><button type="button" className="btn btn-sm" onClick={()=>readJournal(row.journal_entry_id,{ledgerRow:row})}>Open Journal evidence</button>{row.source_document_ids.map(id=><button key={id} type="button" className="btn btn-sm btn-ghost" onClick={()=>readSource(id,row.journal_entry_id)}>Open source evidence</button>)}<button type="button" className="btn btn-sm btn-ghost" onClick={()=>readReports(row)}>Find report evidence</button></div><p className="muted sm">Ledger line {row.ledger_line_id}. Every destination is re-read and must retain this exact entity, period, Journal, line, ledger, account, currency, and source scope.</p></section>}

  function SourceFrame({frame,back,readJournal}){const d=frame.detail;return <section className="full-bleed qbo-transaction-report authoritative-evidence-page" aria-label="Source Document lineage evidence"><Back onClick={back} context={frame.context}/><h1>Source Document evidence</h1><div className="qbo-toolgrid"><span><i>Document</i><b>{d.document_no||d.source_record_id}</b></span><span><i>Revision</i><b>{d.source_document_revision}</b></span><span><i>Accounting date</i><b>{d.accounting_date}</b></span><span><i>Currency</i><b>{d.currency}</b></span></div><p className="muted sm">Immutable payload hash {d.payload_hash}. Raw provider data and attachment bytes are not exposed.</p><ProviderEvidenceTrace lines={traceRows(d)}/><div className="row-acts">{d.posted_journal_entry_ids.map(id=><button key={id} type="button" className="btn btn-sm" onClick={()=>readJournal(id,{sourceDocumentId:d.source_document_id})}>Open linked Journal</button>)}</div>{!d.posted_journal_entry_ids.length&&<StateBlock tone="empty" title="No POSTED Journal link returned">This source remains readable, but no Journal or ledger drill is asserted.</StateBlock>}</section>}

function ReportChooser({frame,back,open}){return <section className="full-bleed qbo-transaction-report authoritative-evidence-page" aria-label="Matching report evidence"><Back onClick={back} context={frame.context}/><h1>Report evidence containing this ledger line</h1><p className="page-subtitle">Choose an explicit API-returned statement row; REFS does not infer which report you intended.</p><div className="stack">{frame.rows.map(row=><button key={`${row.statement_type}:${row.account_code}`} type="button" className="btn" onClick={()=>open(row)}>{row.statement_type} | {row.statement_section} | {row.account_code}</button>)}</div></section>}

function EvidenceFrame({frame,back,readLedger}){const row=frame.row,account=row.account_code||'Multiple retained accounts';return <section className="full-bleed qbo-transaction-report authoritative-evidence-page" aria-label="Report evidence lineage"><Back onClick={back} context={frame.context}/><h1>{account} evidence drill</h1><p className="page-subtitle">Select one API-returned POSTED ledger line. REFS will re-read General Ledger, then require the exact Journal and Source relationships before continuing.</p><div className="qbo-toolgrid"><span><i>Account scope</i><b>{account}</b></span><span><i>Journal entries</i><b>{ids(row.journal_entry_ids).length}</b></span><span><i>Journal lines</i><b>{ids(row.journal_line_ids).length}</b></span><span><i>Sources</i><b>{ids(row.source_document_ids).length}</b></span></div><div className="row-acts">{ids(row.ledger_line_ids).map(id=><button key={id} type="button" className="btn btn-sm" onClick={()=>readLedger(row,id)}>Open GL line</button>)}</div></section>}

function ReportFrame({frame,back,readLedger}){const row=frame.row;return <section className="full-bleed qbo-transaction-report authoritative-evidence-page" aria-label="Report lineage evidence"><Back onClick={back} context={frame.context}/><h1>{row.statement_type} account evidence</h1><div className="qbo-toolgrid"><span><i>Section</i><b>{row.statement_section}</b></span><span><i>Account</i><b>{row.account_code}</b></span><span><i>Period debit</i><b>{money(row.period_debit)}</b></span><span><i>Period credit</i><b>{money(row.period_credit)}</b></span><span><i>Balance</i><b>{money(row.display_balance)}</b></span></div><p className="muted sm">This statement row was returned for the exact entity and period. Open one retained ledger line to re-read its immutable GL evidence.</p><div className="row-acts">{ids(row.ledger_line_ids).map(id=><button key={id} type="button" className="btn btn-sm" onClick={()=>readLedger(row,id)}>Open GL line</button>)}</div></section>}
