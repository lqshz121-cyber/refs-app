import React from 'react';
import { nextAuthoritativeWorkflowAction } from './authoritative-workflow.js';
import { StateBlock } from './ui.jsx';
import {AuthoritativeScopeEmpty} from './authoritative-read-state.jsx';
import {AuthoritativeApArView} from './authoritative-ap-ar-view.jsx';
import {AuthoritativeWbsLivePilotObservation,WBS_LIVE_PILOT_SURFACE_TOOLS} from './authoritative-wbs-live-pilot-observation.jsx';
import {AuthoritativeSecondaryDisclosure} from './authoritative-secondary-disclosure.jsx';
import {
  DEFAULT_AUTHORITATIVE_LIST_VIEW,
  authoritativeEvidenceKey,
  filterAuthoritativeRows,
  normalizeAuthoritativeListView,
  paginateAuthoritativeRows,
} from './authoritative-list-context.js';

const money=(value,currency)=>new Intl.NumberFormat('en-US',{style:'currency',currency:/^[A-Z]{3}$/.test(currency||'')?currency:'USD'}).format(Number(value)||0);
const date=/^\d{4}-\d{2}-\d{2}$/;
const amount=/^(?:0|[1-9]\d{0,15})(?:\.\d{1,4})?$/;
const account=/^[A-Za-z0-9._-]{1,64}$/;
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const revision=value=>Number.isSafeInteger(Number(value))&&Number(value)>=0;

// List rows are facts, not lineage.  A later API contract may attach a
// complete immutable evidence object, but a browser must never assemble one
// from unrelated list fields.  Every retained link below is therefore bound
// back to the exact object id, object revision, entity, and posted journal
// revision that the current list row reports.
export const authoritativeLineageFor=(record,entityId)=>{
  const lineage=record?.lineage;
  const recordId=record?.business_document_id||record?.business_adjustment_id;
  if(!lineage||typeof lineage!=='object'||Array.isArray(lineage)||!uuid.test(recordId||'')||lineage.entity_id!==entityId||lineage.record_id!==recordId||!revision(record?.revision??record?.version)||Number(lineage.record_revision)!==Number(record.revision??record.version))return null;
  const ids=['source_document_id','receipt_id','mapping_snapshot_id','posted_journal_entry_id'];
  const versions=['source_document_revision','receipt_revision','mapping_version','posted_journal_revision'];
  if(ids.some(field=>!uuid.test(lineage[field]||''))||versions.some(field=>!revision(lineage[field]))||!Array.isArray(lineage.audit_event_ids)||!lineage.audit_event_ids.length||new Set(lineage.audit_event_ids).size!==lineage.audit_event_ids.length||lineage.audit_event_ids.some(id=>!uuid.test(id||''))||!Array.isArray(lineage.ledger_line_ids)||!lineage.ledger_line_ids.length||new Set(lineage.ledger_line_ids).size!==lineage.ledger_line_ids.length||lineage.ledger_line_ids.some(id=>!uuid.test(id||'')))return null;
  const journalId=record?.journal_entry_id||record?.posted_journal_entry_id;
  if(record?.journal_status!=='POSTED'||!uuid.test(journalId||'')||journalId!==lineage.posted_journal_entry_id||!revision(record?.journal_revision)||Number(record.journal_revision)!==Number(lineage.posted_journal_revision))return null;
  if(record?.posted_journal_entry_id&&record.posted_journal_entry_id!==lineage.posted_journal_entry_id)return null;
  return {source_document_id:lineage.source_document_id,source_document_revision:Number(lineage.source_document_revision),receipt_id:lineage.receipt_id,receipt_revision:Number(lineage.receipt_revision),mapping_snapshot_id:lineage.mapping_snapshot_id,mapping_version:Number(lineage.mapping_version),audit_event_ids:[...lineage.audit_event_ids],posted_journal_entry_id:lineage.posted_journal_entry_id,posted_journal_revision:Number(lineage.posted_journal_revision),ledger_line_ids:[...lineage.ledger_line_ids]};
};
const AuthoritativeLineageBlock=({record,entityId,subject})=>{const lineage=authoritativeLineageFor(record,entityId);return lineage?<details className="authoritative-secondary-disclosure authoritative-lineage" aria-label={`${subject} immutable lineage`}><summary><span>Immutable authoritative lineage</span><span className="badge badge-muted">POSTED EVIDENCE</span></summary><section><div className="table-wrap authoritative-document-detail-table" role="region" tabIndex={0} aria-label={`${subject} immutable lineage fields; scroll horizontally to view every column`}><table className="tbl"><tbody><tr><th scope="row">Source document</th><td>{lineage.source_document_id} · rev {lineage.source_document_revision}</td><th scope="row">Receipt</th><td>{lineage.receipt_id} · rev {lineage.receipt_revision}</td></tr><tr><th scope="row">Mapping snapshot</th><td>{lineage.mapping_snapshot_id} · v{lineage.mapping_version}</td><th scope="row">POSTED journal</th><td>{lineage.posted_journal_entry_id} · rev {lineage.posted_journal_revision}</td></tr><tr><th scope="row">Audit events</th><td>{lineage.audit_event_ids.join(', ')}</td><th scope="row">Ledger lines</th><td>{lineage.ledger_line_ids.join(', ')}</td></tr></tbody></table></div></section></details>:<StateBlock tone="warn" title="BLOCKED — authoritative lineage unavailable">Source, receipt, mapping, audit, journal, and ledger links were not returned for this revision. List facts remain read only.</StateBlock>;};
export const validateAuthoritativeDocumentDraft=values=>{
  const kind=['AP_BILL','AR_INVOICE'].includes(values?.kind)?values.kind:null;
  const documentNumber=String(values?.documentNumber||'').trim(),counterpartyRef=String(values?.counterpartyRef||'').trim(),counterpartyName=String(values?.counterpartyName||'').trim(),currency=String(values?.currency||'').trim().toUpperCase(),accountingDate=String(values?.accountingDate||'').trim(),dueDate=String(values?.dueDate||'').trim(),value=String(values?.amount||'').trim(),offsetAccountCode=String(values?.offsetAccountCode||'').trim(),description=String(values?.description||'').trim();
  if(!kind||!documentNumber||documentNumber.length>128||!counterpartyRef||counterpartyRef.length>128||!counterpartyName||counterpartyName.length>255||!/^[A-Z]{3}$/.test(currency)||!date.test(accountingDate)||!amount.test(value)||Number(value)<=0||!account.test(offsetAccountCode)||description.length>2000||(dueDate&&!date.test(dueDate)))return {ok:false,code:'AUTHORITATIVE_DOCUMENT_INVALID',message:'Complete the Draft fields with valid dates, a positive four-decimal amount, and an account code.'};
  return {ok:true,kind,document:{documentNumber,counterpartyRef,counterpartyName,currency,accountingDate,dueDate:dueDate||null,amount:value,offsetAccountCode,description:description||null}};
};
export function AuthoritativeDocumentTable({title,documents=[],kind,onOpen}) {
  const bill=kind==='AP',number=bill?'bill_no':'inv_no',counterparty=bill?'vendor_name':'customer_name',dateKey=bill?'bill_date':'inv_date';
  return <section aria-label={title}><div className="card-head"><div><h2>{title}</h2><p className="muted sm">{documents.length} {documents.length===1?(bill?'bill':'invoice'):(bill?'bills':'invoices')}</p></div></div>{documents.length?<div className="table-wrap authoritative-document-table" role="region" tabIndex={0} aria-label={`${title}; scroll horizontally to view every column`}><table className="tbl"><thead><tr><th scope="col">{bill?'Bill':'Invoice'}</th><th scope="col">{bill?'Vendor':'Customer'}</th><th scope="col">Date</th><th scope="col">Due date</th><th scope="col" className="ta-r">Amount</th><th scope="col" className="ta-r">Open balance</th><th scope="col">Status</th><th scope="col">Details</th></tr></thead><tbody>{documents.map(row=>{
    const key=authoritativeEvidenceKey('document',row)||row.journal_entry_id||row[bill?'bill_id':'inv_id']||row[number];
    const focusId=authoritativeEvidenceKey('document',row)?`authoritative-document-${row.business_document_id}`:undefined;
    return <tr key={key}><td>{row[number]}</td><td>{row[counterparty]}</td><td>{row[dateKey]}</td><td>{row.due_date||'Not retained'}</td><td className="ta-r">{money(row.amount,row.currency)}</td><td className="ta-r">{money(row.open_balance,row.currency)}</td><td><span className="badge badge-muted authoritative-row-status">{row.status}</span></td><td><button id={focusId} type="button" className="btn btn-sm btn-ghost" onClick={event=>onOpen?.(row,focusId,Number(event.currentTarget.closest('.table-wrap')?.scrollLeft)||0)}>View details</button></td></tr>;
  })}</tbody></table></div>:<AuthoritativeScopeEmpty subject={bill?'AP bills':'AR invoices'}/>}</section>;
}

const documentReturnScope = (entityLabel, view, revision, includeVendor) => [
  entityLabel,
  `authoritative list revision ${revision}`,
  `search ${view?.query || 'All'}`,
  `status ${view?.status === 'ALL' || !view?.status ? 'All statuses' : view.status}`,
  `from ${view?.from || 'Any date'}`,
  `through ${view?.through || 'Any date'}`,
  ...(includeVendor ? [`vendor ${view?.counterparty || 'All vendors'}`] : []),
  ...(includeVendor ? [`category ${view?.accountCode || 'All offset accounts'}`] : []),
  ...(includeVendor ? [`transaction type ${view?.transactionType || 'ALL'}`] : []),
  `page ${view?.page || 1}`,
].join(' | ');

export function AuthoritativeDocumentDetail({document,kind,entityId,config,returnContext,onBack}){const bill=kind==='AP',number=bill?'bill_no':'inv_no',counterparty=bill?'vendor_name':'customer_name',dateKey=bill?'bill_date':'inv_date',title=bill?'Bill evidence':'Invoice evidence',entityLabel=config?.entityId===entityId?config?.scopePresentation?.entityLabel||'Configured entity':'Configured entity',periodLabel=config?.periodId===document.period_id?config?.scopePresentation?.periodLabel||'Configured period':'Configured period',returnScope=documentReturnScope(entityLabel,returnContext?.view,document.revision,bill);return <section className="full-bleed qbo-transaction-report authoritative-document-detail" aria-label={title}><div className="qbo-report-back"><button type="button" onClick={onBack}>Back to {bill?'AP bills':'AR invoices'}</button><details className="authoritative-return-context"><summary>List filters retained</summary><span>{returnScope}</span></details></div><div className="gl-drill-head"><div><div className="gl-drill-crumb">{bill?'Payables':'Receivables'} / read-only evidence</div><h1>{document[number]}</h1><div className="gl-drill-account">{document[counterparty]} · {document[dateKey]}</div></div><span className="badge badge-muted">{document.status}</span></div><div className="authoritative-document-detail-summary" aria-label={`${title} summary`}><span><i>{bill?'Vendor':'Customer'}</i><b>{document[counterparty]}</b></span><span><i>Original amount</i><b>{money(document.amount,document.currency)}</b></span><span><i>Open balance</i><b>{money(document.open_balance,document.currency)}</b></span><span><i>Due date</i><b>{document.due_date||'Not retained'}</b></span></div><p className="report-drill-hint">Read-only retained evidence. Document actions are unavailable here.</p><AuthoritativeLineageBlock record={document} entityId={entityId} subject={bill?'Bill':'Invoice'}/><div className="table-wrap authoritative-document-detail-table" role="region" tabIndex={0} aria-label={`${title} fields; scroll horizontally to view every column`}><table className="tbl"><tbody><tr><th scope="row">Entity</th><td title={`Entity ID: ${entityId}`}>{entityLabel}</td><th scope="row">Currency</th><td>{document.currency}</td></tr><tr><th scope="row">Offset account</th><td>{document.account_code||'Not retained'}</td><th scope="row">Posted journal</th><td>{document.je_number||'Not retained'}</td></tr><tr><th scope="row">Period</th><td title={`Period ID: ${document.period_id||'Not retained'}`}>{periodLabel}</td><th scope="row">Description</th><td>{document.description||'Not retained'}</td></tr></tbody></table></div></section>;}

export function AuthoritativeAdjustmentSummary({title,adjustments=[],kind,onOpen}) {
  const payables=kind==='AP';
  return <section aria-label={title}><div className="card-head"><div><h2>{title}</h2><p className="muted sm">{adjustments.length} {adjustments.length===1?'adjustment':'adjustments'}</p></div></div>{adjustments.length?<div className="table-wrap authoritative-adjustment-table" role="region" tabIndex={0} aria-label={`${title}; scroll horizontally to view every column`}><table className="tbl"><thead><tr><th scope="col">Adjustment</th><th scope="col">Date</th><th scope="col">Reason</th><th scope="col" className="ta-r">Amount</th><th scope="col">Status</th><th scope="col">Details</th></tr></thead><tbody>{adjustments.map(row=>{
    const focusId=authoritativeEvidenceKey('adjustment',row)?`authoritative-adjustment-${row.business_adjustment_id}`:undefined;
    return <tr key={row.business_adjustment_id}><td>{row.adjustment_kind}</td><td>{row.accounting_date}</td><td>{row.reason||'Not retained'}</td><td className="ta-r">{money(row.amount,row.currency)}</td><td>{row.status}</td><td><button id={focusId} type="button" className="btn btn-sm btn-ghost" onClick={event=>onOpen?.(row,focusId,Number(event.currentTarget.closest('.table-wrap')?.scrollLeft)||0)}>View details</button></td></tr>;
  })}</tbody></table></div>:<StateBlock tone="empty" title="No authoritative adjustments in this scope">This scoped empty result is not evidence of a zero balance.</StateBlock>}</section>;
}

export function AuthoritativeAdjustmentDetail({adjustment,side,entityId,config,returnContext,onBack}){const payables=side==='AP',label=payables?'AP adjustment evidence':'AR adjustment evidence',entityLabel=config?.entityId===entityId?config?.scopePresentation?.entityLabel||'Configured entity':'Configured entity',periodLabel=config?.periodId===adjustment.period_id?config?.scopePresentation?.periodLabel||'Configured period':'Configured period',returnScope=documentReturnScope(entityLabel,returnContext?.view,adjustment.version,payables);return <section className="full-bleed qbo-transaction-report authoritative-document-detail" aria-label={label}><div className="qbo-report-back"><button type="button" onClick={onBack}>Back to {payables?'AP adjustments':'AR adjustments'}</button><details className="authoritative-return-context"><summary>List filters retained</summary><span>{returnScope}</span></details></div><div className="gl-drill-head"><div><div className="gl-drill-crumb">{payables?'Payables':'Receivables'} / read-only adjustment evidence</div><h1>{adjustment.adjustment_kind}</h1><div className="gl-drill-account">{adjustment.accounting_date} · {adjustment.business_adjustment_id}</div></div><span className="badge badge-muted">{adjustment.status}</span></div><div className="authoritative-document-detail-summary" aria-label={`${label} summary`}><span><i>Amount</i><b>{money(adjustment.amount,adjustment.currency)}</b></span><span><i>Period</i><b title={`Period ID: ${adjustment.period_id||'Not retained'}`}>{periodLabel}</b></span><span><i>Currency</i><b>{adjustment.currency}</b></span><span><i>Revision</i><b>{adjustment.version}</b></span></div><p className="report-drill-hint">Read-only retained evidence. Adjustment actions are unavailable here.</p><AuthoritativeLineageBlock record={adjustment} entityId={entityId} subject="Adjustment"/><details className="authoritative-secondary-disclosure authoritative-adjustment-fields"><summary><span>Adjustment evidence fields</span><span className="badge badge-muted">READ ONLY</span></summary><section><div className="table-wrap authoritative-document-detail-table" role="region" tabIndex={0} aria-label={`${label} fields; scroll horizontally to view every column`}><table className="tbl"><tbody><tr><th scope="row">Entity</th><td title={`Entity ID: ${entityId}`}>{entityLabel}</td><th scope="row">Document ID</th><td>{adjustment.business_document_id||'Not retained'}</td></tr><tr><th scope="row">Source adjustment</th><td>{adjustment.source_adjustment_id||'Not retained'}</td><th scope="row">Journal entry</th><td>{adjustment.journal_entry_id||'Not retained'}</td></tr><tr><th scope="row">Journal status</th><td>{adjustment.journal_status||'Not retained'}</td><th scope="row">Created at</th><td>{adjustment.created_at}</td></tr><tr><th scope="row">Reason</th><td colSpan="3">{adjustment.reason||'Not retained'}</td></tr></tbody></table></div></section></details></section>;}

export function AuthoritativeDocumentWorkspace({kind,documents=[],adjustments=[],view,onViewChange,onOpenDocument,onOpenAdjustment,onOpenAging,config,fetcher=globalThis.fetch}) {
  const bill=kind==='AP';
  const workspaceLabel=bill?'Payables':'Receivables';
  const state=normalizeAuthoritativeListView(view);
  const dateField=bill?'bill_date':'inv_date';
  const counterpartyField=bill?'vendor_name':'customer_name';
  // Offset-account is an AP Bill category presentation filter. An account code
  // retained in a restored AP context must never narrow AR invoices because AR
  // has no corresponding visible category contract.
  const documentView=bill?state:{...state,accountCode:'ALL'};
  const filteredDocuments=filterAuthoritativeRows(documents,documentView,dateField,{counterpartyField,accountField:bill?'account_code':null});
  // AP Vendor credits are retained adjustment facts, not bill rows.  The
  // presentation-only type selector must never synthesize an expense/payment.
  const visibleDocuments=bill&&state.transactionType==='VENDOR_CREDITS'?[]:filteredDocuments;
  const page=paginateAuthoritativeRows(visibleDocuments,state);
  const filteredAdjustments=filterAuthoritativeRows(adjustments,{...state,accountCode:''},'accounting_date');
  const visibleAdjustments=bill&&state.transactionType==='BILLS'?[]:filteredAdjustments.filter(row=>state.transactionType!=='VENDOR_CREDITS'||row.adjustment_kind==='AP_VENDOR_CREDIT');
  const adjustmentPage=paginateAuthoritativeRows(visibleAdjustments,state);
  const presentedAdjustments=bill&&state.transactionType==='VENDOR_CREDITS'?adjustmentPage.rows:visibleAdjustments;
  const sourceEmpty=bill&&documents.length===0&&adjustments.length===0;
  const showDocumentList=!bill||state.transactionType!=='VENDOR_CREDITS';
  const showAdjustmentList=!bill||state.transactionType!=='BILLS';
  const showAdjustmentSection=showAdjustmentList&&(!bill||visibleAdjustments.length>0||state.transactionType==='VENDOR_CREDITS');
  const visibleResultCount=(showDocumentList?page.total:0)+(showAdjustmentList?visibleAdjustments.length:0);
  const statuses=[...new Set([...documents,...adjustments].map(row=>row?.status).filter(Boolean))].sort();
  const counterparties=[...new Set(documents.map(row=>row?.[counterpartyField]).filter(Boolean))].sort((left,right)=>left.localeCompare(right));
  const accountCodes=[...new Set(documents.map(row=>row?.account_code).filter(Boolean))].sort((left,right)=>left.localeCompare(right));
  const appliedScope=[
    state.status!=='ALL'?`Status: ${state.status}`:null,
    state.from?`From: ${state.from}`:null,
    state.through?`Through: ${state.through}`:null,
    state.counterparty!=='ALL'?`${bill?'Vendor':'Customer'}: ${state.counterparty}`:null,
    bill&&state.accountCode!=='ALL'?`Category: ${state.accountCode}`:null,
    bill&&state.transactionType!=='ALL'?`Transaction type: ${state.transactionType==='BILLS'?'Bills':'Vendor credits'}`:null,
  ].filter(Boolean);
  const moreFilterCount=[state.from,state.through,state.counterparty!=='ALL',state.accountCode!=='ALL'].filter(Boolean).length;
  const change=patch=>onViewChange?.({...state,...patch,page:patch.page??1});
  const tabs=bill?[
    {id:'ALL',label:'All transactions'}, {id:'BILLS',label:'Bills'}, {id:'VENDOR_CREDITS',label:'Vendor credits'}, {id:'AGING',label:'AP Aging',focusId:'authoritative-ap-aging-launch'}, {id:'VENDORS',label:'Vendors',unavailable:true},
  ]:[{id:'INVOICES',label:'Invoices'}, {id:'RECEIPTS',label:'Receipts',unavailable:true}, {id:'AGING',label:'AR Aging',focusId:'authoritative-ar-aging-launch'}, {id:'COUNTERPARTIES',label:'Counterparties',unavailable:true}];
  const activeTab=bill?state.transactionType:'INVOICES';
  const selectTab=next=>{
    if(next==='AGING'){onOpenAging?.();return;}
    if(bill)change({transactionType:next});
  };
  // QBO Expenses keeps the list count beside its filters and does not repeat
  // the same empty totals as KPI cards. AR remains unchanged until observed.
  const metrics=bill?[]:[
    {label:'Invoices',value:documents.length,sub:'All records'}, {label:'Visible',value:page.total,sub:'After filters'}, {label:'Adjustments',value:adjustments.length,sub:'All records'}, {label:'Visible adjustments',value:visibleAdjustments.length,sub:'After filters'},
  ];
  return <AuthoritativeApArView kind={kind} className="authoritative-document-workspace stack" headerClassName={`authoritative-document-page-head${bill?' authoritative-expense-page-head':''}`} metrics={metrics} tabs={tabs} activeTab={activeTab} onSelectTab={selectTab} toolbar={bill?null:<p className="muted sm authoritative-api-scope">API read · filters do not change records.</p>}>
    <section className={`card authoritative-filter-card${bill?' authoritative-expense-filter-card':''}`} aria-label={`${workspaceLabel} API list filters`}>
    {!bill&&<div className="authoritative-filter-head"><div><h2>Filters</h2></div><span className="badge badge-muted">READ ONLY</span></div>}
    <div className={`filter-bar authoritative-list-filters${bill?' authoritative-expense-list-filters':''}`} role="search" aria-label={`${bill?'Payables':'Receivables'} presentation filters`}>
      <label>Search <input value={state.query} onChange={event=>change({query:event.target.value})} placeholder={bill?'Bill, vendor, account, or reference':'Invoice, customer, account, or reference'}/></label>
      <label>Status <select value={state.status} onChange={event=>change({status:event.target.value})}><option value="ALL">All statuses</option>{statuses.map(status=><option key={status} value={status}>{status}</option>)}</select></label>
      {bill?<details className="authoritative-expense-more-filters"><summary>More filters{moreFilterCount?` (${moreFilterCount})`:''}</summary><div className="authoritative-expense-more-filter-grid">
        <label>From <input type="date" value={state.from} onChange={event=>change({from:event.target.value})}/></label>
        <label>Through <input type="date" value={state.through} onChange={event=>change({through:event.target.value})}/></label>
        <label>Vendor <select value={state.counterparty} onChange={event=>change({counterparty:event.target.value})}><option value="ALL">All vendors</option>{counterparties.map(name=><option key={name} value={name}>{name}</option>)}</select></label>
        {accountCodes.length>0?<label>Category <select value={state.accountCode} onChange={event=>change({accountCode:event.target.value})}><option value="ALL">All categories</option>{accountCodes.map(code=><option key={code} value={code}>{code}</option>)}</select></label>:<span className="muted sm">Category unavailable for this result.</span>}
      </div></details>:<>
        <label>From <input type="date" value={state.from} onChange={event=>change({from:event.target.value})}/></label>
        <label>Through <input type="date" value={state.through} onChange={event=>change({through:event.target.value})}/></label>
        <label>Customer <select value={state.counterparty} onChange={event=>change({counterparty:event.target.value})}><option value="ALL">All customers</option>{counterparties.map(name=><option key={name} value={name}>{name}</option>)}</select></label>
      </>}
      <button type="button" className="btn btn-sm btn-ghost" disabled={!state.query&&!appliedScope.length} onClick={()=>change({query:'',status:'ALL',transactionType:'ALL',from:'',through:'',counterparty:'ALL',accountCode:'ALL'})}>Reset filters</button>
      <span className="result-count" aria-live="polite">{visibleResultCount} {visibleResultCount===1?'result':'results'}</span>
    </div>
    <p className="muted sm authoritative-applied-scope" aria-live="polite">{appliedScope.length?appliedScope.join(' · '):'All records'}</p>
    </section>
    {showDocumentList&&<section className="card" aria-label={`${workspaceLabel} document list facts`}>
    {page.total?<AuthoritativeDocumentTable title={bill?'Bills':'AR invoices'} documents={page.rows} kind={kind} onOpen={onOpenDocument}/>:sourceEmpty?<StateBlock tone="empty" title="No expenses found">Try changing the filters. Empty results do not confirm a zero balance.</StateBlock>:bill&&state.transactionType==='ALL'&&visibleResultCount===0?<StateBlock tone="empty" title="No expenses match these filters">Try changing or resetting the filters. This scoped result is not evidence of zero activity.</StateBlock>:documents.length?<StateBlock tone="empty" title={`No ${bill?'bills':'invoices'} match these filters`}>Try changing or resetting the filters. This result does not confirm a zero balance.</StateBlock>:<AuthoritativeScopeEmpty subject={bill?'AP bills':'AR invoices'}/>}
    {page.pageCount>1&&<nav className="pagination" aria-label={`${bill?'AP bills':'AR invoices'} pages`}><button type="button" className="btn btn-sm btn-ghost" disabled={page.page===1} onClick={()=>change({page:page.page-1})}>Previous</button><span>Page {page.page} of {page.pageCount}</span><button type="button" className="btn btn-sm btn-ghost" disabled={page.page===page.pageCount} onClick={()=>change({page:page.page+1})}>Next</button></nav>}
    </section>}
    {showAdjustmentSection&&<section className="card" aria-label={`${workspaceLabel} adjustment list facts`}>
    {visibleAdjustments.length?<><AuthoritativeAdjustmentSummary title={bill&&state.transactionType==='VENDOR_CREDITS'?'Vendor credits':bill?'AP adjustments':'AR adjustments'} adjustments={presentedAdjustments} kind={kind} onOpen={onOpenAdjustment}/>{bill&&state.transactionType==='VENDOR_CREDITS'&&adjustmentPage.pageCount>1&&<nav className="pagination" aria-label="Vendor credit pages"><button type="button" className="btn btn-sm btn-ghost" disabled={adjustmentPage.page===1} onClick={()=>change({page:adjustmentPage.page-1})}>Previous</button><span>Page {adjustmentPage.page} of {adjustmentPage.pageCount}</span><button type="button" className="btn btn-sm btn-ghost" disabled={adjustmentPage.page===adjustmentPage.pageCount} onClick={()=>change({page:adjustmentPage.page+1})}>Next</button></nav>}</>:<StateBlock tone="empty" title={bill&&state.transactionType==='VENDOR_CREDITS'&&!adjustments.length?'No vendor credits found':adjustments.length?'No adjustments match these filters':bill?'No authoritative adjustments in this scope':'No adjustments found'}>{adjustments.length?'Try changing or resetting the filters. This result does not confirm a zero balance.':bill&&state.transactionType==='VENDOR_CREDITS'?'No retained vendor credits were returned for this scope. This is not evidence of a zero AP balance.':bill?'This scoped empty result is not evidence of a zero balance.':'No adjustments were returned for this scope. This does not confirm a zero balance.'}</StateBlock>}
    </section>}
    {bill&&<AuthoritativeSecondaryDisclosure label="External WBS evidence"><AuthoritativeWbsLivePilotObservation config={config} fetcher={fetcher} tools={WBS_LIVE_PILOT_SURFACE_TOOLS.payables} title="External WBS payables observation"/></AuthoritativeSecondaryDisclosure>}
  </AuthoritativeApArView>;
}
export function AuthoritativeWorkflowTable({title,documents=[],kind,onWorkflow,workingJournalIds=new Set()}){const bill=kind==='AP';return <section aria-label={title}><h2>{title}</h2>{documents.map(row=>{const action=nextAuthoritativeWorkflowAction(row.journal_status);return <div key={row.journal_entry_id}>{row[bill?'bill_no':'inv_no']} {action?<button disabled={workingJournalIds.has(row.journal_entry_id)} onClick={()=>onWorkflow(row,action)}>{action}</button>:row.journal_status}</div>;})}</section>;}
export function AuthoritativeWorkflowAdjustmentTable({title,adjustments=[],onWorkflow,workingJournalIds=new Set()}){return <section aria-label={title}><h2>{title}</h2>{adjustments.map(row=>{const action=nextAuthoritativeWorkflowAction(row.journal_status);return <div key={row.business_adjustment_id}>{row.adjustment_kind} {action?<button disabled={workingJournalIds.has(row.journal_entry_id)} onClick={()=>onWorkflow(row,action)}>{action}</button>:row.journal_status}</div>;})}</section>;}
export function AuthoritativeCreditApplicationForm({kind,credits=[],documents=[]}){const label=kind==='AR_CREDIT_MEMO'?'Credit memo':'Vendor credit';return <section aria-label={`Apply ${label}`}><h2>Apply {label}</h2><select>{credits.filter(x=>x.status==='POSTED').map(x=><option key={x.business_adjustment_id}>{x.business_adjustment_id}</option>)}</select><select>{documents.map(x=><option key={x.business_document_id}>{x.inv_no||x.bill_no}</option>)}</select></section>;}
export function AuthoritativeRefundForm({credits=[]}){return <section aria-label="Create refund Draft"><h2>Create refund Draft</h2><label>Credit memo<select>{credits.filter(x=>x.status==='POSTED').map(x=><option key={x.business_adjustment_id}>{x.business_adjustment_id}</option>)}</select></label></section>;}
export function AuthoritativeDraftForm(){return <section aria-label="Create Draft only"><h2>Create Draft only</h2><p>Drafts are sent to the authoritative API and require review and approval before any separate posting command.</p></section>;}
export function AuthoritativeRuntimeLock(){return <main className="login-shell"><section className="login-card" role="alert"><h1>Authoritative API required</h1><p>The deployed REFS client is locked until its HTTPS accounting API and OIDC token provider are configured.</p></section></main>;}
