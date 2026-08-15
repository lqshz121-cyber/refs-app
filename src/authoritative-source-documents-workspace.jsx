import React,{useEffect,useMemo,useRef,useState} from 'react';
import {readAuthoritativeSourceDocumentDetail,refreshAuthoritativeSourceDocuments} from './accounting-api.js';
import {StateBlock} from './ui.jsx';
import {AuthoritativeSourceDocumentsView} from './authoritative-source-documents-view.jsx';
import {AuthoritativeLineageDrill} from './authoritative-lineage-drill.jsx';

const failure=(result,fallback)=>result?.message||fallback;
const empty='Not retained';

const documentCounts=rows=>({
  documents:rows.length,
  linked:rows.filter(row=>row.posted_journal_entry_ids.length>0).length,
  unlinked:rows.filter(row=>row.posted_journal_entry_ids.length===0).length,
  sourceSystems:new Set(rows.map(row=>row.source_system)).size,
});

const displayDocument=row=>row.document_no||row.source_record_id||row.source_document_id;
const detailScope=detail=>[
  `Source ${detail.source_system}`,
  `module ${detail.source_module}`,
  `record ${detail.source_record_id}`,
  `version ${detail.source_version}`,
].join(' | ');

export function AuthoritativeSourceDocumentsWorkspace({config,fetcher=globalThis.fetch}){
  const [state,setState]=useState({phase:'LOADING',rows:[],error:null,detail:null});
  const [query,setQuery]=useState('');
  const [sourceSystem,setSourceSystem]=useState('ALL');
  const listScrollRef=useRef(null);
  const detailReturnRef=useRef(null);
  const load=async()=>{setState(current=>({...current,phase:'LOADING',error:null}));const result=await refreshAuthoritativeSourceDocuments({config,fetcher});if(!result.ok){setState({phase:'ERROR',rows:[],error:failure(result,'Source Document evidence could not be loaded.'),detail:null});return;}setState({phase:'READY',rows:result.rows,error:null,detail:null});};
  useEffect(()=>{void load();},[config,fetcher]);
  const rows=useMemo(()=>state.rows.filter(row=>{
    const needle=query.trim().toLowerCase();
    const search=!needle||[row.document_no,row.source_record_id,row.document_type,row.source_system,row.source_module,row.status,row.currency].filter(Boolean).some(value=>String(value).toLowerCase().includes(needle));
    return search&&(sourceSystem==='ALL'||row.source_system===sourceSystem);
  }),[state.rows,query,sourceSystem]);
  const sourceSystems=useMemo(()=>[...new Set(state.rows.map(row=>row.source_system))].sort(),[state.rows]);
  const counts=useMemo(()=>documentCounts(state.rows),[state.rows]);
  const scopePresentation=config?.scopePresentation||{};
  const companyLabel=scopePresentation.entityLabel||'Selected company';
  const periodLabel=scopePresentation.periodLabel||'Selected reporting period';
  const open=async id=>{detailReturnRef.current={focusId:`authoritative-source-document-${id}`,pageY:globalThis.scrollY||0,tableX:listScrollRef.current?.scrollLeft||0,query,sourceSystem};setState(current=>({...current,phase:'DETAIL_LOADING',error:null}));const result=await readAuthoritativeSourceDocumentDetail({config,sourceDocumentId:id,fetcher});if(!result.ok){detailReturnRef.current=null;setState(current=>({...current,phase:'READY',error:failure(result,'Source Document detail could not be loaded.')}));return;}setState(current=>({...current,phase:'READY',detail:result.detail}));};
  const backToList=()=>{const context=detailReturnRef.current;setQuery(context?.query||'');setSourceSystem(context?.sourceSystem||'ALL');setState(current=>({...current,detail:null}));const restore=()=>{listScrollRef.current?.scrollTo?.({left:context?.tableX||0});globalThis.scrollTo?.(0,context?.pageY||0);globalThis.document?.getElementById(context?.focusId)?.focus?.({preventScroll:true});detailReturnRef.current=null;};if(typeof globalThis.requestAnimationFrame==='function')globalThis.requestAnimationFrame(restore);else setTimeout(restore,0);};
  if(state.phase==='LOADING')return <StateBlock tone="loading">Loading authoritative Source Document evidence…</StateBlock>;
  if(state.detail){const detail=state.detail;return <AuthoritativeLineageDrill config={config} fetcher={fetcher} initial={{kind:'SOURCE',detail,context:{entityId:config.entityId,periodId:config.periodId,sourceDocumentId:detail.source_document_id,sourceRevision:detail.source_document_revision,payloadHash:detail.payload_hash}}} onExit={backToList}/>;/* legacy retained below for stable visual source guards */return <section className="full-bleed qbo-transaction-report authoritative-source-document-detail" aria-labelledby="source-document-detail-title">
    <div className="qbo-report-back"><button type="button" className="btn btn-sm btn-ghost" onClick={backToList}>Back to Source Documents</button><span>{detailScope(detail)}</span></div>
    <header className="gl-drill-head authoritative-source-detail-head"><div><div className="gl-drill-crumb">Source &amp; staging / immutable evidence</div><h1 id="source-document-detail-title">{displayDocument(detail)}</h1><div className="gl-drill-account">{detail.document_type} | {detail.accounting_date} | {detail.currency}</div></div><span className="badge badge-muted">{detail.status}</span></header>
    <section className="authoritative-source-trace" aria-label="Source Document evidence trace"><span>Source</span><b>{detail.source_system}</b><span>Document</span><b>{detail.document_type}</b><span>Journals</span><b>{detail.posted_journal_entry_ids.length}</b><span>Lines</span><b>{detail.source_line_count}</b></section>
    <div className="authoritative-document-detail-summary authoritative-source-detail-summary" aria-label="Source Document evidence summary"><span><i>Document ID</i><b>{detail.source_document_id}</b></span><span><i>Revision</i><b>{detail.source_document_revision}</b></span><span><i>Gross amount</i><b>{detail.gross_amount} {detail.currency}</b></span><span><i>Business date</i><b>{detail.business_date}</b></span></div>
    <p className="report-drill-hint">This page exposes only immutable metadata and retained line evidence returned by the authenticated Source Document API. It does not expose attachment content, raw provider payloads, or any create, edit, post, export, or synchronization action.</p>
    <section className="authoritative-source-metadata" aria-label="Immutable Source Document metadata"><h2>Evidence identity</h2><dl className="evidence-grid"><div><dt>Source module</dt><dd>{detail.source_module}</dd></div><div><dt>Source record</dt><dd>{detail.source_record_id}</dd></div><div><dt>Source version</dt><dd>{detail.source_version}</dd></div><div><dt>Payload hash</dt><dd>{detail.payload_hash}</dd></div><div><dt>Created</dt><dd>{detail.created_at}</dd></div><div><dt>Updated</dt><dd>{detail.updated_at}</dd></div></dl></section>
    <section className="authoritative-source-lines-panel" aria-labelledby="source-document-lines-title"><div className="card-head"><div><h2 id="source-document-lines-title">Retained source lines</h2><p className="muted sm">Line facts only; account and dimensional references remain exactly as supplied by the evidence API.</p></div><span className="badge badge-muted">{detail.lines.length} lines</span></div><div className="table-wrap authoritative-source-document-lines" role="region" tabIndex={0} aria-label="Source Document lines; scroll horizontally to view every column"><table className="tbl"><thead><tr><th>Line</th><th>Direction</th><th className="ta-r">Amount</th><th>Party</th><th>Bank account</th><th>Project / property / unit</th><th>Loan / cost code</th></tr></thead><tbody>{detail.lines.map(line=><tr key={line.source_document_line_id}><td><b>{line.line_no}</b><small className="authoritative-source-line-id">{line.source_line_id}</small></td><td><span className="badge badge-muted">{line.direction}</span></td><td className="ta-r">{line.amount}</td><td>{line.party_ref||empty}</td><td>{line.bank_account_ref||empty}</td><td>{[line.project_ref,line.property_ref,line.unit_ref].filter(Boolean).join(' · ')||empty}</td><td>{[line.loan_ref,line.cost_code_ref].filter(Boolean).join(' · ')||empty}</td></tr>)}</tbody></table></div></section>
  </section>;}
  if(state.phase==='ERROR')return <StateBlock tone="error">{state.error}</StateBlock>;
  return <AuthoritativeSourceDocumentsView
    scope="Source records for the selected company and reporting period. Review the supporting record before relying on it for a close or management report."
    actions={<button type="button" className="btn btn-sm" onClick={load}>Refresh records</button>}
    metrics={<><span><i>Records</i><b>{counts.documents}</b><small>In this view</small></span><span><i>Linked to journals</i><b>{counts.linked}</b><small>Posted-journal references</small></span><span><i>Not yet linked</i><b>{counts.unlinked}</b><small>No journal reference</small></span><span><i>Source systems</i><b>{counts.sourceSystems}</b><small>Included in this view</small></span></>}>
    <section className="authoritative-source-scope" aria-label="Source Document scope"><div><span>Company</span><b title={`Entity ID: ${config.entityId}`}>{companyLabel}</b></div><div><span>Reporting period</span><b title={`Period ID: ${config.periodId}`}>{periodLabel}</b></div><div><span>Record source</span><b>Connected accounting records</b></div></section>
    <section className="authoritative-source-intro" aria-label="Source Document guidance"><div><b>Source records</b><p>Open a record to review its revision, supporting details, and any journal link.</p></div><ul><li><b>Available here</b><span>Record details, source identity, and journal references.</span></li><li><b>Protected</b><span>Attachments and provider payloads stay outside this view.</span></li><li><b>What you can do</b><span>Review records; importing, posting, and synchronization are not available here.</span></li></ul></section>
    <div className="filter-bar authoritative-list-filters authoritative-source-filters" role="search" aria-label="Source Document presentation filters"><label>Search <input value={query} onChange={event=>setQuery(event.target.value)} placeholder="Document, source, type, or status"/></label><label>Source system <select value={sourceSystem} onChange={event=>setSourceSystem(event.target.value)}><option value="ALL">All sources</option>{sourceSystems.map(value=><option key={value} value={value}>{value}</option>)}</select></label><span className="result-count" aria-live="polite">{rows.length} matching source documents</span><button type="button" className="btn btn-sm btn-ghost" onClick={()=>{setQuery('');setSourceSystem('ALL');}}>Clear filters</button></div>
    {state.error&&<StateBlock tone="error">{state.error}</StateBlock>}{state.phase==='DETAIL_LOADING'&&<StateBlock tone="loading">Loading immutable source evidence…</StateBlock>}{state.rows.length===0?<StateBlock tone="empty" title="No source documents in this scope">No source documents were returned for this entity. A scoped empty response is not evidence that no source activity exists.</StateBlock>:rows.length===0?<StateBlock tone="empty" title="No source documents match these filters">Change a presentation filter to see retained Source Document facts. A filtered empty result is not evidence of zero activity.</StateBlock>:<div ref={listScrollRef} className="table-wrap authoritative-source-document-list" role="region" tabIndex={0} aria-label="Source Documents; scroll horizontally to view every column"><table className="tbl"><thead><tr><th>Document</th><th>Source</th><th>Type</th><th>Accounting date</th><th className="ta-r">Amount</th><th>Currency</th><th>Status</th><th>Journal evidence</th><th>Open</th></tr></thead><tbody>{rows.map(row=><tr key={row.source_document_id}><td><b>{displayDocument(row)}</b><small className="authoritative-source-row-id">Revision {row.source_document_revision} | {row.source_record_id}</small></td><td>{row.source_system}<small className="authoritative-source-row-id">{row.source_module}</small></td><td>{row.document_type}</td><td>{row.accounting_date}</td><td className="ta-r">{row.gross_amount}</td><td>{row.currency}</td><td><span className="badge badge-muted">{row.status}</span></td><td>{row.posted_journal_entry_ids.length?`${row.posted_journal_entry_ids.length} retained`:'Not returned'}</td><td><button id={`authoritative-source-document-${row.source_document_id}`} type="button" className="btn btn-sm" onClick={()=>void open(row.source_document_id)}>Open evidence</button></td></tr>)}</tbody></table></div>}
  </AuthoritativeSourceDocumentsView>;
}
